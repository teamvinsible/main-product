export interface GitCredential {
  profile: string;
  token: string;
  envName: string;
}

export function normalizeGitProfile(profile?: string): string {
  const cleaned = String(profile || "default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return cleaned || "default";
}

export function gitProfileEnvName(profile?: string): string {
  const normalized = normalizeGitProfile(profile);
  if (normalized === "default") return process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "GH_TOKEN";
  return `GITHUB_TOKEN_${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export function resolveGitCredential(profile?: string): GitCredential | null {
  const normalized = normalizeGitProfile(profile);
  if (normalized === "default") {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (!token) return null;
    return { profile: normalized, token, envName: process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "GH_TOKEN" };
  }
  const envName = gitProfileEnvName(normalized);
  const token = process.env[envName] || "";
  if (!token) return null;
  return { profile: normalized, token, envName };
}

export function configuredGitProfiles(env: Record<string, string | undefined> = process.env): Array<{ name: string; envName: string; tokenSet: boolean }> {
  const profiles = new Map<string, { name: string; envName: string; tokenSet: boolean }>();
  profiles.set("default", {
    name: "default",
    envName: env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "GH_TOKEN",
    tokenSet: Boolean(env.GITHUB_TOKEN || env.GH_TOKEN),
  });
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("GITHUB_TOKEN_")) continue;
    const suffix = key.slice("GITHUB_TOKEN_".length).toLowerCase().replace(/_/g, "-");
    if (!suffix) continue;
    profiles.set(suffix, { name: suffix, envName: key, tokenSet: Boolean(value) });
  }
  return Array.from(profiles.values()).sort((a, b) => a.name.localeCompare(b.name));
}
