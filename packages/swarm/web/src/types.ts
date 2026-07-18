// Shapes returned by the dashboard's /api/* endpoints. Kept intentionally
// permissive (optional fields) since state is built up over a run's lifetime.

export interface Metrics {
  totalDurationMs?: number;
  totalAgentRuns?: number;
  totalErrors?: number;
  totalTokensSaved?: number;
  phaseDurations?: Record<string, number>;
}

export interface Artifact {
  path?: string;
  name?: string;
  phase?: string;
}

// A human-input request raised by a paused run (missing secret/external config).
export interface PendingQuestion {
  id: string;
  project: string;
  runId?: string;
  agent: string;
  phase: string;
  kind: "secret" | "config" | "external" | "input" | string;
  question: string;
  context: string;
  envKey: string;         // for 'secret': the env var name to set (never the value)
  suggestion: string;
  status: "open" | "answered" | "skipped" | string;
  answer?: string;
  createdAt: string;
  resolvedAt?: string;
  envPath?: string;       // secret only: per-project .env path to add the key to
  globalEnvPath?: string; // secret only: shared .env path (reusable keys)
}

export interface ChatMessage {
  id: string;
  project: string;
  runId?: string;
  role: "user" | "swarm";
  kind: "message" | "answer" | "change" | "note" | "error" | string;
  text: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectState {
  projectName?: string;
  name?: string;
  runId?: string;
  idea?: string;
  request?: string;
  status?: "waiting" | "running" | "paused" | "awaiting_input" | "completed" | "completed_with_issues" | "failed" | "stopped" | string;
  kind?: string;
  projectType?: string;
  currentPhase?: string;
  completedPhases?: string[];
  completedAgents?: Record<string, string[]>;
  artifacts?: Artifact[];
  metrics?: Metrics;
  startedAt?: string;
  updatedAt?: string;
  repoUrl?: string;
  repoOwner?: string;
  repoName?: string;
  defaultBranch?: string;
  credentialProfile?: string;
  branch?: string;
  baseCommit?: string;
  headCommit?: string;
  prUrl?: string;
  deployProvider?: string;
  deployProfile?: string;
  deployTarget?: Record<string, unknown>;
}

export interface ProjectEntry {
  name: string;
  state: ProjectState | null;
}

export interface IntakeResult {
  ok?: boolean;
  error?: string;
  mode: "new" | "change";
  idea: string;
  suggestedName: string;
  projectType: string;
  projectTypeLabel: string;
  repo: string;
  project: string;
  intent: string;
  summary: string;
}

export interface DeployProviderInfo {
  key: string;
  label: string;
  secrets: string[];  // secret env base vars (VERCEL_TOKEN, …)
  config: string[];   // optional non-secret env base vars (GCP_PROJECT, …)
}

export interface Config {
  controlMode: boolean;
  projectTypes: Array<{ key: string; label: string; phases: string[] }>;
  phaseAgents: Record<string, string[]>;
  allPhases: string[];
  deployProviders?: DeployProviderInfo[];
}

export interface Deployment {
  id: string;
  project: string;
  runId?: string;
  provider: string;
  profile: string;
  status: "success" | "failed";
  url?: string;
  logsUrl?: string;
  detail?: string;
  createdAt?: string;
}

export interface LogEntry {
  id?: string;
  runId?: string;
  level?: string;
  category?: string;
  message?: string;
  timestamp?: string;
  phase?: string;
  agent?: string;
}

export interface AgentRun {
  id: string;
  runId?: string;
  role: string;
  phase: string;
  success: boolean;
  durationMs?: number;
  artifactsCreated: string[];
  tokensSaved?: number;
  error?: string;
  summary?: string;
  fullOutput: string;
  promptSent: string;
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  detail?: string;
  durationMs?: number;
}

export interface EvalResult {
  id?: string;
  project: string;
  runId?: string;
  overallScore: number;
  passed: boolean;
  createdAt: string;
  checks?: EvalCheck[];
}

export interface ArtifactMeta {
  path: string;
  size: number;
}

export interface Commit {
  sha: string;
  runId?: string;
  message: string;
  files: number;
  htmlUrl?: string;
}

export interface EnvVar {
  key: string;
  preview: string;
}

export interface RunningRun {
  name: string;
  idea: string;
  startedAt: string;
  pid: number;
}

export interface Settings {
  deepseekKeySet?: boolean;
  anthropicKeySet?: boolean;
  openrouterKeySet?: boolean;
  githubTokenSet?: boolean;
  deepseekBaseUrl?: string;
  openrouterBaseUrl?: string;
  swarmWorktrees?: "on" | "off";
  swarmCiRepair?: "on" | "off";
  swarmCiRepairRounds?: string;
  swarmCiRepairTimeoutMs?: string;
  swarmSandbox?: "off" | "exec" | "full";
  swarmSandboxImage?: string;
  swarmSandboxCpus?: string;
  swarmSandboxMemory?: string;
  gitProfiles?: Array<{ name: string; envName: string; tokenSet: boolean }>;
  deployProfiles?: Array<{ provider: string; name: string; envNames: string[]; tokenSet: boolean }>;
}

export interface DeployProfileStatus {
  provider: string;
  name: string;
  envNames: string[];
  tokenSet: boolean;
  scope?: "global" | "project";
}

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "exited";
  exitCode?: number | null;
  pid: number;
  output: string;
}

export interface McpConfig {
  scope: "global" | "project";
  path: string;
  exists: boolean;
  content: string;
  error?: string;
}

export type PromptKind = "role" | "template" | "directive";

export interface PromptItem {
  key: string;
  kind: PromptKind;
  default: string;
  effective: string;
  overridden: boolean;
  value: string;
}

export interface PromptResponse {
  scope: "global" | "project";
  project: string;
  items: PromptItem[];
}

export interface Learning {
  category: string;
  confidence: number;
  appliedCount: number;
  insight: string;
  context: string;
  source: string;
  projectName: string;
}

export interface ProjectHistory {
  projectName: string;
  success: boolean;
  phases: number;
  artifacts: number;
  learningsExtracted: number;
  totalDurationMs: number;
}

export interface Activity {
  timestamp: string;
  agent?: string;
  category?: string;
  message: string;
  type?: string;
}

// ── Run graph (animated data-flow timeline) ──
export interface GraphNode {
  id: string;
  role: string;
  phase: string;
  start: number;      // ms offset from run start
  end: number;        // ms offset from run start
  durationMs: number;
  lane: number;       // sub-lane within the phase swimlane (parallel stacking)
  success: boolean;
  produced: string[]; // sample of artifact paths
  producedCount: number;
  summary: string;
  tokensSaved: number;
}

export interface GraphEdge {
  from: string;       // producer node id
  to: string;         // consumer node id
  artifacts: string[];
  count: number;
  at: number;         // ms offset when the consumer started (data handed over)
}

export interface RunSessionMeta {
  index: number;
  startedAt: string;
  phases: string[];
  agents: number;
}

export interface RunGraph {
  project: string;
  sessions: RunSessionMeta[];
  selected: number;
  t0: number;
  t1: number;
  durationMs: number;
  phases: string[];
  lanesPerPhase: Record<string, number>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type WorkNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_input";
export type WorkGateStatus = "pending" | "passed" | "failed" | "skipped";

export interface WorkNode {
  id: string;
  kind: "phase";
  phase: string;
  agents: string[];
  mode: "greenfield" | "incremental";
  optional?: boolean;
  requires?: string;
  status: WorkNodeStatus;
}

export interface WorkGate {
  id: string;
  kind: "gate";
  name: string;
  status: WorkGateStatus;
  detail?: string;
}

export interface WorkSpec {
  version: 1;
  runId: string;
  project: string;
  mode: "new-build" | "change";
  intent: string;
  request: string;
  rationale?: string;
  updatedAt: string;
  status: string;
  currentPhase?: string;
  route: WorkNode[];
  scope?: {
    summary?: string;
    affectedAreas?: string[];
    affectedFiles?: string[];
    tags?: string[];
    phasesNeeded?: string[];
    acceptanceCriteria?: string[];
  };
  gates: WorkGate[];
  delivery?: {
    mode: "pr" | "deploy" | "local";
    prUrl?: string;
    deployUrl?: string;
  };
  appliedLearningIds?: string[];
}
