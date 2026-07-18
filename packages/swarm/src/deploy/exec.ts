import { spawn } from "node:child_process";
import { buildDockerRunArgs, sandboxConfigFromEnv, shouldSandboxExec } from "../sandbox.js";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export interface RunCliOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  sandbox?: boolean;    // wrap in docker when sandbox mode is on (default true)
  timeoutMs?: number;
}

// Run a provider CLI, optionally inside the configured Docker sandbox (reusing
// buildDockerRunArgs). Never throws — spawn failures surface as code 127.
export function runCli(command: string, args: string[], opts: RunCliOptions): Promise<ExecResult> {
  const config = sandboxConfigFromEnv(opts.env);
  const useSandbox = opts.sandbox !== false && shouldSandboxExec(config);
  const spawnCmd = useSandbox ? "docker" : command;
  const spawnArgs = useSandbox
    ? buildDockerRunArgs(opts.cwd, command, args, opts.env, config)
    : args;

  return new Promise((resolve) => {
    const proc = spawn(spawnCmd, spawnArgs, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { if (stdout.length < 200_000) stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString(); });
    const timer = opts.timeoutMs ? setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs) : null;
    proc.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    proc.on("error", (err) => { if (timer) clearTimeout(timer); resolve({ code: 127, stdout, stderr, spawnError: err.message }); });
  });
}

export function isCliMissing(res: ExecResult): boolean {
  return res.code === 127
    || /ENOENT|not found|not recognized|command not found|is not recognized/i.test(res.spawnError || res.stderr || "");
}

// Replace secret values with *** so tokens never reach logs / the DB.
export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text || "";
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("***");
  }
  return out;
}

export function tailLines(text: string, n = 8): string {
  return (text || "").trim().split(/\r?\n/).slice(-n).join("\n");
}
