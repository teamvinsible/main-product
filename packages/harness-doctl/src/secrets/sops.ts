import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { commandExists, run } from "../provision/exec.js";
import { SecretsError, type EnvMap, type LogFn, type SecretsProvider } from "./types.js";

export interface SopsOpts {
  /** Path to the SOPS-encrypted secrets file (.env, .yaml, or .json). */
  file: string;
  /** age private key file; also honored via SOPS_AGE_KEY_FILE in the environment. */
  ageKeyFile?: string;
  log?: LogFn;
}

// Default provider: decrypts an age-encrypted, git-committable secrets file with
// SOPS. No running service; the encrypted file lives in the project repo and is
// decrypted only in memory at deploy time. Decrypted output is NEVER streamed to
// logs (it's the secret material).
export class SopsProvider implements SecretsProvider {
  id = "sops";
  constructor(private opts: SopsOpts) {}

  async resolve(): Promise<EnvMap> {
    if (!(await commandExists("sops"))) {
      throw new SecretsError("`sops` not found on PATH. Install SOPS (github.com/getsops/sops) to decrypt secrets.");
    }
    const env = { ...process.env };
    if (this.opts.ageKeyFile) env.SOPS_AGE_KEY_FILE = this.opts.ageKeyFile;

    // Intentionally no `log` — stdout is plaintext secrets.
    const res = await run("sops", ["--decrypt", this.opts.file], { env });
    if (res.code !== 0) {
      throw new SecretsError(`sops decrypt failed for ${this.opts.file} (exit ${res.code}): ${res.stderr.slice(0, 200)}`);
    }
    return parseByExt(this.opts.file, res.stdout);
  }
}

function parseByExt(file: string, text: string): EnvMap {
  const ext = extname(file).toLowerCase();
  if (ext === ".json") return flat(JSON.parse(text));
  if (ext === ".yaml" || ext === ".yml") return flat(parseYaml(text) ?? {});
  return parseDotenv(text);
}

function flat(o: unknown): EnvMap {
  const out: EnvMap = {};
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v !== null && typeof v !== "object") out[k] = String(v);
    }
  }
  return out;
}

function parseDotenv(text: string): EnvMap {
  const out: EnvMap = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}
