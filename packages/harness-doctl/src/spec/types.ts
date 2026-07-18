// The developer contract: `project.spec.yaml`. See ARCHITECTURE.md §4.
// Services are written in any language; this spec declares infra + routing + deps.

export type Tier = "micro" | "standard" | "performance";

export interface HarnessSpec {
  project: string;
  region: string;
  tier?: Tier;
  services: Record<string, ServiceSpec>;
  resources: ResourcesSpec;
  security?: SecuritySpec;
}

export interface ServiceSpec {
  /** Build context dir (any language). The harness builds + runs the container. */
  build: string;
  /** Caddy routes, e.g. "GET /users". Generated into the reverse proxy. */
  routes?: string[];
  /** Declared infra deps, e.g. "db.main", "bucket.uploads", "auth". */
  needs?: string[];
  /** Non-secret env; secrets go through SOPS/infra-config `$env` indirection. */
  env?: Record<string, string>;
}

export interface ResourcesSpec {
  db?: Record<string, DbSpec>;
  bucket?: Record<string, BucketSpec>;
  auth?: AuthSpec;
}

export interface DbSpec {
  /** e.g. "postgres@16" */
  engine: string;
  /** RLS is required by default; `off` is an auditable override. */
  rls?: "required" | "off";
  backups?: BackupSpec;
}

export interface BackupSpec {
  to: "spaces";
  /** cron expression */
  schedule: string;
  pitr?: boolean;
}

export interface BucketSpec {
  /** Private by default. `true` is an auditable override. */
  public?: boolean;
}

export interface AuthSpec {
  provider: "gotrue";
  /** enabled identity providers, e.g. ["email", "google"] */
  providers?: string[];
}

export interface SecuritySpec {
  ssh?: "headscale-only" | "public";
  firewall?: "default-deny" | "open";
  tls?: "auto" | "off";
}

/** Structural validation error (shape/type problems). Guardrail violations are gates. */
export interface SpecError {
  path: string;
  message: string;
}
