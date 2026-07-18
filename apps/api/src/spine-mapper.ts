import type {
  ActiveQuestion,
  ActivityItem,
  CoordinationHealth,
  DataFlowEdge,
  DecisionItem,
  DependencyEdge,
  DependencyNode,
  DepNodeStatus,
  DomainAgentNode,
  NextUpItem,
  ProjectBrief,
  ProjectListItem,
  RevisionLoop,
  SignalState,
  SpecCard,
  SpecStatus,
  SpineSnapshot,
  SpineStage,
  TimelinePass,
  Workstream,
  WorkstreamStatus,
} from "@teamvinsible/shared";

/* ——— Swarm payload shapes (loose; we only read what we need) ——— */

export interface SwarmState {
  projectName?: string;
  runId?: string;
  kind?: string;
  request?: string;
  idea?: string;
  projectType?: string;
  currentPhase?: string;
  completedPhases?: string[];
  completedAgents?: Record<string, string[]>;
  artifacts?: Array<{
    name?: string;
    path?: string;
    createdBy?: string;
    phase?: string;
    timestamp?: string;
  }>;
  doubts?: Array<{
    agent?: string;
    phase?: string;
    question?: string;
    context?: string;
    resolution?: string;
    resolvedBy?: string;
    timestamp?: string;
  }>;
  status?: string;
  startedAt?: string;
  updatedAt?: string;
  flow?: Array<{ phase?: string; agents?: string[] }>;
  plannerRationale?: string;
  metrics?: {
    totalDurationMs?: number;
    phaseDurations?: Record<string, number>;
    agentDurations?: Record<string, number>;
    totalAgentRuns?: number;
    totalErrors?: number;
  };
}

export interface SwarmAgentRun {
  id?: string;
  role?: string;
  phase?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  success?: boolean;
  summary?: string;
  artifactsCreated?: string[];
  doubtsRaised?: Array<{ agent?: string; question?: string; resolution?: string; resolvedBy?: string }>;
}

export interface SwarmLog {
  id?: string;
  timestamp?: string;
  level?: string;
  category?: string;
  agent?: string;
  phase?: string;
  message?: string;
}

export interface SwarmGraphEdge {
  from?: string;
  to?: string;
  artifacts?: string[];
  count?: number;
  at?: number;
}

export interface SwarmGraphNode {
  id?: string;
  role?: string;
  phase?: string;
  startMs?: number;
  endMs?: number;
  success?: boolean;
  produced?: string[];
}

export interface SwarmRunGraph {
  nodes?: SwarmGraphNode[];
  edges?: SwarmGraphEdge[];
  durationMs?: number;
}

export interface SwarmArtifactFile {
  path?: string;
  size?: number;
}

/* ——— Domain node map (UI hub ↔ swarm roles) ——— */

const DOMAIN_NODES: Array<{
  id: string;
  label: string;
  roles: string[];
  phases: string[];
}> = [
  { id: "research", label: "Research", roles: ["researcher"], phases: ["research"] },
  { id: "product", label: "Product", roles: ["product-manager", "change-analyst"], phases: ["product", "scoping"] },
  { id: "brand", label: "Brand", roles: ["brand-strategist", "designer"], phases: ["branding", "design"] },
  { id: "social", label: "Social", roles: ["social-media-manager"], phases: ["marketing"] },
  { id: "email", label: "Email", roles: ["content-strategist"], phases: ["marketing"] },
  {
    id: "engineering",
    label: "Engineering",
    roles: ["principal-engineer", "frontend-dev", "backend-dev", "devops"],
    phases: ["architecture", "development", "deployment"],
  },
  { id: "review", label: "Review", roles: ["tech-lead", "qa-engineer", "seo-specialist", "analytics-specialist"], phases: ["qa", "seo", "analytics"] },
];

const PHASE_LABELS: Record<string, string> = {
  scoping: "Brief",
  research: "Research",
  product: "Product",
  branding: "Brand",
  design: "Design",
  architecture: "Architecture",
  development: "Engineering",
  qa: "QA",
  seo: "SEO",
  deployment: "Deploy",
  marketing: "Marketing",
  analytics: "Analytics",
};

const DEFAULT_FLOW = [
  "research",
  "product",
  "branding",
  "design",
  "architecture",
  "development",
  "qa",
  "seo",
  "deployment",
  "marketing",
  "analytics",
];

function roleToNodeId(role: string): string | null {
  const hit = DOMAIN_NODES.find((n) => n.roles.includes(role));
  return hit?.id ?? null;
}

function phaseToNodeId(phase: string): string | null {
  const hit = DOMAIN_NODES.find((n) => n.phases.includes(phase));
  return hit?.id ?? null;
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function formatClock(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function spineStage(state: SwarmState): SpineStage {
  const completed = state.completedPhases || [];
  const status = state.status || "";
  if (status === "completed" || status === "completed_with_issues") return "ready";
  if (completed.includes("qa") || completed.includes("deployment")) return "ready";
  if (completed.includes("development") || state.currentPhase === "qa") return "consolidating";
  if (completed.length >= 2) return "cross-review";
  return "drafting";
}

function phaseStatus(
  phase: string,
  state: SwarmState,
  openDoubts: NonNullable<SwarmState["doubts"]>,
): WorkstreamStatus {
  const completed = state.completedPhases || [];
  const current = state.currentPhase;
  const status = state.status || "";

  if (status === "failed" && current === phase) return "blocked";
  if (completed.includes(phase)) return "aligned";
  if (current === phase) {
    if (status === "awaiting_input") return "blocked";
    if (openDoubts.some((d) => d.phase === phase && !d.resolution)) return "review";
    if (status === "running") return "in-progress";
    return "drafting";
  }
  // Queued if later in flow
  return "queued";
}

function agentDetail(nodeId: string, signal: SignalState, state: SwarmState, runs: SwarmAgentRun[]): string {
  const node = DOMAIN_NODES.find((n) => n.id === nodeId)!;
  const current = state.currentPhase || "";
  const latest = [...runs]
    .filter((r) => r.role && node.roles.includes(r.role))
    .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())[0];

  if (signal === "active") {
    return latest?.summary?.slice(0, 80) || `Working on ${PHASE_LABELS[current] || current}`;
  }
  if (signal === "revision") return "Awaiting clarification / revision";
  if (signal === "done") return latest?.summary?.slice(0, 80) || "Phase complete";
  if (node.phases.includes(current)) return "Standing by in current phase";
  return "Standby";
}

function signalForNode(
  nodeId: string,
  state: SwarmState,
  runs: SwarmAgentRun[],
  openDoubts: NonNullable<SwarmState["doubts"]>,
): SignalState {
  const node = DOMAIN_NODES.find((n) => n.id === nodeId)!;
  const current = state.currentPhase || "";
  const completed = state.completedPhases || [];
  const status = state.status || "";

  // Open doubt involving this node's roles → revision
  const doubtHit = openDoubts.find(
    (d) =>
      (d.agent && node.roles.includes(d.agent)) ||
      (d.resolvedBy && node.roles.includes(d.resolvedBy) && !d.resolution),
  );
  if (doubtHit && status === "running") return "revision";

  // Active if current phase belongs to this node and run is live
  if (status === "running" && node.phases.includes(current)) {
    const doneAgents = state.completedAgents?.[current] || [];
    const stillWorking = node.roles.some((r) => !doneAgents.includes(r));
    // Also: recent incomplete-feeling — last run for this role in this phase
    const recent = runs.filter((r) => r.role && node.roles.includes(r.role) && r.phase === current);
    const inFlight = recent.some((r) => !r.completedAt);
    if (stillWorking || inFlight) return "active";
  }

  // Done if all of this node's overlapping phases are completed
  const relevant = node.phases.filter((p) => (state.flow?.length ? state.flow.some((f) => f.phase === p) : DEFAULT_FLOW.includes(p)));
  if (relevant.length && relevant.every((p) => completed.includes(p))) return "done";

  return "standby";
}

function buildRevisionLoop(
  state: SwarmState,
  openDoubts: NonNullable<SwarmState["doubts"]>,
): RevisionLoop | undefined {
  const doubt = openDoubts[0];
  if (!doubt?.agent) return undefined;
  const from = roleToNodeId(doubt.agent);
  const toRole = doubt.resolvedBy && doubt.resolvedBy !== "human" ? doubt.resolvedBy : "tech-lead";
  const to = roleToNodeId(toRole) || "review";
  if (!from) return undefined;
  return {
    from,
    to,
    outboundLabel: doubt.question?.slice(0, 72) || "Clarification requested",
    inboundLabel: doubt.resolution?.slice(0, 72) || (doubt.resolvedBy ? `Routed to ${doubt.resolvedBy}` : "Awaiting response"),
  };
}

function buildDataFlows(
  graph: SwarmRunGraph | null,
  state: SwarmState,
  runs: SwarmAgentRun[],
): DataFlowEdge[] {
  const current = state.currentPhase || "";
  const live = state.status === "running" || state.status === "awaiting_input" || state.status === "paused";
  const ACTIVE_MS = 5 * 60_000;
  const edges: DataFlowEdge[] = [];

  const push = (e: DataFlowEdge) => {
    edges.push(e);
  };

  // 1) Real run-graph edges (artifact produced by A consumed by B)
  if (graph?.edges?.length && graph.nodes?.length) {
    const byId = new Map(graph.nodes.map((n) => [n.id || "", n]));
    for (let i = 0; i < graph.edges.length; i++) {
      const e = graph.edges[i];
      const fromNode = byId.get(e.from || "");
      const toNode = byId.get(e.to || "");
      if (!fromNode?.role || !toNode?.role) continue;
      const from = roleToNodeId(fromNode.role);
      const to = roleToNodeId(toNode.role);
      if (!from || !to || from === to) continue;
      const at = e.at || toNode.startMs || 0;
      push({
        id: `graph-${i}-${from}-${to}`,
        from,
        to,
        artifacts: (e.artifacts || []).map(basename).slice(0, 4),
        at,
        active: live && (fromNode.phase === current || toNode.phase === current || Date.now() - at < ACTIVE_MS),
        kind: "handoff",
      });
    }
  }

  // 2) Synthesize handoffs from sequential agent runs + artifactsCreated
  const sortedRuns = [...runs]
    .filter((r) => r.role && r.startedAt)
    .sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());

  for (let i = 0; i < sortedRuns.length; i++) {
    const producer = sortedRuns[i];
    const arts = (producer.artifactsCreated || []).map(basename).filter(Boolean);
    if (!arts.length) continue;
    const from = roleToNodeId(producer.role!);
    if (!from) continue;
    const producedAt = new Date(producer.completedAt || producer.startedAt || 0).getTime();

    // Prefer next run that started after this one finished (consumer)
    const consumer = sortedRuns.find(
      (r, j) =>
        j > i &&
        r.role &&
        roleToNodeId(r.role) !== from &&
        new Date(r.startedAt || 0).getTime() >= producedAt - 5_000,
    );
    const to = consumer?.role
      ? roleToNodeId(consumer.role)
      : phaseToNodeId(
          (state.flow || [])
            .map((f) => f.phase!)
            .filter(Boolean)
            .find((p, idx, arr) => arr[idx - 1] === producer.phase) || "",
        );

    if (to && to !== from) {
      push({
        id: `run-${producer.id || i}-${from}-${to}`,
        from,
        to,
        artifacts: arts.slice(0, 3),
        at: producedAt,
        active: live && (producer.phase === current || Date.now() - producedAt < ACTIVE_MS),
        kind: "handoff",
      });
    }

    // Producer always reports up to mediator while in flight / recently done
    push({
      id: `up-${producer.id || i}-${from}`,
      from,
      to: "mediator",
      artifacts: arts.slice(0, 2),
      at: producedAt,
      active:
        live &&
        (!producer.completedAt || Date.now() - producedAt < ACTIVE_MS || producer.phase === current),
      kind: "to-mediator",
    });
  }

  // 3) State artifacts → creator node → next phase / mediator
  for (let i = 0; i < (state.artifacts || []).length; i++) {
    const a = state.artifacts![i];
    const from = a.createdBy ? roleToNodeId(a.createdBy) : phaseToNodeId(a.phase || "");
    if (!from) continue;
    const at = new Date(a.timestamp || state.updatedAt || 0).getTime();
    const name = basename(a.path || a.name || `artifact-${i}`);
    const flowPhases = (state.flow?.map((f) => f.phase!).filter(Boolean) as string[]) || DEFAULT_FLOW;
    const phaseIdx = flowPhases.indexOf(a.phase || "");
    const nextPhase = phaseIdx >= 0 ? flowPhases[phaseIdx + 1] : undefined;
    const to = nextPhase ? phaseToNodeId(nextPhase) : null;

    if (to && to !== from) {
      push({
        id: `art-${i}-${from}-${to}`,
        from,
        to,
        artifacts: [name],
        at,
        active: live && (a.phase === current || Date.now() - at < ACTIVE_MS),
        kind: "handoff",
      });
    }

    push({
      id: `art-up-${i}-${from}`,
      from,
      to: "mediator",
      artifacts: [name],
      at,
      active: live && (a.phase === current || Date.now() - at < ACTIVE_MS),
      kind: "to-mediator",
    });
  }

  // 4) Active agents receive dispatch from mediator
  if (live) {
    const openDoubts = (state.doubts || []).filter((d) => !d.resolution);
    for (const n of DOMAIN_NODES) {
      const signal = signalForNode(n.id, state, runs, openDoubts);
      if (signal !== "active" && signal !== "revision") continue;
      push({
        id: `dispatch-${n.id}`,
        from: "mediator",
        to: n.id,
        artifacts: [signal === "revision" ? "clarification" : `${PHASE_LABELS[current] || current || "task"}`],
        at: Date.now(),
        active: true,
        kind: signal === "revision" ? "revision" : "from-mediator",
      });
    }
  }

  // Dedupe: prefer handoff > mediator links; keep most recent per from→to+kind
  const best = new Map<string, DataFlowEdge>();
  for (const e of edges) {
    const key = `${e.kind || "handoff"}:${e.from}->${e.to}`;
    const prev = best.get(key);
    if (!prev || e.at >= prev.at) best.set(key, e);
  }

  const all = [...best.values()];
  // Prefer showing active exchanges; pad with recent history
  const active = all.filter((e) => e.active);
  const quiet = all
    .filter((e) => !e.active)
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  return [...active, ...quiet].slice(0, 18);
}

function buildWorkstreams(state: SwarmState, openDoubts: NonNullable<SwarmState["doubts"]>): Workstream[] {
  const flowPhases =
    state.flow?.map((f) => f.phase!).filter(Boolean) ||
    [...(state.completedPhases || []), state.currentPhase].filter(Boolean) as string[] ||
    DEFAULT_FLOW;

  const phases = [...new Set(flowPhases.length ? flowPhases : DEFAULT_FLOW)];

  // Always show Brief as submitted once a project exists
  const streams: Workstream[] = [
    {
      id: "brief",
      label: "Brief",
      status: "submitted",
      agentRole: "orchestrator",
      phase: "scoping",
    },
  ];

  for (const phase of phases) {
    if (phase === "scoping") continue;
    const nodeId = phaseToNodeId(phase);
    const agents = state.flow?.find((f) => f.phase === phase)?.agents;
    streams.push({
      id: phase,
      label: PHASE_LABELS[phase] || titleCase(phase),
      status: phaseStatus(phase, state, openDoubts),
      agentRole: agents?.[0] || DOMAIN_NODES.find((n) => n.id === nodeId)?.roles[0] || "orchestrator",
      phase,
    });
  }

  return streams;
}

function buildAgents(
  state: SwarmState,
  runs: SwarmAgentRun[],
  openDoubts: NonNullable<SwarmState["doubts"]>,
): DomainAgentNode[] {
  // Only show nodes that appear in this run's flow (or have activity)
  const flowPhases = new Set(
    (state.flow?.map((f) => f.phase) || state.completedPhases || []).filter(Boolean) as string[],
  );
  if (state.currentPhase) flowPhases.add(state.currentPhase);
  const activeRoles = new Set(runs.map((r) => r.role).filter(Boolean) as string[]);

  return DOMAIN_NODES.filter((n) => {
    if (!flowPhases.size && !activeRoles.size) return true; // show full crew for empty mid-run
    return n.phases.some((p) => flowPhases.has(p)) || n.roles.some((r) => activeRoles.has(r));
  }).map((n) => {
    const signal = signalForNode(n.id, state, runs, openDoubts);
    return {
      id: n.id,
      label: n.label,
      role: n.roles[0],
      swarmRoles: n.roles,
      signal,
      detail: agentDetail(n.id, signal, state, runs),
    };
  });
}

function buildSpecs(state: SwarmState, files: SwarmArtifactFile[]): SpecCard[] {
  const fromState = (state.artifacts || []).map((a, i) => {
    const path = a.path || a.name || `artifact-${i}`;
    const phase = a.phase || "";
    const completed = (state.completedPhases || []).includes(phase);
    const current = state.currentPhase === phase;
    let status: SpecStatus = "drafting";
    if (completed) status = "ready";
    else if (current) status = "cross-review";
    else if (state.doubts?.some((d) => d.phase === phase && !d.resolution)) status = "needs-attention";

    return {
      id: path,
      title: a.name || titleCase(basename(path).replace(/\.\w+$/, "")),
      status,
      owner: a.createdBy ? `${titleCase(a.createdBy)} Agent` : "Crew",
      updatedAt: formatRelative(a.timestamp || state.updatedAt),
      summary: `${PHASE_LABELS[phase] || phase || "Artifact"} · ${path}`,
      path,
    } satisfies SpecCard;
  });

  if (fromState.length) return fromState.slice().reverse().slice(0, 12);

  // Fallback: markdown under _artifacts from file scan
  return files
    .filter((f) => f.path?.includes("_artifacts/") && /\.(md|json)$/i.test(f.path))
    .slice(0, 12)
    .map((f) => {
      const path = f.path!;
      const parts = path.split("/");
      const phase = parts[1] || "";
      return {
        id: path,
        title: titleCase(basename(path).replace(/\.\w+$/, "")),
        status: (state.completedPhases || []).includes(phase)
          ? ("ready" as const)
          : state.currentPhase === phase
            ? ("cross-review" as const)
            : ("drafting" as const),
        owner: "Crew",
        updatedAt: formatRelative(state.updatedAt),
        summary: path,
        path,
      };
    });
}

function buildActivity(logs: SwarmLog[]): ActivityItem[] {
  return [...logs]
    .slice()
    .reverse()
    .slice(0, 40)
    .map((l) => {
      let kind: ActivityItem["kind"] = "info";
      if (l.category === "doubt") kind = "revision";
      else if (l.category === "phase") kind = "gate";
      else if (l.category === "agent") kind = "signal";
      return {
        id: l.id || `${l.timestamp}-${l.message}`,
        at: formatClock(l.timestamp),
        message: l.message || "",
        kind,
        agent: l.agent,
        phase: l.phase,
      };
    });
}

function buildHealth(state: SwarmState, openDoubts: NonNullable<SwarmState["doubts"]>): CoordinationHealth {
  const flow = state.flow?.map((f) => f.phase!).filter(Boolean) || DEFAULT_FLOW;
  const total = Math.max(flow.length, 1);
  const aligned = (state.completedPhases || []).filter((p) => flow.includes(p)).length;
  const inProgress = state.status === "running" || state.status === "paused" ? 1 : 0;
  const needsAttention =
    openDoubts.length + (state.status === "awaiting_input" ? 1 : 0) + (state.metrics?.totalErrors ? 1 : 0);
  const blocked = state.status === "failed" || state.status === "stopped" ? 1 : 0;
  const alignedPct = Math.round((aligned / total) * 100);
  return {
    alignedPct: Number.isFinite(alignedPct) ? alignedPct : 0,
    aligned,
    inProgress,
    needsAttention,
    blocked,
  };
}

function buildNextUp(state: SwarmState): NextUpItem[] {
  const flow = state.flow?.length
    ? state.flow
    : DEFAULT_FLOW.map((phase) => ({ phase, agents: undefined as string[] | undefined }));
  const completed = new Set(state.completedPhases || []);
  const upcoming = flow.filter((f) => f.phase && !completed.has(f.phase));
  return upcoming.slice(0, 5).map((f, i) => {
    const phase = f.phase!;
    const agents = f.agents?.length
      ? f.agents
      : DOMAIN_NODES.find((n) => n.phases.includes(phase))?.roles || [];
    const isCurrent = phase === state.currentPhase;
    return {
      id: `next-${phase}-${i}`,
      label: isCurrent ? `Continue ${PHASE_LABELS[phase] || phase}` : `Start ${PHASE_LABELS[phase] || phase}`,
      owner: agents[0] ? `${titleCase(agents[0])} Agent` : "Mediator",
      eta: isCurrent ? "In progress" : "Queued",
    };
  });
}

function buildActiveQuestion(
  openDoubts: NonNullable<SwarmState["doubts"]>,
): ActiveQuestion | null {
  const d = openDoubts[0];
  if (!d?.question) return null;
  return {
    id: `q-${d.timestamp || d.agent || "0"}`,
    question: d.question,
    askedAt: formatClock(d.timestamp) || "Just now",
    agent: d.agent,
    phase: d.phase,
    status: "awaiting-update",
  };
}

function buildDecisions(state: SwarmState): DecisionItem[] {
  const doubts = state.doubts || [];
  if (!doubts.length) return [];

  return [...doubts]
    .slice()
    .reverse()
    .slice(0, 12)
    .map((d, i) => {
      const resolved = Boolean(d.resolution);
      const title =
        d.question?.replace(/\?+$/, "").slice(0, 56) ||
        `${PHASE_LABELS[d.phase || ""] || d.phase || "Coordination"} decision`;
      return {
        id: `dec-${d.timestamp || i}-${d.agent || "x"}`,
        number: doubts.length - i,
        title,
        summary: resolved
          ? (d.resolution || "Resolved").slice(0, 100)
          : (d.context || d.question || "Open clarification").slice(0, 100),
        status: resolved ? ("accepted" as const) : ("open" as const),
        at: formatRelative(d.timestamp || state.updatedAt),
        author: d.resolvedBy
          ? titleCase(d.resolvedBy)
          : d.agent
            ? titleCase(d.agent)
            : "Crew",
        kind: resolved ? ("policy" as const) : ("open" as const),
      };
    });
}

function specToDepStatus(status: SpecStatus, blocked: boolean): DepNodeStatus {
  if (blocked) return "blocked";
  if (status === "ready") return "approved";
  if (status === "needs-attention") return "reopened";
  if (status === "cross-review" || status === "drafting") return "editing";
  return "pending";
}

function buildDependencies(
  specs: SpecCard[],
  agents: DomainAgentNode[],
  openDoubts: NonNullable<SwarmState["doubts"]>,
): { nodes: DependencyNode[]; edges: DependencyEdge[] } {
  const layout: Array<{ x: number; y: number }> = [
    { x: 18, y: 22 },
    { x: 52, y: 14 },
    { x: 82, y: 28 },
    { x: 22, y: 58 },
    { x: 55, y: 52 },
    { x: 84, y: 62 },
    { x: 48, y: 82 },
  ];

  if (specs.length) {
    const nodes: DependencyNode[] = specs.slice(0, 7).map((s, i) => {
      const pos = layout[i] || { x: 20 + (i % 3) * 30, y: 20 + Math.floor(i / 3) * 30 };
      const blocked = openDoubts.some((d) => s.summary.toLowerCase().includes((d.phase || "").toLowerCase()) && d.phase);
      return {
        id: s.id,
        title: s.title.length > 28 ? `${s.title.slice(0, 26)}…` : s.title,
        version: `v0.${Math.max(1, specs.length - i)}`,
        status: specToDepStatus(s.status, Boolean(blocked && s.status === "needs-attention")),
        x: pos.x,
        y: pos.y,
      };
    });
    const edges: DependencyEdge[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ id: `e-${i}`, from: nodes[i].id, to: nodes[i + 1].id });
    }
    // Fan-in to the most recently active (editing) node when present
    const editing = nodes.find((n) => n.status === "editing");
    if (editing && nodes[0] && editing.id !== nodes[0].id) {
      edges.push({ id: "e-focus", from: nodes[0].id, to: editing.id });
    }
    return { nodes, edges };
  }

  // Fallback: domain agents as dependency nodes
  const nodes: DependencyNode[] = agents.slice(0, 7).map((a, i) => {
    const pos = layout[i] || { x: 50, y: 50 };
    let status: DepNodeStatus = "pending";
    if (a.signal === "done") status = "approved";
    else if (a.signal === "active") status = "editing";
    else if (a.signal === "revision") status = "reopened";
    else if (a.signal === "standby") status = "pending";
    return {
      id: a.id,
      title: a.label,
      version: "—",
      status,
      x: pos.x,
      y: pos.y,
    };
  });
  const edges: DependencyEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ id: `ea-${i}`, from: nodes[i].id, to: nodes[i + 1].id });
  }
  return { nodes, edges };
}

function buildTimeline(state: SwarmState): TimelinePass[] {
  const started = formatRelative(state.startedAt);
  const updated = formatRelative(state.updatedAt);
  const completed = state.completedPhases || [];
  const stage = spineStage(state);
  const hasDoubts = (state.doubts || []).some((d) => !d.resolution);
  const failed = state.status === "failed" || state.status === "stopped";

  const passes: TimelinePass[] = [
    {
      id: "t0",
      label: "Initial state",
      at: started !== "—" ? started : undefined,
      state: "done",
    },
    {
      id: "t1",
      label: "Draft pass 1",
      state: completed.length >= 1 || stage !== "drafting" ? "done" : stage === "drafting" ? "current" : "upcoming",
    },
    {
      id: "t2",
      label: "Cross-review",
      state:
        stage === "cross-review"
          ? "current"
          : ["consolidating", "ready"].includes(stage)
            ? "done"
            : "upcoming",
    },
    {
      id: "t3",
      label: hasDoubts || failed ? "Reopened" : "Consolidate",
      state: hasDoubts || failed ? "attention" : stage === "consolidating" ? "current" : stage === "ready" ? "done" : "upcoming",
    },
    {
      id: "t4",
      label: stage === "ready" ? "Ready" : "Pass 3 (current)",
      at: stage !== "drafting" ? updated : undefined,
      state: stage === "ready" ? "done" : ["consolidating", "cross-review"].includes(stage) && !hasDoubts ? "current" : stage === "drafting" ? "upcoming" : "current",
    },
  ];

  // Ensure exactly one current when possible
  const currents = passes.filter((p) => p.state === "current");
  if (currents.length > 1) {
    let seen = false;
    for (const p of passes) {
      if (p.state === "current") {
        if (seen) p.state = "upcoming";
        seen = true;
      }
    }
  } else if (currents.length === 0 && state.status === "running") {
    const lastDone = [...passes].reverse().find((p) => p.state === "done");
    const idx = lastDone ? passes.indexOf(lastDone) + 1 : 0;
    if (passes[idx] && passes[idx].state !== "attention") passes[idx].state = "current";
  }

  return passes;
}

export function emptySpine(opts: {
  swarmOnline: boolean;
  projects: ProjectListItem[];
  message?: string;
}): SpineSnapshot {
  return {
    empty: true,
    project: null,
    workstreams: [],
    agents: DOMAIN_NODES.map((n) => ({
      id: n.id,
      label: n.label,
      role: n.roles[0],
      swarmRoles: n.roles,
      signal: "standby" as const,
      detail: "No active run",
    })),
    dataFlows: [],
    specs: [],
    activeQuestion: null,
    decisions: [],
    dependencies: { nodes: [], edges: [] },
    timeline: [],
    activity: [],
    health: { alignedPct: 0, aligned: 0, inProgress: 0, needsAttention: 0, blocked: 0 },
    nextUp: [],
    specsTotal: 0,
    live: false,
    source: "swarm",
    projects: opts.projects,
    swarmOnline: opts.swarmOnline,
    message:
      opts.message ||
      (opts.swarmOnline
        ? "No project selected. Launch a brief or pick a project to see live coordination."
        : "Swarm control plane offline. Start it with npm run dev:swarm."),
  };
}

export function buildSpineSnapshot(input: {
  state: SwarmState;
  runs: SwarmAgentRun[];
  logs: SwarmLog[];
  graph: SwarmRunGraph | null;
  files: SwarmArtifactFile[];
  projects: ProjectListItem[];
  swarmOnline: boolean;
}): SpineSnapshot {
  const { state, runs, logs, graph, files, projects, swarmOnline } = input;
  const openDoubts = (state.doubts || []).filter((d) => !d.resolution);
  const projectName = state.projectName || "untitled";

  const project: ProjectBrief = {
    id: projectName,
    title: projectName,
    brief: state.request || state.idea || state.plannerRationale || "No brief recorded for this run.",
    stage: spineStage(state),
    status: state.status || "unknown",
    createdAt: state.startedAt || new Date().toISOString(),
    updatedAt: state.updatedAt || new Date().toISOString(),
  };

  const specs = buildSpecs(state, files);
  const agents = buildAgents(state, runs, openDoubts);
  const activeSpec =
    specs.find((s) => s.status === "drafting" || s.status === "cross-review" || s.status === "needs-attention") ||
    specs[0];

  return {
    empty: false,
    project,
    workstreams: buildWorkstreams(state, openDoubts),
    agents,
    revisionLoop: buildRevisionLoop(state, openDoubts),
    dataFlows: buildDataFlows(graph, state, runs),
    specs,
    activeSpecId: activeSpec?.id,
    activeQuestion: buildActiveQuestion(openDoubts),
    decisions: buildDecisions(state),
    dependencies: buildDependencies(specs, agents, openDoubts),
    timeline: buildTimeline(state),
    activity: buildActivity(logs),
    health: buildHealth(state, openDoubts),
    nextUp: buildNextUp(state),
    specsTotal: Math.max(specs.length, files.filter((f) => f.path?.includes("_artifacts")).length),
    live: state.status === "running" || state.status === "awaiting_input" || state.status === "paused",
    source: "swarm",
    projects,
    swarmOnline,
  };
}

export function toProjectList(
  projects: Array<{ name?: string; state?: SwarmState } | SwarmState & { name?: string }>,
): ProjectListItem[] {
  return projects.map((p) => {
    const state = ("state" in p && p.state ? p.state : p) as SwarmState;
    const name = ("name" in p && p.name ? String(p.name) : state.projectName) || "untitled";
    return {
      name,
      status: state.status || "unknown",
      phase: state.currentPhase,
      idea: state.idea || state.request,
      updatedAt: state.updatedAt,
    };
  });
}
