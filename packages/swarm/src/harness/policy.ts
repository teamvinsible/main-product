import fs from "node:fs";
import path from "node:path";
import type { SandboxMode } from "../sandbox.js";

export type DeployAutonomy = "off" | "manual" | "staging_auto" | "prod_auto";

export interface SwarmPolicy {
  version: 1;
  autonomy: {
    deploy: DeployAutonomy;
    prod: "human_approve" | "allowed";
    /** When a PR is opened, skip auto-deploy — the PR is the delivery artifact. */
    skipDeployWhenPrTracked: boolean;
  };
  sandbox: {
    mode: SandboxMode;
    network: "bridge" | "none";
  };
  network: {
    /** Empty = allow public hosts (private/loopback still blocked). */
    webFetchAllow: string[];
    webFetchBlockPrivate: boolean;
  };
  preflight: {
    /** Declare missing env keys before the run starts. */
    proactiveSecrets: boolean;
    /** Pause the run when required keys are absent (dashboard or TTY). */
    blockOnMissingSecrets: boolean;
  };
}

export const DEFAULT_POLICY: SwarmPolicy = {
  version: 1,
  autonomy: {
    deploy: "staging_auto",
    prod: "human_approve",
    skipDeployWhenPrTracked: true,
  },
  sandbox: {
    mode: "exec",
    network: "bridge",
  },
  network: {
    webFetchAllow: [
      "github.com",
      "*.githubusercontent.com",
      "raw.githubusercontent.com",
      "npmjs.org",
      "*.npmjs.org",
      "registry.npmjs.org",
      "nodejs.org",
      "developer.mozilla.org",
      "docs.npmjs.com",
      "nextjs.org",
      "react.dev",
      "supabase.com",
      "*.supabase.co",
      "vercel.com",
      "digitalocean.com",
      "cloud.google.com",
      "aws.amazon.com",
      "stackoverflow.com",
      "wikipedia.org",
    ],
    webFetchBlockPrivate: true,
  },
  preflight: {
    proactiveSecrets: true,
    blockOnMissingSecrets: false,
  },
};

const POLICY_FILES = ["swarm.policy.json", "swarm.policy.example.json"];

export function loadPolicy(root = process.cwd()): SwarmPolicy {
  for (const name of POLICY_FILES) {
    if (name.endsWith(".example.json")) continue;
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<SwarmPolicy>;
      return mergePolicy(DEFAULT_POLICY, raw);
    } catch {
      // fall through to defaults
    }
  }
  return { ...DEFAULT_POLICY };
}

function mergePolicy(base: SwarmPolicy, raw: Partial<SwarmPolicy>): SwarmPolicy {
  return {
    version: 1,
    autonomy: { ...base.autonomy, ...(raw.autonomy || {}) },
    sandbox: { ...base.sandbox, ...(raw.sandbox || {}) },
    network: {
      webFetchAllow: raw.network?.webFetchAllow ?? base.network.webFetchAllow,
      webFetchBlockPrivate: raw.network?.webFetchBlockPrivate ?? base.network.webFetchBlockPrivate,
    },
    preflight: { ...base.preflight, ...(raw.preflight || {}) },
  };
}

/** Env SWARM_SANDBOX wins; else policy default. */
export function resolveSandboxMode(policy = loadPolicy(), env: NodeJS.ProcessEnv = process.env): SandboxMode {
  const raw = (env.SWARM_SANDBOX || "").trim();
  if (raw === "off" || raw === "exec" || raw === "full") return raw;
  return policy.sandbox.mode;
}

function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith(`.${suffix}`);
  }
  return h === p;
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" || h === "0.0.0.0" || h === "::1" ||
    h === "169.254.169.254" || h === "metadata.google.internal" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function isWebFetchAllowed(url: string, policy = loadPolicy()): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `unsupported protocol ${parsed.protocol}` };
  }
  const host = parsed.hostname.toLowerCase();
  if (policy.network.webFetchBlockPrivate && isPrivateOrLoopbackHost(host)) {
    return { ok: false, reason: `private/loopback host ${host}` };
  }
  const allow = policy.network.webFetchAllow;
  if (allow.length > 0 && !allow.some((p) => hostMatchesPattern(host, p))) {
    return { ok: false, reason: `host ${host} not on web_fetch allowlist (swarm.policy.json)` };
  }
  return { ok: true };
}

export function deployAutonomyAllowsStaging(policy = loadPolicy()): boolean {
  return policy.autonomy.deploy === "staging_auto" || policy.autonomy.deploy === "prod_auto";
}

export function deployAutonomyAllowsProd(policy = loadPolicy()): boolean {
  return policy.autonomy.deploy === "prod_auto" && policy.autonomy.prod === "allowed";
}
