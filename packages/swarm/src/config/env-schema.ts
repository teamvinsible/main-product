/**
 * Documented defaults for environment variables. Keeps .env.example and runtime
 * aligned — import readEnv* helpers where a default matters.
 */

export function envString(key: string, fallback = ""): string {
  const v = process.env[key];
  return v !== undefined && v.trim() !== "" ? v.trim() : fallback;
}

export function envBool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return fallback;
  return ["1", "true", "on", "yes"].includes(v.trim().toLowerCase());
}

export function envInt(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) ? Math.floor(raw) : fallback;
}

export function envList(key: string): string[] {
  return envString(key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const ENV_DEFAULTS = {
  DATABASE_URL: "postgres://swarm:swarm@localhost:5432/swarm",
  SWARM_BIND: "127.0.0.1",
  SWARM_SANDBOX: "exec",
  SWARM_SANDBOX_IMAGE: "node:22-bookworm",
  SWARM_PROVIDER_ATTEMPTS: 3,
  SWARM_MAX_REVIEW_ROUNDS: 5,
  SWARM_REPEATED_TOOL_LIMIT: 4,
  SWARM_EMPTY_TOOL_RESULT_LIMIT: 5,
  SWARM_CI_REPAIR_ROUNDS: 3,
  SWARM_CI_REPAIR_TIMEOUT_MS: 1_200_000,
} as const;
