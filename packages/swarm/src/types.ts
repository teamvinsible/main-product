export type AgentRole =
  | "orchestrator"
  | "tech-lead"
  | "change-analyst"
  | "researcher"
  | "product-manager"
  | "brand-strategist"
  | "designer"
  | "principal-engineer"
  | "frontend-dev"
  | "backend-dev"
  | "qa-engineer"
  | "seo-specialist"
  | "devops"
  | "content-strategist"
  | "social-media-manager"
  | "analytics-specialist";

export type Phase =
  | "scoping"
  | "research"
  | "product"
  | "branding"
  | "design"
  | "architecture"
  | "development"
  | "qa"
  | "seo"
  | "deployment"
  | "marketing"
  | "analytics";

// --- Model Configuration ---

// "claude" = Claude via the Agent SDK (subscription auth). "anthropic" = Claude
// via the raw Messages API on the unified loop (API key; tools reach it).
// "openrouter" = any model via the OpenRouter gateway (OpenAI-compatible; one key
// fronts Anthropic/OpenAI/DeepSeek/etc. by slug). All coexist; "claude" stays the
// default.
export type Provider = "claude" | "anthropic" | "codex" | "deepseek" | "openrouter" | "custom";

export interface ModelConfig {
  provider: Provider;
  model: string;
  tier: "high" | "mid" | "low";
}

// Default model assignments per agent role (higher-tier for planning, lower for execution)
export const DEFAULT_MODEL_MAP: Record<AgentRole, ModelConfig> = {
  // Planning & research — Claude (higher reasoning)
  orchestrator:           { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  "tech-lead":            { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  "change-analyst":       { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  researcher:             { provider: "claude",   model: "claude-sonnet-4-6",     tier: "mid" },
  "product-manager":      { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  "brand-strategist":     { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  designer:               { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  "principal-engineer":   { provider: "claude",   model: "claude-opus-4-6",       tier: "high" },
  // Coding & execution — DeepSeek (fast, cheap, good at code)
  "frontend-dev":         { provider: "deepseek", model: "deepseek-coder",        tier: "low" },
  "backend-dev":          { provider: "deepseek", model: "deepseek-coder",        tier: "low" },
  "qa-engineer":          { provider: "deepseek", model: "deepseek-coder",        tier: "low" },
  "seo-specialist":       { provider: "claude",   model: "claude-sonnet-4-6",     tier: "mid" },
  devops:                 { provider: "deepseek", model: "deepseek-coder",        tier: "low" },
  "content-strategist":   { provider: "claude",   model: "claude-sonnet-4-6",     tier: "mid" },
  "social-media-manager": { provider: "claude",   model: "claude-sonnet-4-6",     tier: "mid" },
  "analytics-specialist": { provider: "claude",   model: "claude-sonnet-4-6",     tier: "mid" },
};

export interface SwarmConfig {
  models: Record<AgentRole, ModelConfig>;
  maxTurnsPerAgent: number;
  defaultProvider: Provider;
  projectType?: string; // explicit project-type override; auto-classified if unset
  repo?: string;        // GitHub repo to commit to (owner/repo, url, or bare name)
  repoProfile?: string; // credential profile name; default uses GITHUB_TOKEN/GH_TOKEN
  localOnly?: boolean;  // allow existing-project changes without a linked repo
}

export function createDefaultConfig(overrides?: Partial<SwarmConfig>): SwarmConfig {
  return {
    models: { ...DEFAULT_MODEL_MAP },
    maxTurnsPerAgent: 50,
    defaultProvider: "claude",
    ...overrides,
  };
}

export interface PhaseConfig {
  phase: Phase;
  agents: AgentRole[];
  parallel: boolean;
  isolate?: boolean;
  inputArtifacts: string[];
  outputArtifacts: string[];
  description: string;
}

export interface Artifact {
  name: string;
  path: string;
  createdBy: AgentRole;
  phase: Phase;
  timestamp: string;
}

export interface Doubt {
  agent: AgentRole;
  phase: Phase;
  question: string;
  context: string;
  resolution?: string;
  resolvedBy?: AgentRole | "human";   // who answered it
  timestamp: string;
}

// A human-input request. Raised when an agent hits something it genuinely
// cannot invent (a missing secret/credential, an external account/resource
// choice). The run pauses until the human answers or explicitly skips it.
export type QuestionKind = "secret" | "config" | "external" | "input";
export type QuestionStatus = "open" | "answered" | "skipped";

export interface PendingQuestion {
  id: string;
  project: string;
  runId?: string;
  agent: AgentRole;
  phase: Phase;
  kind: QuestionKind;
  question: string;
  context: string;
  envKey: string;           // for 'secret': the env var name the operator should set (never the value)
  suggestion: string;       // the lead's fallback, applied only if the human skips
  status: QuestionStatus;
  answer?: string;
  createdAt: string;
  resolvedAt?: string;
}

// One turn in a project's interactive chat (user asks/requests, swarm answers or
// acknowledges a launched change). Rendered alongside PendingQuestion in the
// Chat tab timeline.
export type ChatRole = "user" | "swarm";
export type ChatMessageKind = "message" | "answer" | "change" | "note" | "error";
export interface ChatMessage {
  id: string;
  project: string;
  runId?: string;
  role: ChatRole;
  kind: ChatMessageKind;
  text: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

// A revision the tech-lead wants from a specific agent before the phase passes.
export interface RevisionRequest {
  role: AgentRole;
  instructions: string;
}

// The tech-lead's verdict on a phase's output.
export interface PhaseReview {
  approved: boolean;
  score: number;            // 0..1 quality assessment
  summary: string;          // overall assessment
  revisions: RevisionRequest[]; // empty when approved
}

export interface SwarmState {
  projectName: string;
  runId: string;        // id of the run (work order) this state belongs to
  kind: string;         // intent of this run (new-build, feature, bugfix, ...)
  request: string;      // the run's request — the idea for new-build, the change for others
  idea: string;
  projectType: string; // which project-type flow this run uses (key in PROJECT_TYPES)
  workspaceDir: string; // absolute path to this project's workspace (for artifact reads)
  repoUrl?: string;     // GitHub repo this project commits to (html url), if any
  repoOwner?: string;
  repoName?: string;
  defaultBranch?: string;
  credentialProfile?: string;
  deployProvider?: string;  // '' | vercel | digitalocean | gcp | aws
  deployProfile?: string;   // deploy credential profile
  deployTarget?: Record<string, unknown>; // non-secret provider target config
  branch?: string;      // git branch for this work order (step 5)
  baseCommit?: string;  // commit this work order branched from (step 5)
  headCommit?: string;
  prUrl?: string;       // opened PR for this work order, if any (step 5)
  flow?: FlowStep[];    // the resolved, ordered steps this run executes
  plannerRationale?: string; // why the planner selected this route
  currentPhase: Phase;
  completedPhases: Phase[];
  completedAgents: Record<string, AgentRole[]>; // phase -> agents that succeeded
  artifacts: Artifact[];
  doubts: Doubt[];
  status: "running" | "paused" | "awaiting_input" | "completed" | "completed_with_issues" | "failed" | "stopped";
  startedAt: string;
  updatedAt: string;
  metrics: SwarmMetrics;
}

export interface SwarmMetrics {
  totalDurationMs: number;
  phaseDurations: Record<string, number>;
  agentDurations: Record<string, number>;
  agentRetries: Record<string, number>;
  totalAgentRuns: number;
  totalErrors: number;
  totalTokensSaved: number; // approx tokens kept out of context by output compression
  commandTimeouts?: number;
  evalFailures?: number;
  statePersistFailures?: number;
  agentStalls?: number;
}

// --- Logging ---

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory = "system" | "agent" | "phase" | "doubt" | "artifact" | "learning" | "error";

export interface LogEntry {
  id: string;
  runId?: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  agent?: AgentRole;
  phase?: Phase;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunLog {
  id: string;
  runId?: string;
  role: AgentRole;
  phase: Phase;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  promptSent: string;
  fullOutput: string;
  success: boolean;
  error?: string;
  artifactsCreated: string[];
  doubtsRaised: Doubt[];
  summary: string;
  tokensSaved?: number; // approx tokens saved by output compression in this run
}

// --- Auto-Learning ---

export interface Learning {
  id: string;
  projectName: string;
  timestamp: string;
  category: LearningCategory;
  insight: string;
  context: string;
  confidence: number; // 0-1
  appliedCount: number;
  source: AgentRole;
}

export type LearningCategory =
  | "tech-stack"
  | "architecture"
  | "design-pattern"
  | "bug-pattern"
  | "user-preference"
  | "process"
  | "performance"
  | "best-practice"
  | "anti-pattern"
  // A role-targeted improvement directive produced by the post-run retrospective.
  // For these, `source` holds the TARGET role (the agent whose next run should
  // apply the directive), so no schema change is needed to route it back.
  | "process-improvement";

export interface KnowledgeBase {
  learnings: Learning[];
  projectHistory: ProjectSummary[];
  updatedAt: string;
}

export interface ProjectSummary {
  projectName: string;
  idea: string;
  techStack: string[];
  completedAt: string;
  success: boolean;
  totalDurationMs: number;
  phases: number;
  artifacts: number;
  doubts: number;
  errors: number;
  learningsExtracted: number;
}

export interface AgentResult {
  role: AgentRole;
  phase: Phase;
  success: boolean;
  artifacts: string[];
  doubts: Doubt[];
  summary: string;
  error?: string;
  tokensSaved?: number; // approx tokens saved by output compression in this run
  commandTimeouts?: number;
  stallCount?: number;
}

export const PIPELINE: PhaseConfig[] = [
  {
    phase: "research",
    agents: ["researcher"],
    parallel: false,
    inputArtifacts: [],
    outputArtifacts: ["_artifacts/research/market-analysis.md", "_artifacts/research/competitor-analysis.md", "_artifacts/research/tech-landscape.md"],
    description: "Research the market, competitors, and technology landscape",
  },
  {
    phase: "product",
    agents: ["product-manager"],
    parallel: false,
    inputArtifacts: ["_artifacts/research/"],
    outputArtifacts: ["_artifacts/product/prd.md", "_artifacts/product/user-stories.md", "_artifacts/product/features.md"],
    description: "Define product requirements, user stories, and feature specs",
  },
  {
    phase: "branding",
    agents: ["brand-strategist"],
    parallel: false,
    inputArtifacts: ["_artifacts/research/", "_artifacts/product/"],
    outputArtifacts: ["_artifacts/branding/brand-identity.md", "_artifacts/branding/messaging-framework.md", "_artifacts/branding/visual-direction.md", "_artifacts/branding/brand-voice.md"],
    description: "Define brand identity, positioning, messaging, and visual direction",
  },
  {
    phase: "design",
    agents: ["designer"],
    parallel: false,
    inputArtifacts: ["_artifacts/research/", "_artifacts/product/", "_artifacts/branding/"],
    outputArtifacts: ["_artifacts/design/references.md", "_artifacts/design/design-system.md", "_artifacts/design/wireframes.md", "_artifacts/design/component-hierarchy.md"],
    description: "Research UX/competitor patterns, then create a design system, wireframes, and component hierarchy grounded in that research and the brand",
  },
  {
    phase: "architecture",
    agents: ["principal-engineer"],
    parallel: false,
    inputArtifacts: ["_artifacts/product/", "_artifacts/design/"],
    outputArtifacts: ["_artifacts/architecture/tech-stack.md", "_artifacts/architecture/system-design.md", "_artifacts/architecture/api-design.md", "_artifacts/architecture/folder-structure.md"],
    description: "Define tech stack, system architecture, and API design",
  },
  {
    phase: "development",
    agents: ["frontend-dev", "backend-dev"],
    parallel: true,
    isolate: true,
    inputArtifacts: ["_artifacts/product/", "_artifacts/design/", "_artifacts/architecture/"],
    outputArtifacts: ["app/"],
    description: "Build the application (frontend and backend in parallel)",
  },
  {
    phase: "qa",
    agents: ["qa-engineer"],
    parallel: false,
    inputArtifacts: ["_artifacts/product/", "app/"],
    outputArtifacts: ["_artifacts/qa/test-results.md", "_artifacts/qa/bug-reports.md", "_artifacts/qa/qa-report.json"],
    description: "Boot the app and test it end-to-end against every acceptance criterion; report real, evidence-backed results",
  },
  {
    phase: "seo",
    agents: ["seo-specialist"],
    parallel: false,
    inputArtifacts: ["_artifacts/product/", "_artifacts/branding/", "_artifacts/architecture/", "app/"],
    outputArtifacts: ["_artifacts/seo/technical-seo.md", "_artifacts/seo/keyword-strategy.md", "_artifacts/seo/on-page-seo.md", "_artifacts/seo/structured-data.md", "_artifacts/seo/aeo-geo-strategy.md", "_artifacts/seo/seo-implementation.md"],
    description: "Implement technical SEO, AEO/GEO strategy, keyword strategy, meta tags, structured data, and search optimization",
  },
  {
    phase: "deployment",
    agents: ["devops"],
    parallel: false,
    inputArtifacts: ["_artifacts/architecture/", "app/", "_artifacts/seo/"],
    outputArtifacts: ["devops/"],
    description: "Set up CI/CD, containerization, and deployment configs with SEO considerations",
  },
  {
    phase: "marketing",
    agents: ["content-strategist", "social-media-manager"],
    parallel: true,
    inputArtifacts: ["_artifacts/product/", "_artifacts/branding/", "_artifacts/seo/"],
    outputArtifacts: ["_artifacts/marketing/content-strategy.md", "_artifacts/marketing/blog-plan.md", "_artifacts/marketing/launch-copy.md", "_artifacts/marketing/social-media-strategy.md", "_artifacts/marketing/content-calendar.md", "_artifacts/marketing/platform-playbooks.md"],
    description: "Create content strategy, launch copy, social media strategy, and content calendar",
  },
  {
    phase: "analytics",
    agents: ["analytics-specialist"],
    parallel: false,
    inputArtifacts: ["_artifacts/product/", "_artifacts/seo/", "_artifacts/marketing/", "app/"],
    outputArtifacts: ["_artifacts/analytics/tracking-plan.md", "_artifacts/analytics/kpi-dashboard.md", "_artifacts/analytics/growth-metrics.md", "_artifacts/analytics/analytics-implementation.md"],
    description: "Define KPIs, set up analytics tracking, conversion funnels, and growth measurement",
  },
];

// --- Project types ---
// Not every flow is valid for every project. Each project type selects an
// ordered subset of phases from the library below. The full PIPELINE above is
// the canonical phase definitions; PHASE_LIBRARY indexes them by name.

// The scoping/triage phase. It is NOT part of PIPELINE (so greenfield new-build
// never runs it), but lives in PHASE_LIBRARY so change flows can reference it.
// It reads the existing project + change request and emits _artifacts/change/plan.json.
export const SCOPING_PHASE: PhaseConfig = {
  phase: "scoping",
  agents: ["change-analyst"],
  parallel: false,
  inputArtifacts: ["_artifacts/product/", "_artifacts/architecture/"],
  outputArtifacts: ["_artifacts/change/plan.json", "_artifacts/change/change-spec.md"],
  description: "Analyze the change request against the existing project and produce an incremental change plan",
};

export const PHASE_LIBRARY: Record<Phase, PhaseConfig> = {
  ...(Object.fromEntries(PIPELINE.map((p) => [p.phase, p])) as Record<Phase, PhaseConfig>),
  scoping: SCOPING_PHASE,
};

export interface ProjectType {
  key: string;
  label: string;
  description: string;   // also used to help the classifier pick
  phases: Phase[];       // ordered subset of phases this type runs
  phaseOverrides?: Partial<Record<Phase, Partial<Pick<FlowStep, "agents" | "parallel" | "isolate">>>>;
}

// Starter registry — extend freely by adding entries.
export const PROJECT_TYPES: Record<string, ProjectType> = {
  "web-app": {
    key: "web-app",
    label: "Web App (full stack)",
    description: "A full-stack web application with UI, backend, brand, SEO and growth. The complete flow.",
    phases: ["research", "product", "branding", "design", "architecture", "development", "qa", "seo", "deployment", "marketing", "analytics"],
  },
  "static-app": {
    key: "static-app",
    label: "Simple Static App",
    description: "A small client-side browser app, widget, prototype, or PWA with no backend and little need for brand/SEO/marketing. Use the leanest route.",
    phases: ["development", "qa"],
    phaseOverrides: {
      development: { agents: ["frontend-dev"], parallel: false, isolate: false },
    },
  },
  saas: {
    key: "saas",
    label: "SaaS Product",
    description: "A multi-tenant subscription web product. Full flow with strong product, architecture, growth and analytics.",
    phases: ["research", "product", "branding", "design", "architecture", "development", "qa", "seo", "deployment", "marketing", "analytics"],
  },
  "landing-page": {
    key: "landing-page",
    label: "Marketing Site / Landing Page",
    description: "A marketing website or landing page. Brand, design, SEO and content are central; backend is light.",
    phases: ["research", "product", "branding", "design", "development", "seo", "deployment", "marketing", "analytics"],
    phaseOverrides: {
      development: { agents: ["frontend-dev"], parallel: false },
    },
  },
  "mobile-app": {
    key: "mobile-app",
    label: "Mobile App",
    description: "A native or cross-platform mobile application. Brand, design and growth matter; no web SEO.",
    phases: ["research", "product", "branding", "design", "architecture", "development", "qa", "deployment", "marketing", "analytics"],
  },
  "api-service": {
    key: "api-service",
    label: "API / Backend Service",
    description: "A backend API, microservice or server with no user-facing UI. No branding/design/SEO/marketing.",
    phases: ["research", "product", "architecture", "development", "qa", "deployment"],
    phaseOverrides: {
      development: { agents: ["backend-dev"], parallel: false },
    },
  },
  "cli-tool": {
    key: "cli-tool",
    label: "CLI Tool",
    description: "A command-line tool or utility run in a terminal. Lean engineering flow, no UI/brand/marketing.",
    phases: ["research", "product", "architecture", "development", "qa", "deployment"],
    phaseOverrides: {
      development: { agents: ["backend-dev"], parallel: false },
    },
  },
  library: {
    key: "library",
    label: "Library / Package / SDK",
    description: "A reusable code library, package or SDK consumed by other developers. No deployment/marketing.",
    phases: ["research", "product", "architecture", "development", "qa"],
    phaseOverrides: {
      development: { agents: ["backend-dev"], parallel: false },
    },
  },
  "dev-tool": {
    key: "dev-tool",
    label: "Developer Tool / Harness / Framework",
    description: "Developer infrastructure: a harness, framework, build tool, agent system or internal platform.",
    phases: ["research", "product", "architecture", "development", "qa", "deployment"],
    phaseOverrides: {
      development: { agents: ["backend-dev"], parallel: false },
    },
  },
  "data-ml": {
    key: "data-ml",
    label: "Data / ML Project",
    description: "A data pipeline, analytics system, or machine-learning project. Engineering + data focus, no brand/marketing.",
    phases: ["research", "product", "architecture", "development", "qa", "deployment"],
    phaseOverrides: {
      development: { agents: ["backend-dev"], parallel: false },
    },
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise Application",
    description: "A large internal/enterprise application with rigorous product, architecture, QA and operations. Light external marketing.",
    phases: ["research", "product", "design", "architecture", "development", "qa", "deployment", "analytics"],
  },
};

export const DEFAULT_PROJECT_TYPE = "web-app";

// --- Flows & Intents (the change-request harness) ---
// A flow is an ordered list of phase steps; an intent maps a kind of work to a
// flow + git strategy. resolveFlow() intersects a flow with the project type's
// allowed phases so, e.g., a feature on an api-service never runs design/seo.

export type PhaseMode = "greenfield" | "incremental";

export interface FlowStep {
  phase: Phase;
  mode: PhaseMode;
  agents?: AgentRole[];   // override the phase's default agents
  parallel?: boolean;     // override the phase's default parallelism
  isolate?: boolean;      // override worktree isolation for this step
  optional?: boolean;     // a scoping step (step 4) may prune this
  requires?: string;      // tag gate produced by scoping (step 4)
  agentProposed?: boolean; // true when inserted via propose_step
  stepKind?: "phase" | "task" | "spike";
}

export interface Flow {
  key: string;
  label: string;
  steps: FlowStep[];      // canonical order; intersected with the project type at resolve time
}

// Greenfield: every phase, build-from-scratch. Intersected with a project type
// this reproduces the legacy full pipeline exactly.
const GREENFIELD_STEPS: FlowStep[] = PIPELINE.map((p) => ({ phase: p.phase, mode: "greenfield" as PhaseMode }));

export const FLOWS: Record<string, Flow> = {
  "new-build": { key: "new-build", label: "Full greenfield build", steps: GREENFIELD_STEPS },

  // Incremental flows start with a `scoping` step (triage) that emits a change
  // plan; the orchestrator then prunes the remaining steps from that plan.
  feature: {
    key: "feature", label: "Feature addition",
    steps: [
      { phase: "scoping", mode: "incremental" },
      { phase: "product", mode: "incremental" },
      { phase: "design", mode: "incremental", optional: true, requires: "ui-change" },
      { phase: "development", mode: "incremental" },
      { phase: "qa", mode: "incremental" },
    ],
  },
  bugfix: {
    key: "bugfix", label: "Bug fix",
    steps: [
      { phase: "scoping", mode: "incremental" },
      { phase: "development", mode: "incremental" },
      { phase: "qa", mode: "incremental" },
    ],
  },
  refactor: {
    key: "refactor", label: "Refactor / cleanup",
    steps: [
      { phase: "scoping", mode: "incremental" },
      { phase: "architecture", mode: "incremental", optional: true, requires: "arch-change" },
      { phase: "development", mode: "incremental" },
      { phase: "qa", mode: "incremental" },
    ],
  },
  seo: {
    key: "seo", label: "SEO / AEO / GEO optimization",
    steps: [
      { phase: "scoping", mode: "incremental" },
      { phase: "seo", mode: "incremental" },
      { phase: "development", mode: "incremental", optional: true, requires: "code-change" },
      { phase: "qa", mode: "incremental" },
    ],
  },
  marketing: {
    key: "marketing", label: "Marketing / social media",
    steps: [
      { phase: "scoping", mode: "incremental" },
      { phase: "marketing", mode: "incremental" },
      { phase: "seo", mode: "incremental", optional: true, requires: "seo-change" },
      { phase: "development", mode: "incremental", optional: true, requires: "code-change" },
      { phase: "qa", mode: "incremental", optional: true, requires: "code-change" },
    ],
  },
};

export type GitStrategy = "branch-pr" | "commit-main" | "none";

export interface IntentDef {
  key: string;
  label: string;
  description: string;  // used by the intent classifier (step 6)
  flow: string;         // FLOWS key
  git: GitStrategy;     // default git strategy for runs of this intent
}

export const INTENTS: Record<string, IntentDef> = {
  "new-build": { key: "new-build", label: "New build", description: "Build a brand-new project from an idea.", flow: "new-build", git: "commit-main" },
  feature:     { key: "feature", label: "Feature addition", description: "Add a new capability or feature to an existing project.", flow: "feature", git: "branch-pr" },
  bugfix:      { key: "bugfix", label: "Bug fix", description: "Fix a defect or incorrect behavior in an existing project.", flow: "bugfix", git: "branch-pr" },
  refactor:    { key: "refactor", label: "Refactor / cleanup", description: "Restructure or clean up existing code without changing behavior.", flow: "refactor", git: "branch-pr" },
  seo:         { key: "seo", label: "SEO / AEO / GEO", description: "Improve search, answer-engine, and generative-engine optimization for an existing project.", flow: "seo", git: "branch-pr" },
  marketing:   { key: "marketing", label: "Marketing / social media", description: "Create or update launch copy, content strategy, content calendar, platform playbooks, and social media assets for an existing project.", flow: "marketing", git: "branch-pr" },
};

export const DEFAULT_INTENT = "new-build";

// Phases that always run when a flow includes them, regardless of project type
// (meta/triage phases that aren't part of any project type's phase list).
const META_PHASES = new Set<Phase>(["scoping"]);

// Resolve the concrete, ordered steps to run for a (project type, intent): the
// intent's flow restricted to the phases the project type actually uses (meta
// phases like scoping always survive).
export function resolveFlow(projectTypeKey: string, intentKey: string): FlowStep[] {
  const intent = INTENTS[intentKey] || INTENTS[DEFAULT_INTENT];
  const flow = FLOWS[intent.flow] || FLOWS[INTENTS[DEFAULT_INTENT].flow];
  const type = PROJECT_TYPES[projectTypeKey] || PROJECT_TYPES[DEFAULT_PROJECT_TYPE];
  const allowed = new Set<Phase>(type.phases);
  return flow.steps
    .filter((s) => Boolean(PHASE_LIBRARY[s.phase]) && (META_PHASES.has(s.phase) || allowed.has(s.phase)))
    .map((s) => ({ ...s, ...(type.phaseOverrides?.[s.phase] || {}) }));
}

// Incremental change routes must begin with scoping so change-analyst can emit
// plan.json and pruneFlow() can trim optional steps before execution.
export function ensureChangeScoping(steps: FlowStep[]): FlowStep[] {
  if (steps.some((s) => s.phase === "scoping")) return steps;
  return [{ phase: "scoping", mode: "incremental" }, ...steps];
}

// The scoping agent's output: which phases the change actually needs and why.
export interface ChangePlan {
  summary?: string;
  affectedAreas?: string[];   // e.g. frontend, backend, api, database, design, infra
  affectedFiles?: string[];   // workspace-relative paths the change touches
  tags?: string[];            // gate optional steps, e.g. ui-change, schema-change, arch-change
  phasesNeeded?: Phase[];     // the subset of flow phases this change requires
  acceptanceCriteria?: string[];
}

// Prune a resolved flow using the scoping plan. Drops the scoping step itself
// (it has already run), restricts to phasesNeeded when given, and gates optional
// steps on their required tag. With no plan, runs the required (non-optional)
// steps only.
export function pruneFlow(steps: FlowStep[], plan?: ChangePlan | null): FlowStep[] {
  const needed = plan?.phasesNeeded?.length ? new Set<Phase>(plan.phasesNeeded) : null;
  const tags = new Set<string>(plan?.tags || []);
  return steps.filter((s) => {
    if (s.phase === "scoping") return false;
    if (needed) return needed.has(s.phase);
    if (s.optional && s.requires) return tags.has(s.requires);
    return true;
  });
}

// The effective PhaseConfig for a flow step (phase defaults + step overrides).
export function stepToPhaseConfig(step: FlowStep): PhaseConfig {
  const base = PHASE_LIBRARY[step.phase];
  return {
    ...base,
    agents: step.agents ?? base.agents,
    parallel: step.parallel ?? base.parallel,
    isolate: step.isolate ?? base.isolate,
  };
}

// Back-compat: the greenfield pipeline (PhaseConfig[]) for a project type.
export function getPipeline(typeKey: string): PhaseConfig[] {
  return resolveFlow(typeKey, "new-build").map(stepToPhaseConfig);
}
