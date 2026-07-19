// Per-project deploy credentials via environment-variable profiles — the same
// isolation model as GitHub tokens (see src/git/credentials.ts). The `default`
// profile uses the bare env var; a named profile appends `_<PROFILE>`. Per-
// project isolation is automatic: deploy runs load .swarm/workspaces/<name>/.env over
// the global .env, so a project can carry its own provider token. Secrets are
// never stored in the database — only the binding (provider + profile) is.

export type DeployProvider = "vercel" | "digitalocean" | "gcp" | "aws";

export const DEPLOY_PROVIDERS: DeployProvider[] = ["vercel", "digitalocean", "gcp", "aws"];

export const DEPLOY_PROVIDER_LABELS: Record<DeployProvider, string> = {
  vercel: "Vercel",
  digitalocean: "DigitalOcean (App Platform)",
  gcp: "GCP (Cloud Run)",
  aws: "AWS",
};

export function isDeployProvider(value: string): value is DeployProvider {
  return (DEPLOY_PROVIDERS as string[]).includes(value);
}

interface ProviderEnvSpec {
  secrets: string[];   // required secret base vars (all must be set for a profile)
  config?: string[];   // optional, non-secret base vars (region/project/etc.)
}

// Base env var names per provider. Named profiles suffix these (see envName).
const DEPLOY_ENV_SPEC: Record<DeployProvider, ProviderEnvSpec> = {
  vercel:       { secrets: ["VERCEL_TOKEN"] },
  digitalocean: { secrets: ["DIGITALOCEAN_TOKEN"] },
  gcp:          { secrets: ["GCP_SA_KEY"], config: ["GCP_PROJECT", "GCP_REGION"] },
  aws:          { secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], config: ["AWS_REGION"] },
};

export function normalizeDeployProfile(profile?: string): string {
  const cleaned = String(profile || "default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return cleaned || "default";
}

// The concrete env var name for a base var under a profile. Default → bare var.
export function deployEnvName(baseVar: string, profile?: string): string {
  const normalized = normalizeDeployProfile(profile);
  if (normalized === "default") return baseVar;
  return `${baseVar}_${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export function deploySecretBases(provider: DeployProvider): string[] {
  return DEPLOY_ENV_SPEC[provider].secrets;
}

export function deployConfigBases(provider: DeployProvider): string[] {
  return DEPLOY_ENV_SPEC[provider].config || [];
}

// The secret env var names an operator must set for provider+profile — used for
// clear "set X" error messages and Settings validation.
export function requiredDeployEnvNames(provider: DeployProvider, profile?: string): string[] {
  return deploySecretBases(provider).map((base) => deployEnvName(base, profile));
}

export interface DeployCredential {
  provider: DeployProvider;
  profile: string;
  secrets: Record<string, string>;  // base var name -> resolved value
  config: Record<string, string>;   // base var name -> resolved value (profile, then bare)
  envNames: string[];               // resolved secret env var names (never log values)
}

// Resolve a provider credential for a profile, or null if any required secret is
// missing. Optional config vars fall back from the profile-scoped name to bare.
export function resolveDeployCredential(
  provider: DeployProvider,
  profile?: string,
  env: NodeJS.ProcessEnv = process.env,
): DeployCredential | null {
  const normalized = normalizeDeployProfile(profile);
  const secretBases = deploySecretBases(provider);
  const secrets: Record<string, string> = {};
  const envNames: string[] = [];
  for (const base of secretBases) {
    const name = deployEnvName(base, normalized);
    envNames.push(name);
    const value = env[name] || "";
    if (!value) return null;
    secrets[base] = value;
  }
  const config: Record<string, string> = {};
  for (const base of deployConfigBases(provider)) {
    const value = env[deployEnvName(base, normalized)] || env[base] || "";
    if (value) config[base] = value;
  }
  return { provider, profile: normalized, secrets, config, envNames };
}

export interface DeployProfileInfo {
  provider: DeployProvider;
  name: string;
  envNames: string[];  // secret env var names for this profile
  tokenSet: boolean;   // all required secrets present
}

// Enumerate configured deploy credential profiles per provider (for the Settings
// UI + pre-flight validation). Mirrors configuredGitProfiles.
export function configuredDeployProfiles(env: NodeJS.ProcessEnv = process.env): DeployProfileInfo[] {
  const out: DeployProfileInfo[] = [];
  for (const provider of DEPLOY_PROVIDERS) {
    const primary = deploySecretBases(provider)[0];
    const prefix = `${primary}_`;
    const names = new Set<string>(["default"]);
    for (const [key, value] of Object.entries(env)) {
      if (!value || !key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length).toLowerCase().replace(/_/g, "-");
      if (suffix) names.add(suffix);
    }
    for (const name of names) {
      const envNames = requiredDeployEnvNames(provider, name);
      out.push({ provider, name, envNames, tokenSet: envNames.every((n) => Boolean(env[n])) });
    }
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}
