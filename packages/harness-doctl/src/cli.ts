#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "./spec/parse.js";
import { renderPlan } from "./render/index.js";
import { runGates } from "./gates/index.js";
import { materialize } from "./provision/materialize.js";
import { Provisioner, type ProvisionerOpts } from "./provision/index.js";
import { computeRequiredEnv, selectProvider } from "./secrets/index.js";
import type { RenderedStack } from "./render/types.js";
import type { ResourceGraph } from "./graph/types.js";
import type { GateLevel } from "./gates/types.js";
import type { LogFn } from "./provision/types.js";

// Standalone `harness` CLI (also usable without agent-swarm).
//   harness validate    <spec.yaml>
//   harness graph       <spec.yaml>
//   harness render      <spec.yaml> [--prod]
//   harness gates       <spec.yaml> [--prod]
//   harness materialize <spec.yaml> [outDir] [--prod]
//   harness plan        <spec.yaml> [--prod]     (runs gates, then `tofu plan`)
//   harness apply       <spec.yaml> [--prod]     (runs gates, then apply + deploy)

const USAGE = `harness — Infrastructure from Spec (DigitalOcean)

Usage:
  harness validate    <spec.yaml>
  harness graph       <spec.yaml>
  harness render      <spec.yaml> [--prod]
  harness gates       <spec.yaml> [--prod]
  harness materialize <spec.yaml> [outDir] [--prod]
  harness secrets     <spec.yaml> [--prod]     (list required env vars)
  harness plan        <spec.yaml> [--prod]
  harness apply       <spec.yaml> [--prod]

Env for plan/apply: DIGITALOCEAN_TOKEN, HEADSCALE_URL, TAILSCALE_AUTHKEY,
  SPACES_KEY, SPACES_SECRET, SITE_DOMAIN
Remote state: TOFU_STATE_BUCKET, TOFU_STATE_REGION, TOFU_STATE_ENDPOINT
Secrets: SECRETS_FILE (SOPS-encrypted .env/.yaml/.json), SOPS_AGE_KEY_FILE
`;

const log: LogFn = (level, message) => process.stderr.write(`  [${level}] ${message}\n`);

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const file = argv[1];
  if (!file) {
    process.stderr.write(`error: missing <spec.yaml>\n\n${USAGE}`);
    return 2;
  }
  const rest = argv.slice(2);
  const prod = rest.includes("--prod");

  const { spec, graph, errors } = parseSpec(read(file));
  if (errors.length || !spec || !graph) {
    process.stderr.write("spec errors:\n");
    for (const e of errors) process.stderr.write(`  ${e.path}: ${e.message}\n`);
    return 1;
  }

  switch (cmd) {
    case "validate":
      process.stdout.write(`ok: ${spec.project} (${Object.keys(spec.services).length} service(s))\n`);
      return 0;

    case "graph":
      process.stdout.write(JSON.stringify(graph, null, 2) + "\n");
      return 0;

    case "render": {
      const stack = renderPlan(graph, { region: spec.region, prod });
      for (const f of [...stack.tofu, stack.compose, stack.caddy, stack.infraConfig]) {
        process.stdout.write(`\n# ===== ${f.path} =====\n${f.content}\n`);
      }
      return 0;
    }

    case "gates":
      return (await gate(graph, spec.region, prod)) ? 0 : 1;

    case "materialize": {
      const outDir = rest.find((a) => !a.startsWith("--")) ?? join(".harness", spec.project);
      const stack = renderPlan(graph, { region: spec.region, prod });
      const layout = materialize(stack, outDir);
      process.stdout.write(`materialized ${spec.project} -> ${layout.root}\n  tofu dir: ${layout.tofuDir}\n`);
      return 0;
    }

    case "secrets": {
      const stack = renderPlan(graph, { region: spec.region, prod });
      const names = computeRequiredEnv(stack);
      process.stdout.write(`required env for ${spec.project} (${names.length}):\n`);
      for (const n of names) process.stdout.write(`  ${n}\n`);
      process.stdout.write(`\nPut these in a SOPS-encrypted file and point SECRETS_FILE at it.\n`);
      return 0;
    }

    case "plan":
    case "apply": {
      if (!(await gate(graph, spec.region, prod))) {
        process.stderr.write("\naborted: security gates failed (fix the spec or override a named guardrail).\n");
        return 1;
      }
      const stack = renderPlan(graph, { region: spec.region, prod });
      const prov = new Provisioner(provisionerOpts(stack));
      try {
        if (cmd === "plan") {
          const diff = await prov.plan(stack, { project: spec.project });
          process.stdout.write(`\n${diff.summary}\n`);
        } else {
          const res = await prov.apply(stack, { project: spec.project });
          process.stdout.write(`\ndeployed: ${res.url ?? "(url pending)"}  droplet=${res.dropletId ?? "?"}\n`);
        }
        return 0;
      } catch (e) {
        process.stderr.write(`\n${cmd} failed: ${e instanceof Error ? e.message : String(e)}\n`);
        return 3;
      }
    }

    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

async function gate(graph: ResourceGraph, region: string, prod: boolean): Promise<boolean> {
  const stack = renderPlan(graph, { region, prod });
  const report = await runGates(stack);
  for (const r of report.results) process.stdout.write(`  ${icon(r.level)} [${r.id}] ${r.message}\n`);
  process.stdout.write(`\n${report.ok ? "PASS" : "FAIL"} — ${report.summary}\n`);
  return report.ok;
}

function provisionerOpts(stack: RenderedStack): ProvisionerOpts {
  const e = process.env;
  const secrets = selectProvider({
    secretsFile: e.SECRETS_FILE,
    ageKeyFile: e.SOPS_AGE_KEY_FILE,
    requiredNames: computeRequiredEnv(stack),
    log,
  });
  return {
    token: e.DIGITALOCEAN_TOKEN ?? e.DO_TOKEN,
    spacesKey: e.SPACES_KEY,
    spacesSecret: e.SPACES_SECRET,
    stateBucket: e.TOFU_STATE_BUCKET,
    stateRegion: e.TOFU_STATE_REGION,
    stateEndpoint: e.TOFU_STATE_ENDPOINT,
    headscaleUrl: e.HEADSCALE_URL,
    tailscaleAuthkey: e.TAILSCALE_AUTHKEY,
    siteDomain: e.SITE_DOMAIN,
    workRoot: join(".harness"),
    secrets,
    log,
  };
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    process.stderr.write(`error: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}

function icon(level: GateLevel): string {
  return { pass: "✓", warn: "!", error: "✗", skip: "·" }[level];
}

main().then((code) => process.exit(code)).catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
