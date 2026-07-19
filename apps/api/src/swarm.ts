import type { Env } from "./env";

export async function proxySwarm(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (!env.SWARM_ORIGIN) return null;
  try {
    const headers = new Headers(init?.headers || {});
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
    if (env.SWARM_DASHBOARD_TOKEN) {
      headers.set("x-swarm-token", env.SWARM_DASHBOARD_TOKEN);
    }
    return await fetch(`${env.SWARM_ORIGIN}${path}`, {
      ...init,
      headers,
    });
  } catch {
    return null;
  }
}

export async function swarmJson<T>(env: Env, path: string, init?: RequestInit): Promise<T | null> {
  const res = await proxySwarm(env, path, init);
  if (!res?.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useLegacyArtifacts(env: Env): boolean {
  return env.LEGACY_SWARM === "true" && Boolean(env.SWARM_ORIGIN);
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

export function swarmNameForUser(userId: string, suggested: string): string {
  const short = userId.replace(/-/g, "").slice(0, 8);
  const base = slugify(suggested);
  return `${short}-${base}`.slice(0, 63);
}

export type SwarmArtifactMeta = { path: string; size: number };

export async function listSwarmArtifacts(
  env: Env,
  projectName: string,
): Promise<SwarmArtifactMeta[]> {
  const rows = await swarmJson<SwarmArtifactMeta[]>(
    env,
    `/api/artifacts?project=${encodeURIComponent(projectName)}`,
  );
  return rows || [];
}

export async function readSwarmArtifact(
  env: Env,
  projectName: string,
  relativePath: string,
): Promise<string | null> {
  const res = await proxySwarm(
    env,
    `/api/artifact/${encodeURIComponent(relativePath)}?project=${encodeURIComponent(projectName)}`,
  );
  if (!res?.ok) return null;
  return res.text();
}
