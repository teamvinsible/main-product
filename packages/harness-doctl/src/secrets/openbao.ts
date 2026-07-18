import { SecretsError, type EnvMap, type SecretsProvider } from "./types.js";

export interface OpenBaoOpts {
  /** OpenBao address, reachable over the tailnet (e.g. http://bao:8200). */
  addr: string;
  token?: string;
  /** KV path holding the project's secrets. */
  path: string;
  /** Optional OpenBao namespace. */
  namespace?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

// Optional dynamic-secrets engine: OpenBao (MPL-2.0, the OSS fork of Vault).
// Supports KV v1 (`data`) and KV v2 (`data.data`) responses without logging the
// response body. Authentication may be supplied explicitly or with BAO_TOKEN.
export class OpenBaoProvider implements SecretsProvider {
  id = "openbao";
  constructor(private opts: OpenBaoOpts) {}

  async resolve(): Promise<EnvMap> {
    const token = this.opts.token ?? process.env.BAO_TOKEN;
    if (!token) throw new SecretsError("OpenBao token missing. Set OpenBaoOpts.token or BAO_TOKEN.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 10_000);
    const url = `${this.opts.addr.replace(/\/$/, "")}/v1/${this.opts.path.replace(/^\//, "")}`;
    try {
      const response = await fetch(url, {
        headers: {
          "X-Vault-Token": token,
          ...(this.opts.namespace ? { "X-Vault-Namespace": this.opts.namespace } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new SecretsError(`OpenBao request failed (${response.status} ${response.statusText}).`);
      const body = await response.json() as { data?: unknown };
      const outer = record(body.data);
      if (!outer) throw new SecretsError("OpenBao response did not contain a KV data object.");
      const values = record(outer.data) ?? outer;
      const env: EnvMap = {};
      for (const [key, value] of Object.entries(values)) {
        if (value !== null && typeof value !== "object") env[key] = String(value);
      }
      if (!Object.keys(env).length) throw new SecretsError("OpenBao KV path contained no scalar secrets.");
      return env;
    } catch (error) {
      if (error instanceof SecretsError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new SecretsError("OpenBao request timed out.");
      throw new SecretsError(`OpenBao request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
