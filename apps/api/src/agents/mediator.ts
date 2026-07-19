import { Agent, callable, getAgentByName } from "agents";
import type {
  ActivityItem,
  DataFlowEdge,
  DomainAgentNode,
  SpecCard,
  SpineSnapshot,
  SpineStage,
  Workstream,
  WorkspaceFileCard,
} from "@teamvinsible/shared";
import {
  isArtifactDocPath,
  isWorkspaceFilePath,
  workspaceFileTitle,
} from "@teamvinsible/shared";
import type { Env } from "../env";
import { baseCrewAgents, CREW_PHASES } from "../orchestrator/phases";

export type MediatorState = {
  projectId: string;
  swarmName: string;
  userId: string;
  title: string;
  brief: string;
  stage: SpineStage;
  status: string;
  runId: string | null;
  phaseIndex: number;
  agents: DomainAgentNode[];
  workstreams: Workstream[];
  specs: SpecCard[];
  /** Generated app/workspace files (Files tab). */
  files: WorkspaceFileCard[];
  activity: ActivityItem[];
  previewUrl: string | null;
  sandboxId: string | null;
  startedAt: string;
  updatedAt: string;
};

const PHASES = CREW_PHASES;
const baseAgents = baseCrewAgents;

function isSettledStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "completed" || s === "ready" || s === "failed" || s === "published" || s === "preview";
}

type SpineSseClient = {
  projects: SpineSnapshot["projects"];
  write: (chunk: string) => void;
  close: () => void;
};

export class MediatorAgent extends Agent<Env, MediatorState> {
  initialState: MediatorState = {
    projectId: "",
    swarmName: "",
    userId: "",
    title: "",
    brief: "",
    stage: "drafting",
    status: "idle",
    runId: null,
    phaseIndex: -1,
    agents: baseAgents(),
    workstreams: [],
    specs: [],
    files: [],
    activity: [],
    previewUrl: null,
    sandboxId: null,
    startedAt: "",
    updatedAt: "",
  };

  /** Live dashboard SSE writers (one Durable Object instance per project). */
  #sseClients = new Set<SpineSseClient>();

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/sse") && request.method === "GET") {
      return this.openSpineSse(request);
    }
    return new Response("Not found", { status: 404 });
  }

  onStateChanged(state: MediatorState | undefined, _source: unknown): void {
    if (!state || this.#sseClients.size === 0) return;
    for (const client of [...this.#sseClients]) {
      this.writeSpineEvent(client, state);
      if (isSettledStatus(state.status) || state.stage === "ready") {
        this.endSseClient(client, "settled");
      }
    }
  }

  private openSpineSse(request: Request): Response {
    let projects: SpineSnapshot["projects"] = [];
    try {
      const raw = request.headers.get("X-Spine-Projects");
      if (raw) projects = JSON.parse(raw) as SpineSnapshot["projects"];
    } catch {
      projects = [];
    }

    const encoder = new TextEncoder();
    let client: SpineSseClient | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const write = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Client already disconnected.
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        };

        client = { projects, write, close };
        this.#sseClients.add(client);
        this.writeSpineEvent(client, this.state);

        if (isSettledStatus(this.state.status) || this.state.stage === "ready") {
          this.endSseClient(client, "settled");
          return;
        }

        pingTimer = setInterval(() => {
          write("event: ping\ndata: {}\n\n");
        }, 15_000);

        const onAbort = () => {
          if (pingTimer) clearInterval(pingTimer);
          if (client) this.#sseClients.delete(client);
          close();
        };
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener("abort", onAbort, { once: true });
      },
      cancel: () => {
        if (pingTimer) clearInterval(pingTimer);
        if (client) this.#sseClients.delete(client);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  private writeSpineEvent(client: SpineSseClient, state: MediatorState): void {
    const spine = mediatorToSpine(state, client.projects);
    const id = state.updatedAt || String(Date.now());
    client.write(`event: spine\nid: ${id}\ndata: ${JSON.stringify(spine)}\n\n`);
  }

  private endSseClient(client: SpineSseClient, reason: string): void {
    client.write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
    this.#sseClients.delete(client);
    client.close();
  }

  @callable()
  async bootstrap(input: {
    projectId: string;
    swarmName: string;
    userId: string;
    title: string;
    brief: string;
    runId: string;
  }): Promise<MediatorState> {
    const now = new Date().toISOString();
    const workstreams: Workstream[] = PHASES.map((p, i) => ({
      id: `ws-${p.phase}`,
      label: p.label,
      status: i === 0 ? "in-progress" : "queued",
      agentRole: p.agentId,
      phase: p.phase,
    }));

    this.setState({
      ...this.state,
      ...input,
      stage: "drafting",
      status: "running",
      phaseIndex: 0,
      agents: baseAgents().map((a) =>
        a.id === "mediator" || a.id === "product" ? { ...a, signal: "active" as const } : a,
      ),
      workstreams,
      specs: [],
      files: [],
      activity: [
        {
          id: crypto.randomUUID(),
          at: now,
          message: `Mediator accepted brief for ${input.title}`,
          kind: "gate",
          agent: "Mediator",
          phase: "intake",
        },
      ],
      startedAt: now,
      updatedAt: now,
    });

    // The CrewRun Workflow is created exactly once by cfStartRun (instance id = runId).
    // Creating it here as well would throw "instance already exists" back to the caller.
    if (this.env.CREW_WORKFLOW) {
      this.setState({
        ...this.state,
        activity: [
          {
            id: crypto.randomUUID(),
            at: now,
            message: "CrewRun Workflow owns phases — domain agents will execute each step",
            kind: "gate",
            agent: "Mediator",
            phase: "workflow",
          },
          ...this.state.activity,
        ],
      });
      return this.state;
    }

    await this.schedule(2, "advancePhase", {});
    return this.state;
  }

  /** Fallback driver when Workflow creation fails after bootstrap assumed it. */
  @callable()
  async schedulePhases(): Promise<MediatorState> {
    if (this.state.status === "running") {
      await this.schedule(2, "advancePhase", {});
    }
    return this.state;
  }

  /** Called by CrewRunWorkflow after each DomainAgent finishes a phase */
  @callable()
  async applyPhaseResult(input: {
    phaseIndex: number;
    phase: string;
    stage: SpineStage;
    label: string;
    agentId: string;
    summary: string;
    path: string;
    done: boolean;
    filesWritten?: string[];
  }): Promise<MediatorState> {
    const now = new Date().toISOString();
    const nextIndex = input.done ? input.phaseIndex : input.phaseIndex + 1;
    const next = input.done ? null : PHASES[nextIndex] || null;
    const specId = `spec-${input.phase}`;
    // Planning artifacts always live under artifacts/*.md — never app entrypoints.
    const docPath = isArtifactDocPath(input.path)
      ? input.path
      : `artifacts/${input.phase}.md`;

    const specs: SpecCard[] = [
      ...this.state.specs.filter((s) => s.id !== specId && isArtifactDocPath(s.path)),
      {
        id: specId,
        title: input.label,
        status: input.done ? "ready" : "cross-review",
        owner: input.agentId,
        updatedAt: now,
        summary: input.summary,
        path: docPath,
      },
    ];

    const incomingFiles = (input.filesWritten || []).filter((p) => isWorkspaceFilePath(p));
    const prevFiles = Array.isArray(this.state.files) ? this.state.files : [];
    const filesByPath = new Map<string, WorkspaceFileCard>();
    for (const f of prevFiles) filesByPath.set(f.path, f);
    // Migrate legacy SpecCards that pointed at app files into the Files list.
    for (const s of this.state.specs) {
      if (s.path && isWorkspaceFilePath(s.path)) {
        filesByPath.set(s.path, {
          id: `file-${s.path}`,
          title: workspaceFileTitle(s.path),
          path: s.path,
          owner: s.owner,
          updatedAt: /^\d{4}-\d{2}-\d{2}/.test(s.updatedAt) ? s.updatedAt : now,
          summary: s.summary,
        });
      }
    }
    for (const path of incomingFiles) {
      filesByPath.set(path, {
        id: `file-${path}`,
        title: workspaceFileTitle(path),
        path,
        owner: input.agentId,
        updatedAt: now,
        summary: `${input.label} wrote ${path}`,
      });
    }
    const files = [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));

    const activity: ActivityItem[] = [
      {
        id: crypto.randomUUID(),
        at: now,
        message: `${input.label} completed (domain agent)`,
        kind: "signal" as const,
      },
      ...this.state.activity,
    ].slice(0, 40);

    // Rehydrate workstreams if bootstrap state was lost — specs alone can't drive the hub.
    const baseWorkstreams =
      this.state.workstreams.length > 0
        ? this.state.workstreams
        : PHASES.map((p) => ({
            id: `ws-${p.phase}`,
            label: p.label,
            status: "queued" as const,
            agentRole: p.agentId,
            phase: p.phase,
          }));

    const workstreams = baseWorkstreams.map((ws, i) => {
      if (i < nextIndex || (input.done && i <= input.phaseIndex)) return { ...ws, status: "aligned" as const };
      if (i === nextIndex && !input.done) return { ...ws, status: "in-progress" as const };
      return ws;
    });

    const completedIds = new Set(
      workstreams
        .map((ws, i) => (ws.status === "aligned" ? PHASES[i]?.agentId : undefined))
        .filter((id): id is string => Boolean(id && id !== "mediator")),
    );
    if (input.agentId !== "mediator") completedIds.add(input.agentId);

    const agents = baseAgents().map((a) => {
      if (a.id === "mediator") {
        return { ...a, signal: input.done ? ("done" as const) : ("active" as const) };
      }
      if (!input.done && next && a.id === next.agentId) {
        return { ...a, signal: "active" as const };
      }
      if (completedIds.has(a.id)) {
        return { ...a, signal: "done" as const };
      }
      return { ...a, signal: "standby" as const };
    });

    this.setState({
      ...this.state,
      phaseIndex: input.done ? PHASES.length - 1 : nextIndex,
      stage: input.done ? "ready" : input.stage,
      status: input.done ? "completed" : "running",
      specs,
      files,
      activity,
      workstreams,
      agents,
      updatedAt: now,
    });

    if (this.env.DB && this.state.runId) {
      try {
        const { d1UpdateRun } = await import("../d1");
        await d1UpdateRun(this.env, this.state.runId, {
          status: this.state.status,
          stage: this.state.stage,
          current_phase: input.done ? "done" : next?.phase || input.phase,
        });
      } catch (err) {
        console.error(JSON.stringify({ event: "mediator.run_update_failed", runId: this.state.runId, error: String(err) }));
      }
    }
    return this.state;
  }

  @callable()
  async advancePhase(_payload: Record<string, never> = {}): Promise<MediatorState> {
    const idx = this.state.phaseIndex;
    if (idx < 0 || idx >= PHASES.length) return this.state;

    const current = PHASES[idx]!;
    let artifactSummary = `${current.label} for “${this.state.title}”.`;
    let artifactPath = `artifacts/${current.phase}.md`;
    let filesWritten: string[] = [];

    try {
      if (this.env.DomainAgent) {
        const { getDomainAgent } = await import("./domain-agent");
        const role =
          current.phase === "devops"
            ? "devops"
            : current.agentId === "mediator"
              ? "product"
              : current.agentId;
        const agent = await getDomainAgent(this.env, this.state.projectId, role);
        const result = await agent.runPhase({
          role,
          projectId: this.state.projectId,
          swarmName: this.state.swarmName,
          title: this.state.title,
          brief: this.state.brief,
          phase: current.phase,
          label: current.label,
          briefHint: current.briefHint,
        });
        artifactSummary = result.summary;
        artifactPath = result.path;
        filesWritten = result.filesWritten;
      } else {
        const { runEngineeringBuild, writePhaseArtifact } = await import("../orchestrator/agent-runner");
        if (current.phase === "devops") {
          const { leadEnsureWorkspaceReady } = await import("../orchestrator/lead-gate");
          const gate = await leadEnsureWorkspaceReady(this.env, {
            projectId: this.state.projectId,
            title: this.state.title,
            brief: this.state.brief,
            swarmName: this.state.swarmName,
            allowRebuild: true,
          });
          artifactSummary = gate.summary;
          artifactPath = `artifacts/${current.phase}.md`;
          filesWritten = gate.present.filter((p) => !p.startsWith("artifacts/"));
          await writePhaseArtifact(this.env, {
            projectId: this.state.projectId,
            phase: current.phase,
            title: this.state.title,
            brief: `${this.state.brief}\n\n## DevOps gate\n${gate.summary}`,
            label: current.label,
            briefHint: current.briefHint,
          });
        } else if (current.phase === "eng" || current.phase === "eng-frontend") {
          const build = await runEngineeringBuild(this.env, {
            projectId: this.state.projectId,
            title: this.state.title,
            brief: this.state.brief,
            swarmName: this.state.swarmName,
          });
          artifactSummary = build.summary;
          artifactPath = `artifacts/${current.phase}.md`;
          filesWritten = build.filesWritten.filter((p) => !p.startsWith("artifacts/"));
          await writePhaseArtifact(this.env, {
            projectId: this.state.projectId,
            phase: current.phase,
            title: this.state.title,
            brief: `${this.state.brief}\n\n## Frontend build\n${build.summary}\n\nFiles: ${build.filesWritten.join(", ")}`,
            label: current.label,
            briefHint: current.briefHint,
          });
        } else {
          artifactSummary = await writePhaseArtifact(this.env, {
            projectId: this.state.projectId,
            phase: current.phase,
            title: this.state.title,
            brief: this.state.brief,
            label: current.label,
            briefHint: current.briefHint,
          });
          artifactPath = `artifacts/${current.phase}.md`;
        }
      }
    } catch (err) {
      artifactSummary = `${current.label} (partial): ${err instanceof Error ? err.message : String(err)}`;
    }

    const nextIndex = idx + 1;
    const done = nextIndex >= PHASES.length;
    await this.applyPhaseResult({
      phaseIndex: idx,
      phase: current.phase,
      stage: current.stage,
      label: current.label,
      agentId: current.agentId,
      summary: artifactSummary,
      path: artifactPath,
      filesWritten,
      done,
    });

    if (done && this.env.WORKSPACES) {
      const existing = await this.env.WORKSPACES.head(`workspaces/${this.state.projectId}/index.html`);
      if (!existing) {
        const { scaffoldApp } = await import("../orchestrator/agent-runner");
        const scaffold = await scaffoldApp(this.env, {
          projectId: this.state.projectId,
          title: this.state.title,
          brief: this.state.brief,
          swarmName: this.state.swarmName,
        });
        const now = new Date().toISOString();
        const filesByPath = new Map((this.state.files || []).map((f) => [f.path, f]));
        for (const path of scaffold.filesWritten.filter((p) => !p.startsWith("artifacts/"))) {
          filesByPath.set(path, {
            id: `file-${path}`,
            title: workspaceFileTitle(path),
            path,
            owner: "eng",
            updatedAt: now,
            summary: scaffold.summary,
          });
        }
        this.setState({
          ...this.state,
          files: [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
          updatedAt: now,
        });
      }

      // Publish-first live URL (no Sandbox required). Workflow path also publishes;
      // this covers Mediator.advancePhase when CREW_WORKFLOW is unavailable.
      if (this.state.userId && !this.env.CREW_WORKFLOW) {
        try {
          const { autoPublishProject } = await import("../orchestrator/auto-publish");
          const published = await autoPublishProject(this.env, {
            userId: this.state.userId,
            projectId: this.state.projectId,
            swarmName: this.state.swarmName,
            title: this.state.title,
          });
          if (published?.ok) {
            this.setState({
              ...this.state,
              previewUrl: published.url,
              sandboxId: "published",
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.warn("auto-publish failed", err);
        }
      }
    }

    if (!done) {
      await this.schedule(3, "advancePhase", {});
    }
    return this.state;
  }

  @callable()
  getSnapshot(): MediatorState {
    return this.state;
  }

  @callable()
  setPreview(previewUrl: string, sandboxId: string): MediatorState {
    this.setState({
      ...this.state,
      previewUrl,
      sandboxId,
      updatedAt: new Date().toISOString(),
    });
    return this.state;
  }
}

export async function getMediator(env: Env, projectId: string) {
  if (!env.Mediator) {
    throw new Error("Mediator Durable Object binding is not configured");
  }
  return getAgentByName<Env, MediatorAgent>(env.Mediator, projectId);
}

/** Derive hub edges from phase progress so the orchestrator can show handoffs. */
function buildDataFlows(state: MediatorState): DataFlowEdge[] {
  const flows: DataFlowEdge[] = [];
  const baseAt = Date.now();

  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i]!;
    if (phase.agentId === "mediator") continue;

    const ws = state.workstreams[i];
    const spec = state.specs.find((s) => s.id === `spec-${phase.phase}` || s.owner === phase.agentId);
    const aligned = ws?.status === "aligned" || Boolean(spec && ws?.status !== "in-progress" && ws?.status !== "drafting");
    const inFlight = ws?.status === "in-progress" || ws?.status === "drafting";
    const fromSpecOnly = !ws && Boolean(spec);
    if (!aligned && !inFlight && !fromSpecOnly) continue;

    const artifact = spec?.path?.split("/").pop() || `${phase.phase}.md`;
    const at = baseAt - (PHASES.length - i) * 12_000;
    // Completed handoffs stay live so the hub keeps packet motion (not a gray static web).
    const stillActive = true;

    flows.push({
      id: `flow-${phase.phase}-dispatch`,
      from: "mediator",
      to: phase.agentId,
      artifacts: ["brief.md"],
      at: at - 4_000,
      active: stillActive && inFlight,
      kind: "from-mediator",
    });

    flows.push({
      id: `flow-${phase.phase}-report`,
      from: phase.agentId,
      to: "mediator",
      artifacts: [artifact],
      at,
      active: stillActive,
      kind: "to-mediator",
    });
  }

  // Sequential handoffs between consecutive domain agents (after both have run).
  for (let i = 1; i < PHASES.length; i++) {
    const prev = PHASES[i - 1]!;
    const curr = PHASES[i]!;
    if (prev.agentId === "mediator" || curr.agentId === "mediator") continue;

    const prevWs = state.workstreams[i - 1];
    const currWs = state.workstreams[i];
    const prevSpec = state.specs.find((s) => s.id === `spec-${prev.phase}`);
    const currSpec = state.specs.find((s) => s.id === `spec-${curr.phase}`);
    const prevDone = prevWs?.status === "aligned" || Boolean(prevSpec);
    const currLive =
      currWs?.status === "aligned" ||
      currWs?.status === "in-progress" ||
      Boolean(currSpec);
    if (!prevDone || !currLive) continue;

    const artifact = prevSpec?.path?.split("/").pop() || `${prev.phase}.md`;
    flows.push({
      id: `flow-${prev.phase}-to-${curr.phase}`,
      from: prev.agentId,
      to: curr.agentId,
      artifacts: [artifact],
      at: baseAt - (PHASES.length - i) * 12_000 + 2_000,
      active: true,
      kind: "handoff",
    });
  }

  return flows;
}

/** Prefer domain agents that already participated; never leave a finished run as standby-only. */
function agentsForSpine(state: MediatorState): DomainAgentNode[] {
  const touched = new Set(
    state.workstreams
      .filter((ws) => ws.status === "aligned" || ws.status === "in-progress" || ws.status === "drafting")
      .map((ws) => ws.agentRole),
  );
  for (const spec of state.specs) {
    if (spec.owner && spec.owner !== "mediator") touched.add(spec.owner);
  }

  const roster = state.agents.length > 0 ? state.agents : baseAgents();
  return roster.map((a) => {
    if (a.id === "mediator") {
      return state.status === "completed" ? { ...a, signal: "done" as const } : { ...a, signal: "active" as const };
    }
    if (a.signal !== "standby") return a;
    if (touched.has(a.id) || state.status === "completed") {
      return { ...a, signal: "done" as const };
    }
    return a;
  });
}

export function mediatorToSpine(state: MediatorState, projects: SpineSnapshot["projects"]): SpineSnapshot {
  if (!state.projectId) {
    return {
      empty: true,
      project: null,
      workstreams: [],
      agents: [],
      dataFlows: [],
      specs: [],
      files: [],
      decisions: [],
      dependencies: { nodes: [], edges: [] },
      timeline: [],
      activity: [],
      health: { alignedPct: 0, aligned: 0, inProgress: 0, needsAttention: 0, blocked: 0 },
      nextUp: [],
      specsTotal: 0,
      live: true,
      source: "swarm",
      projects,
      swarmOnline: true,
      message: "No Mediator state yet. Launch a brief.",
    };
  }

  const aligned = state.workstreams.filter((w) => w.status === "aligned").length;
  const inProgress = state.workstreams.filter((w) => w.status === "in-progress" || w.status === "drafting").length;
  const total = state.workstreams.length || 1;
  const agents = agentsForSpine(state);
  const dataFlows = buildDataFlows(state);
  const fallbackAt = state.updatedAt || state.startedAt || new Date().toISOString();
  const coerceAt = (value?: string) =>
    !value || value === "Just now" || value.toLowerCase() === "just now" ? fallbackAt : value;

  // Split legacy mixed SpecCards into docs vs workspace files.
  const docs: SpecCard[] = [];
  const filesByPath = new Map<string, WorkspaceFileCard>();
  for (const f of state.files || []) {
    filesByPath.set(f.path, { ...f, updatedAt: coerceAt(f.updatedAt) });
  }
  for (const s of state.specs || []) {
    const card = { ...s, updatedAt: coerceAt(s.updatedAt) };
    if (s.path && isWorkspaceFilePath(s.path)) {
      filesByPath.set(s.path, {
        id: `file-${s.path}`,
        title: workspaceFileTitle(s.path),
        path: s.path,
        owner: s.owner,
        updatedAt: card.updatedAt,
        summary: s.summary,
      });
      continue;
    }
    // Remap legacy eng/lead/preview cards that pointed at index.html back to their md docs.
    if (s.id.startsWith("spec-") && (!s.path || s.path === "index.html")) {
      const phase = s.id.slice("spec-".length);
      docs.push({ ...card, path: `artifacts/${phase}.md` });
      if (s.path === "index.html") {
        filesByPath.set("index.html", {
          id: "file-index.html",
          title: "index.html",
          path: "index.html",
          owner: s.owner,
          updatedAt: card.updatedAt,
          summary: s.summary,
        });
      }
      continue;
    }
    docs.push(card);
  }

  return {
    empty: false,
    live: true,
    source: "swarm",
    swarmOnline: true,
    project: {
      id: state.projectId,
      title: state.title,
      brief: state.brief,
      stage: state.stage,
      status: state.status,
      createdAt: state.startedAt.slice(0, 10),
      updatedAt: fallbackAt,
    },
    workstreams: state.workstreams,
    agents,
    dataFlows,
    specs: docs,
    files: [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    activeSpecId: docs[0]?.id,
    activeQuestion: null,
    decisions: [],
    dependencies: { nodes: [], edges: [] },
    timeline: PHASES.map((p, i) => ({
      id: p.phase,
      label: p.label,
      state: i < state.phaseIndex ? "done" : i === state.phaseIndex ? "current" : "upcoming",
    })),
    activity: state.activity.map((a) => ({ ...a, at: coerceAt(a.at) })),
    health: {
      alignedPct: Math.round((aligned / total) * 100),
      aligned,
      inProgress,
      needsAttention: 0,
      blocked: 0,
    },
    nextUp: state.workstreams
      .filter((w) => w.status === "queued" || w.status === "in-progress")
      .slice(0, 3)
      .map((w) => ({ id: w.id, label: w.label, owner: w.agentRole, eta: "—" })),
    specsTotal: docs.length,
    projects,
    previewUrl: state.previewUrl,
    sandboxId: state.sandboxId,
  };
}
