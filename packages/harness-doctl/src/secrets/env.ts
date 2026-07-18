import type { EnvMap, SecretsProvider } from "./types.js";

// Zero-config fallback: reads the required var names straight from process.env.
// Useful for CI/local, but NOT encrypted-at-rest — prefer SopsProvider for deploys.
export class EnvProvider implements SecretsProvider {
  id = "env";
  constructor(private names: string[] = []) {}

  async resolve(): Promise<EnvMap> {
    const out: EnvMap = {};
    for (const n of this.names) {
      const v = process.env[n];
      if (v !== undefined) out[n] = v;
    }
    return out;
  }
}
