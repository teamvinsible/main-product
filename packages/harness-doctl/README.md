# @ansi2u/harness-doctl

**Infrastructure from Spec** — turn one `project.spec.yaml` into a repeatable,
hardened, self-hosted **DigitalOcean** backend. Supabase-like flexibility on
green-field DO, 100% open source, secure by default.

Runs standalone (`harness` CLI) or as a dependency of
[agent-swarm](../agent-swarm) via a `do-droplet` deploy adapter. See
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`INTEGRATION.md`](INTEGRATION.md), and
[`docs/threat-model.md`](docs/threat-model.md).

## Pipeline

```
project.spec.yaml → parseSpec → Resource Graph → renderPlan → runGates → Provisioner.apply
                                                  (tofu +      (guardrails,   (tofu + compose
                                                   compose +    the product)   over tailnet)
                                                   infra-config)
```

## Quick start

```bash
npm install
npm run build

# validate a spec, inspect the graph, render artifacts, run security gates
node dist/cli.js validate    examples/project.spec.yaml
node dist/cli.js graph       examples/project.spec.yaml
node dist/cli.js render      examples/project.spec.yaml
node dist/cli.js gates       examples/project.spec.yaml

# write a deployable directory (compose + Caddyfile + infra-config + tofu + modules/services)
node dist/cli.js materialize examples/project.spec.yaml ./out

# gated provisioning (needs OpenTofu + tailnet reachability; env below)
DIGITALOCEAN_TOKEN=... HEADSCALE_URL=... node dist/cli.js plan  examples/project.spec.yaml
DIGITALOCEAN_TOKEN=... HEADSCALE_URL=... node dist/cli.js apply examples/project.spec.yaml

# or without building:
npm run dev -- gates examples/project.spec.yaml
```

## Package surface

| Export | Purpose |
|---|---|
| `parseSpec(yaml)` | YAML → validated spec + Resource Graph (never throws) |
| `renderPlan(graph, opts)` | Graph → `RenderedStack` (tofu, compose, Caddyfile, infra-config) |
| `runGates(stack)` | Guardrail + linter checks; `ok=false` blocks apply |
| `materialize(stack, dir)` | Write a deployable dir (artifacts + modules/ + services/) |
| `Provisioner` | tofu (init/plan/apply/output) + rsync/ssh `docker compose up` over the tailnet |

## Status

**Production-gated standalone engine.** Implemented: spec model + validation, graph builder, renderers
(tofu, compose, Caddyfile, infra-config), OpenTofu modules + service configs,
in-process security gates (RLS-required, buckets-private, db-no-public-port,
only-caddy-publishes, no-inline-secrets), `materialize`, the `Provisioner`
(plan/apply/destroy/status with binary checks + secret redaction), and the CLI.

**Secrets:** a `SecretsProvider` layer resolves secrets at `apply` time and writes a
`0600 .env` into the deploy dir (shipped over the tailnet, redacted from logs).
Default adapter is **SOPS + age** (`SECRETS_FILE` + `SOPS_AGE_KEY_FILE`, no running
service); **OpenBao KV v1/v2** is available for dynamic secrets. `harness secrets
<spec>` lists the required vars. HashiCorp Vault is intentionally not used (BUSL).

Production mode requires tfsec, Checkov, Conftest/OPA, Trivy, and Gitleaks; missing
tools fail closed. Runtime images are immutable digest pins, PostgreSQL traffic is
TLS-encrypted, restore drills run weekly, host/container metrics are scraped, and
optional encrypted lock-enabled remote state is configured with `TOFU_STATE_*`.
The remaining cross-repository work is the agent-swarm integration described in
[`INTEGRATION.md`](INTEGRATION.md) Seams A–D.
