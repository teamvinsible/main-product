import path from "node:path";
import crypto from "node:crypto";
import type { SwarmLogger } from "../utils/logger.js";
import { resolvePrimaryCodeRoot } from "../utils/workspace-layout.js";
import { insertDeployment } from "../db/store.js";
import {
  DEPLOY_PROVIDER_LABELS, normalizeDeployProfile, requiredDeployEnvNames, resolveDeployCredential,
  type DeployProvider,
} from "./credentials.js";
import { scrubSecrets } from "./exec.js";
import type { DeployAdapter, DeployContext, DeployResult, DeployTarget } from "./types.js";
import { vercelAdapter } from "./adapters/vercel.js";
import { digitaloceanAdapter } from "./adapters/digitalocean.js";
import { gcpAdapter } from "./adapters/gcp.js";
import { awsAdapter } from "./adapters/aws.js";

const ADAPTERS: Record<DeployProvider, DeployAdapter> = {
  vercel: vercelAdapter,
  digitalocean: digitaloceanAdapter,
  gcp: gcpAdapter,
  aws: awsAdapter,
};

export interface DeployOptions {
  provider: DeployProvider;
  profile?: string;
  target?: DeployTarget;
  prod?: boolean;
  runId?: string;
  repoUrl?: string;
  defaultBranch?: string;
}

// Resolves the provider adapter, validates the (isolated) credential, locates
// the app to deploy, runs the adapter, and records the deployment. Secrets are
// scrubbed from every log line and from the persisted detail.
export class Deployer {
  private workspaceDir: string;
  private logger?: SwarmLogger;

  constructor(workspaceDir: string, logger?: SwarmLogger) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.logger = logger;
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const projectName = path.basename(this.workspaceDir);
    const provider = opts.provider;
    const label = DEPLOY_PROVIDER_LABELS[provider];
    const profile = normalizeDeployProfile(opts.profile);

    const credential = resolveDeployCredential(provider, profile);
    if (!credential) {
      const names = requiredDeployEnvNames(provider, profile).join(" and ");
      const detail = `${label}: missing credentials. Set ${names} (global .env or .swarm/workspaces/${projectName}/.env) via Settings.`;
      this.log("error", detail);
      await this.record(projectName, provider, profile, opts.runId, "failed", undefined, detail);
      return { ok: false, detail };
    }

    const secrets = Object.values(credential.secrets);
    const appDir = resolvePrimaryCodeRoot(this.workspaceDir);
    const ctx: DeployContext = {
      provider,
      projectName,
      workspaceDir: this.workspaceDir,
      appDir,
      repoUrl: opts.repoUrl,
      defaultBranch: opts.defaultBranch,
      credential,
      target: opts.target || {},
      prod: Boolean(opts.prod),
      env: process.env,
      logger: this.logger,
      log: (level, message) => this.log(level, scrubSecrets(message, secrets)),
    };

    this.log("info", `${label}: starting deploy of "${projectName}" (profile ${profile})`);
    let result: DeployResult;
    try {
      result = await ADAPTERS[provider].deploy(ctx);
    } catch (err) {
      result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    result.detail = scrubSecrets(result.detail || "", secrets);

    await this.record(projectName, provider, profile, opts.runId, result.ok ? "success" : "failed", result.url, result.detail, result.logsUrl);
    this.log(result.ok ? "info" : "error",
      `${label}: ${result.ok ? `deployed → ${result.url || "(pending URL)"}` : `deploy failed — ${result.detail}`}`);
    return result;
  }

  private async record(
    project: string, provider: DeployProvider, profile: string, runId: string | undefined,
    status: "success" | "failed", url?: string, detail?: string, logsUrl?: string,
  ): Promise<void> {
    try {
      await insertDeployment({
        id: crypto.randomUUID(),
        project, runId, provider, profile, status,
        url, logsUrl, detail,
      });
    } catch (err) {
      this.log("warn", `Failed to record deployment: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    if (this.logger) this.logger.log(level, "system", message);
    else console.log(message);
  }
}
