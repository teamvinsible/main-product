import { existsSync } from "node:fs";
import type { LogFn } from "../provision/types.js";
import type { RenderedStack } from "../render/types.js";
import { EnvProvider } from "./env.js";
import { SopsProvider } from "./sops.js";
import type { EnvMap, SecretsProvider } from "./types.js";

export { SopsProvider } from "./sops.js";
export { EnvProvider } from "./env.js";
export { OpenBaoProvider } from "./openbao.js";
export { SecretsError } from "./types.js";
export type { EnvMap, SecretsProvider } from "./types.js";
export type { SopsOpts } from "./sops.js";
export type { OpenBaoOpts } from "./openbao.js";

// `${VAR}` in compose/Caddy — but NOT `$${VAR}` (an escaped, container-runtime var).
const ENV_REF = /(?<!\$)\$\{([A-Z][A-Z0-9_]*)\}/g;
// {"$env":"NAME"} indirection in infra-config.json.
const JSON_ENV_REF = /"\$env"\s*:\s*"([A-Z][A-Z0-9_]*)"/g;

// Every env var name the deployed stack expects at deploy time.
export function computeRequiredEnv(stack: RenderedStack): string[] {
  const names = new Set<string>();
  const scan = (text: string, re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const g = m[1];
      if (g) names.add(g);
    }
  };
  for (const f of [stack.compose, stack.caddy, stack.infraConfig]) scan(f.content, ENV_REF);
  scan(stack.infraConfig.content, JSON_ENV_REF);
  return [...names].sort();
}

export function buildDotenv(env: EnvMap): string {
  return (
    Object.entries(env)
      .map(([k, v]) => `${k}=${dotenvEscape(v)}`)
      .join("\n") + "\n"
  );
}

function dotenvEscape(v: string): string {
  return /[\s"'#=]/.test(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v;
}

export interface ProviderChoice {
  provider?: SecretsProvider;
  secretsFile?: string;
  ageKeyFile?: string;
  requiredNames?: string[];
  log?: LogFn;
}

// sops when an encrypted secrets file is present; otherwise the env fallback.
export function selectProvider(c: ProviderChoice): SecretsProvider {
  if (c.provider) return c.provider;
  if (c.secretsFile && existsSync(c.secretsFile)) {
    return new SopsProvider({ file: c.secretsFile, ageKeyFile: c.ageKeyFile, log: c.log });
  }
  return new EnvProvider(c.requiredNames ?? []);
}
