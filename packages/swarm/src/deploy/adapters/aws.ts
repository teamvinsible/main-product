import { isCliMissing, runCli, tailLines } from "../exec.js";
import type { DeployAdapter, DeployContext, DeployResult } from "../types.js";

// Deploys a container image to AWS App Runner via the aws CLI. Baseline: the
// image must already exist in a registry (ECR / ECR Public); pass it as the
// Deploy target's `image`. Building & pushing to ECR from here is a follow-up.
export const awsAdapter: DeployAdapter = {
  provider: "aws",
  async deploy(ctx: DeployContext): Promise<DeployResult> {
    const image = String(ctx.target.image || "");
    if (!image) {
      return { ok: false, detail: "AWS App Runner needs a container image. Set the Deploy target's `image` to an ECR/ECR-Public image URI (building & pushing from source is a planned follow-up)." };
    }
    const region = String(ctx.target.region || ctx.credential.config.AWS_REGION || "us-east-1");
    const service = sanitizeName(ctx.target.service || ctx.projectName);
    const env = {
      ...ctx.env,
      AWS_ACCESS_KEY_ID: ctx.credential.secrets.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: ctx.credential.secrets.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: region,
      AWS_DEFAULT_REGION: region,
    };
    const run = (args: string[]) => runCli("aws", [...args, "--region", region, "--output", "json"], { cwd: ctx.appDir, env, timeoutMs: 15 * 60_000 });

    const isPublic = /public\.ecr\.aws/.test(image);
    const sourceConfiguration = JSON.stringify({
      ImageRepository: {
        ImageIdentifier: image,
        ImageRepositoryType: isPublic ? "ECR_PUBLIC" : "ECR",
        ImageConfiguration: {},
      },
      ...(ctx.target.accessRoleArn && !isPublic
        ? { AuthenticationConfiguration: { AccessRoleArn: String(ctx.target.accessRoleArn) } }
        : {}),
      AutoDeploymentsEnabled: false,
    });

    ctx.log("info", `AWS: resolving App Runner service "${service}" in ${region}`);
    const list = await run(["apprunner", "list-services"]);
    if (isCliMissing(list)) {
      return { ok: false, detail: "AWS deploy needs the `aws` CLI installed (or present in the sandbox image)." };
    }
    if (list.code !== 0) {
      return { ok: false, detail: `aws apprunner list-services failed: ${tailLines(list.stderr || list.stdout)}` };
    }
    const services = safeJson<{ ServiceSummaryList?: Array<{ ServiceName: string; ServiceArn: string }> }>(list.stdout)?.ServiceSummaryList || [];
    const existing = services.find((s) => s.ServiceName === service);

    const res = existing
      ? await run(["apprunner", "update-service", "--service-arn", existing.ServiceArn, "--source-configuration", sourceConfiguration])
      : await run(["apprunner", "create-service", "--service-name", service, "--source-configuration", sourceConfiguration]);

    if (res.code !== 0) {
      return { ok: false, detail: `aws apprunner ${existing ? "update" : "create"}-service failed: ${tailLines(res.stderr || res.stdout)}` };
    }
    const parsed = safeJson<{ Service?: { ServiceUrl?: string; ServiceArn?: string } }>(res.stdout);
    const rawUrl = parsed?.Service?.ServiceUrl;
    const url = rawUrl ? (rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`) : undefined;
    ctx.log("info", `AWS: ${existing ? "updated" : "created"} App Runner service ${service}`);
    return {
      ok: true,
      url,
      logsUrl: `https://console.aws.amazon.com/apprunner/home?region=${region}#/services`,
      detail: url ? "AWS App Runner deploy triggered." : "App Runner service submitted; the URL appears once it reaches RUNNING.",
      raw: { serviceArn: parsed?.Service?.ServiceArn },
    };
  },
};

function safeJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

function sanitizeName(name: string): string {
  return String(name).replace(/[^A-Za-z0-9-_]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
}
