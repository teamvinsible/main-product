import type {
  IntakePlan,
  PreviewStatus,
  RunStartResponse,
  SpineSnapshot,
  SpineStage,
} from "@teamvinsible/shared";
import { MOCK_INTAKE_PLAN, MOCK_SPINE } from "./mock/spine";
import { getAccessToken, isSupabaseConfigured } from "./lib/supabase";

/** Demo mode when explicitly enabled, or when Supabase is absent and not forced live. */
export function isMockMode() {
  if (import.meta.env.VITE_USE_MOCK === "false") return false;
  if (import.meta.env.VITE_USE_MOCK === "true") return true;
  // Default: mock only when auth is not configured (design without backend)
  return !isSupabaseConfigured();
}

let tokenGetter: (() => Promise<string | null>) | null = null;

/** Optional: AuthProvider registers session token getter */
export function setApiTokenGetter(fn: (() => Promise<string | null>) | null) {
  tokenGetter = fn;
}

async function resolveToken(): Promise<string | null> {
  if (tokenGetter) return tokenGetter();
  return getAccessToken();
}

/** Worker origin for deployed Pages; empty in dev where Vite proxies /api. */
const API_BASE = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await resolveToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* keep text */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function asStage(phase?: string): SpineStage {
  if (phase === "drafting" || phase === "cross-review" || phase === "consolidating" || phase === "ready") {
    return phase;
  }
  return "drafting";
}

function mockSpineFor(project?: string): SpineSnapshot {
  if (!project || project === MOCK_SPINE.project?.id) {
    return { ...MOCK_SPINE };
  }
  const listed = MOCK_SPINE.projects.find((p) => p.name === project);
  if (!listed || !MOCK_SPINE.project) {
    return {
      ...MOCK_SPINE,
      project: {
        id: project,
        title: project,
        brief: `Demo brief for ${project}. Set VITE_USE_MOCK=false when the swarm is online.`,
        stage: "drafting",
        status: "demo",
        createdAt: "2026-07-18",
        updatedAt: "Just now",
      },
    };
  }
  return {
    ...MOCK_SPINE,
    project: {
      ...MOCK_SPINE.project,
      id: listed.name,
      title: listed.name,
      status: listed.status,
      stage: asStage(listed.phase),
      brief: listed.idea || MOCK_SPINE.project.brief,
    },
  };
}

export function fetchSpine(project?: string) {
  if (isMockMode()) {
    return Promise.resolve(mockSpineFor(project));
  }
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  return req<SpineSnapshot>(`/api/spine${q}`);
}

export function submitIntake(body: {
  idea?: string;
  text?: string;
  kind?: string;
  url?: string;
  attachments?: Array<{ name: string; size: number; type: string; hasText?: boolean }>;
}) {
  if (isMockMode()) {
    const idea = body.idea || body.text || MOCK_INTAKE_PLAN.idea;
    const attachNote =
      body.attachments && body.attachments.length > 0
        ? ` With ${body.attachments.length} attached document${body.attachments.length === 1 ? "" : "s"}.`
        : "";
    return Promise.resolve({
      ...MOCK_INTAKE_PLAN,
      idea,
      summary: `${MOCK_INTAKE_PLAN.summary}${attachNote}`,
      attachments: body.attachments || [],
    } as unknown as IntakePlan & Record<string, unknown>);
  }
  return req<IntakePlan & Record<string, unknown>>("/api/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startRun(body: Record<string, unknown>) {
  if (isMockMode()) {
    return Promise.resolve({
      ok: true,
      name: String(body.name || "feature-insight"),
      swarmName: String(body.name || "feature-insight"),
      projectId: "mock-project-id",
    } satisfies RunStartResponse);
  }
  return req<RunStartResponse>("/api/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchHealth() {
  if (isMockMode()) {
    return Promise.resolve({ ok: true, swarm: false, platformHost: "mock", auth: false, sandbox: false });
  }
  return req<{
    ok: boolean;
    swarm: boolean;
    platformHost: string;
    auth?: boolean;
    sandbox?: boolean;
  }>("/api/health");
}

export function startPreview(project: string) {
  if (isMockMode()) {
    return Promise.resolve({
      ok: true,
      projectId: project,
      swarmName: project,
      previewUrl: "https://example.com",
      sandboxId: "mock",
      status: "ready" as const,
      message: "Demo preview",
    } satisfies PreviewStatus);
  }
  return req<PreviewStatus>("/api/preview", {
    method: "POST",
    body: JSON.stringify({ project }),
  });
}

export function publishProject(project: string, slug?: string) {
  if (isMockMode()) {
    return Promise.resolve({
      ok: true,
      status: "published" as const,
      slug: slug || project,
      url: `https://${slug || project}.teamvinsible.com`,
      dispatch: "r2-edge" as const,
      message: "Demo publish",
    });
  }
  return req<{
    ok: boolean;
    status: string;
    slug: string;
    url: string;
    dispatch: string;
    message?: string;
  }>("/api/publish", {
    method: "POST",
    body: JSON.stringify({ project, slug }),
  });
}

export function fetchPreview(projectId: string) {
  if (isMockMode()) {
    return Promise.resolve({
      ok: true,
      projectId,
      swarmName: projectId,
      previewUrl: null,
      sandboxId: null,
      status: "unavailable" as const,
    } satisfies PreviewStatus);
  }
  return req<PreviewStatus>(`/api/preview/${encodeURIComponent(projectId)}`);
}

/** Load a workspace artifact body (markdown/text) for the spec viewer. */
export function fetchArtifact(project: string, path: string) {
  if (isMockMode()) {
    const spec = MOCK_SPINE.specs.find((s) => s.path === path);
    const title = spec?.title || path.split("/").pop() || "Artifact";
    const body = [
      `# ${title}`,
      "",
      spec?.summary || "Demo artifact content.",
      "",
      "## Outline",
      "",
      "- Context and constraints",
      "- Proposed approach",
      "- Open questions",
      "",
      "> Set `VITE_USE_MOCK=false` to load live R2 artifacts.",
    ].join("\n");
    return Promise.resolve({ ok: true as const, path, content: body, contentType: "text/markdown" });
  }
  const q = `?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`;
  return req<{ ok: boolean; path: string; content: string; contentType: string }>(`/api/artifact${q}`);
}

/** Ask the swarm control plane to skip an agent's phases (proxied via Workers API). */
export function skipAgent(project: string, agentId: string) {
  if (isMockMode()) {
    return Promise.resolve({ ok: true, skipped: [agentId] });
  }
  return req<{ ok?: boolean; skipped?: string[]; error?: string }>("/api/skip", {
    method: "POST",
    body: JSON.stringify({ project, agentId }),
  });
}
