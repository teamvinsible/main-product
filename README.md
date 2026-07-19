# Teamvinsible

Vibe coding with a full agent crew — plan, build, and run the business in the open.

**Platform:** Cloudflare-native (Pages + Worker + Agents SDK Mediator + D1/R2/Queues + Sandbox).  
**Auth:** Supabase Auth (Google + email).  
See [`docs/ARCHITECTURE-CLOUDFLARE.md`](docs/ARCHITECTURE-CLOUDFLARE.md).

## Monorepo

| Path | Role |
|---|---|
| `apps/web` | Landing, auth, Coordination Spine (→ Cloudflare Pages) |
| `apps/api` | CF control plane: Mediator Agent, intake/run/spine, Sandbox preview |
| `packages/shared` | Shared domain types |
| `packages/swarm` | **Legacy** Node orchestrator (optional `LEGACY_SWARM=true` bridge only) |
| `packages/harness-doctl` | Optional skill for **customer** DO backends — not platform hosting |
| `supabase/migrations` | Auth profiles + ownership (RLS) |
| `docs/` | Architecture |

## Local development (Cloudflare path)

```bash
npm install

# Supabase (auth + ownership) — see supabase/README.md
# Apply supabase/migrations/001_platform.sql

# Web
cp apps/web/.env.example apps/web/.env
# VITE_USE_MOCK=false
# VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY

# API secrets
cp apps/api/.dev.vars.example apps/api/.dev.vars
# SUPABASE_* + DEEPSEEK_API_KEY (required for live LLM)
# DEV_AUTH_BYPASS=true in wrangler.toml for local without Supabase

# D1 migrations (local)
npm run db:migrate:local -w @teamvinsible/api

# terminals
npm run dev:api    # Worker + Mediator + Sandbox (Docker for containers)
npm run dev:web
```

- Landing: http://127.0.0.1:5173/  
- Spine: http://127.0.0.1:5173/dashboard  
- API health: http://127.0.0.1:8787/api/health → `controlPlane: "cloudflare"`

Legacy VPS swarm is **not** required. Set `LEGACY_SWARM=true` + `SWARM_ORIGIN` only for temporary bridge.

## Milestone map

- [x] Monorepo + Coordination Spine UI  
- [x] Supabase Auth + landing  
- [x] Cloudflare Mediator Agent + D1/R2/Queue control plane  
- [x] Sandbox preview *(optional; requires [Workers Paid](https://dash.cloudflare.com/?to=/:account/workers/plans) + Containers)*  
- [x] Publish-first live URL (`{slug}.teamvinsible.com` — no Paid plan required)  
- [x] Agent build loop (Worker DeepSeek tools → R2; optional SwarmRuntime Container)  
- [x] Domain agents + CrewRun Workflow (Phase C)  
- [x] Publish to R2 edge + optional Workers for Platforms (Phase D)  

## License

MIT
