import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isCliMissing, runCli, tailLines } from "../exec.js";
import type { DeployAdapter, DeployContext, DeployResult } from "../types.js";

// Deploys the app directory to Google Cloud Run via the gcloud CLI, using a
// service-account key from the profile. GCP_SA_KEY may be a path to a JSON key,
// raw JSON, or base64-encoded JSON. Requires gcloud to be installed.
export const gcpAdapter: DeployAdapter = {
  provider: "gcp",
  async deploy(ctx: DeployContext): Promise<DeployResult> {
    const project = ctx.target.project || ctx.credential.config.GCP_PROJECT;
    if (!project) {
      return { ok: false, detail: "Cloud Run needs a GCP project id. Set it as the Deploy target's project, or GCP_PROJECT[_<PROFILE>] in Settings." };
    }
    const region = String(ctx.target.region || ctx.credential.config.GCP_REGION || "us-central1");
    const service = sanitizeName(ctx.target.service || ctx.projectName);

    const keyFile = writeKeyFile(ctx.workspaceDir, ctx.credential.secrets.GCP_SA_KEY);
    if (!keyFile) {
      return { ok: false, detail: "Could not read GCP_SA_KEY. Provide a service-account JSON (path, raw JSON, or base64)." };
    }
    const env = { ...ctx.env, CLOUDSDK_CORE_PROJECT: String(project), CLOUDSDK_CORE_DISABLE_PROMPTS: "1" };

    try {
      ctx.log("info", `GCP: activating service account for project ${project}`);
      const auth = await runCli("gcloud", ["auth", "activate-service-account", "--key-file", keyFile], { cwd: ctx.appDir, env, timeoutMs: 2 * 60_000 });
      if (isCliMissing(auth)) {
        return { ok: false, detail: "Cloud Run deploy needs the `gcloud` CLI installed (or present in the sandbox image)." };
      }
      if (auth.code !== 0) {
        return { ok: false, detail: `gcloud auth failed: ${tailLines(auth.stderr || auth.stdout)}` };
      }

      ctx.log("info", `GCP: deploying Cloud Run service "${service}" to ${region}`);
      const deploy = await runCli("gcloud", [
        "run", "deploy", service,
        "--source", ".",
        "--project", String(project),
        "--region", region,
        "--allow-unauthenticated",
        "--quiet",
        "--format=value(status.url)",
      ], { cwd: ctx.appDir, env, timeoutMs: 20 * 60_000 });

      const url = firstUrl(deploy.stdout);
      if (deploy.code !== 0 || !url) {
        return { ok: false, url, detail: tailLines(deploy.stderr || deploy.stdout) || `gcloud run deploy exited ${deploy.code}` };
      }
      return { ok: true, url, logsUrl: `https://console.cloud.google.com/run?project=${project}`, detail: `Deployed to Cloud Run (${region}).` };
    } finally {
      fs.rmSync(keyFile, { force: true });
    }
  },
};

// Materialize the SA key to a temp file gcloud can read; returns its path.
function writeKeyFile(workspaceDir: string, raw: string): string | null {
  const dir = path.join(workspaceDir, ".swarm");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `gcp-key-${crypto.randomBytes(6).toString("hex")}.json`);
    const trimmed = (raw || "").trim();
    // A filesystem path to an existing key file.
    if (!trimmed.startsWith("{") && fs.existsSync(trimmed)) {
      fs.copyFileSync(trimmed, target);
      return target;
    }
    // Raw JSON, or base64-encoded JSON.
    let json = trimmed;
    if (!json.startsWith("{")) {
      try { json = Buffer.from(trimmed, "base64").toString("utf-8"); } catch { /* fall through */ }
    }
    JSON.parse(json); // validate
    fs.writeFileSync(target, json, "utf-8");
    return target;
  } catch {
    return null;
  }
}

function firstUrl(text: string): string | undefined {
  const m = (text || "").match(/https:\/\/[^\s"']+/);
  return m ? m[0] : undefined;
}

function sanitizeName(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
}
