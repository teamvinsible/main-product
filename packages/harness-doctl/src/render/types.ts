import type { ResourceGraph } from "../graph/types.js";

export interface RenderOpts {
  /** DigitalOcean API token. Never written into artifacts — passed to the Provisioner. */
  token?: string;
  region: string;
  prod: boolean;
}

export interface RenderedFile {
  path: string;
  content: string;
}

// The full set of artifacts derived from the graph. Pure data — nothing is applied.
export interface RenderedStack {
  project: string;
  graph: ResourceGraph;
  /** OpenTofu files (main.tf, variables.tf, ...). */
  tofu: RenderedFile[];
  /** docker-compose.yml (hardened). */
  compose: RenderedFile;
  /** infra-config.json — $env-wired map from declared resources to real endpoints. */
  infraConfig: RenderedFile;
  /** Caddyfile (reverse proxy + auto-TLS + security headers). */
  caddy: RenderedFile;
  meta: { region: string; prod: boolean };
}
