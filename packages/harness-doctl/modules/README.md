# OpenTofu modules

Referenced by the rendered `tofu/main.tf` (see `src/render/tofu.ts`). Each is a
hardened, self-contained module.

| Module | Provisions | Guardrails baked in |
|---|---|---|
| `vpc/` | DO VPC + private network | all resources private by default |
| `droplet/` | project Droplet (compute) | cloud-init: non-root `deploy` user, SSH hardening (no root/password), Docker with `data-root` on the encrypted volume, **tailnet join (no public SSH)**, ufw |
| `firewall/` | DO Cloud Firewall | default-deny inbound; only 80/443 public; SSH tailnet-only; egress open |
| `volume/` | encrypted block volume | Docker data-root lives here → all container/DB data encrypted at rest |
| `spaces/` | DO Spaces bucket | private ACL, versioning, non-current expiry |

**Tailnet join** is not a separate module: it happens in the Droplet's
`cloud-init.yaml.tftpl` (installs tailscale, `tailscale up --login-server=<headscale>`),
so there is no public SSH surface. See ARCHITECTURE.md §6 and the threat model.

Each module ships `main.tf` / `variables.tf` / `outputs.tf`. The renderer wires them
together and conditionally includes the volume only when the spec declares a database.
