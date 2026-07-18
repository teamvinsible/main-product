import fs from "node:fs";
import path from "node:path";
import { loadPolicy, resolveSandboxMode } from "./harness/policy.js";

export type SandboxMode = "off" | "exec" | "full";

export interface SandboxExecConfig {
  mode: SandboxMode;
  image: string;
  cpus?: string;
  memory?: string;
  // ── Hardening ──
  // Egress policy for the exec path (arbitrary agent-run shell). "none" cuts
  // the network entirely (strongest isolation, but breaks npm/pip fetches);
  // "bridge" keeps default networking so installs work. The full-run path
  // (agent CLI) always keeps egress — it must reach the model API.
  network: "bridge" | "none";
  dropCaps: boolean;   // --cap-drop ALL (safe for normal builds)
  readOnly: boolean;   // read-only rootfs + tmpfs /tmp (exec path; opt-in)
  pidsLimit?: string;  // --pids-limit (fork-bomb guard)
}

function envFlag(value: string | undefined, dflt: boolean): boolean {
  if (value == null || value === "") return dflt;
  return /^(1|on|true|yes)$/i.test(value.trim());
}

export function sandboxConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxExecConfig {
  const policy = loadPolicy();
  const mode = resolveSandboxMode(policy, env);
  const network = env.SWARM_SANDBOX_NETWORK === "none"
    ? "none"
    : (env.SWARM_SANDBOX_NETWORK === "bridge" ? "bridge" : policy.sandbox.network);
  return {
    mode,
    image: env.SWARM_SANDBOX_IMAGE || "node:22-bookworm",
    cpus: env.SWARM_SANDBOX_CPUS || undefined,
    memory: env.SWARM_SANDBOX_MEMORY || undefined,
    network,
    dropCaps: envFlag(env.SWARM_SANDBOX_DROP_CAPS, true),
    readOnly: envFlag(env.SWARM_SANDBOX_READONLY, false),
    pidsLimit: env.SWARM_SANDBOX_PIDS || "512",
  };
}

// Container-hardening flags applied to every sandboxed `docker run`. cap-drop +
// no-new-privileges + a pids cap are safe for ordinary builds; network
// isolation and a read-only rootfs are handled per call-site (they break
// network-dependent installs).
function dockerHardeningArgs(config: SandboxExecConfig): string[] {
  const args: string[] = ["--security-opt", "no-new-privileges"];
  if (config.dropCaps) args.push("--cap-drop", "ALL");
  if (config.pidsLimit) args.push("--pids-limit", config.pidsLimit);
  return args;
}

export function shouldSandboxExec(config = sandboxConfigFromEnv()): boolean {
  return config.mode === "exec" || config.mode === "full";
}

export function buildDockerExecArgs(workspaceDir: string, command: string, config = sandboxConfigFromEnv()): string[] {
  const args = [
    "run",
    "--rm",
    ...dockerHardeningArgs(config),
    "-v", `${workspaceDir}:/work`,
    "-w", "/work",
  ];
  // Untrusted, agent-generated shell: cut egress and lock the rootfs when the
  // operator has opted into strict isolation (SWARM_SANDBOX_NETWORK=none /
  // SWARM_SANDBOX_READONLY=on).
  if (config.network === "none") args.push("--network", "none");
  if (config.readOnly) {
    // Read-only rootfs, but keep /tmp and $HOME (default /root) writable via
    // tmpfs so caches/scratch still work; nothing persists to the image.
    args.push("--read-only", "--tmpfs", "/tmp:rw,exec,size=512m", "--tmpfs", "/root:rw,exec,size=256m");
  }
  if (config.cpus) args.push("--cpus", config.cpus);
  if (config.memory) args.push("--memory", config.memory);
  args.push(config.image, "sh", "-lc", command);
  return args;
}

export function buildDockerRunArgs(
  projectRoot: string,
  command: string,
  commandArgs: string[],
  env: Record<string, string | undefined>,
  config = sandboxConfigFromEnv(),
): string[] {
  const args = [
    "run",
    "--rm",
    // Safe hardening only — the agent CLI needs egress (model API) and a
    // writable rootfs, so network isolation / read-only are NOT applied here.
    ...dockerHardeningArgs(config),
    "-v", `${projectRoot}:/work`,
    "-w", "/work",
  ];
  const claudeDir = hostClaudeDir(env);
  if (claudeDir) args.push("-v", `${claudeDir}:/root/.claude`);
  if (config.cpus) args.push("--cpus", config.cpus);
  if (config.memory) args.push("--memory", config.memory);
  for (const key of dockerEnvKeys(env)) {
    args.push("--env", key);
  }
  args.push("--env", "HOME=/root");
  args.push(config.image, command, ...commandArgs);
  return args;
}

export function isDockerInfrastructureFailure(code: number | null, stderr: string): boolean {
  if (code === 125) return true;
  return /docker daemon|cannot connect|image .* not found|pull access denied|no such image|is docker running/i.test(stderr);
}

function dockerEnvKeys(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((key) => {
    if (env[key] == null) return false;
    if (/^(ANTHROPIC|CLAUDE|DEEPSEEK|OPENAI|GITHUB|GH|SWARM|MCP)_/.test(key)) return true;
    if (/^(VERCEL|DIGITALOCEAN|DO|GCP|GOOGLE|CLOUDSDK|AWS)_/.test(key)) return true;
    if (/^(DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|NODE_ENV)$/.test(key)) return true;
    return false;
  });
}

function hostClaudeDir(env: Record<string, string | undefined>): string | null {
  const home = env.HOME || env.USERPROFILE;
  if (!home) return null;
  const dir = path.join(home, ".claude");
  return fs.existsSync(dir) ? dir : null;
}

