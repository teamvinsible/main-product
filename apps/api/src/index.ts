import type { PlatformProject } from "@teamvinsible/shared";
import { authConfigured, isAuthResponse, requireAuth, serviceClient, type Authed } from "./auth";
import { createProject, getProfile, updateProjectPreview, memoryStore } from "./db";
import { corsHeaders, isDevelopment, json, missingCoreBindings, notModified, useLegacySwarm, type Env } from "./env";
import { d1ListNotifications, d1MarkNotificationsRead } from "./d1";
import {
  cfGetProject,
  cfIntake,
  cfListProjects,
  cfLoadSpine,
  cfOpenSpineStream,
  cfReadArtifact,
  cfSetPreview,
  cfStartRun,
} from "./orchestrator/cf";
import { maybeProxySandbox, startProjectPreview } from "./preview";
import { publishProject, servePublished, slugFromHost } from "./publish";
import { isFaviconPath, platformFaviconResponse } from "./brand/favicon";
import { proxySwarm, swarmNameForUser } from "./swarm";
import { readJsonObject, RequestError, slugField, stringField } from "./validation";

export { Sandbox } from "@cloudflare/sandbox";
export { MediatorAgent } from "./agents/mediator";
export { DomainAgent } from "./agents/domain-agent";
export { SwarmRuntime } from "./containers/swarm-runtime";
export { CrewRunWorkflow } from "./workflows/crew-run";
export type { Env };

function isSettledProjectStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "completed" || s === "ready" || s === "failed" || s === "published" || s === "preview";
}

function projectSpineEtag(id: string, updatedAt: string, status: string): string {
  return `W/"p:${id}:${updatedAt}:${status}"`;
}

function spineSnapshotEtag(spine: {
  project?: { id?: string; status?: string; stage?: string; updatedAt?: string } | null;
  specsTotal?: number;
  previewUrl?: string | null;
  agents?: Array<{ id: string; signal?: string }>;
}): string {
  const agents = (spine.agents || []).map((a) => `${a.id}:${a.signal || ""}`).join(",");
  const raw = [
    spine.project?.id || "empty",
    spine.project?.status || "",
    spine.project?.stage || "",
    String(spine.specsTotal ?? 0),
    spine.previewUrl || "",
    agents,
  ].join("|");
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
  return `W/"s:${(hash >>> 0).toString(16)}"`;
}

function spineCacheControl(spine: { project?: { status?: string; stage?: string } | null }): string {
  const status = (spine.project?.status || "").toLowerCase();
  const stage = (spine.project?.stage || "").toLowerCase();
  if (isSettledProjectStatus(status) || stage === "ready") return "private, max-age=30";
  return "private, max-age=5";
}

function etagMatches(ifNoneMatch: string, etag: string): boolean {
  return ifNoneMatch
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === etag || part === etag.replace(/^W\//, "") || `W/${part}` === etag);
}

function withCors(env: Env, request: Request, res: Response): Response {
  const headers = new Headers(res.headers);
  Object.entries(corsHeaders(env, request)).forEach(([k, v]) => headers.set(k, v));
  return new Response(res.body, { status: res.status, headers });
}

async function enforceExpensiveRouteLimit(env: Env, auth: Authed, pathname: string): Promise<void> {
  if (!env.RUN_RATE_LIMITER) {
    if (!isDevelopment(env)) throw new RequestError("Rate limiting is unavailable", 503, "rate_limit_unavailable");
    return;
  }
  const result = await env.RUN_RATE_LIMITER.limit({ key: `${auth.user.id}:${pathname}` });
  if (!result.success) throw new RequestError("Too many requests. Try again shortly.", 429, "rate_limited");
}

async function handleAuthed(
  request: Request,
  env: Env,
  auth: Authed,
  pathname: string,
  url: URL,
): Promise<Response> {
  if (pathname === "/api/me" && request.method === "GET") {
    const db = serviceClient(env);
    const profile = db ? await getProfile(db, auth.user.id) : null;
    return json(env, request, {
      user: {
        ...auth.user,
        displayName: profile?.display_name || auth.user.displayName,
        avatarUrl: profile?.avatar_url || auth.user.avatarUrl,
        email: profile?.email || auth.user.email,
      },
    });
  }

  if (pathname === "/api/projects" && request.method === "GET") {
    return json(env, request, await cfListProjects(env, auth.user.id));
  }

  if (pathname === "/api/spine" && request.method === "GET") {
    const requested = url.searchParams.get("project");
    const inm = request.headers.get("If-None-Match");

    // Settled projects: answer 304 from D1 alone (skip Mediator DO) when unchanged.
    if (inm && requested) {
      const owned = await cfGetProject(env, auth.user.id, requested);
      if (owned && isSettledProjectStatus(owned.status)) {
        const etag = projectSpineEtag(owned.id, owned.updatedAt, owned.status);
        if (etagMatches(inm, etag)) {
          return notModified(env, request, etag, "private, max-age=30");
        }
      }
    }

    const spine = await cfLoadSpine(env, auth, requested);
    const listed = spine.project
      ? spine.projects?.find((p) => p.id === spine.project!.id || p.name === spine.project!.id)
      : undefined;
    const etag =
      spine.project && listed?.updatedAt
        ? projectSpineEtag(spine.project.id, listed.updatedAt, spine.project.status || listed.status || "")
        : spineSnapshotEtag(spine);
    if (inm && etagMatches(inm, etag)) {
      return notModified(env, request, etag, spineCacheControl(spine));
    }
    return json(env, request, spine, 200, {
      ETag: etag,
      "Cache-Control": spineCacheControl(spine),
    });
  }

  if (pathname === "/api/spine/activity" && request.method === "GET") {
    const requested = url.searchParams.get("project");
    const spine = await cfLoadSpine(env, auth, requested);
    return json(env, request, { activity: spine.activity, source: "cf" }, 200, {
      "Cache-Control": "private, max-age=5",
    });
  }

  if (pathname === "/api/spine/stream" && request.method === "GET") {
    const projectKey = url.searchParams.get("project");
    if (!projectKey) throw new RequestError("project is required");
    const stream = await cfOpenSpineStream(env, auth, projectKey, request.signal);
    return withCors(env, request, stream);
  }

  if (pathname === "/api/artifact" && request.method === "GET") {
    const projectKey = url.searchParams.get("project");
    const path = url.searchParams.get("path");
    if (!projectKey || !path) throw new RequestError("project and path are required");
    const artifact = await cfReadArtifact(env, auth, projectKey, path);
    if (!artifact) {
      return json(env, request, { ok: false, error: "Artifact not found" }, 404);
    }
    return json(env, request, { ok: true, ...artifact }, 200, {
      "Cache-Control": "private, max-age=60",
    });
  }

  if (pathname === "/api/notifications" && request.method === "GET") {
    if (!env.DB) throw new RequestError("Notifications are unavailable", 503, "storage_unavailable");
    const unreadOnly = url.searchParams.get("unread") === "true";
    const notifications = await d1ListNotifications(env, auth.user.id, { unreadOnly });
    return json(env, request, {
      notifications: notifications.map((item) => ({
        ...item,
        metadata: JSON.parse(item.metadata || "{}") as unknown,
        read: Boolean(item.read_at),
      })),
      unread: notifications.filter((item) => !item.read_at).length,
    });
  }

  if (pathname === "/api/notifications/read" && request.method === "POST") {
    if (!env.DB) throw new RequestError("Notifications are unavailable", 503, "storage_unavailable");
    const body = await readJsonObject(request, 16 * 1024);
    const ids = body.ids === undefined
      ? undefined
      : Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100)
        : null;
    if (ids === null) throw new RequestError("ids must be an array of notification IDs");
    const updated = await d1MarkNotificationsRead(env, auth.user.id, ids);
    return json(env, request, { ok: true, updated });
  }

  if (pathname === "/api/intake" && request.method === "POST") {
    await enforceExpensiveRouteLimit(env, auth, pathname);
    const payload = await readJsonObject(request);
    const idea = stringField(payload, ["idea", "text"], { required: true, maxLength: 20_000 });

    if (useLegacySwarm(env)) {
      const swarmRes = await proxySwarm(env, "/api/intake", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (swarmRes?.ok) {
        return withCors(env, request, swarmRes);
      }
    }

    const plan = await cfIntake(env, auth, {
      idea,
      kind: stringField(payload, "kind", { maxLength: 40 }) || undefined,
      url: stringField(payload, "url", { maxLength: 2_048 }) || undefined,
    });
    return json(env, request, plan);
  }

  if (pathname === "/api/run" && request.method === "POST") {
    await enforceExpensiveRouteLimit(env, auth, pathname);
    const payload = await readJsonObject(request);
    const idea = stringField(payload, ["idea", "text"], { required: true, maxLength: 20_000 });
    const suggested = stringField(payload, ["name", "suggestedName"], { maxLength: 80, fallback: "project" });

    if (useLegacySwarm(env)) {
      const swarmName = swarmNameForUser(auth.user.id, suggested);
      const db = serviceClient(env);
      let project: PlatformProject;
      try {
        project = db
          ? await createProject(db, {
              userId: auth.user.id,
              swarmName,
              title: suggested,
              brief: idea,
              status: "running",
            })
          : isDevelopment(env) ? memoryStore.create({
              userId: auth.user.id,
              swarmName,
              title: suggested,
              brief: idea,
              status: "running",
            }) : (() => { throw new Error("Persistent project storage is unavailable"); })();
      } catch (err) {
        return json(env, request, { ok: false, error: String(err) }, 400);
      }
      const swarmRes = await proxySwarm(env, "/api/run", {
        method: "POST",
        body: JSON.stringify({ ...payload, name: swarmName, idea }),
      });
      if (swarmRes?.ok) {
        const body = (await swarmRes.json().catch(() => ({}))) as Record<string, unknown>;
        return json(env, request, {
          ok: true,
          name: swarmName,
          swarmName,
          projectId: project.id,
          pid: body.pid,
        });
      }
    }

    try {
      const result = await cfStartRun(env, auth, {
        idea,
        name: suggested,
        type: stringField(payload, "type", { maxLength: 40 }) || undefined,
      });
      return json(env, request, result);
    } catch (err) {
      return json(env, request, { ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }

  if (pathname === "/api/preview" && request.method === "POST") {
    await enforceExpensiveRouteLimit(env, auth, pathname);
    const body = await readJsonObject(request, 16 * 1024);
    const key = stringField(body, ["projectId", "project"], { required: true, maxLength: 100 });
    if (!key) return json(env, request, { ok: false, error: "project required" }, 400);
    const project = await cfGetProject(env, auth.user.id, key);
    if (!project) return json(env, request, { ok: false, error: "Project not found" }, 404);

    const result = await startProjectPreview(env, {
      projectId: project.id,
      swarmName: project.swarmName,
      hostname: url.hostname,
    });

    if (result.ok) {
      await cfSetPreview(env, project.id, result.previewUrl, result.sandboxId);
      const sb = serviceClient(env);
      if (sb) {
        await updateProjectPreview(sb, project.id, {
          previewUrl: result.previewUrl,
          sandboxId: result.sandboxId,
          status: "preview",
        }).catch(() => undefined);
      }
    }
    return json(env, request, result, result.ok ? 200 : 503);
  }

  const previewMatch = /^\/api\/preview\/([^/]+)$/.exec(pathname);
  if (previewMatch && request.method === "GET") {
    const project = await cfGetProject(env, auth.user.id, decodeURIComponent(previewMatch[1]!));
    if (!project) return json(env, request, { ok: false, error: "Project not found" }, 404);
    return json(env, request, {
      ok: true,
      projectId: project.id,
      swarmName: project.swarmName,
      previewUrl: project.previewUrl,
      sandboxId: project.sandboxId,
      status: project.previewUrl ? "ready" : "unavailable",
    });
  }

  if (pathname === "/api/publish" && request.method === "POST") {
    await enforceExpensiveRouteLimit(env, auth, pathname);
    const body = await readJsonObject(request, 16 * 1024);
    const key = stringField(body, ["projectId", "project"], { required: true, maxLength: 100 });
    const requestedSlug = slugField(body);
    const project = await cfGetProject(env, auth.user.id, key);
    if (!project) return json(env, request, { ok: false, error: "Project not found" }, 404);

    const result = await publishProject(env, {
      userId: auth.user.id,
      projectId: project.id,
      swarmName: project.swarmName,
      title: project.title,
      slug: requestedSlug || project.swarmName,
    });

    if (result.ok) {
      await cfSetPreview(env, project.id, result.url, project.sandboxId, "published");
    }
    return json(env, request, result, result.ok ? 200 : (result.httpStatus || 503));
  }

  if (pathname === "/api/publish/preview" && request.method === "POST") {
    await enforceExpensiveRouteLimit(env, auth, pathname);
    const body = await readJsonObject(request, 16 * 1024);
    const projectKey = stringField(body, "project", { maxLength: 100 });
    const requestedSlug = slugField(body);
    if (projectKey) {
      const project = await cfGetProject(env, auth.user.id, projectKey);
      if (!project) return json(env, request, { ok: false, error: "Project not found" }, 404);
      const result = await publishProject(env, {
        userId: auth.user.id,
        projectId: project.id,
        swarmName: project.swarmName,
        title: project.title,
        slug: requestedSlug || project.swarmName,
      });
      return json(env, request, result);
    }
    const slug = requestedSlug || "preview";
    return json(env, request, {
      status: "preview",
      subdomain: slug,
      url: `https://${slug}.${env.PLATFORM_HOST}`,
      note: "Pass project id to publish workspace to R2 edge / WfP.",
    });
  }

  return json(env, request, { error: "Not found", path: pathname }, 404);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // Sandbox preview hosts ({port}-{sandboxId}.PLATFORM_HOST) must be resolved
    // before the published-app wildcard below would swallow them. These are
    // capability URLs: the sandbox id embeds the project UUID, which only the
    // owner ever sees, and browsers (iframes) cannot attach Authorization
    // headers to subdomain navigations.
    const sandboxProxied = await maybeProxySandbox(request, env);
    if (sandboxProxied) return sandboxProxied;

    // Public published apps: {slug}.PLATFORM_HOST only.
    const hostSlug = slugFromHost(url.hostname, env.PLATFORM_HOST);
    if (hostSlug) {
      // Prefer WfP dispatcher when available
      if (env.DISPATCHER) {
        try {
          const userWorker = env.DISPATCHER.get(hostSlug);
          return await userWorker.fetch(request);
        } catch {
          /* fall through to R2 */
        }
      }
      const published = await servePublished(env, hostSlug, pathname);
      if (published) return published;
      if (isFaviconPath(pathname)) return platformFaviconResponse();
      return new Response("App not found", { status: 404 });
    }

    // Legacy /p/{slug} bookmarks → canonical subdomain (no dual hosting).
    const legacyPub = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
    if (legacyPub) {
      const slug = decodeURIComponent(legacyPub[1]!);
      const rest = legacyPub[2] && legacyPub[2] !== "/" ? legacyPub[2] : "/";
      return Response.redirect(`https://${slug}.${env.PLATFORM_HOST}${rest}${url.search}`, 308);
    }

    if (pathname === "/api/health") {
      const missing = missingCoreBindings(env);
      const authReady = authConfigured(env)
        || (isDevelopment(env) && env.DEV_AUTH_BYPASS === "true");
      const ready = authReady && (isDevelopment(env) || missing.length === 0);
      // Binding-by-binding detail is a config disclosure; keep it dev-only.
      const detail = isDevelopment(env)
        ? {
            mediator: Boolean(env.Mediator),
            domainAgent: Boolean(env.DomainAgent),
            workflow: Boolean(env.CREW_WORKFLOW),
            d1: Boolean(env.DB),
            r2: Boolean(env.WORKSPACES),
            sandbox: Boolean(env.Sandbox),
            swarmRuntime: Boolean(env.SwarmRuntime),
            dispatcher: Boolean(env.DISPATCHER),
            legacySwarm: useLegacySwarm(env),
            platformHost: env.PLATFORM_HOST,
            llm: "deepseek",
            missingBindings: missing,
          }
        : { missingBindings: missing.length };
      return json(env, request, {
        ok: ready,
        controlPlane: "cloudflare",
        auth: authReady,
        sandbox: Boolean(env.Sandbox),
        ...detail,
      }, ready ? 200 : 503, {
        "Cache-Control": ready ? "public, max-age=30" : "no-store",
      });
    }

    const auth = await requireAuth(request, env);
    if (isAuthResponse(auth)) {
      return withCors(env, request, auth);
    }

    try {
      return await handleAuthed(request, env, auth, pathname, url);
    } catch (err) {
      if (err instanceof RequestError) {
        return json(env, request, { error: err.message, code: err.code }, err.status);
      }
      const requestId = request.headers.get("CF-Ray") || crypto.randomUUID();
      console.error(JSON.stringify({ event: "request.failed", requestId, pathname, error: err instanceof Error ? err.message : String(err) }));
      return json(env, request, { error: "Internal server error", requestId }, 500);
    }
  },

  async queue(
    batch: MessageBatch<{
      type: string;
      projectId: string;
      runId: string;
      idea: string;
      title?: string;
      swarmName?: string;
      userId?: string;
    }>,
    env: Env,
  ) {
    // Dead-letter queue: surface permanently failed run messages to the user
    // instead of dropping them silently.
    if (batch.queue.endsWith("-dlq")) {
      for (const msg of batch.messages) {
        console.error(JSON.stringify({ event: "queue.dead_letter", body: msg.body }));
        try {
          if (env.DB && msg.body.userId) {
            const { d1CreateNotification } = await import("./d1");
            await d1CreateNotification(env, {
              id: `dlq-${msg.body.runId || msg.body.projectId}`,
              userId: msg.body.userId,
              projectId: msg.body.projectId || null,
              runId: msg.body.runId || null,
              kind: "run.failed",
              severity: "error",
              title: "Build step failed",
              message: "A background build task failed after multiple retries. The crew run may be incomplete.",
              metadata: { type: msg.body.type },
            });
          }
        } catch (err) {
          console.error("dlq notification failed", err);
        }
        msg.ack();
      }
      return;
    }

    for (const msg of batch.messages) {
      try {
        if (msg.body.type === "run.start" || msg.body.type === "run.build") {
          // Prefer workflow-driven crew; queue build is a warm/fallback eng pass
          if (env.CREW_WORKFLOW && msg.body.type === "run.start") {
            console.log("run.start — CrewRun Workflow owns phases", msg.body.projectId);
          } else {
            const { runEngineeringBuild } = await import("./orchestrator/agent-runner");
            const { getMediator } = await import("./agents/mediator");
            const mediator = env.Mediator ? await getMediator(env, msg.body.projectId) : null;
            const snap = mediator ? await mediator.getSnapshot() : null;
            const title = snap?.title || msg.body.title || msg.body.swarmName || "project";
            const brief = snap?.brief || msg.body.idea || "";
            const swarmName = snap?.swarmName || msg.body.swarmName || "app";

            const result = await runEngineeringBuild(env, {
              projectId: msg.body.projectId,
              title,
              brief,
              swarmName,
            });
            console.log("run.build", msg.body.projectId, result.mode, result.filesWritten.length, result.summary);
          }
        } else {
          console.log("run.queue", msg.body.type, msg.body.projectId);
        }
        msg.ack();
      } catch (err) {
        console.error("queue failed", err);
        msg.retry();
      }
    }
  },

  // Nightly retention: cf_activity and cf_notifications grow per run and have
  // no other pruning path.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.DB) return;
    ctx.waitUntil(
      (async () => {
        const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
        const activity = await env.DB!.prepare(`DELETE FROM cf_activity WHERE at < ?`)
          .bind(daysAgo(30))
          .run();
        const readNotifications = await env.DB!.prepare(
          `DELETE FROM cf_notifications WHERE read_at IS NOT NULL AND created_at < ?`,
        )
          .bind(daysAgo(90))
          .run();
        const staleNotifications = await env.DB!.prepare(
          `DELETE FROM cf_notifications WHERE created_at < ?`,
        )
          .bind(daysAgo(180))
          .run();
        console.log(JSON.stringify({
          event: "retention.pruned",
          activity: activity.meta.changes,
          readNotifications: readNotifications.meta.changes,
          staleNotifications: staleNotifications.meta.changes,
        }));
      })().catch((err) => console.error("retention failed", err)),
    );
  },
};
