# Teamvinsible — Cloudflare-native Agent Swarm

This platform runs **entirely on Cloudflare**. The old VPS/`SWARM_ORIGIN` Node dashboard is a **legacy bridge only** and is not required for the product path.

## Target topology

```
apps/web (Pages)
    │  Bearer JWT (Supabase Auth)
    ▼
apps/api (Worker) ──────────────────────────────┐
    │                                           │
    ├─ Mediator Agent (Durable Object)          │
    │    coordination state, spine, questions   │
    ├─ Run Workflow                             │
    │    durable phases: draft → review → …     │
    ├─ Run Queue                                │
    │    fan-out / retries                      │
    ├─ D1                                       │
    │    projects mirror, runs, logs, artifacts │
    ├─ R2                                       │
    │    workspace object tree                  │
    ├─ SwarmRuntime Container                   │
    │    heavy agent tool loop (git, build, …)  │
    ├─ Sandbox                                  │
    │    live preview URLs                      │
    ├─ DomainAgent DOs (research/product/design/eng) │
    ├─ CrewRun Workflow (durable phases)        │
    └─ Workers for Platforms / R2 edge publish  │
         *.teamvinsible.com                     │
```

## Domain mapping (swarm concept → CF)

| Swarm concept | Cloudflare primitive |
|---|---|
| Mediator / Lead | `MediatorAgent` (Agents SDK DO) |
| Domain agents | `DomainAgent` DOs + `CrewRunWorkflow` steps |
| Project workspace | R2 prefix `workspaces/{projectId}/` |
| Postgres runs/logs | D1 tables |
| Dashboard `/api/*` | Worker routes (auth-gated) |
| Docker sandbox | Cloudflare Sandbox |
| VPS Caddy publish | R2 edge on `{slug}.teamvinsible.com` (+ optional Workers for Platforms) |
| doctl / harness-doctl | Optional skill for **customer** backends, not platform hosting |

## Phased delivery

### Phase A — Control plane on CF (implemented)
- Worker owns intake / run / spine / preview
- Mediator DO + D1 run state
- Queue + Workflow scaffold for phases
- Sandbox preview remains
- Supabase Auth + `projects` ownership kept
- `SWARM_ORIGIN` optional fallback behind `LEGACY_SWARM=true`

### Phase B — Agent execution (implemented)
- In-Worker **DeepSeek** tool loop writes apps into R2 (`orchestrator/agent-runner.ts`)
- Optional `SwarmRuntime` Container (`Dockerfile.runtime`) for shell-capable builds
- Mediator eng/preview phases invoke the build loop
- Queue consumer can trigger `run.build` / warm builds
- Sandbox preview syncs from R2 workspace

### Phase C — Peel to Agents SDK (implemented)
- `DomainAgent` DO per `${projectId}:${role}` (`agents/domain-agent.ts`)
- `CrewRunWorkflow` runs durable phase steps; Mediator applies results
- Mediator `advancePhase` falls back to DomainAgent when Workflow is unavailable
- Optional SwarmRuntime kept for heavy shell builds only

### Phase D — Publish (implemented)
- `POST /api/publish` copies workspace → R2 `publishes/{slug}/`
- Public serve: `{slug}.{PLATFORM_HOST}` only (subdomain)
- Optional WfP upload when `CF_ACCOUNT_ID` + `CF_API_TOKEN` + `DISPATCHER` are set
- Spine UI **Publish** action

## Secrets (Cloudflare)

| Secret | Binding |
|---|---|
| `SUPABASE_JWT_SECRET` | `wrangler secret` |
| `SUPABASE_SERVICE_ROLE_KEY` | `wrangler secret` |
| `SUPABASE_URL` | `wrangler secret` or var |
| `DEEPSEEK_API_KEY` | `wrangler secret` — **only LLM provider** |
| `DEEPSEEK_MODEL` | optional var (default `deepseek-v4-flash`) |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | optional — Workers for Platforms upload |
| `LEGACY_SWARM_TOKEN` | only if bridge enabled |

Never commit secrets. `DEV_AUTH_BYPASS` must be **false** in production.

### LLM

Teamvinsible uses **DeepSeek only** (`https://api.deepseek.com`, OpenAI-compatible chat + tools). No Anthropic/OpenAI keys in the Cloudflare control plane.

## Operations

- **Run lifecycle**: `POST /api/run` → D1 rows → Mediator bootstrap → CrewRun Workflow (created **only** by `cfStartRun`, instance id = runId). If Workflow creation fails, the Mediator's scheduled phase loop takes over.
- **Queues**: `teamvinsible-runs` retries 3×, then dead-letters to `teamvinsible-runs-dlq` (create it: `wrangler queues create teamvinsible-runs-dlq`). The DLQ consumer logs and writes a `run.failed` notification.
- **Retention**: nightly cron (03:17 UTC) prunes `cf_activity` (>30d) and `cf_notifications` (read >90d, all >180d).
- **Publish**: max 400 files per publish (Worker subrequest cap). Reserved subdomains (`api`, `www`, `admin`, …) cannot be claimed as slugs. Live apps are served only on `{slug}.PLATFORM_HOST` (origin-isolated by DNS).
- **Previews**: sandbox preview hosts (`{port}-{sandboxId}.PLATFORM_HOST`) are unauthenticated capability URLs (sandbox id derives from the project UUID) and are proxied before the published-app wildcard.

## Non-goals
- DigitalOcean droplets for Teamvinsible itself
- Host Docker / Postgres on a VPS for the control plane
- MCP stdio on Workers
