# harness-doctl — Architecture

> An agent-driven harness that turns a single project **spec** into a repeatable,
> hardened, self-hosted backend on DigitalOcean — "Supabase-like flexibility on
> green-field DO", 100% open source, managed from one unified console.

Status: **standalone engine implemented; agent-swarm integration pending**. Companion: [`docs/threat-model.md`](docs/threat-model.md).

---

## 1. Goals & non-goals

### Goals
- **Spec → running backend.** One `project.spec.yaml` declares services, API
  endpoints, and resources; the harness renders + provisions everything.
- **Repeatable & idempotent.** Everything is generated from templates + IaC.
  Nothing is hand-clicked in the DO console. Re-running converges to the spec.
- **Secure by default.** Insecurity requires *editing the spec to override a named
  guardrail* — auditable in git. See §8 and the threat model.
- **100% open source, no paid SaaS.** DO compute is the only paid substrate.
  All software is OSS (Postgres, GoTrue, PostgREST, Caddy, OpenTofu, SOPS,
  Headscale, Prometheus/Grafana/Loki).
- **Unified console.** One bespoke control plane to manage projects, provisioning,
  DB, containers, observability, auth users, and secrets.
- **Agent-friendly.** The spec + resource graph + a machine API make the whole
  system introspectable and drivable by AI agents (the "harness" in the name).

### Non-goals
- Not a PaaS reselling infra. It provisions into *your* DO account.
- Not "100% secure" (nothing is). Target = defense-in-depth baseline + threat
  model + continuous verification. See threat model.
- No application-code parsing / framework lock-in. Declaration is an explicit spec.

---

## 2. The core idea: Infrastructure *from Spec*

Encore's insight is: **one declaration → a resource graph → provisioned infra with
secure defaults.** We keep that. We drop Encore's mechanism (statically parsing
app code to *infer* infra), because it forces framework + language lock-in.

Instead the declaration is an **explicit spec file**. Services are written in any
language/framework; the spec declares infra + routing + dependencies. Slight
duplication vs. code-parsing, bought back as total language freedom and zero
lock-in.

```
project.spec.yaml ──► parser ──► Resource Graph ──► renderers ──► gates ──► apply
```

---

## 3. Pipeline

```
                       ┌──────────────────────────┐
  project.spec.yaml ──►│  parser + validator      │──► Resource Graph (JSON)
                       └──────────────────────────┘         │
        ┌───────────────────────┬──────────────────────────┴───────────────┐
        ▼                       ▼                                           ▼
 OpenTofu render         docker-compose render                    infra-config.json
 (VPC, Droplet,          (Postgres, GoTrue, PostgREST,            ($env-wired to SOPS
  firewall, Spaces,       Caddy, project services,                secrets; the seam
  DNS, block volume,      Prometheus, node-exporter)              between "declared
  Headscale join)                                                  needs" and real infra)
        │                       │                                           │
        └───────────► security gates: tfsec · checkov · conftest/OPA ·──────┘
                                        spec-linter
                                             │
                                     plan → apply → deployed backend
```

- **parser/validator** builds the Resource Graph — our machine-readable
  "Application Model" (services, endpoints, DBs, buckets, auth, dependencies).
- **renderers** are pure functions Graph → files. No hidden state.
- **infra-config.json** is the deliberate steal from Encore's self-host seam:
  a `{"$env": "..."}`-indirected map from declared resources to real endpoints,
  so secrets never live in the rendered artifacts.
- **gates** must pass before `apply`. They are the product.

---

## 4. The spec (developer contract)

```yaml
project: acme-saas
region: blr1
tier: standard                 # -> Droplet size + resource defaults

services:
  api:
    build: ./api               # any language; harness builds+runs the container
    routes:                    # -> Caddy routing
      - GET  /users
      - POST /users
    needs: [db.main, bucket.uploads, auth]   # declared infra dependencies

resources:
  db:
    main:
      engine: postgres@16
      rls: required            # linter REJECTS tables lacking RLS policies
      backups: { to: spaces, schedule: "0 */6 * * *", pitr: true }
  bucket:
    uploads: { public: false }
  auth:
    provider: gotrue
    providers: [email, google]

security:
  ssh: headscale-only          # no public SSH
  firewall: default-deny       # only 443 public; control plane via tailnet
  tls: auto                    # Caddy + Let's Encrypt
```

---

## 5. Resource Graph

A normalized JSON document derived from the spec. Consumed by all renderers and
exposed on the console API for agents. Sketch:

```json
{
  "project": "acme-saas",
  "nodes": {
    "droplet:main":   { "kind": "compute", "size": "s-2vcpu-4gb", "region": "blr1" },
    "db:main":        { "kind": "postgres", "version": 16, "rls": "required" },
    "bucket:uploads": { "kind": "object_storage", "public": false },
    "auth:gotrue":    { "kind": "auth", "providers": ["email","google"] },
    "svc:api":        { "kind": "service", "routes": [...], "needs": ["db:main","bucket:uploads","auth:gotrue"] }
  },
  "edges": [ ["svc:api","db:main"], ["svc:api","bucket:uploads"], ["svc:api","auth:gotrue"] ]
}
```

---

## 6. Per-project topology (isolation = one Droplet + DB per project)

Each project = its own DO Droplet, VPC, block volume, firewall, and Spaces bucket.
Clean blast radius; per-project teardown; simplest security story.

```
Internet ──443──► Caddy (auto-TLS, HSTS, security headers, rate-limit)
                    │  reverse proxy (host/path routing from spec)
      ┌─────────────┼───────────────┬─────────────┐
      ▼             ▼               ▼             ▼
   GoTrue        PostgREST      project svcs   Prometheus
   (auth/JWT)    (REST API)     (any lang)     + node-exporter
      └─────────────┴───────────────┴─────────────┘
                    ▼  (internal docker network; NO published host port)
              Postgres 16  (RLS forced) ── block volume (encrypted)
                    │
                    └── pgBackRest/wal-g ──► DO Spaces (encrypted, off-box, PITR)

  DO Cloud Firewall: default-deny; public 443 only; control plane via tailnet.
  Headscale mesh: Droplet joins the private tailnet — no public SSH/control ports.
```

Self-hosted Postgres is the biggest owned risk (§ threat model T-DB). The harness
makes backups, patching-window, encrypted volume, and no-public-port
**non-optional** in the render. A `restore-drill` command must have passed for a
project to be marked production-ready.

---

## 7. Unified console (control plane)

We build the UI; it orchestrates proven OSS service APIs (not a framework dep).

```
┌─ Console  (static, SEO-clean frontend + API)                     ← we build
│    projects · spec editor · plan/apply · DB studio · logs ·
│    metrics · auth users · secrets · audit log
│
├─ Control-plane API + small Postgres    ← projects, specs, tofu state refs, audit
│      calls: postgres-meta (DB/RLS editor), GoTrue admin (users),
│             Prometheus/Loki (obs), Docker API (containers), OpenTofu (plan/apply)
│
└─ Per-project Droplet, reached over the Headscale tailnet (no public control ports)
```

- **Control channel = Headscale mesh.** Console + every Droplet share a private
  tailnet. No public SSH or control ports anywhere. Headscale keeps it zero-SaaS.
- The console's DB editor is our UI over `postgres-meta`'s REST API; user admin is
  our UI over GoTrue's admin API; dashboards query Prometheus/Loki. Cohesive UX
  without reimplementing a SQL editor.

---

## 8. Security guardrails (enforced at render/gate time)

| Guardrail | Enforcement |
|---|---|
| DB never on a public interface | renderer forbids `ports:` on Postgres; gate fails otherwise |
| Every table has an RLS policy | spec-linter + migration check; `rls: required` default |
| Only Caddy is internet-facing | compose-linter: no non-Caddy published ports; firewall default-deny |
| TLS everywhere, auto-renewed | Caddy; HSTS header enforced |
| No plaintext secrets | SOPS+age; gate greps rendered artifacts for secret patterns |
| No public SSH | Headscale-only; firewall blocks 22 from public |
| Pinned, scanned images | digest pins; Trivy in CI; non-root; read-only FS where possible |
| Backups exist & restore-tested | render mandatory; `restore-drill` gate for prod flag |
| IaC policy | tfsec + checkov + conftest/OPA must pass before apply |
| Drift | scheduled `tofu plan` diff; console flags drift |

---

## 9. Repeatability

Two phases, both fully in-repo, nothing clicked:

1. **Infra (OpenTofu):** VPC, Droplet, firewall, Spaces, DNS, volume, tags.
2. **Config (compose + Caddy + SOPS + infra-config.json):** rendered, shipped,
   `docker compose up -d`.

The harness wraps both: parse → render → gates → plan → apply. Re-running
converges to the spec (idempotent). Teardown is per-project and complete.

---

## 10. Repo layout (target)

```
harness-doctl/
├── ARCHITECTURE.md
├── docs/threat-model.md
├── spec/                # JSON-schema for project.spec.yaml + examples
├── harness/             # parser, graph builder, renderers, gate runner, CLI
├── modules/             # OpenTofu modules: vpc, droplet, firewall, spaces, dns, volume, headscale
├── services/            # hardened compose + configs: postgres, gotrue, postgrest, caddy, prometheus
├── policies/            # tfsec/checkov config + conftest/OPA rules + spec-linter rules
├── security/            # CIS baseline, hardening scripts, restore-drill
└── console/             # unified control-plane UI + API + per-Droplet agent
```

---

## 11. Open questions (deferred)

- Secrets bootstrap: SOPS+age in-repo (leaning yes) vs. self-hosted Infisical.
- Console auth: who administers the control plane, and its own hardening.
- Managed-Postgres escape hatch: keep DB a pluggable spec flag for prod-critical
  projects (recommended — cheap to build now, saves a migration later).
- Multi-region / multi-Droplet-per-project (HA) — out of scope for v1.
```
