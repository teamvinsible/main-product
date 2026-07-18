import { spawn } from "node:child_process";
import type { LogFn } from "./types.js";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  log?: LogFn;
  /** Redact these substrings from streamed log lines (never from returned stdout). */
  redact?: string[];
}

// Thin spawn wrapper: streams output line-by-line to `log` (with redaction) and
// resolves with the captured streams + exit code. shell:false — no shell injection.
export function run(cmd: string, args: string[], opts: ExecOpts = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, shell: false });
    let stdout = "";
    let stderr = "";
    const sink = (buf: Buffer, isErr: boolean) => {
      const text = buf.toString();
      if (isErr) stderr += text;
      else stdout += text;
      if (opts.log) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) opts.log(isErr ? "warn" : "info", redact(line, opts.redact));
        }
      }
    };
    child.stdout.on("data", (d: Buffer) => sink(d, false));
    child.stderr.on("data", (d: Buffer) => sink(d, true));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export async function commandExists(cmd: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const r = await run(probe, [cmd]);
    return r.code === 0;
  } catch {
    return false;
  }
}

function redact(line: string, secrets?: string[]): string {
  let out = line;
  for (const s of secrets ?? []) {
    if (s && s.length >= 4) out = out.split(s).join("***");
  }
  return out;
}
