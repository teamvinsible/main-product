# Service configs

Hardened runtime configs shipped alongside the rendered `docker-compose.yml`
(see `src/render/compose.ts`). The Provisioner ships this `services/` tree into the
deploy directory; compose mounts the relevant paths.

| Path | For | What it does |
|---|---|---|
| `postgres/init/00-roles.sh` | database | Creates the PostgREST role chain (`authenticator` → `web_anon` / `authenticated`), least-privilege grants. |
| `postgres/init/01-rls-helpers.sql` | database | `auth.uid()` / `auth.role()` from JWT claims + the required RLS pattern. |
| `postgres/backup/` | database | pg_dump → gzip → DO Spaces on the spec's cron (supercronic), plus `restore-drill.sh`. |
| `gotrue/gotrue.env.example` | auth | JWT + provider config; secrets via `$env`. |
| `postgrest/postgrest.env.example` | REST API | `authenticator` connection, anon role, row-limit hardening. |
| `prometheus/prometheus.yml` | metrics | Prometheus self-monitoring plus node-exporter host and cAdvisor container metrics. |
| `caddy/` | reverse proxy | the Caddyfile is rendered by `src/render/caddy.ts`; this holds optional snippets. |

Secrets never live in these files — the `artifacts/no-inline-secrets` gate enforces
`$env`/SOPS indirection. See ARCHITECTURE.md §6.
