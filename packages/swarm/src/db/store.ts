import { eq, ne, and, or, desc, asc, isNull, inArray } from "drizzle-orm";
import { db } from "./client.js";
import { projects, runs, logs, agentRuns, learnings, projectHistory, evals, commits, deployments, prompts, questions, chatMessages, notifications } from "./schema.js";
import type { EvalCheck } from "./schema.js";
import { isArtifactPathAllowed } from "../utils/artifacts.js";
import type {
  SwarmState, LogEntry, AgentRunLog, Learning, ProjectSummary, FlowStep, PendingQuestion, ChatMessage,
} from "../types.js";

// ── Mappers ──────────────────────────────────────────────────────────────

type ProjectRow = typeof projects.$inferSelect;

function repoParts(repoUrl?: string | null): { owner?: string; name?: string } {
  const match = String(repoUrl || "").match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
  return match ? { owner: match[1], name: match[2].replace(/\.git$/, "") } : {};
}

function rowToState(r: ProjectRow): SwarmState {
  const parsedRepo = repoParts(r.repoUrl);
  return {
    projectName: r.name,
    runId: r.latestRunId || "",
    kind: r.kind,
    request: r.request,
    idea: r.idea,
    projectType: r.projectType,
    workspaceDir: r.workspaceDir,
    repoUrl: r.repoUrl || undefined,
    repoOwner: r.repoOwner || parsedRepo.owner,
    repoName: r.repoName || parsedRepo.name,
    defaultBranch: r.defaultBranch || undefined,
    credentialProfile: r.credentialProfile || undefined,
    deployProvider: r.deployProvider || undefined,
    deployProfile: r.deployProfile || undefined,
    deployTarget: r.deployTarget || undefined,
    currentPhase: r.currentPhase!,
    completedPhases: r.completedPhases,
    completedAgents: r.completedAgents,
    artifacts: r.artifacts,
    doubts: r.doubts,
    status: r.status as SwarmState["status"],
    startedAt: r.startedAt ? r.startedAt.toISOString() : "",
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : "",
    metrics: r.metrics,
  };
}

function filteredArtifacts(state: SwarmState): SwarmState["artifacts"] {
  return (state.artifacts || []).filter((artifact) => isArtifactPathAllowed(artifact.path));
}

// ── Projects / state ─────────────────────────────────────────────────────

export async function upsertProject(state: SwarmState): Promise<void> {
  const parsedRepo = repoParts(state.repoUrl);
  const values = {
    name: state.projectName,
    idea: state.idea,
    projectType: state.projectType || "web-app",
    workspaceDir: state.workspaceDir || "",
    repoUrl: state.repoUrl || "",
    repoOwner: state.repoOwner || parsedRepo.owner || "",
    repoName: state.repoName || parsedRepo.name || "",
    defaultBranch: state.defaultBranch || "main",
    credentialProfile: state.credentialProfile || "default",
    latestRunId: state.runId || null,
    kind: state.kind || "new-build",
    request: state.request || "",
    status: state.status,
    currentPhase: state.currentPhase,
    completedPhases: state.completedPhases,
    completedAgents: state.completedAgents,
    artifacts: filteredArtifacts(state),
    doubts: state.doubts,
    metrics: state.metrics,
    startedAt: state.startedAt ? new Date(state.startedAt) : null,
    updatedAt: new Date(),
  };
  await db.insert(projects).values(values).onConflictDoUpdate({
    target: projects.name,
    set: {
      idea: values.idea,
      projectType: values.projectType,
      workspaceDir: values.workspaceDir,
      repoUrl: values.repoUrl,
      repoOwner: values.repoOwner,
      repoName: values.repoName,
      defaultBranch: values.defaultBranch,
      credentialProfile: values.credentialProfile,
      latestRunId: values.latestRunId,
      kind: values.kind,
      request: values.request,
      status: values.status,
      currentPhase: values.currentPhase,
      completedPhases: values.completedPhases,
      completedAgents: values.completedAgents,
      artifacts: values.artifacts,
      doubts: values.doubts,
      metrics: values.metrics,
      startedAt: values.startedAt,
      updatedAt: values.updatedAt,
    },
  });
}

export async function getProject(name: string): Promise<SwarmState | null> {
  const rows = await db.select().from(projects).where(eq(projects.name, name)).limit(1);
  return rows[0] ? rowToState(rows[0]) : null;
}

export async function listProjects(): Promise<Array<{ name: string; state: SwarmState }>> {
  const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  return rows.map((r) => ({ name: r.name, state: rowToState(r) }));
}

// ── Runs (work orders) ─────────────────────────────────────────────────────

export async function updateProjectGitBinding(projectName: string, binding: {
  repoUrl?: string;
  repoOwner?: string;
  repoName?: string;
  defaultBranch?: string;
  credentialProfile?: string;
}): Promise<void> {
  const parsedRepo = repoParts(binding.repoUrl);
  await db.update(projects).set({
    repoUrl: binding.repoUrl || "",
    repoOwner: binding.repoOwner || parsedRepo.owner || "",
    repoName: binding.repoName || parsedRepo.name || "",
    defaultBranch: binding.defaultBranch || "main",
    credentialProfile: binding.credentialProfile || "default",
    updatedAt: new Date(),
  }).where(eq(projects.name, projectName));
}

export async function updateProjectDeployBinding(projectName: string, binding: {
  provider?: string;
  profile?: string;
  target?: Record<string, unknown>;
}): Promise<void> {
  await db.update(projects).set({
    deployProvider: binding.provider || "",
    deployProfile: binding.profile || "default",
    deployTarget: binding.target || {},
    updatedAt: new Date(),
  }).where(eq(projects.name, projectName));
}

export interface DeploymentRecord {
  id: string;
  project: string;
  runId?: string;
  provider: string;
  profile: string;
  status: "success" | "failed";
  url?: string;
  logsUrl?: string;
  detail?: string;
  commitSha?: string;
  createdAt?: string;
}

export async function insertDeployment(d: DeploymentRecord): Promise<void> {
  await db.insert(deployments).values({
    id: d.id,
    project: d.project,
    runId: d.runId ?? null,
    provider: d.provider,
    profile: d.profile || "default",
    status: d.status,
    url: d.url ?? null,
    logsUrl: d.logsUrl ?? null,
    detail: d.detail ?? null,
    commitSha: d.commitSha ?? null,
  });
}

export async function getDeployments(project: string, limit = 50): Promise<DeploymentRecord[]> {
  const rows = await db.select().from(deployments)
    .where(eq(deployments.project, project))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    runId: r.runId ?? undefined,
    provider: r.provider,
    profile: r.profile,
    status: r.status as "success" | "failed",
    url: r.url ?? undefined,
    logsUrl: r.logsUrl ?? undefined,
    detail: r.detail ?? undefined,
    commitSha: r.commitSha ?? undefined,
    createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
  }));
}

export async function getLatestDeployment(project: string): Promise<DeploymentRecord | null> {
  const rows = await getDeployments(project, 1);
  return rows[0] || null;
}

type RunRow = typeof runs.$inferSelect;

function runRowToState(r: RunRow): SwarmState {
  return {
    projectName: r.project,
    runId: r.id,
    kind: r.kind,
    request: r.request,
    idea: r.request, // for new-build the request IS the idea; orchestrator overrides as needed
    projectType: "", // project-level; filled by the caller from the project row
    workspaceDir: "", // filled by the caller
    flow: (r.flow as unknown as FlowStep[]) ?? [],
    branch: r.branch || undefined,
    baseCommit: r.baseCommit || undefined,
    headCommit: r.headCommit || undefined,
    prUrl: r.prUrl || undefined,
    currentPhase: r.currentPhase!,
    completedPhases: r.completedPhases,
    completedAgents: r.completedAgents,
    artifacts: r.artifacts,
    doubts: r.doubts,
    status: r.status as SwarmState["status"],
    startedAt: r.startedAt ? r.startedAt.toISOString() : "",
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : "",
    metrics: r.metrics,
  };
}

// Create or update the run row for the current work order (keyed by runId).
export async function upsertRun(state: SwarmState): Promise<void> {
  if (!state.runId) return; // no run established yet
  const values = {
    id: state.runId,
    project: state.projectName,
    kind: state.kind || "new-build",
    request: state.request || state.idea || "",
    flow: (state.flow as unknown[]) ?? [],
    status: state.status,
    currentPhase: state.currentPhase,
    completedPhases: state.completedPhases,
    completedAgents: state.completedAgents,
    artifacts: filteredArtifacts(state),
    doubts: state.doubts,
    metrics: state.metrics,
    branch: state.branch ?? null,
    baseCommit: state.baseCommit ?? null,
    headCommit: state.headCommit ?? null,
    prUrl: state.prUrl ?? null,
    startedAt: state.startedAt ? new Date(state.startedAt) : null,
    updatedAt: new Date(),
  };
  await db.insert(runs).values(values).onConflictDoUpdate({
    target: runs.id,
    set: {
      kind: values.kind,
      request: values.request,
      flow: values.flow,
      status: values.status,
      currentPhase: values.currentPhase,
      completedPhases: values.completedPhases,
      completedAgents: values.completedAgents,
      artifacts: values.artifacts,
      doubts: values.doubts,
      metrics: values.metrics,
      branch: values.branch,
      baseCommit: values.baseCommit,
      headCommit: values.headCommit,
      prUrl: values.prUrl,
      startedAt: values.startedAt,
      updatedAt: values.updatedAt,
    },
  });
}

export async function getRun(id: string): Promise<SwarmState | null> {
  const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  return rows[0] ? runRowToState(rows[0]) : null;
}

// The most recently updated run for a project (the one to resume), if any.
export async function getLatestRun(project: string): Promise<SwarmState | null> {
  const rows = await db.select().from(runs)
    .where(eq(runs.project, project))
    .orderBy(desc(runs.updatedAt))
    .limit(1);
  return rows[0] ? runRowToState(rows[0]) : null;
}

export async function listRuns(project: string): Promise<SwarmState[]> {
  const rows = await db.select().from(runs)
    .where(eq(runs.project, project))
    .orderBy(desc(runs.updatedAt));
  return rows.map(runRowToState);
}

// Idempotent backfill: give every legacy project (one with no latestRunId) a
// `new-build` run derived from its snapshot, point the project at it, and stamp
// existing child rows with that runId. Safe to run on every startup.
export async function backfillRuns(): Promise<void> {
  const rows = await db.select().from(projects).where(isNull(projects.latestRunId));
  for (const pr of rows) {
    const runId = crypto.randomUUID();
    await db.insert(runs).values({
      id: runId,
      project: pr.name,
      kind: "new-build",
      request: pr.idea,
      status: pr.status,
      currentPhase: pr.currentPhase,
      completedPhases: pr.completedPhases,
      completedAgents: pr.completedAgents,
      artifacts: pr.artifacts,
      doubts: pr.doubts,
      metrics: pr.metrics,
      startedAt: pr.startedAt,
      updatedAt: pr.updatedAt,
    }).onConflictDoNothing();
    await db.update(projects).set({ latestRunId: runId, kind: "new-build", request: pr.idea }).where(eq(projects.name, pr.name));
    await db.update(logs).set({ runId }).where(and(eq(logs.project, pr.name), isNull(logs.runId)));
    await db.update(agentRuns).set({ runId }).where(and(eq(agentRuns.project, pr.name), isNull(agentRuns.runId)));
    await db.update(evals).set({ runId }).where(and(eq(evals.project, pr.name), isNull(evals.runId)));
    await db.update(commits).set({ runId }).where(and(eq(commits.project, pr.name), isNull(commits.runId)));
  }
}

// ── Logs / activity ──────────────────────────────────────────────────────

export async function insertLogs(project: string, entries: LogEntry[], runId?: string): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(logs).values(entries.map((e) => ({
    id: e.id,
    project,
    runId: runId ?? null,
    ts: new Date(e.timestamp),
    level: e.level,
    category: e.category,
    message: e.message,
    agent: e.agent ?? null,
    phase: e.phase ?? null,
    metadata: e.metadata ?? null,
  })));
}

export async function getLogs(project: string, limit = 1000, runId?: string): Promise<LogEntry[]> {
  const rows = await db.select().from(logs)
    .where(runId ? and(eq(logs.project, project), eq(logs.runId, runId)) : eq(logs.project, project))
    .orderBy(desc(logs.ts))
    .limit(limit);
  return rows.map(rowToLog);
}

export async function getActivity(project: string, limit = 30): Promise<LogEntry[]> {
  // Most recent non-debug entries, returned chronologically (UI reverses).
  const rows = await db.select().from(logs)
    .where(and(eq(logs.project, project), ne(logs.level, "debug")))
    .orderBy(desc(logs.ts))
    .limit(limit);
  return rows.reverse().map(rowToLog);
}

function rowToLog(r: typeof logs.$inferSelect): LogEntry {
  return {
    id: r.id,
    runId: r.runId ?? undefined,
    timestamp: r.ts.toISOString(),
    level: r.level,
    category: r.category,
    message: r.message,
    agent: r.agent ?? undefined,
    phase: r.phase ?? undefined,
    metadata: r.metadata ?? undefined,
  };
}

// ── Agent runs ───────────────────────────────────────────────────────────

export async function insertAgentRun(project: string, run: AgentRunLog, runId?: string): Promise<void> {
  await db.insert(agentRuns).values({
    id: run.id,
    project,
    runId: runId ?? null,
    role: run.role,
    phase: run.phase,
    startedAt: run.startedAt ? new Date(run.startedAt) : null,
    completedAt: run.completedAt ? new Date(run.completedAt) : null,
    durationMs: run.durationMs,
    promptSent: run.promptSent,
    fullOutput: run.fullOutput,
    success: run.success,
    error: run.error ?? null,
    artifactsCreated: (run.artifactsCreated || []).filter(isArtifactPathAllowed),
    doubtsRaised: run.doubtsRaised,
    summary: run.summary,
    tokensSaved: run.tokensSaved ?? 0,
  });
}

export async function getAgentRuns(project: string, runId?: string): Promise<AgentRunLog[]> {
  const rows = await db.select().from(agentRuns)
    .where(runId ? and(eq(agentRuns.project, project), eq(agentRuns.runId, runId)) : eq(agentRuns.project, project))
    .orderBy(asc(agentRuns.startedAt));
  return rows.map((r) => ({
    id: r.id,
    runId: r.runId ?? undefined,
    role: r.role,
    phase: r.phase,
    startedAt: r.startedAt ? r.startedAt.toISOString() : "",
    completedAt: r.completedAt ? r.completedAt.toISOString() : "",
    durationMs: r.durationMs ?? 0,
    promptSent: r.promptSent ?? "",
    fullOutput: r.fullOutput ?? "",
    success: r.success ?? false,
    error: r.error ?? undefined,
    artifactsCreated: r.artifactsCreated,
    doubtsRaised: r.doubtsRaised,
    summary: r.summary ?? "",
    tokensSaved: r.tokensSaved,
  }));
}

// ── Learnings / knowledge base (global) ──────────────────────────────────

export async function getAllLearnings(): Promise<Learning[]> {
  const rows = await db.select().from(learnings);
  return rows.map((r) => ({
    id: r.id,
    projectName: r.projectName ?? "",
    timestamp: r.createdAt.toISOString(),
    category: r.category as Learning["category"],
    insight: r.insight,
    context: r.context ?? "",
    confidence: r.confidence,
    appliedCount: r.appliedCount,
    source: r.source as Learning["source"],
  }));
}

export async function upsertLearning(l: Learning): Promise<void> {
  await db.insert(learnings).values({
    id: l.id,
    category: l.category,
    insight: l.insight,
    context: l.context,
    confidence: l.confidence,
    appliedCount: l.appliedCount,
    source: l.source,
    projectName: l.projectName,
    createdAt: l.timestamp ? new Date(l.timestamp) : new Date(),
  }).onConflictDoUpdate({
    target: learnings.id,
    set: { confidence: l.confidence, appliedCount: l.appliedCount, insight: l.insight, context: l.context },
  });
}

export async function getAllProjectHistory(): Promise<ProjectSummary[]> {
  const rows = await db.select().from(projectHistory).orderBy(asc(projectHistory.createdAt));
  return rows.map((r) => ({
    projectName: r.projectName,
    idea: r.idea ?? "",
    techStack: r.techStack,
    completedAt: r.completedAt ? r.completedAt.toISOString() : r.createdAt.toISOString(),
    success: r.success ?? false,
    totalDurationMs: r.totalDurationMs ?? 0,
    phases: r.phases ?? 0,
    artifacts: r.artifacts ?? 0,
    doubts: r.doubts ?? 0,
    errors: r.errors ?? 0,
    learningsExtracted: r.learningsExtracted ?? 0,
  }));
}

export async function insertProjectSummary(s: ProjectSummary): Promise<void> {
  await db.insert(projectHistory).values({
    id: `${s.projectName}-${Date.now()}`,
    projectName: s.projectName,
    idea: s.idea,
    techStack: s.techStack,
    success: s.success,
    phases: s.phases,
    artifacts: s.artifacts,
    doubts: s.doubts,
    errors: s.errors,
    learningsExtracted: s.learningsExtracted,
    totalDurationMs: s.totalDurationMs,
    completedAt: s.completedAt ? new Date(s.completedAt) : new Date(),
  });
}

// ── Evals ────────────────────────────────────────────────────────────────

export interface EvalResult {
  id: string;
  project: string;
  runId?: string;
  createdAt: string;
  overallScore: number;
  passed: boolean;
  checks: EvalCheck[];
}

export async function insertEval(e: EvalResult): Promise<void> {
  await db.insert(evals).values({
    id: e.id,
    project: e.project,
    runId: e.runId ?? null,
    overallScore: e.overallScore,
    passed: e.passed,
    checks: e.checks,
    createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
  });
}

export async function getEvals(project: string, runId?: string): Promise<EvalResult[]> {
  const rows = await db.select().from(evals)
    .where(runId ? and(eq(evals.project, project), eq(evals.runId, runId)) : eq(evals.project, project))
    .orderBy(desc(evals.createdAt));
  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    runId: r.runId ?? undefined,
    createdAt: r.createdAt.toISOString(),
    overallScore: r.overallScore,
    passed: r.passed,
    checks: r.checks,
  }));
}

export async function getAllEvals(): Promise<EvalResult[]> {
  const rows = await db.select().from(evals).orderBy(desc(evals.createdAt)).limit(200);
  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    createdAt: r.createdAt.toISOString(),
    overallScore: r.overallScore,
    passed: r.passed,
    checks: r.checks,
  }));
}

// ── Commits ──────────────────────────────────────────────────────────────

export interface CommitRecord {
  project: string;
  runId?: string;
  phase: string | null;
  sha: string;
  message: string;
  files: number;
  htmlUrl: string | null;
}

export async function insertCommit(c: CommitRecord): Promise<void> {
  await db.insert(commits).values({
    id: crypto.randomUUID(),
    project: c.project,
    runId: c.runId ?? null,
    phase: c.phase,
    sha: c.sha,
    message: c.message,
    files: c.files,
    htmlUrl: c.htmlUrl,
  });
}

export async function getCommits(project: string, runId?: string): Promise<Array<CommitRecord & { createdAt: string }>> {
  const rows = await db.select().from(commits)
    .where(runId ? and(eq(commits.project, project), eq(commits.runId, runId)) : eq(commits.project, project))
    .orderBy(desc(commits.createdAt));
  return rows.map((r) => ({
    project: r.project,
    runId: r.runId ?? undefined,
    phase: r.phase,
    sha: r.sha,
    message: r.message,
    files: r.files,
    htmlUrl: r.htmlUrl,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── Prompt overrides (configurable prompts) ────────────────────────────────

export type PromptScope = "global" | "project";

export interface PromptOverride {
  scope: PromptScope;
  projectName: string; // "" for global
  key: string;
  content: string;
  updatedAt: string;
}

// Fetch the override rows relevant to a run: all global rows, plus this
// project's rows when a project name is given. PromptStore layers them.
export async function getPromptOverrides(projectName?: string): Promise<PromptOverride[]> {
  const rows = projectName
    ? await db.select().from(prompts).where(
        or(eq(prompts.scope, "global"), and(eq(prompts.scope, "project"), eq(prompts.projectName, projectName))),
      )
    : await db.select().from(prompts).where(eq(prompts.scope, "global"));
  return rows.map((r) => ({
    scope: r.scope as PromptScope,
    projectName: r.projectName,
    key: r.key,
    content: r.content,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// Create or replace a single prompt override (keyed by scope+project+key).
export async function upsertPrompt(p: { scope: PromptScope; projectName?: string; key: string; content: string }): Promise<void> {
  const projectName = p.scope === "project" ? (p.projectName || "") : "";
  await db.insert(prompts).values({
    id: crypto.randomUUID(),
    scope: p.scope,
    projectName,
    key: p.key,
    content: p.content,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [prompts.scope, prompts.projectName, prompts.key],
    set: { content: p.content, updatedAt: new Date() },
  });
}

// Remove an override (reverts that key to the next layer / code default).
export async function deletePrompt(p: { scope: PromptScope; projectName?: string; key: string }): Promise<void> {
  const projectName = p.scope === "project" ? (p.projectName || "") : "";
  await db.delete(prompts).where(
    and(eq(prompts.scope, p.scope), eq(prompts.projectName, projectName), eq(prompts.key, p.key)),
  );
}

// ── Human-input questions ──────────────────────────────────────────────────

type QuestionRow = typeof questions.$inferSelect;

function rowToQuestion(r: QuestionRow): PendingQuestion {
  return {
    id: r.id,
    project: r.project,
    runId: r.runId || undefined,
    agent: r.agent,
    phase: r.phase,
    kind: r.kind as PendingQuestion["kind"],
    question: r.question,
    context: r.context,
    envKey: r.envKey,
    suggestion: r.suggestion,
    status: r.status as PendingQuestion["status"],
    answer: r.answer || undefined,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : undefined,
  };
}

export async function insertQuestion(q: {
  id: string; project: string; runId?: string; agent: string; phase: string;
  kind: string; question: string; context?: string; envKey?: string; suggestion?: string;
}): Promise<void> {
  await db.insert(questions).values({
    id: q.id, project: q.project, runId: q.runId ?? null,
    agent: q.agent as QuestionRow["agent"], phase: q.phase as QuestionRow["phase"],
    kind: q.kind, question: q.question, context: q.context ?? "",
    envKey: q.envKey ?? "", suggestion: q.suggestion ?? "",
    status: "open",
  });
}

export async function getQuestion(id: string): Promise<PendingQuestion | null> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  return row ? rowToQuestion(row) : null;
}

// Open questions, optionally scoped to a project (newest first).
export async function getOpenQuestions(project?: string): Promise<PendingQuestion[]> {
  const where = project
    ? and(eq(questions.status, "open"), eq(questions.project, project))
    : eq(questions.status, "open");
  const rows = await db.select().from(questions).where(where).orderBy(desc(questions.createdAt));
  return rows.map(rowToQuestion);
}

// All questions for a project (any status), newest first — for run history/review.
export async function getQuestions(project: string): Promise<PendingQuestion[]> {
  const rows = await db.select().from(questions)
    .where(eq(questions.project, project)).orderBy(desc(questions.createdAt));
  return rows.map(rowToQuestion);
}

// ── Interactive project chat ───────────────────────────────────────────────

type ChatRow = typeof chatMessages.$inferSelect;

function rowToChatMessage(r: ChatRow): ChatMessage {
  return {
    id: r.id,
    project: r.project,
    runId: r.runId || undefined,
    role: r.role as ChatMessage["role"],
    kind: r.kind as ChatMessage["kind"],
    text: r.text,
    meta: (r.meta as Record<string, unknown>) || {},
    createdAt: (r.createdAt ?? new Date()).toISOString(),
  };
}

export async function addChatMessage(m: {
  id: string; project: string; role: ChatMessage["role"]; kind?: ChatMessage["kind"];
  text: string; runId?: string; meta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(chatMessages).values({
    id: m.id, project: m.project, role: m.role, kind: m.kind ?? "message",
    text: m.text, runId: m.runId ?? null, meta: m.meta ?? {},
  });
}

// All chat turns for a project, oldest first (chronological timeline).
export async function getChatMessages(project: string): Promise<ChatMessage[]> {
  const rows = await db.select().from(chatMessages)
    .where(eq(chatMessages.project, project)).orderBy(asc(chatMessages.createdAt));
  return rows.map(rowToChatMessage);
}

export interface NotificationRecord {
  id: string;
  project: string;
  runId?: string;
  kind: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

export async function createNotification(input: Omit<NotificationRecord, "id" | "readAt" | "createdAt">): Promise<NotificationRecord> {
  const [row] = await db.insert(notifications).values({
    id: crypto.randomUUID(),
    project: input.project,
    runId: input.runId ?? null,
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    message: input.message,
    metadata: input.metadata,
  }).returning();
  if (!row) throw new Error("Failed to create notification");
  return {
    id: row.id,
    project: row.project,
    runId: row.runId ?? undefined,
    kind: row.kind,
    severity: row.severity as NotificationRecord["severity"],
    title: row.title,
    message: row.message,
    metadata: row.metadata as Record<string, unknown>,
    readAt: row.readAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(options: { project?: string; unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRecord[]> {
  const filters = [
    options.project ? eq(notifications.project, options.project) : undefined,
    options.unreadOnly ? isNull(notifications.readAt) : undefined,
  ].filter((value): value is Exclude<typeof value, undefined> => Boolean(value));
  const rows = await db.select().from(notifications)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(options.limit || 50, 1), 100));
  return rows.map((row) => ({
    id: row.id,
    project: row.project,
    runId: row.runId ?? undefined,
    kind: row.kind,
    severity: row.severity as NotificationRecord["severity"],
    title: row.title,
    message: row.message,
    metadata: row.metadata as Record<string, unknown>,
    readAt: row.readAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markNotificationsRead(ids?: string[], project?: string): Promise<number> {
  const filters = [
    isNull(notifications.readAt),
    project ? eq(notifications.project, project) : undefined,
    ids?.length ? inArray(notifications.id, ids.slice(0, 100)) : undefined,
  ].filter((value): value is Exclude<typeof value, undefined> => Boolean(value));
  const rows = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(...filters))
    .returning({ id: notifications.id });
  return rows.length;
}

// Answer or skip an OPEN question. `skip` records it as an explicit, reviewable
// placeholder (no answer). Returns the updated row, or null if it wasn't open.
export async function resolveQuestion(
  id: string,
  outcome: { answer: string } | { skip: true },
): Promise<PendingQuestion | null> {
  const skipped = "skip" in outcome;
  const [row] = await db.update(questions)
    .set({
      status: skipped ? "skipped" : "answered",
      answer: skipped ? null : outcome.answer,
      resolvedAt: new Date(),
    })
    .where(and(eq(questions.id, id), eq(questions.status, "open")))
    .returning();
  return row ? rowToQuestion(row) : null;
}
