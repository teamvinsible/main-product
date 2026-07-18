// Same-origin in production (served by the Node server) and via Vite's /api
// proxy in dev, so all calls are relative.
import type {
  Activity, AgentRun, ArtifactMeta, ChatMessage, Commit, Config, Deployment, DeployProfileStatus, EnvVar, EvalResult,
  IntakeResult, Learning, LogEntry, McpConfig, PendingQuestion, ProjectEntry, ProjectHistory, PromptResponse,
  ProjectState, RunGraph, RunningRun, Settings, WorkSpec,
  TerminalSession,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface PostResult<T = unknown> { ok: boolean; status: number; data: T }

async function post<T = unknown>(path: string, body: unknown): Promise<PostResult<T>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: T;
  try { data = (await res.json()) as T; } catch { data = {} as T; }
  return { ok: res.ok, status: res.status, data };
}

function scoped(path: string, project?: string, extra?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  for (const [key, value] of Object.entries(extra || {})) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export const api = {
  // reads
  config: () => get<Config>("/api/config"),
  projects: () => get<ProjectEntry[]>("/api/projects"),
  state: (project?: string) => get<ProjectState>(scoped("/api/state", project)),
  logs: (project?: string, runId?: string) => get<LogEntry[]>(scoped("/api/logs", project, { runId })),
  agentRuns: (project?: string, runId?: string) => get<AgentRun[]>(scoped("/api/agent-runs", project, { runId })),
  runGraph: (project: string, session?: number) =>
    get<RunGraph>(`/api/run-graph?project=${encodeURIComponent(project)}${session != null ? `&session=${session}` : ""}`),
  workSpec: (project: string) => get<WorkSpec | null>(`/api/work-spec?project=${encodeURIComponent(project)}`),
  activity: (project?: string) => get<Activity[]>(scoped("/api/activity", project)),
  evals: (project?: string, runId?: string) => get<EvalResult[]>(scoped("/api/evals", project, { runId })),
  commits: (project?: string, runId?: string) => get<Commit[]>(scoped("/api/commits", project, { runId })),
  runs: (project?: string) => get<ProjectState[]>(scoped("/api/runs", project)),
  artifacts: (project?: string) => get<ArtifactMeta[]>(scoped("/api/artifacts", project)),
  artifactContent: async (path: string, project?: string) => {
    const url = scoped(`/api/artifact/${encodeURIComponent(path)}`, project);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`artifact ${path} -> ${res.status}`);
    return res.text();
  },
  learnings: () => get<{ learnings: Learning[]; projectHistory: ProjectHistory[] }>("/api/learnings"),
  settings: () => get<Settings>("/api/settings"),
  mcp: (project?: string) => get<McpConfig>(scoped("/api/mcp", project)),
  env: (project?: string) => get<EnvVar[]>(scoped("/api/env", project)),
  running: () => get<RunningRun[]>("/api/running"),
  prompts: (project?: string) => get<PromptResponse>(scoped("/api/prompts", project)),
  deployments: (project?: string) => get<Deployment[]>(scoped("/api/deployments", project)),
  deployProfiles: (project?: string) => get<DeployProfileStatus[]>(scoped("/api/deploy-profiles", project)),
  questions: (project?: string) => get<PendingQuestion[]>(scoped("/api/questions", project)),
  questionThread: (project: string) => get<PendingQuestion[]>(scoped("/api/questions", project, { all: "1" })),
  chatThread: (project: string) => get<ChatMessage[]>(scoped("/api/chat", project)),
  terminals: () => get<TerminalSession[]>("/api/terminal"),
  terminal: (id: string) => get<TerminalSession>(`/api/terminal?id=${encodeURIComponent(id)}`),

  // writes
  intake: (body: Record<string, unknown>) => post<IntakeResult>("/api/intake", body),
  startRun: (body: Record<string, unknown>) => post<{ name: string; error?: string }>("/api/run", body),
  stopRun: (body: Record<string, unknown>) => post<{ name?: string; error?: string }>("/api/run/stop", body),
  resumeRun: (body: Record<string, unknown>) => post<{ name: string; error?: string }>("/api/resume", body),
  saveSettings: (body: Record<string, unknown>) => post<Settings & { error?: string }>("/api/settings", body),
  saveProjectGit: (body: Record<string, unknown>) => post<{ ok?: boolean; state?: ProjectState; error?: string }>("/api/project/git", body),
  saveProjectDeploy: (body: Record<string, unknown>) => post<{ ok?: boolean; state?: ProjectState; error?: string }>("/api/project/deploy", body),
  deploy: (body: Record<string, unknown>) => post<{ name?: string; error?: string }>("/api/deploy", body),
  saveMcp: (body: Record<string, unknown>) => post<McpConfig>("/api/mcp", body),
  saveEnv: (body: Record<string, unknown>) => post<{ vars: EnvVar[]; error?: string }>("/api/env", body),
  savePrompt: (body: Record<string, unknown>) => post<{ error?: string }>("/api/prompts", body),
  resetPrompt: (body: Record<string, unknown>) => post<{ error?: string }>("/api/prompts/reset", body),
  answerQuestion: (body: { id: string; answer?: string; confirm?: boolean; skip?: boolean; allowBuild?: boolean }) =>
    post<{ ok?: boolean; question?: PendingQuestion; error?: string }>("/api/questions/answer", body),
  sendChat: (body: { project: string; message: string }) =>
    post<{ ok?: boolean; name?: string; error?: string }>("/api/chat", body),
  startTerminal: (body: Record<string, unknown>) =>
    post<{ ok?: boolean; session?: TerminalSession; error?: string }>("/api/terminal/start", body),
  sendTerminal: (body: { id: string; input: string }) =>
    post<{ ok?: boolean; session?: TerminalSession; error?: string }>("/api/terminal/send", body),
  stopTerminal: (body: { id: string }) =>
    post<{ ok?: boolean; session?: TerminalSession; error?: string }>("/api/terminal/stop", body),
};

// Model-strategy preset -> provider fields the backend expects.
export function presetToProviders(preset: string): Record<string, string> {
  if (preset === "deepseek") return { provider: "deepseek" };
  if (preset === "claude") return { provider: "claude" };
  if (preset === "anthropic") return { provider: "anthropic" };
  if (preset === "openrouter") return { provider: "openrouter" };
  return { provider: "claude", highProvider: "claude", lowProvider: "deepseek" };
}

export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  (text || "").split("\n").forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const eq = t.indexOf("=");
    if (eq === -1) return;
    const k = t.slice(0, eq).trim();
    if (k) out[k] = t.slice(eq + 1).trim();
  });
  return out;
}
