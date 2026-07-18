import { isCliMissing, runCli, tailLines } from "../exec.js";
import type { DeployAdapter, DeployContext, DeployResult } from "../types.js";

// Deploys the app directory to Vercel via the CLI (`npx vercel deploy`). npx
// avoids requiring a global install; the token authenticates non-interactively.
export const vercelAdapter: DeployAdapter = {
  provider: "vercel",
  async deploy(ctx: DeployContext): Promise<DeployResult> {
    const token = ctx.credential.secrets.VERCEL_TOKEN;
    const args = ["--yes", "vercel", "deploy", "--yes", "--token", token];
    if (ctx.prod) args.push("--prod");

    ctx.log("info", `Vercel: deploying ${ctx.appDir}${ctx.prod ? " (production)" : ""}`);
    const res = await runCli("npx", args, { cwd: ctx.appDir, env: ctx.env, timeoutMs: 15 * 60_000 });

    if (isCliMissing(res)) {
      return { ok: false, detail: "Vercel deploy needs Node.js/npx (the Vercel CLI is run via `npx vercel`). Install Node.js or add the CLI to the sandbox image." };
    }
    const url = lastVercelUrl(res.stdout) || lastVercelUrl(res.stderr);
    if (res.code !== 0 || !url) {
      return { ok: false, url, detail: tailLines(res.stderr || res.stdout) || `vercel exited with code ${res.code}` };
    }
    return { ok: true, url, logsUrl: "https://vercel.com/dashboard", detail: `Deployed to Vercel${ctx.prod ? " (production)" : ""}.` };
  },
};

function lastVercelUrl(text: string): string | undefined {
  const matches = (text || "").match(/https:\/\/[^\s"']+\.vercel\.app[^\s"']*/g);
  return matches?.length ? matches[matches.length - 1] : undefined;
}
