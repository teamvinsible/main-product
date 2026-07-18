# harness-doctl — Threat Model

Companion to [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Method: **STRIDE** per
trust boundary, plus the risks specific to *self-hosted Postgres* and the *agent
harness* itself.

> Framing: "100% secure" is not a target. This document defines what "secure"
> **means** here — the assets, the boundaries, the threats we accept vs. mitigate,
> and how each mitigation is *verified continuously* (not asserted once).

---

## 1. Assets

| # | Asset | Why it matters |
|---|---|---|
| A1 | Customer/application data in Postgres | Primary crown jewels; breach = worst case |
| A2 | Secrets (DB creds, JWT signing key, OAuth secrets, Spaces keys, DO token) | Compromise cascades to everything |
| A3 | The DO API token / control plane | Can create/destroy all infra, exfiltrate all data |
| A4 | Backups in Spaces | A second copy of A1; often the *forgotten* attack surface |
| A5 | Auth/session integrity (GoTrue JWTs) | Forgery = impersonation, authz bypass |
| A6 | The spec + rendered artifacts (in git) | Source of truth; tampering = supply-chain risk |
| A7 | Console / control plane | Cross-project blast radius if compromised |

---

## 2. Trust boundaries

```
[Internet] ─(B1)─► [Caddy edge] ─(B2)─► [internal docker net: GoTrue/PostgREST/svcs]
                                             │
                                          (B3)▼
                                        [Postgres + volume]
[Operator/Agent] ─(B4:tailnet)─► [Console/Control plane] ─(B5:tailnet)─► [per-project Droplet]
[Harness CI] ─(B6)─► [DO API]           [Droplet] ─(B7)─► [Spaces backups]
```

- **B1** public → edge (untrusted → semi-trusted)
- **B2** edge → app services
- **B3** app → database (the authz-critical hop; RLS enforced here)
- **B4/B5** control plane over private Headscale tailnet (no public ports)
- **B6** CI → DO API (holds A3)
- **B7** Droplet → object storage (holds A4)

---

## 3. STRIDE by boundary

### B1 — Internet → Caddy edge
| Threat | Vector | Mitigation | Verification |
|---|---|---|---|
| **S**poofing | Fake TLS / MITM | Auto-TLS (Let's Encrypt), HSTS preload | ssllabs/testssl in CI |
| **T**amper | Request smuggling, header injection | Caddy hardened config, strict routing from spec | config lint |
| **R**epudiation | No trace of abuse | Access logs → Loki, retained | log-presence check |
| **I**nfo disclosure | Verbose errors, missing headers | Security headers enforced; error masking | header scan gate |
| **D**oS | Volumetric / app-layer flood | Rate-limit at Caddy; DO firewall; (optional Cloudflare in front) | load-test smoke |
| **E**oP | Path traversal to internal svc | Only Caddy published; services have no host port | compose-linter |

### B2 — Edge → app services
| Threat | Mitigation | Verification |
|---|---|---|
| Spoofing internal calls | Services bind to internal docker net only; mTLS/service keys (infra-config `auth`) | port scan from host = closed |
| Info disclosure | No service exposes a public port; least-privilege env | compose-linter gate |
| EoP via vuln image | Pinned digests, Trivy scan, non-root, read-only FS | Trivy gate in CI |

### B3 — App → Postgres (authz-critical)
| Threat | Mitigation | Verification |
|---|---|---|
| **Authz bypass / IDOR** | **RLS forced on every table**; JWT claims passed to PostgREST→Postgres | spec-linter rejects table w/o policy; migration test asserts RLS on |
| SQL injection | Parameterized access via PostgREST; reviewed raw SQL | static check; PostgREST default |
| Spoofing | `sslmode=require` even intra-host; least-priv DB roles | connection config gate |
| Info disclosure | DB has **no public IP / no published port**; encrypted block volume | render forbids `ports:`; gate fails otherwise |

### B4/B5 — Control plane over tailnet
| Threat | Mitigation | Verification |
|---|---|---|
| Spoofing operator | Headscale ACLs; console SSO + MFA; per-node keys | ACL policy test |
| EoP cross-project | One Droplet+DB per project = hard isolation; console scoped tokens | isolation test |
| Repudiation | Console audit log (who ran plan/apply, secret access) | audit-log presence |
| Exposure | No public SSH/control ports; tailnet-only | external port scan = only 443 |

### B6 — CI → DO API (holds A3)
| Threat | Mitigation | Verification |
|---|---|---|
| Token theft | DO token in CI secret store, scoped, rotated; never in repo | secret-scan gate (gitleaks) |
| Supply chain | Pinned actions/deps; tfsec/checkov/conftest gate before apply | gates required to merge |
| Tamper with state | Remote tofu state, encrypted, locked; least-priv | state config review |

### B7 — Droplet → Spaces backups (A4)
| Threat | Mitigation | Verification |
|---|---|---|
| Backup exfiltration | Bucket private, SSE, scoped keys, lifecycle rules | bucket policy gate |
| Ransomware/overwrite | Versioning + object lock where available; off-box copies | backup-integrity check |
| Useless backup | **`restore-drill` must pass** before prod flag; PITR verified | restore-drill gate |

---

## 4. Self-hosted Postgres — accepted risk register

Chosen for cost/portability over DO Managed PG. The harness must offset:

| Risk | Owner-since-self-hosted | Mitigation (mandatory in render) |
|---|---|---|
| T-DB-1 Data loss | No managed backups | pgBackRest/wal-g → Spaces, PITR, restore-drill gate |
| T-DB-2 Unpatched CVEs | No managed patching | pinned digest + scheduled bump + restart window; Trivy gate |
| T-DB-3 Public exposure | One wrong `ports:` line = Shodan | render forbids published port; firewall default-deny; gate |
| T-DB-4 No HA | Single container | documented in generated README; Managed-PG escape hatch via spec flag |
| T-DB-5 Volume theft | Snapshot/volume access | encrypted block volume; scoped DO token |

**Escape hatch:** keep DB a pluggable spec flag so prod-critical projects can flip
to DO Managed Postgres without re-architecting.

---

## 5. The agent harness itself

The harness runs with high privilege (renders infra, holds/accesses secrets, can
`apply`). Treat it as a supply-chain-critical component.

| Threat | Mitigation |
|---|---|
| Malicious/hallucinated spec change provisions bad infra | Gates run on every change; human approval before `apply`; plan diff surfaced in console |
| Agent leaks secrets in logs/output | Secrets only via SOPS `$env` indirection; never rendered inline; log redaction |
| Agent over-broad DO token | Scoped, short-lived tokens; separate plan (read) vs apply (write) creds |
| Prompt-injection via project content | Agent treats project data as untrusted input; no secret access from data-plane context |

---

## 6. Residual / accepted risks

- Single-Droplet-per-project has no in-region HA (accepted for v1; escape hatch noted).
- Zero-day in Caddy/Postgres/GoTrue — mitigated by fast patch pipeline, not eliminated.
- Insider with control-plane admin — mitigated by audit log + MFA, not eliminated.
- DO account/root compromise is out of scope (assumed-trusted substrate).

---

## 7. Continuous verification (so "secure" stays true)

- Pre-apply gates: tfsec, checkov, conftest/OPA, spec-linter, compose-linter, gitleaks, Trivy.
- Scheduled: `tofu plan` drift detection; CVE re-scan; backup-integrity; restore-drill.
- Runtime: access/audit logs → Loki; metrics/alerts → Prometheus/Grafana.
- A project is **not** "production-ready" in the console until all gates + a passing
  restore-drill are green.
```
