import fs from "node:fs";
import path from "node:path";
import { loadPolicy, type SwarmPolicy } from "./policy.js";
import { isDeployProvider, deployEnvName } from "../deploy/credentials.js";

export interface PreflightKey {
  envKey: string;
  reason: string;
  kind: "secret" | "config";
  present: boolean;
}

export interface PreflightResult {
  ready: boolean;
  deployRequested: boolean;
  inferredDeployProvider: string;
  keys: PreflightKey[];
  missing: PreflightKey[];
  warnings: string[];
  summary: string;
}

const DEPLOY_KEYWORDS: Array<{ re: RegExp; provider: string; keys: string[] }> = [
  { re: /\bvercel\b/i, provider: "vercel", keys: ["VERCEL_TOKEN"] },
  { re: /\bdigital\s*ocean\b|\bdroplet\b/i, provider: "digitalocean", keys: ["DIGITALOCEAN_TOKEN"] },
  { re: /\bcloud\s*run\b|\bgcp\b|\bgoogle\s*cloud\b/i, provider: "gcp", keys: ["GCP_SA_KEY"] },
  { re: /\baws\b|\bapp\s*runner\b|\becr\b/i, provider: "aws", keys: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] },
];

const STACK_KEYS: Array<{ re: RegExp; keys: Array<{ envKey: string; reason: string; kind: "secret" | "config" }> }> = [
  {
    re: /\bsupabase\b/i,
    keys: [
      { envKey: "SUPABASE_URL", reason: "Supabase project URL", kind: "config" },
      { envKey: "SUPABASE_ANON_KEY", reason: "Supabase anon key (public client)", kind: "secret" },
    ],
  },
  {
    re: /\bstripe\b/i,
    keys: [
      { envKey: "STRIPE_SECRET_KEY", reason: "Stripe API secret", kind: "secret" },
    ],
  },
  {
    re: /\bopenai\b/i,
    keys: [
      { envKey: "OPENAI_API_KEY", reason: "OpenAI API key", kind: "secret" },
    ],
  },
];

export function detectDeployIntent(text: string): boolean {
  return /\b(deploy|ship|publish|go\s*live|staging|production|preview\s*url|host(?:ed)?\s+on)\b/i.test(text);
}

function inferDeployProvider(text: string, bound?: string): string {
  if (bound && isDeployProvider(bound)) return bound;
  for (const row of DEPLOY_KEYWORDS) {
    if (row.re.test(text)) return row.provider;
  }
  if (/\bnext\.?js\b/i.test(text)) return "vercel";
  return "";
}

function envPresent(env: NodeJS.ProcessEnv, key: string): boolean {
  const v = env[key];
  return typeof v === "string" && v.trim().length > 0;
}

function deployKeysForProvider(provider: string, profile = "default"): PreflightKey[] {
  if (!isDeployProvider(provider)) return [];
  const bases: Record<string, string[]> = {
    vercel: ["VERCEL_TOKEN"],
    digitalocean: ["DIGITALOCEAN_TOKEN"],
    gcp: ["GCP_SA_KEY"],
    aws: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  };
  return (bases[provider] || []).map((base) => ({
    envKey: deployEnvName(base, profile),
    reason: `${provider} deploy credential`,
    kind: "secret" as const,
    present: false,
  }));
}

export function runPreflight(args: {
  request: string;
  workspaceDir: string;
  deployProvider?: string;
  deployProfile?: string;
  env?: NodeJS.ProcessEnv;
  policy?: SwarmPolicy;
}): PreflightResult {
  const policy = args.policy ?? loadPolicy();
  const env = args.env ?? process.env;
  const warnings: string[] = [];
  const keys: PreflightKey[] = [];
  const seen = new Set<string>();

  const addKey = (row: Omit<PreflightKey, "present">) => {
    if (seen.has(row.envKey)) return;
    seen.add(row.envKey);
    keys.push({ ...row, present: envPresent(env, row.envKey) });
  };

  const deployRequested = detectDeployIntent(args.request);
  const inferredDeployProvider = inferDeployProvider(args.request, args.deployProvider);

  if (deployRequested || inferredDeployProvider) {
    const provider = inferredDeployProvider || args.deployProvider || "";
    if (provider) {
      for (const k of deployKeysForProvider(provider, args.deployProfile || "default")) addKey(k);
    } else {
      warnings.push("Deploy was requested but no deploy provider could be inferred. Bind one in the dashboard Deploy tab.");
    }
  }

  if (/\b(github|git\s*hub)\b/i.test(args.request) && /\b(push|commit|pr|pull\s*request|repo)\b/i.test(args.request)) {
    addKey({ envKey: "GITHUB_TOKEN", reason: "GitHub automation (or GH_TOKEN)", kind: "secret" });
    if (!envPresent(env, "GITHUB_TOKEN")) addKey({ envKey: "GH_TOKEN", reason: "GitHub automation alias", kind: "secret" });
  }

  for (const row of STACK_KEYS) {
    if (!row.re.test(args.request)) continue;
    for (const k of row.keys) addKey(k);
  }

  // Provider keys for agent routing (declare only if that provider is mentioned).
  if (/\bdeepseek\b/i.test(args.request)) {
    addKey({ envKey: "DEEPSEEK_API_KEY", reason: "DeepSeek model provider", kind: "secret" });
  }
  if (/\bopenrouter\b/i.test(args.request)) {
    addKey({ envKey: "OPENROUTER_API_KEY", reason: "OpenRouter gateway", kind: "secret" });
  }

  const projEnv = path.join(args.workspaceDir, ".env");
  if (!fs.existsSync(projEnv) && keys.some((k) => !k.present)) {
    warnings.push(`Per-project secrets can be added to ${projEnv} (values are never read into chat/logs).`);
  }

  const missing = keys.filter((k) => !k.present);
  const ready = missing.length === 0 || !policy.preflight.blockOnMissingSecrets;

  const summary = missing.length === 0
    ? (keys.length ? "Pre-flight: all declared keys present." : "Pre-flight: no extra keys required.")
    : `Pre-flight: ${missing.length} key(s) not set — ${missing.map((k) => k.envKey).join(", ")}`;

  return {
    ready,
    deployRequested,
    inferredDeployProvider,
    keys,
    missing,
    warnings,
    summary,
  };
}
