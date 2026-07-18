// ──────────────────────────────────────────────────────────────────────────
// Environment scoping for LLM-driven shell commands.
//
// The agent lets a model run shell commands (the `run_command` tool). If those
// commands inherit the full process environment, a prompt-injected or misled
// model can read the operator's crown-jewel secrets — the swarm's own API keys,
// GitHub PAT, and deploy-provider credentials — via `env`/`printenv`, and (now
// that agents can fetch URLs) exfiltrate them. So we hand tool commands a
// scrubbed copy of the environment with credential-bearing keys removed, while
// keeping the system vars (PATH, HOME, …) and project runtime config that a
// build/test legitimately needs.
//
// This does NOT touch the provider-CLI spawns (e.g. codex), which must keep
// their auth env to talk to their backend.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Keys matching any of these are treated as secrets and dropped. Covers the
 * swarm's provider/auth/deploy credentials plus generic secret-shaped names.
 */
const SECRET_KEY_PATTERNS: RegExp[] = [
  // Model-provider + swarm/git/MCP credentials (mirrors sandbox.dockerEnvKeys).
  /^(ANTHROPIC|CLAUDE|DEEPSEEK|OPENAI|GITHUB|GH|MCP)_/i,
  /^GH_TOKEN$/i,
  // Deploy-provider credentials.
  /^(VERCEL|DIGITALOCEAN|DO|GCP|GOOGLE|CLOUDSDK|AWS)_/i,
  // Generic secret-shaped names, wherever they come from.
  /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSWD|_PAT|_CREDENTIALS?|_PRIVATE_KEY)$/i,
  /(APIKEY|API_KEY|ACCESS_KEY|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i,
];

function splitList(raw: string | undefined): string[] {
  return (raw || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// High-confidence "this is a credential value" shapes. Used to REFUSE secret-
// shaped submissions coming in over the wire (e.g. someone pasting an API key
// into a chat answer) so secrets never land in the DB/logs/prompt. Kept
// conservative so ordinary answers (domains, ids, URLs) are not blocked.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN[ A-Z]*PRIVATE KEY-----/,                                        // PEM private key
  /\b(sk|pk|rk|ghp|gho|ghu|ghs|glpat|xox[baprs]|AIza)[-_][A-Za-z0-9._-]{12,}/i, // provider tokens (may span segments)
  /\bAKIA[0-9A-Z]{16}\b/,                                                      // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/,            // JWT (Supabase anon/service keys)
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,                                             // long base64 blob
  /\b[A-Fa-f0-9]{40,}\b/,                                                     // long hex blob
];

/** True if a value looks like a credential/secret that must not be accepted in chat. */
export function looksLikeSecretValue(value: string): boolean {
  const s = (value || "").trim();
  if (s.length < 16) return false;
  return SECRET_VALUE_PATTERNS.some((re) => re.test(s));
}

/**
 * Return a copy of `source` with credential-bearing keys removed.
 *
 * Overrides via env:
 *  - SWARM_SHELL_ENV_ALLOW: comma-separated keys to force-KEEP (a build that
 *    genuinely needs a specific token). Wins over the scrub patterns.
 *  - SWARM_SHELL_ENV_DENY: comma-separated keys to additionally force-DROP.
 */
export function scrubSecretsFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allow = new Set(splitList(env.SWARM_SHELL_ENV_ALLOW));
  const deny = new Set(splitList(env.SWARM_SHELL_ENV_DENY));
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allow.has(key)) { out[key] = value; continue; }
    if (deny.has(key)) continue;
    if (SECRET_KEY_PATTERNS.some((re) => re.test(key))) continue;
    out[key] = value;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Log redaction. The scrub above keeps secrets out of shell commands; this
// keeps them out of what we PERSIST (agent prompts/outputs, log messages and
// metadata). Applied at the logger choke point so no secret reaches the DB,
// dashboard, or console no matter how it entered the text (a model echoing a
// `.env`, a build printing an env var, a pasted token, …).
// ──────────────────────────────────────────────────────────────────────────

const REDACTED = "[REDACTED]";

// High-confidence credential shapes to mask wherever they appear in log text.
// Deliberately narrower than SECRET_VALUE_PATTERNS (no bare long hex/base64) so
// we don't mangle legitimate output like git SHAs or content hashes.
const LOG_REDACT_PATTERNS: RegExp[] = [
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,   // PEM private key block
  /\b(sk|pk|rk|ghp|gho|ghu|ghs|ghr|glpat|xox[baprs]|AIza)[-_][A-Za-z0-9._-]{12,}/gi, // provider tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                                                        // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g,              // JWT (Supabase, etc.)
];

// KEY=value / KEY: value lines from a dumped .env where the KEY looks like a
// secret — masks the value even when it isn't a known env value.
const DOTENV_SECRET_LINE =
  /^(\s*(?:export\s+)?[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|CREDENTIALS?|PRIVATE_KEY|API[_-]?KEY|ACCESS[_-]?KEY)[A-Za-z0-9_]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gim;

/**
 * The literal values of credential-bearing env keys — the operator's real
 * secrets (provider keys, PAT, deploy creds) plus any project `.env` secrets
 * loaded over them. Longest first so overlapping values redact fully.
 */
export function secretValuesFromEnv(source: NodeJS.ProcessEnv = process.env): string[] {
  const vals = new Set<string>();
  for (const [key, value] of Object.entries(source)) {
    if (!value || value.length < 8) continue; // ignore trivially short / non-secret values
    if (SECRET_KEY_PATTERNS.some((re) => re.test(key))) vals.add(value);
  }
  return Array.from(vals).sort((a, b) => b.length - a.length);
}

/** Mask secrets in a string before it is logged/persisted. */
export function redactSecrets(text: string, source: NodeJS.ProcessEnv = process.env): string {
  if (!text) return text;
  let out = text;
  // 1) Exact known secret values from the environment (the surest signal).
  for (const value of secretValuesFromEnv(source)) {
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }
  // 2) Credential-shaped tokens from unknown sources.
  for (const re of LOG_REDACT_PATTERNS) out = out.replace(re, REDACTED);
  // 3) Secret-looking assignments from a dumped .env.
  out = out.replace(DOTENV_SECRET_LINE, `$1${REDACTED}`);
  return out;
}

/** Deep-redact any JSON-serializable value (log metadata, structured fields). */
export function redactDeep<T>(value: T, source: NodeJS.ProcessEnv = process.env): T {
  if (value == null) return value;
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value), source)) as T;
  } catch {
    return value; // non-serializable — leave as-is rather than drop the log
  }
}

// ── Sensitive-file guard (defense-in-depth at the read tool) ────────────────
// Keeps a model from pulling raw secrets into context in the first place. The
// log-redaction above is the backstop; this stops the leak at the source.

// `.env` (any suffix) plus common credential files.
const SENSITIVE_FILE_RE =
  /(^|[\\/])(\.env(\.[^\\/]+)?|\.netrc|\.npmrc|\.pgpass|\.git-credentials|id_[a-z0-9]+|[^\\/]*\.pem|[^\\/]*\.key|[^\\/]*\.p12|[^\\/]*\.pfx|credentials(\.json)?|secrets?\.(json|ya?ml|toml|env))$/i;

// Example/template envs hold placeholders and are safe (and useful) to read.
const SAFE_ENV_RE = /(^|[\\/])\.env\.(example|sample|template|dist|defaults?)$/i;

/** True if a file's contents are secrets/config a model should not see raw. */
export function isSensitiveFile(filePath: string): boolean {
  const p = (filePath || "").replace(/\\/g, "/");
  if (SAFE_ENV_RE.test(p)) return false;
  return SENSITIVE_FILE_RE.test(p);
}

/** Mask a KEY=value / KEY: value config file so keys stay visible but values don't. */
export function redactEnvFileContent(content: string): string {
  const valuesMasked = content.replace(
    /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|\S+)/gm,
    `$1${REDACTED}`,
  );
  // Catch anything not shaped like KEY=value (PEM bodies, stray tokens).
  return redactSecrets(valuesMasked);
}

/** Names of keys that would be scrubbed from `source` — for logging/audit. */
export function scrubbedKeys(
  source: NodeJS.ProcessEnv = process.env,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const kept = new Set(Object.keys(scrubSecretsFromEnv(source, env)));
  return Object.keys(source).filter((k) => source[k] !== undefined && !kept.has(k));
}
