import { parse as parseYaml } from "yaml";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodesOfKind } from "../graph/types.js";
import type { RenderedStack } from "../render/types.js";
import { commandExists, run } from "../provision/exec.js";
import { materialize, packageRoot } from "../provision/materialize.js";
import type { Gate, GateResult, GateReport } from "./types.js";

export type { GateReport, GateResult, GateLevel } from "./types.js";

// The gate runner IS the product: insecurity requires actively deleting a guardrail.
export async function runGates(stack: RenderedStack): Promise<GateReport> {
  const gates: Gate[] = [rlsRequired, bucketsPrivate, dbNoPublicPort, onlyCaddyPublishes, secretsNotInline, imagesPinned, ...externalScannerGates()];

  const results: GateResult[] = [];
  for (const gate of gates) {
    try {
      results.push(...(await gate.run(stack)));
    } catch (e) {
      results.push({ id: gate.id, level: "error", message: `gate threw: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const errors = results.filter((r) => r.level === "error").length;
  const warns = results.filter((r) => r.level === "warn").length;
  return {
    ok: errors === 0,
    summary: `${errors} error(s), ${warns} warning(s), ${results.length} checks`,
    results,
  };
}

// --- in-process guardrails ----------------------------------------------

const rlsRequired: Gate = {
  id: "spec/rls-required",
  run(stack) {
    return nodesOfKind(stack.graph, "postgres").map((db) =>
      db.attrs.rls === "required"
        ? pass(this.id, `${db.id}: RLS required`)
        : { id: this.id, level: "error", message: `${db.id}: RLS is "${String(db.attrs.rls)}" — every table must be RLS-protected. Override is auditable but blocked by default.` },
    );
  },
};

const bucketsPrivate: Gate = {
  id: "spec/buckets-private",
  run(stack) {
    return nodesOfKind(stack.graph, "object_storage").map((b) =>
      b.attrs.public === true
        ? { id: this.id, level: "warn", message: `${b.id}: bucket is public — ensure this is intentional.` }
        : pass(this.id, `${b.id}: private`),
    );
  },
};

const dbNoPublicPort: Gate = {
  id: "compose/db-no-public-port",
  run(stack) {
    const doc = parseCompose(stack);
    const out: GateResult[] = [];
    for (const [name, svc] of composeServices(doc)) {
      if (/^postgres(_|$)/.test(name)) {
        if (svc.ports) out.push({ id: this.id, level: "error", message: `service "${name}" publishes ports ${JSON.stringify(svc.ports)} — the database must never be reachable from the host/internet.` });
        else out.push(pass(this.id, `${name}: no published port`));
      }
    }
    return out;
  },
};

const onlyCaddyPublishes: Gate = {
  id: "compose/only-caddy-publishes",
  run(stack) {
    const doc = parseCompose(stack);
    const out: GateResult[] = [];
    for (const [name, svc] of composeServices(doc)) {
      if (!svc.ports) continue;
      if (name !== "caddy") {
        out.push({ id: this.id, level: "error", message: `service "${name}" publishes ports — only Caddy may be internet-facing.` });
        continue;
      }
      const bad = svc.ports.filter((p) => !/^(80|443):/.test(String(p)));
      if (bad.length) out.push({ id: this.id, level: "error", message: `caddy publishes non-web ports ${JSON.stringify(bad)} — only 80/443 allowed.` });
      else out.push(pass(this.id, "caddy publishes only 80/443"));
    }
    return out;
  },
};

const secretsNotInline: Gate = {
  id: "artifacts/no-inline-secrets",
  run(stack) {
    // High-signal patterns only; SOPS/$env indirection should keep artifacts clean.
    const patterns: Array<[string, RegExp]> = [
      ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ["do token", /dop_v1_[a-f0-9]{64}/i],
      ["aws key", /AKIA[0-9A-Z]{16}/],
    ];
    const files = [stack.compose, stack.infraConfig, stack.caddy, ...stack.tofu];
    const out: GateResult[] = [];
    for (const f of files) {
      for (const [label, re] of patterns) {
        if (re.test(f.content)) out.push({ id: this.id, level: "error", message: `${f.path}: looks like an inline ${label}. Use SOPS + $env indirection.` });
      }
    }
    return out.length ? out : [pass(this.id, "no inline secrets detected")];
  },
};

const imagesPinned: Gate = {
  id: "compose/images-pinned",
  run(stack) {
    const unpinned = composeServices(parseCompose(stack))
      .filter(([, service]) => typeof service.image === "string")
      .filter(([, service]) => !String(service.image).includes("@sha256:"))
      .map(([name, service]) => `${name} (${String(service.image)})`);
    if (!unpinned.length) return [pass(this.id, "all registry images are digest-pinned")];
    return [{
      id: this.id,
      level: stack.meta.prod ? "error" : "warn",
      message: `unpinned registry images: ${unpinned.join(", ")}`,
    }];
  },
};

interface Scanner {
  id: string;
  bin: string;
  args(root: string): string[];
}

function externalScannerGates(): Gate[] {
  const scanners: Scanner[] = [
    { id: "tfsec", bin: "tfsec", args: (root) => [join(root, "tofu"), "--no-color"] },
    { id: "checkov", bin: "checkov", args: (root) => ["-d", join(root, "tofu"), "--quiet", "--compact"] },
    { id: "conftest", bin: "conftest", args: (root) => ["test", join(root, "docker-compose.yml"), "--policy", join(packageRoot(), "policies")] },
    { id: "trivy", bin: "trivy", args: (root) => ["config", "--exit-code", "1", "--severity", "HIGH,CRITICAL", "--quiet", root] },
    { id: "gitleaks", bin: "gitleaks", args: (root) => ["detect", "--no-git", "--source", root, "--exit-code", "1", "--redact"] },
  ];
  return scanners.map((scanner) => ({
    id: `external/${scanner.id}`,
    async run(stack) {
      if (!(await commandExists(scanner.bin))) {
        return [{
          id: this.id,
          level: stack.meta.prod ? "error" : "skip",
          message: `${scanner.bin} is not installed; external coverage is mandatory for production`,
        }];
      }
      const root = mkdtempSync(join(tmpdir(), `harness-gate-${scanner.id}-`));
      try {
        materialize(stack, root, packageRoot());
        const result = await run(scanner.bin, scanner.args(root));
        if (result.code === 0) return [pass(this.id, `${scanner.id} passed`)];
        const detail = compactOutput(result.stderr || result.stdout);
        return [{ id: this.id, level: "error", message: `${scanner.id} failed (exit ${result.code})${detail ? `: ${detail}` : ""}` }];
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  }));
}

// --- helpers -------------------------------------------------------------

interface ComposeService { ports?: unknown[]; image?: unknown; [k: string]: unknown; }
interface ComposeDoc { services?: Record<string, ComposeService>; }

function parseCompose(stack: RenderedStack): ComposeDoc {
  return (parseYaml(stack.compose.content) as ComposeDoc) ?? {};
}
function composeServices(doc: ComposeDoc): Array<[string, ComposeService]> {
  return Object.entries(doc.services ?? {});
}
function pass(id: string, message: string): GateResult {
  return { id, level: "pass", message };
}

function compactOutput(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
