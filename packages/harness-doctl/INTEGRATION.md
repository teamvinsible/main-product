# harness-doctl × agent-swarm — Integration Design

> How the harness marries into the existing **agent-swarm** project
> (`C:\Users\ansi2\Desktop\Experiment\agent-swarm`). Companion to
> [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/threat-model.md`](docs/threat-model.md).

## Decisions driving this doc
- **Coupling:** harness-doctl ships as a **separate npm package** (`@ansi2u/harness-doctl`);
  agent-swarm imports it. Independently useful/testable; clean boundary.
- **DO adapter:** **add a new provider**, keep the existing App Platform one.
  `digitalocean` (App Platform, quick static) stays; new **`do-droplet`** (hardened
  Droplet+Compose backend) is added.
- **Language:** harness tooling is **TypeScript** (parser/renderers/CLI/API), to share
  agent-swarm's toolchain, Drizzle DB, dashboard, and types.
- **Backend mode** per project: `supabase` (existing policy) | `harness-do` (new).

---

## 1. Division of responsibility

```
 agent-swarm (brain · persistence · dashboard)         @ansi2u/harness-doctl (backend engine)
 ───────────────────────────────────────────           ─────────────────────────────────────
 build/import app, classify services+APIs      ──spec──► parse spec.yaml → Resource Graph
 persist projects/runs/deployments (Drizzle)             render OpenTofu + compose + infra-config
 React dashboard + control API                           security gates (tfsec/checkov/conftest/…)
 DeployAdapter dispatch, credential profiles    ──ctx──►  tofu apply + compose up → DeployResult
 GitHub PR flow, MCP, sandbox                   ◄─URL,logs─ provision hardened DO backend
```

agent-swarm decides & drives; harness provisions the real, hardened backend.

---

## 2. Package surface (`@ansi2u/harness-doctl`)

```ts
// what agent-swarm imports
export interface HarnessSpec { /* project.spec.yaml, validated */ }
export function parseSpec(yaml: string): { graph: ResourceGraph; errors: SpecError[] };
export function renderPlan(graph: ResourceGraph, opts: RenderOpts): RenderedStack; // tofu + compose + infra-config
export function runGates(stack: RenderedStack): GateReport;                        // must pass before apply
export interface Provisioner {                    // wraps tofu + compose over the tailnet
  plan(stack: RenderedStack, state: StateRef): Promise<PlanDiff>;
  apply(stack: RenderedStack, state: StateRef): Promise<ApplyResult>;   // -> { url, logsUrl, dropletId, stateRef }
  destroy(state: StateRef): Promise<void>;
  status(state: StateRef): Promise<BackendHealth>;
}
export const cli; // `harness` standalone CLI (also usable without agent-swarm)
```

The package has **no dependency on agent-swarm** — agent-swarm depends on it. It also
runs standalone (`npx harness apply ./project.spec.yaml`) for non-swarm users.

---

## 3. Seam A — Deploy adapter (`src/deploy/adapters/do-droplet.ts`)

Implements agent-swarm's existing `DeployAdapter` contract (`src/deploy/types.ts`):

```ts
// src/deploy/adapters/do-droplet.ts  (in agent-swarm)
import { parseSpec, renderPlan, runGates, Provisioner } from "@ansi2u/harness-doctl";
import type { DeployAdapter, DeployContext, DeployResult } from "../types.js";

export const doDropletAdapter: DeployAdapter = {
  provider: "do-droplet",
  async deploy(ctx: DeployContext): Promise<DeployResult> {
    const yaml = readSpec(ctx.appDir);                 // project.spec.yaml (Seam B)
    const { graph, errors } = parseSpec(yaml);
    if (errors.length) return { ok: false, detail: fmt(errors) };

    const stack = renderPlan(graph, {
      token: ctx.credential.secrets.DIGITALOCEAN_TOKEN,   // isolated cred, scrubbed
      region: String(ctx.target.region || "blr1"),
      prod: ctx.prod,
    });

    const gates = runGates(stack);
    if (!gates.ok) return { ok: false, detail: `security gates failed: ${gates.summary}` };

    const res = await new Provisioner(ctx.log).apply(stack, stateRefFor(ctx));
    return { ok: true, url: res.url, logsUrl: res.logsUrl, detail: "hardened DO backend deployed", raw: res };
  },
};
```

Register in `src/deploy/deployer.ts` `ADAPTERS` map and in `credentials.ts`
`DeployProvider` union. `DIGITALOCEAN_TOKEN` (+ profile suffixes) already exists.
Secret scrubbing (`scrubSecrets`) and `insertDeployment` recording are inherited
for free from the existing `Deployer`.

**`DeployTarget` extension** (non-secret, already jsonb): add
`dropletId?`, `specRef?`, `tofuStateRef?`, `backendMode?: "harness-do"`.

---

## 4. Seam B — Spec generation (the loop-closer)

agent-swarm's pipeline already classifies project type + services. Add a build step
that **emits `project.spec.yaml`** into the workspace app dir, so the swarm authors
the spec from the app it just built — no hand-writing.

- New prompt/role: "backend-spec author" in `src/prompts/` + `src/agents/`.
- Output artifact validated by `parseSpec()` in-loop; failures feed back to the agent.
- Result: `swarm run "..." ` → app + `project.spec.yaml` → `swarm deploy <p> --provider do-droplet`.

---

## 5. Seam C — Dashboard "Backend" panel

Extend the existing dashboard (`src/dashboard/server.ts` + `web/`) rather than build
harness's own console. New control-plane endpoints (mirroring existing style):

```
GET  /api/backend/:project/spec         # current spec + resource graph
POST /api/backend/:project/plan         # renderPlan + runGates -> PlanDiff (no apply)
POST /api/backend/:project/apply        # gated apply (human-approved)
GET  /api/backend/:project/status       # BackendHealth (containers, db, backups)
GET  /api/backend/:project/db/*         # proxied postgres-meta (tables/SQL/RLS editor)
GET  /api/backend/:project/auth/users   # proxied GoTrue admin
GET  /api/backend/:project/metrics      # proxied Prometheus/Loki
POST /api/backend/:project/restore-drill
```

Reached over the **Headscale tailnet** (no public control ports). UI: a new Backend
tab in the project detail view with plan-diff review, DB studio, users, logs, metrics,
and a "production-ready" badge gated on green gates + a passing restore-drill.

---

## 6. Seam D — Persistence (Drizzle migrations)

Add alongside existing `deployments` / `deploy_targets` (migration `0008`):

```sql
-- 0012_backend_specs.sql
CREATE TABLE IF NOT EXISTS "backend_specs" (
  "id" uuid PRIMARY KEY, "project" text NOT NULL,
  "spec_yaml" text NOT NULL, "graph" jsonb NOT NULL,
  "mode" text NOT NULL DEFAULT 'harness-do',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- 0013_infra_state.sql
CREATE TABLE IF NOT EXISTS "infra_state" (
  "project" text PRIMARY KEY, "droplet_id" text, "tofu_state_ref" text,
  "tailnet_host" text, "last_apply" timestamptz, "health" jsonb NOT NULL DEFAULT '{}'
);
-- 0014_gate_runs.sql
CREATE TABLE IF NOT EXISTS "gate_runs" (
  "id" uuid PRIMARY KEY, "project" text NOT NULL, "deployment_id" uuid,
  "ok" boolean NOT NULL, "report" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
```

Add matching Drizzle schema entries in `src/db/schema.ts` and accessors in
`src/db/store.ts` (mirroring `insertDeployment`).

---

## 7. Backend-mode coexistence (Supabase vs harness-do)

agent-swarm's current DB-migration policy (README §Database Migration Policy) is
Supabase-centric. Make it one of two backend modes:

| Mode | Provisioning | Migrations | When |
|---|---|---|---|
| `supabase` | existing | Supabase CI / migration executor | using hosted Supabase |
| `harness-do` | harness Droplet+Compose | RLS-forced migrations applied by harness gate | green-field DO, cost/control, this project's goal |

Chosen per project (spec `resources.db` + a `backendMode` field). This makes harness
the **DO-native, self-hosted alternative to Supabase** — the original objective.

---

## 8. End-to-end flow

```
swarm run "Build a SaaS ..."           ──► app built + project.spec.yaml emitted (Seam B)
swarm deploy p --provider do-droplet   ──► doDropletAdapter (Seam A)
                                            parseSpec → renderPlan → runGates → Provisioner.apply
                                            over Headscale tailnet → hardened DO backend
dashboard Backend tab (Seam C)         ──► plan diff · DB studio · users · logs · restore-drill
Postgres (Seam D)                      ──► backend_specs · infra_state · gate_runs · deployments
```

Static SEO/AEO/GEO frontend deploys via the existing path (Spaces+CDN / App Platform);
the harden-ed backend is the `do-droplet` target it calls.

---

## 9. Build order (suggested)

1. `@ansi2u/harness-doctl` skeleton: spec JSON-schema, `parseSpec`, `ResourceGraph`.
2. Renderers: OpenTofu modules (droplet/vpc/firewall/spaces/volume/headscale) + compose + infra-config.
3. Gate runner (tfsec/checkov/conftest + spec-linter + compose-linter) — the product.
4. `Provisioner` (tofu + compose over tailnet) + `harness` standalone CLI.
5. agent-swarm: `do-droplet` adapter + `DeployProvider` union + `DeployTarget` fields.
6. Seam B spec-author role; Seam D migrations; Seam C dashboard panel.
```
