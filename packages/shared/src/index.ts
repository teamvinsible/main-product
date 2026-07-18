/** Shared Teamvinsible domain types — Coordination Spine + API contracts */

export type IntakeKind = "text" | "image" | "url";

export type SpineStage = "drafting" | "cross-review" | "consolidating" | "ready";

export type WorkstreamStatus =
  | "submitted"
  | "queued"
  | "in-progress"
  | "drafting"
  | "review"
  | "aligned"
  | "blocked";

export type SpecStatus = "drafting" | "cross-review" | "ready" | "needs-attention";

export type SignalState = "active" | "standby" | "revision" | "done";

export type DecisionStatus = "accepted" | "reviewed" | "open" | "blocked";

export type DepNodeStatus = "approved" | "editing" | "reopened" | "blocked" | "pending";

export interface ProjectBrief {
  id: string;
  title: string;
  brief: string;
  stage: SpineStage;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveQuestion {
  id: string;
  question: string;
  askedAt: string;
  agent?: string;
  phase?: string;
  status: "awaiting-update" | "resolved";
}

export interface DecisionItem {
  id: string;
  number: number;
  title: string;
  summary: string;
  status: DecisionStatus;
  at: string;
  author: string;
  kind: "policy" | "review" | "open";
}

export interface DependencyNode {
  id: string;
  title: string;
  version: string;
  status: DepNodeStatus;
  x: number;
  y: number;
}

export interface DependencyEdge {
  id: string;
  from: string;
  to: string;
}

export interface TimelinePass {
  id: string;
  label: string;
  at?: string;
  state: "done" | "current" | "upcoming" | "attention";
}

export interface Workstream {
  id: string;
  label: string;
  status: WorkstreamStatus;
  agentRole: string;
  phase?: string;
}

export interface DomainAgentNode {
  id: string;
  label: string;
  role: string;
  detail: string;
  signal: SignalState;
  /** Underlying swarm roles represented by this node */
  swarmRoles: string[];
}

export interface RevisionLoop {
  from: string;
  to: string;
  outboundLabel: string;
  inboundLabel: string;
}

/** Live artifact handoff between domain nodes (from run-graph edges). */
export interface DataFlowEdge {
  id: string;
  from: string;
  to: string;
  artifacts: string[];
  at: number;
  active: boolean;
  /** How this exchange should render in the hub */
  kind?: "handoff" | "to-mediator" | "from-mediator" | "revision";
}

export interface SpecCard {
  id: string;
  title: string;
  status: SpecStatus;
  owner: string;
  updatedAt: string;
  summary: string;
  path?: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  message: string;
  kind?: "info" | "signal" | "revision" | "gate";
  agent?: string;
  phase?: string;
}

export interface CoordinationHealth {
  alignedPct: number;
  aligned: number;
  inProgress: number;
  needsAttention: number;
  blocked: number;
}

export interface NextUpItem {
  id: string;
  label: string;
  owner: string;
  eta: string;
}

export interface ProjectListItem {
  name: string;
  status: string;
  phase?: string;
  idea?: string;
  updatedAt?: string;
}

export interface SpineSnapshot {
  empty?: boolean;
  project: ProjectBrief | null;
  workstreams: Workstream[];
  agents: DomainAgentNode[];
  revisionLoop?: RevisionLoop;
  dataFlows: DataFlowEdge[];
  specs: SpecCard[];
  /** Spec currently highlighted in the preview pane */
  activeSpecId?: string;
  activeQuestion?: ActiveQuestion | null;
  decisions: DecisionItem[];
  dependencies: { nodes: DependencyNode[]; edges: DependencyEdge[] };
  timeline: TimelinePass[];
  activity: ActivityItem[];
  health: CoordinationHealth;
  nextUp: NextUpItem[];
  specsTotal: number;
  live: boolean;
  source: "swarm";
  projects: ProjectListItem[];
  swarmOnline: boolean;
  message?: string;
}

export interface IntakeRequest {
  kind: IntakeKind;
  text?: string;
  url?: string;
  imageRef?: string;
}

export interface IntakePlan {
  summary: string;
  category: string;
  categoryLabel: string;
  clarifyingQuestions: string[];
  suggestedAgents: string[];
  suggestedName: string;
}

export interface PublishTarget {
  subdomain: string;
  customDomain?: string;
  status: "preview" | "published" | "stopped";
  url: string;
}
