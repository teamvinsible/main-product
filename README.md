# Teamvinsible

Vibe coding with a full agent crew — plan, build, and run the business in the open.

**USP:** Not just an app builder. A coordinator (Mediator) plus domain agents with full visibility into specs, files, revision loops, and post-build ops. No black box.

## Monorepo

| Path | Role |
|---|---|
| `apps/web` | Coordination Spine UI (React + Vite) |
| `apps/api` | Cloudflare Worker edge API (proxies swarm, demo spine, publish contract) |
| `packages/swarm` | Agent orchestrator + control plane (from agent-swarm) |
| `packages/shared` | Shared domain types |
| `packages/harness-doctl` | Optional DO droplet deploy harness |

## Architecture (target)

1. **Intake** — text / image / URL → plan + clarifying questions  
2. **Coordination Spine** — Mediator assigns domain agents, gatekeeps stages  
3. **Sandbox preview** — Cloudflare Sandboxes/Containers (next)  
4. **Publish** — Workers for Platforms → `*.teamvinsible.app` + SSL for SaaS custom domains  

Competitor hosting pattern we follow: shared edge + Host/SNI routing (Lovable-style), not one VM per project. See Cloudflare’s [AI vibe coding platform](https://developers.cloudflare.com/reference-architecture/diagrams/ai/ai-vibe-coding-platform/) reference.

## Local development

```bash
# from repo root
npm install

# terminal 1 — swarm control plane (Postgres via Docker)
cp packages/swarm/.env.example packages/swarm/.env
npm run db:up
npm run dev:swarm

# terminal 2 — edge API (proxies swarm, serves /api/spine)
npm run dev:api

# terminal 3 — web UI
npm run dev:web
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8787  
- Swarm dashboard/API: http://127.0.0.1:3456  

If swarm is offline, the Spine still loads a **demo snapshot** so UI work can continue.

## Milestone map

- [x] Monorepo + swarm package  
- [x] Coordination Spine UI + intake  
- [x] Edge API + demo/live spine bridge  
- [ ] Image/URL ingestion (R2 + fetch)  
- [ ] Sandbox live preview  
- [ ] Workers for Platforms publish  
- [ ] Free-tier gates on files/export  
- [ ] Post-build ops crew  

## License

MIT (swarm package inherits its upstream license terms).
