import type { SpineSnapshot } from "@teamvinsible/shared";
import {
  buildSpineSnapshot,
  emptySpine,
  toProjectList,
  type SwarmAgentRun,
  type SwarmArtifactFile,
  type SwarmLog,
  type SwarmRunGraph,
  type SwarmState,
} from "./spine-mapper";

export interface Env {
  SWARM_ORIGIN: string;
  PLATFORM_HOST: string;
  DISPATCHER?: {
    get(name: string): { fetch: typeof fetch };
  };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function proxySwarm(env: Env, path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(`${env.SWARM_ORIGIN}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    return res;
  } catch {
    return null;
  }
}

async function swarmJson<T>(env: Env, path: string): Promise<T | null> {
  const res = await proxySwarm(env, path);
  if (!res?.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function resolveProjectName(env: Env, requested: string | null): Promise<string | null> {
  if (requested) return requested;

  const running = await swarmJson<Array<{ name?: string }>>(env, "/api/running");
  if (running?.length && running[0]?.name) return String(running[0].name);

  const projects = await swarmJson<Array<{ name?: string }>>(env, "/api/projects");
  if (projects?.length && projects[0]?.name) return String(projects[0].name);

  return null;
}

async function loadSpine(env: Env, projectName: string | null): Promise<SpineSnapshot> {
  const config = await proxySwarm(env, "/api/config");
  const swarmOnline = Boolean(config?.ok);

  const projectRows = swarmOnline
    ? (await swarmJson<Array<{ name?: string; state?: SwarmState }>>(env, "/api/projects")) || []
    : [];
  const projects = toProjectList(projectRows);

  if (!swarmOnline) {
    return emptySpine({
      swarmOnline: false,
      projects: [],
      message: "Swarm control plane offline. Run npm run dev:swarm to stream live coordination.",
    });
  }

  if (!projectName) {
    return emptySpine({ swarmOnline: true, projects });
  }

  const stateRaw = await swarmJson<SwarmState>(
    env,
    `/api/state?project=${encodeURIComponent(projectName)}`,
  );

  if (!stateRaw || (stateRaw as { status?: string }).status === "waiting") {
    return emptySpine({
      swarmOnline: true,
      projects,
      message: `No swarm state found for “${projectName}”. Launch a run from New brief.`,
    });
  }

  const q = encodeURIComponent(projectName);
  const [runs, logs, graph, files] = await Promise.all([
    swarmJson<SwarmAgentRun[]>(env, `/api/agent-runs?project=${q}`),
    swarmJson<SwarmLog[]>(env, `/api/activity?project=${q}`),
    swarmJson<SwarmRunGraph>(env, `/api/run-graph?project=${q}`),
    swarmJson<SwarmArtifactFile[]>(env, `/api/artifacts?project=${q}`),
  ]);

  const state: SwarmState = {
    ...stateRaw,
    projectName: stateRaw.projectName || projectName,
  };

  return buildSpineSnapshot({
    state,
    runs: runs || [],
    logs: logs || [],
    graph: graph || null,
    files: files || [],
    projects,
    swarmOnline: true,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/health") {
      const swarm = await proxySwarm(env, "/api/config");
      return json({
        ok: true,
        swarm: swarm?.ok ?? false,
        platformHost: env.PLATFORM_HOST,
      });
    }

    if (pathname === "/api/projects" && request.method === "GET") {
      const rows = await swarmJson<unknown>(env, "/api/projects");
      if (rows) return json(rows);
      return json([], 503);
    }

    if (pathname === "/api/spine" && request.method === "GET") {
      const requested = url.searchParams.get("project");
      const projectName = await resolveProjectName(env, requested);
      const spine = await loadSpine(env, projectName);
      return json(spine);
    }

    if (pathname === "/api/spine/activity" && request.method === "GET") {
      const project = url.searchParams.get("project") || (await resolveProjectName(env, null));
      if (!project) return json({ activity: [], source: "swarm" });
      const logs = await swarmJson<SwarmLog[]>(
        env,
        `/api/activity?project=${encodeURIComponent(project)}`,
      );
      const spine = await loadSpine(env, project);
      return json({ activity: spine.activity, source: "swarm", raw: logs || [] });
    }

    if (pathname === "/api/intake" && request.method === "POST") {
      let payload: Record<string, unknown> = {};
      try {
        payload = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ ok: false, error: "Invalid JSON body" }, 400);
      }
      const swarmRes = await proxySwarm(env, "/api/intake", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (swarmRes) {
        const body = await swarmRes.text();
        return new Response(body, {
          status: swarmRes.status,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }
      return json(
        {
          ok: false,
          error: "Swarm offline — cannot classify intake without the control plane.",
        },
        503,
      );
    }

    if (pathname === "/api/run" && request.method === "POST") {
      const payload = await request.json();
      const swarmRes = await proxySwarm(env, "/api/run", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (swarmRes) {
        const body = await swarmRes.text();
        return new Response(body, {
          status: swarmRes.status,
          headers: { "Content-Type": "application/json", ...cors },
        });
      }
      return json({ ok: false, error: "Swarm control plane offline. Run: npm run dev:swarm" }, 503);
    }

    if (pathname === "/api/publish/preview" && request.method === "POST") {
      const body = (await request.json()) as { slug?: string };
      const slug = (body.slug || "preview").toLowerCase().replace(/[^a-z0-9-]/g, "-");
      return json({
        status: "preview",
        subdomain: slug,
        url: `https://${slug}.${env.PLATFORM_HOST}`,
        note: "Workers for Platforms dispatch not wired yet — reserved subdomain contract.",
      });
    }

    if (pathname.startsWith("/api/")) {
      const swarmRes = await proxySwarm(env, pathname + url.search, {
        method: request.method,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      });
      if (swarmRes) {
        const headers = new Headers(swarmRes.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(swarmRes.body, { status: swarmRes.status, headers });
      }
      return json({ error: "Swarm offline", path: pathname }, 503);
    }

    return json({ error: "Not found", path: pathname }, 404);
  },
};
