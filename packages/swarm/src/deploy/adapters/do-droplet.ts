import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSpec, renderPlan, runGates, Provisioner, selectProvider, computeRequiredEnv,
} from "@ansi2u/harness-doctl";
import type { DeployAdapter, DeployContext, DeployResult } from "../types.js";

// Provisions a hardened, self-hosted DigitalOcean backend from the project's
// `project.spec.yaml` via @ansi2u/harness-doctl: parse -> render -> security gates
// -> tofu apply + docker compose over the Headscale tailnet. Unlike the App
// Platform `digitalocean` adapter, this stands up a full Droplet+Compose backend
// (Postgres/RLS, GoTrue, PostgREST, Caddy) — "Supabase-like, on green-field DO".
export const doDropletAdapter: DeployAdapter = {
  provider: "do-droplet",
  async deploy(ctx: DeployContext): Promise<DeployResult> {
    // 1) Locate the spec (the swarm's backend-spec author will emit this — Seam B).
    const specPath = findSpec(ctx);
    if (!specPath) {
      return {
        ok: false,
        detail:
          "no project.spec.yaml found (looked in the app + workspace dirs). Add one " +
          "(see @ansi2u/harness-doctl examples) — the backend-spec author will generate it automatically once wired.",
      };
    }

    const { spec, graph, errors } = parseSpec(readFileSync(specPath, "utf8"));
    if (errors.length || !spec || !graph) {
      return { ok: false, detail: "project.spec.yaml invalid:\n" + errors.map((e) => `  ${e.path}: ${e.message}`).join("\n") };
    }

    // 2) Pre-flight: the Droplet joins your self-hosted tailnet, so this is required.
    const headscaleUrl = ctx.credential.config.HEADSCALE_URL || ctx.env.HEADSCALE_URL;
    if (!headscaleUrl) {
      return { ok: false, detail: "HEADSCALE_URL is required (the Droplet joins your self-hosted tailnet). Set it in the project or global .env." };
    }
    const region = ctx.credential.config.DO_REGION || ctx.env.DO_REGION || spec.region;

    // 3) Render + GATE. Security gates block the deploy — insecurity requires
    //    editing the spec to override a named guardrail.
    const stack = renderPlan(graph, { region, prod: ctx.prod });
    const gates = await runGates(stack);
    for (const r of gates.results) ctx.log(gateLevel(r.level), `[gate ${r.id}] ${r.message}`);
    if (!gates.ok) {
      return { ok: false, detail: `security gates failed (${gates.summary}). Fix project.spec.yaml or override a named guardrail.` };
    }

    // 4) Provision. Secrets come from a SOPS file (preferred) or the process env.
    const secretsFile = ctx.env.SECRETS_FILE || join(ctx.workspaceDir, "secrets.enc.env");
    const prov = new Provisioner({
      token: ctx.credential.secrets.DIGITALOCEAN_TOKEN,
      spacesKey: ctx.env.SPACES_KEY,
      spacesSecret: ctx.env.SPACES_SECRET,
      headscaleUrl,
      tailscaleAuthkey: ctx.env.TAILSCALE_AUTHKEY,
      siteDomain: siteDomain(ctx),
      secrets: selectProvider({
        secretsFile,
        ageKeyFile: ctx.env.SOPS_AGE_KEY_FILE,
        requiredNames: computeRequiredEnv(stack),
      }),
      workRoot: join(ctx.workspaceDir, ".harness"),
      remoteDir: `/opt/harness/${spec.project}`,
      log: (level, message) => ctx.log(level, message),
    });

    try {
      const res = await prov.apply(stack, { project: spec.project });
      return {
        ok: true,
        url: res.url,
        logsUrl: res.logsUrl,
        detail: `Provisioned hardened DO backend for "${spec.project}" (Droplet+Compose, Postgres/RLS, GoTrue, tailnet).`,
        raw: { dropletId: res.dropletId, stateRef: res.stateRef },
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

function findSpec(ctx: DeployContext): string | null {
  for (const dir of [ctx.appDir, ctx.workspaceDir]) {
    const p = join(dir, "project.spec.yaml");
    if (existsSync(p)) return p;
  }
  return null;
}

function siteDomain(ctx: DeployContext): string | undefined {
  return (ctx.target.domain as string | undefined) || ctx.credential.config.SITE_DOMAIN || ctx.env.SITE_DOMAIN;
}

function gateLevel(level: string): "info" | "warn" | "error" {
  return level === "error" ? "error" : level === "warn" ? "warn" : "info";
}
