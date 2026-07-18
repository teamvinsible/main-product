import type { SwarmLogger } from "../utils/logger.js";
import type { DeployCredential, DeployProvider } from "./credentials.js";

export type { DeployProvider };

// Non-secret, provider-specific configuration bound to a project (persisted in
// the DB deploy binding). Never holds credentials.
export interface DeployTarget {
  region?: string;    // DO region slug, GCP/AWS region
  project?: string;   // GCP project id
  service?: string;   // Cloud Run / App Runner service name
  appId?: string;     // DigitalOcean app id
  image?: string;     // AWS: ECR image URI to deploy
  [key: string]: unknown;
}

export interface DeployContext {
  provider: DeployProvider;
  projectName: string;
  workspaceDir: string;  // .swarm/workspaces/<name>
  appDir: string;        // resolved code root (absolute)
  repoUrl?: string;
  defaultBranch?: string;
  credential: DeployCredential;
  target: DeployTarget;
  prod: boolean;
  env: NodeJS.ProcessEnv;
  logger?: SwarmLogger;
  log: (level: "info" | "warn" | "error", message: string) => void;  // pre-scrubbed
}

export interface DeployResult {
  ok: boolean;
  url?: string;
  logsUrl?: string;
  detail: string;
  raw?: unknown;
}

export interface DeployAdapter {
  provider: DeployProvider;
  deploy(ctx: DeployContext): Promise<DeployResult>;
}
