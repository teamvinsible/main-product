import type { HarnessSpec, SpecError, Tier } from "./types.js";

// Structural validation only (shape + types + basic well-formedness).
// Security guardrails (RLS required, no public bucket, headscale-only, ...) are
// enforced as GATES on the rendered stack, not here. See src/gates.

const TIERS: Tier[] = ["micro", "standard", "performance"];
const ROUTE_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*$/;
const NAME_RE = /^[a-z][a-z0-9-]{0,62}$/;

export function validateSpec(raw: unknown): { spec: HarnessSpec | null; errors: SpecError[] } {
  const errors: SpecError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (!isObject(raw)) {
    return { spec: null, errors: [{ path: "$", message: "spec must be a YAML mapping" }] };
  }

  requireString(raw, "project", "$", err);
  if (typeof raw.project === "string" && !NAME_RE.test(raw.project)) {
    err("$.project", "must be lowercase kebab-case (a-z, 0-9, -), starting with a letter");
  }
  requireString(raw, "region", "$", err);

  if (raw.tier !== undefined && !TIERS.includes(raw.tier as Tier)) {
    err("$.tier", `must be one of ${TIERS.join(", ")}`);
  }

  if (!isObject(raw.services) || Object.keys(raw.services).length === 0) {
    err("$.services", "at least one service is required");
  } else {
    for (const [name, svc] of Object.entries(raw.services)) {
      validateService(name, svc, err);
    }
  }

  if (!isObject(raw.resources)) {
    err("$.resources", "resources mapping is required");
  } else {
    validateResources(raw.resources, err);
  }

  if (raw.security !== undefined) validateSecurity(raw.security, err);

  if (errors.length) return { spec: null, errors };
  return { spec: raw as unknown as HarnessSpec, errors: [] };
}

function validateService(name: string, svc: unknown, err: (p: string, m: string) => void): void {
  const base = `$.services.${name}`;
  if (!NAME_RE.test(name)) err(base, "service name must be lowercase kebab-case");
  if (!isObject(svc)) return err(base, "service must be a mapping");
  requireString(svc, "build", base, err);
  if (svc.routes !== undefined) {
    if (!Array.isArray(svc.routes)) err(`${base}.routes`, "must be a list");
    else svc.routes.forEach((r, i) => {
      if (typeof r !== "string" || !ROUTE_RE.test(r)) {
        err(`${base}.routes[${i}]`, `invalid route "${String(r)}" (expected e.g. "GET /users")`);
      }
    });
  }
  if (svc.needs !== undefined && !isStringArray(svc.needs)) err(`${base}.needs`, "must be a list of strings");
  if (svc.env !== undefined && !isStringMap(svc.env)) err(`${base}.env`, "must be a map of string -> string");
}

function validateResources(res: Record<string, unknown>, err: (p: string, m: string) => void): void {
  if (res.db !== undefined) {
    if (!isObject(res.db)) err("$.resources.db", "must be a mapping of name -> db");
    else for (const [name, db] of Object.entries(res.db)) validateDb(name, db, err);
  }
  if (res.bucket !== undefined) {
    if (!isObject(res.bucket)) err("$.resources.bucket", "must be a mapping of name -> bucket");
    else for (const [name, b] of Object.entries(res.bucket)) validateBucket(name, b, err);
  }
  if (res.auth !== undefined) validateAuth(res.auth, err);
}

function validateDb(name: string, db: unknown, err: (p: string, m: string) => void): void {
  const base = `$.resources.db.${name}`;
  if (!isObject(db)) return err(base, "db must be a mapping");
  requireString(db, "engine", base, err);
  if (db.rls !== undefined && db.rls !== "required" && db.rls !== "off") {
    err(`${base}.rls`, 'must be "required" or "off"');
  }
  if (db.backups !== undefined) {
    const b = db.backups;
    if (!isObject(b)) err(`${base}.backups`, "must be a mapping");
    else {
      if (b.to !== "spaces") err(`${base}.backups.to`, 'must be "spaces"');
      if (typeof b.schedule !== "string") err(`${base}.backups.schedule`, "cron string required");
    }
  }
}

function validateBucket(name: string, b: unknown, err: (p: string, m: string) => void): void {
  const base = `$.resources.bucket.${name}`;
  if (!isObject(b)) return err(base, "bucket must be a mapping");
  if (b.public !== undefined && typeof b.public !== "boolean") err(`${base}.public`, "must be a boolean");
}

function validateAuth(auth: unknown, err: (p: string, m: string) => void): void {
  const base = "$.resources.auth";
  if (!isObject(auth)) return err(base, "auth must be a mapping");
  if (auth.provider !== "gotrue") err(`${base}.provider`, 'only "gotrue" is supported');
  if (auth.providers !== undefined && !isStringArray(auth.providers)) {
    err(`${base}.providers`, "must be a list of strings");
  }
}

function validateSecurity(sec: unknown, err: (p: string, m: string) => void): void {
  const base = "$.security";
  if (!isObject(sec)) return err(base, "security must be a mapping");
  checkEnum(sec, "ssh", ["headscale-only", "public"], base, err);
  checkEnum(sec, "firewall", ["default-deny", "open"], base, err);
  checkEnum(sec, "tls", ["auto", "off"], base, err);
}

// --- helpers -------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isStringMap(v: unknown): v is Record<string, string> {
  return isObject(v) && Object.values(v).every((x) => typeof x === "string");
}
function requireString(o: Record<string, unknown>, key: string, base: string, err: (p: string, m: string) => void): void {
  if (typeof o[key] !== "string" || (o[key] as string).length === 0) {
    err(`${base === "$" ? "$" : base}.${key}`, "required non-empty string");
  }
}
function checkEnum(o: Record<string, unknown>, key: string, allowed: string[], base: string, err: (p: string, m: string) => void): void {
  if (o[key] !== undefined && !allowed.includes(o[key] as string)) {
    err(`${base}.${key}`, `must be one of ${allowed.join(", ")}`);
  }
}
