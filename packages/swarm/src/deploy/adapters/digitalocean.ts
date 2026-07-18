import type { DeployAdapter, DeployContext, DeployResult } from "../types.js";

// Deploys to DigitalOcean App Platform via the REST API. Creates the app (or
// updates it if one with the same name already exists) from the project's
// GitHub repo + branch. Requires the repo to be reachable by DigitalOcean
// (public, or the DO GitHub app connected for private repos).
export const digitaloceanAdapter: DeployAdapter = {
  provider: "digitalocean",
  async deploy(ctx: DeployContext): Promise<DeployResult> {
    const token = ctx.credential.secrets.DIGITALOCEAN_TOKEN;
    const repo = ghRepoSlug(ctx.repoUrl);
    if (!repo) {
      return { ok: false, detail: "DigitalOcean App Platform deploys from a GitHub repo. Link the project to a GitHub repo first (Repository panel)." };
    }
    const name = sanitizeName(ctx.target.service || ctx.projectName);
    const region = String(ctx.target.region || "nyc");
    const branch = ctx.defaultBranch || "main";

    const spec = {
      name,
      region,
      services: [{
        name: "web",
        github: { repo, branch, deploy_on_push: true },
        source_dir: "/",
        instance_size_slug: "basic-xxs",
        instance_count: 1,
      }],
    };

    const api = (path: string, init?: RequestInit) => fetch(`https://api.digitalocean.com/v2${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    });

    ctx.log("info", `DigitalOcean: resolving app "${name}" in ${region}`);
    // Find an existing app with the same name so re-deploys update in place.
    let appId = ctx.target.appId ? String(ctx.target.appId) : "";
    if (!appId) {
      const listRes = await api("/apps?per_page=200");
      if (listRes.ok) {
        const body = await listRes.json().catch(() => ({})) as { apps?: Array<{ id: string; spec?: { name?: string } }> };
        appId = body.apps?.find((a) => a.spec?.name === name)?.id || "";
      }
    }

    const res = appId
      ? await api(`/apps/${appId}`, { method: "PUT", body: JSON.stringify({ spec }) })
      : await api("/apps", { method: "POST", body: JSON.stringify({ spec }) });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, detail: `DigitalOcean API ${res.status}: ${text.slice(0, 300)}` };
    }
    const body = await res.json().catch(() => ({})) as { app?: { id?: string; live_url?: string; default_ingress?: string } };
    const app = body.app || {};
    const url = app.live_url || app.default_ingress || undefined;
    ctx.log("info", `DigitalOcean: ${appId ? "updated" : "created"} app ${app.id || name}`);
    return {
      ok: true,
      url,
      logsUrl: app.id ? `https://cloud.digitalocean.com/apps/${app.id}` : "https://cloud.digitalocean.com/apps",
      detail: url ? "DigitalOcean App Platform deploy triggered." : "DigitalOcean app created; the live URL appears once the first build finishes.",
      raw: { appId: app.id },
    };
  },
};

function ghRepoSlug(repoUrl?: string): string | null {
  const m = String(repoUrl || "").match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
  return m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : null;
}

function sanitizeName(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "app";
}
