import type { LogFn } from "../provision/types.js";

export type { LogFn };

export type EnvMap = Record<string, string>;

// A secrets backend. `resolve()` returns the full runtime env map for a project
// (decrypted from SOPS, fetched from OpenBao, etc.). Adapters: sops (default),
// env (fallback), openbao (optional). See src/secrets/index.ts.
export interface SecretsProvider {
  id: string;
  resolve(): Promise<EnvMap>;
}

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}
