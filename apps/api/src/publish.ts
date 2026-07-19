import type { Env } from "./env";
import {
  ensureFaviconLink,
  isFaviconPath,
  platformFaviconResponse,
} from "./brand/favicon";

/**
 * Subdomains that must never be claimable as publish slugs — they are (or may
 * become) platform infrastructure hosts under PLATFORM_HOST.
 */
const RESERVED_SLUGS = new Set([
  "api", "app", "www", "admin", "auth", "login", "logout", "account", "accounts",
  "dashboard", "spine", "dev", "staging", "test", "preview", "sandbox", "docs",
  "help", "support", "status", "blog", "mail", "email", "smtp", "imap", "pop",
  "webmail", "mx", "ns1", "ns2", "cdn", "assets", "static", "media", "files",
  "billing", "pay", "payments", "security", "abuse", "root", "internal", "vpn",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * A Worker invocation is capped at 1,000 subrequests; each published file costs
 * a get + a put, plus D1/manifest calls. 400 files keeps a safe margin.
 */
const MAX_PUBLISH_FILES = 400;

export type PublishResult = {
  ok: boolean;
  status: "published" | "preview" | "error";
  slug: string;
  url: string;
  dispatch: "r2-edge" | "workers-for-platforms" | "none";
  message?: string;
  httpStatus?: number;
};

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "app"
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

/** Publish a project workspace to an immutable R2 version and atomically switch its manifest. */
export async function publishProject(
  env: Env,
  opts: { userId: string; projectId: string; swarmName: string; title: string; slug?: string },
): Promise<PublishResult> {
  const slug = slugify(opts.slug || opts.swarmName || opts.title);
  const url = `https://${slug}.${env.PLATFORM_HOST}`;

  if (isReservedSlug(slug)) {
    return {
      ok: false,
      status: "error",
      slug,
      url,
      dispatch: "none",
      message: `“${slug}” is a reserved platform name. Pick a different slug.`,
      httpStatus: 422,
    };
  }

  if (!env.WORKSPACES || !env.DB) {
    return {
      ok: false,
      status: "error",
      slug,
      url,
      dispatch: "none",
      message: "Publishing storage is unavailable",
      httpStatus: 503,
    };
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO cf_publishes
      (slug, user_id, project_id, swarm_name, title, url, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'publishing', ?)`,
  )
    .bind(slug, opts.userId, opts.projectId, opts.swarmName, opts.title, url, now)
    .run();
  const reservation = await env.DB.prepare(`SELECT user_id FROM cf_publishes WHERE slug = ?`)
    .bind(slug)
    .first<{ user_id: string | null }>();
  if (!reservation || reservation.user_id !== opts.userId) {
    return {
      ok: false,
      status: "error",
      slug,
      url,
      dispatch: "none",
      message: "That publish slug is already owned by another account",
      httpStatus: 409,
    };
  }

  const indexKey = `workspaces/${opts.projectId}/index.html`;
  if (!(await env.WORKSPACES.head(indexKey))) {
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(opts.title)}</title></head>
<body style="font-family:system-ui;background:#0b0b0b;color:#f5f5f5;display:grid;place-items:center;min-height:100vh">
<main style="text-align:center;max-width:28rem;padding:2rem"><h1>${escapeHtml(opts.title)}</h1>
<p>Published shell — generate the app from Spine first.</p></main></body></html>`;
    await env.WORKSPACES.put(indexKey, html, { httpMetadata: { contentType: "text/html" } });
  }

  // Repair LLM path mistakes (e.g. home/user/styles.css while HTML links styles.css).
  const { normalizeWorkspaceAssets } = await import("./orchestrator/workspace-assets");
  await normalizeWorkspaceAssets({
    list: async (prefix = "") => {
      const listed = await env.WORKSPACES!.list({
        prefix: `workspaces/${opts.projectId}/${prefix}`,
        limit: 1_000,
      });
      return listed.objects.map((o) => o.key.replace(`workspaces/${opts.projectId}/`, ""));
    },
    get: async (rel) => {
      const obj = await env.WORKSPACES!.get(`workspaces/${opts.projectId}/${rel}`);
      return obj ? obj.text() : null;
    },
    put: async (rel, content) => {
      const type =
        rel.endsWith(".html")
          ? "text/html"
          : rel.endsWith(".css")
            ? "text/css"
            : rel.endsWith(".js") || rel.endsWith(".mjs")
              ? "text/javascript"
              : "text/plain";
      await env.WORKSPACES!.put(`workspaces/${opts.projectId}/${rel}`, content, {
        httpMetadata: { contentType: type },
      });
    },
  });

  // Always ship the platform brand mark with generated apps.
  const { PLATFORM_FAVICON_SVG, ensureFaviconLink } = await import("./brand/favicon");
  await env.WORKSPACES.put(`workspaces/${opts.projectId}/favicon.svg`, PLATFORM_FAVICON_SVG, {
    httpMetadata: { contentType: "image/svg+xml" },
  });
  const indexObj = await env.WORKSPACES.get(`workspaces/${opts.projectId}/index.html`);
  if (indexObj) {
    const html = ensureFaviconLink(await indexObj.text());
    await env.WORKSPACES.put(`workspaces/${opts.projectId}/index.html`, html, {
      httpMetadata: { contentType: "text/html" },
    });
  }

  const workspacePrefix = `workspaces/${opts.projectId}/`;
  const versionPrefix = `publishes/${slug}/versions/${crypto.randomUUID()}/`;
  let cursor: string | undefined;
  let copied = 0;
  do {
    const listed = await env.WORKSPACES.list({ prefix: workspacePrefix, cursor, limit: 1_000 });
    for (const obj of listed.objects) {
      const rel = obj.key.slice(workspacePrefix.length);
      if (!rel) continue;
      if (++copied > MAX_PUBLISH_FILES) {
        // The old manifest is untouched, so the previous published version keeps serving.
        return {
          ok: false,
          status: "error",
          slug,
          url,
          dispatch: "none",
          message: `Workspace exceeds the ${MAX_PUBLISH_FILES}-file publish limit`,
          httpStatus: 422,
        };
      }
      const body = await env.WORKSPACES.get(obj.key);
      if (!body) continue;
      await env.WORKSPACES.put(`${versionPrefix}${rel}`, body.body, {
        httpMetadata: body.httpMetadata,
        customMetadata: body.customMetadata,
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await env.WORKSPACES.put(
    `publishes/${slug}/manifest.json`,
    JSON.stringify({ prefix: versionPrefix, projectId: opts.projectId, publishedAt: now }),
    { httpMetadata: { contentType: "application/json" } },
  );

  const finalized = await env.DB.prepare(
    `UPDATE cf_publishes SET project_id = ?, swarm_name = ?, title = ?, url = ?,
       status = 'published', updated_at = ? WHERE slug = ? AND user_id = ?`,
  )
    .bind(opts.projectId, opts.swarmName, opts.title, url, now, slug, opts.userId)
    .run();
  if (!finalized.meta.changes) throw new Error("Publish ownership changed during deployment");

  let dispatch: PublishResult["dispatch"] = "r2-edge";
  let message = `Live at ${url}`;
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN && env.DISPATCH_NAMESPACE) {
    try {
      await uploadUserWorker(env, slug);
      dispatch = "workers-for-platforms";
      message = `Live at ${url} (Workers for Platforms)`;
    } catch (error) {
      message = `Live at ${url} (R2 edge; WfP upload skipped: ${error instanceof Error ? error.message : String(error)})`;
    }
  }

  return { ok: true, status: "published", slug, url, dispatch, message };
}

async function uploadUserWorker(env: Env, slug: string): Promise<void> {
  // Optional WfP registration. Content is served by the platform Worker on
  // {slug}.PLATFORM_HOST via R2 — this script is only a namespace placeholder.
  const script = `
export default {
  async fetch() {
    return new Response("Teamvinsible app — open https://${slug}.${env.PLATFORM_HOST}/", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
};`;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/dispatch/namespaces/${env.DISPATCH_NAMESPACE}/scripts/${slug}`;
  const form = new FormData();
  form.set("worker.js", new Blob([script], { type: "application/javascript+module" }), "worker.js");
  form.set(
    "metadata",
    new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-07-19" })], { type: "application/json" }),
  );
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cloudflare API returned ${response.status}`);
}

export async function servePublished(
  env: Env,
  slug: string,
  requestPath: string,
): Promise<Response | null> {
  if (!env.WORKSPACES) return null;
  let rel = requestPath.replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel = `${rel}index.html`;
  if (rel.startsWith(`${slug}/`)) rel = rel.slice(slug.length + 1);

  // Always serve the platform brand mark for generated apps.
  if (isFaviconPath(rel)) {
    return platformFaviconResponse();
  }

  const manifestObject = await env.WORKSPACES.get(`publishes/${slug}/manifest.json`);
  let prefix = `publishes/${slug}/`;
  if (manifestObject) {
    try {
      const manifest = (await manifestObject.json()) as { prefix?: string };
      if (manifest.prefix?.startsWith(`publishes/${slug}/versions/`)) prefix = manifest.prefix;
      else return null;
    } catch {
      return null;
    }
  }

  let obj = await env.WORKSPACES.get(`${prefix}${rel || "index.html"}`);
  if (!obj && !rel.includes(".")) obj = await env.WORKSPACES.get(`${prefix}index.html`);
  if (!obj) return null;
  const headers = new Headers();
  let contentType = obj.httpMetadata?.contentType || guessContentType(rel);
  if (contentType === "text/html") contentType = "text/html; charset=utf-8";
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
  headers.set("X-Content-Type-Options", "nosniff");

  // Inject platform favicon link into HTML when the generated app omitted it.
  if (rel.endsWith(".html") || rel === "index.html" || contentType.includes("text/html")) {
    const html = ensureFaviconLink(await obj.text());
    return new Response(html, { status: 200, headers });
  }

  return new Response(obj.body, { status: 200, headers });
}

function guessContentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function slugFromHost(hostname: string, platformHost: string): string | null {
  const host = hostname.toLowerCase();
  const base = platformHost.toLowerCase();
  if (host === base || host === `www.${base}`) return null;
  if (host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(base.length + 1));
    // Reserved names are platform hosts, never published apps. Sandbox preview
    // hosts ({port}-{sandboxId}.…) are handled by proxyToSandbox before this.
    if (sub && !sub.includes(".") && !isReservedSlug(sub)) return sub;
  }
  return null;
}
