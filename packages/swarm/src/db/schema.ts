// Agent Swarm — Drizzle schema (source of truth for all run metadata).
// Generated app artifacts (the actual product code) stay on disk in .swarm/workspaces/;
// everything ABOUT a run lives in these tables.
import {
  pgTable, text, jsonb, timestamp, integer, boolean, doublePrecision, bigint, uuid, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Phase, AgentRole, Artifact, Doubt, SwarmMetrics, LogLevel, LogCategory,
} from "../types.js";

// A project is the durable identity. Its progress columns are a denormalized
// snapshot of the LATEST run (latestRunId) so existing project-scoped read APIs
// keep working; the runs table below holds the per-work-order history.
export const projects = pgTable("projects", {
  name:            text("name").primaryKey(),
  idea:            text("idea").notNull().default(""),
  projectType:     text("project_type").notNull().default("web-app"),
  workspaceDir:    text("workspace_dir").notNull().default(""),
  repoUrl:         text("repo_url").notNull().default(""),
  repoOwner:       text("repo_owner").notNull().default(""),
  repoName:        text("repo_name").notNull().default(""),
  defaultBranch:   text("default_branch").notNull().default("main"),
  credentialProfile: text("credential_profile").notNull().default("default"),
  deployProvider:  text("deploy_provider").notNull().default(""),        // '' | vercel | digitalocean | gcp | aws
  deployProfile:   text("deploy_profile").notNull().default("default"),  // credential profile for the provider
  deployTarget:    jsonb("deploy_target").$type<Record<string, unknown>>().notNull().default({}), // non-secret target config
  latestRunId:     uuid("latest_run_id"),
  kind:            text("kind").notNull().default("new-build"),       // latest run's intent
  request:         text("request").notNull().default(""),             // latest run's request
  status:          text("status").notNull().default("running"),
  currentPhase:    text("current_phase").$type<Phase>(),
  completedPhases: jsonb("completed_phases").$type<Phase[]>().notNull().default([]),
  completedAgents: jsonb("completed_agents").$type<Record<string, AgentRole[]>>().notNull().default({}),
  artifacts:       jsonb("artifacts").$type<Artifact[]>().notNull().default([]),
  doubts:          jsonb("doubts").$type<Doubt[]>().notNull().default([]),
  metrics:         jsonb("metrics").$type<SwarmMetrics>().notNull().default({} as SwarmMetrics),
  startedAt:       timestamp("started_at", { withTimezone: true }),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per work order (run) against a project. A greenfield build is a
// `new-build` run; feature/bugfix/etc. runs are added by later steps. Holds the
// authoritative per-run progress; the project row mirrors the latest one.
export const runs = pgTable("runs", {
  id:              uuid("id").primaryKey(),
  project:         text("project").notNull(),
  kind:            text("kind").notNull().default("new-build"),  // intent
  request:         text("request").notNull().default(""),        // idea (new-build) or change request
  flow:            jsonb("flow").$type<unknown[]>().notNull().default([]), // resolved FlowStep[] (step 3+)
  status:          text("status").notNull().default("running"),
  currentPhase:    text("current_phase").$type<Phase>(),
  completedPhases: jsonb("completed_phases").$type<Phase[]>().notNull().default([]),
  completedAgents: jsonb("completed_agents").$type<Record<string, AgentRole[]>>().notNull().default({}),
  artifacts:       jsonb("artifacts").$type<Artifact[]>().notNull().default([]),
  doubts:          jsonb("doubts").$type<Doubt[]>().notNull().default([]),
  metrics:         jsonb("metrics").$type<SwarmMetrics>().notNull().default({} as SwarmMetrics),
  branch:          text("branch"),       // git branch for this work order (step 5)
  baseCommit:      text("base_commit"),  // commit the work order branched from (step 5)
  headCommit:      text("head_commit"),
  prUrl:           text("pr_url"),        // opened PR, if any (step 5)
  startedAt:       timestamp("started_at", { withTimezone: true }),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("runs_project_idx").on(t.project, t.updatedAt),
]);

export const logs = pgTable("logs", {
  id:       uuid("id").primaryKey(),
  project:  text("project").notNull(),
  runId:    uuid("run_id"),
  ts:       timestamp("ts", { withTimezone: true }).notNull(),
  level:    text("level").$type<LogLevel>().notNull(),
  category: text("category").$type<LogCategory>().notNull(),
  message:  text("message").notNull(),
  agent:    text("agent").$type<AgentRole>(),
  phase:    text("phase").$type<Phase>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (t) => [
  index("logs_project_ts_idx").on(t.project, t.ts),
  index("logs_level_idx").on(t.project, t.level),
]);

export const agentRuns = pgTable("agent_runs", {
  id:               uuid("id").primaryKey(),
  project:          text("project").notNull(),
  runId:            uuid("run_id"),
  role:             text("role").$type<AgentRole>().notNull(),
  phase:            text("phase").$type<Phase>().notNull(),
  startedAt:        timestamp("started_at", { withTimezone: true }),
  completedAt:      timestamp("completed_at", { withTimezone: true }),
  durationMs:       integer("duration_ms"),
  promptSent:       text("prompt_sent"),
  fullOutput:       text("full_output"),
  success:          boolean("success"),
  error:            text("error"),
  artifactsCreated: jsonb("artifacts_created").$type<string[]>().notNull().default([]),
  doubtsRaised:     jsonb("doubts_raised").$type<Doubt[]>().notNull().default([]),
  summary:          text("summary"),
  tokensSaved:      integer("tokens_saved").notNull().default(0),
}, (t) => [
  index("agent_runs_project_idx").on(t.project, t.startedAt),
]);

// Cross-project knowledge base (global, not scoped to one project).
export const learnings = pgTable("learnings", {
  id:           text("id").primaryKey(),
  category:     text("category").notNull(),
  insight:      text("insight").notNull(),
  context:      text("context"),
  confidence:   doublePrecision("confidence").notNull().default(0.5),
  appliedCount: integer("applied_count").notNull().default(0),
  source:       text("source"),
  projectName:  text("project_name"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("learnings_category_idx").on(t.category),
]);

export const projectHistory = pgTable("project_history", {
  id:                 text("id").primaryKey(),
  projectName:        text("project_name").notNull(),
  idea:               text("idea"),
  techStack:          jsonb("tech_stack").$type<string[]>().notNull().default([]),
  success:            boolean("success"),
  phases:             integer("phases"),
  artifacts:          integer("artifacts"),
  doubts:             integer("doubts"),
  errors:             integer("errors"),
  learningsExtracted: integer("learnings_extracted"),
  totalDurationMs:    bigint("total_duration_ms", { mode: "number" }),
  completedAt:        timestamp("completed_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Deterministic (Layer A) evaluation results, one row per evaluated run.
export const evals = pgTable("evals", {
  id:           uuid("id").primaryKey(),
  project:      text("project").notNull(),
  runId:        uuid("run_id"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  overallScore: doublePrecision("overall_score").notNull().default(0), // 0..1 weighted pass rate
  passed:       boolean("passed").notNull().default(false),
  checks:       jsonb("checks").$type<EvalCheck[]>().notNull().default([]),
}, (t) => [
  index("evals_project_idx").on(t.project, t.createdAt),
]);

// Git commits the swarm pushed for a project (a reference of all committed work).
export const commits = pgTable("commits", {
  id:        uuid("id").primaryKey(),
  project:   text("project").notNull(),
  runId:     uuid("run_id"),
  phase:     text("phase"),
  sha:       text("sha").notNull(),
  message:   text("message").notNull(),
  files:     integer("files").notNull().default(0),
  htmlUrl:   text("html_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commits_project_idx").on(t.project, t.createdAt),
]);

// Deploy attempts to a real provider (Vercel/DigitalOcean/GCP/AWS). One row per
// deploy; secrets are never stored — only provider, profile name, and result.
export const deployments = pgTable("deployments", {
  id:        uuid("id").primaryKey(),
  project:   text("project").notNull(),
  runId:     uuid("run_id"),
  provider:  text("provider").notNull(),
  profile:   text("profile").notNull().default("default"),
  status:    text("status").notNull().default("success"), // 'success' | 'failed'
  url:       text("url"),
  logsUrl:   text("logs_url"),
  detail:    text("detail"),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("deployments_project_idx").on(t.project, t.createdAt),
]);

// Configurable prompt overrides. Code defaults (AGENT_PROMPTS + template
// constants) are the floor; rows here override a prompt key globally or for one
// project. `key` is a role name, a `directive.*`, or a `template.*` key.
// `projectName` is "" for global scope so the unique index is reliable
// (Postgres treats NULLs as distinct, which would break onConflict for globals).
export const prompts = pgTable("prompts", {
  id:          uuid("id").primaryKey(),
  scope:       text("scope").notNull().default("global"), // 'global' | 'project'
  projectName: text("project_name").notNull().default(""),
  key:         text("key").notNull(),
  content:     text("content").notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("prompts_scope_project_key_idx").on(t.scope, t.projectName, t.key),
]);

// Human-input gate. When an agent hits something it genuinely cannot invent
// (a missing secret/credential, an external account/resource choice), the run
// raises a question here and pauses (run status -> 'awaiting_input') until the
// human answers or skips it in the dashboard. Answers/skips are recorded so a
// skip is an explicit, reviewable placeholder — never a silent fabrication.
export const questions = pgTable("questions", {
  id:         uuid("id").primaryKey(),
  project:    text("project").notNull(),
  runId:      uuid("run_id"),
  agent:      text("agent").$type<AgentRole>().notNull(),
  phase:      text("phase").$type<Phase>().notNull(),
  kind:       text("kind").notNull().default("input"),   // 'secret' | 'config' | 'external' | 'input'
  question:   text("question").notNull(),
  context:    text("context").notNull().default(""),
  envKey:     text("env_key").notNull().default(""),     // for 'secret': the env var name to set (never the value)
  suggestion: text("suggestion").notNull().default(""),  // the lead's fallback, used if skipped
  status:     text("status").notNull().default("open"),  // 'open' | 'answered' | 'skipped'
  answer:     text("answer"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [
  index("questions_project_status_idx").on(t.project, t.status),
  index("questions_run_idx").on(t.runId),
]);

// Interactive per-project chat. From a project's Chat tab the user can ask
// questions about the project (answered read-only) or request changes (which
// launch a change run). Each turn — human or swarm — is one row. Distinct from
// `questions` (the swarm→human input gate); the Chat UI renders both as one
// timeline.
export const chatMessages = pgTable("chat_messages", {
  id:        uuid("id").primaryKey(),
  project:   text("project").notNull(),
  runId:     uuid("run_id"),                             // set when a turn launched/relates to a run
  role:      text("role").notNull(),                     // 'user' | 'swarm'
  kind:      text("kind").notNull().default("message"),  // 'message' | 'answer' | 'change' | 'note' | 'error'
  text:      text("text").notNull(),
  meta:      jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("chat_messages_project_idx").on(t.project, t.createdAt),
]);

// Durable user-facing events. Delivery adapters are secondary; this table is
// the canonical in-app inbox and remains available if an outbound webhook fails.
export const notifications = pgTable("notifications", {
  id:        uuid("id").primaryKey(),
  project:   text("project").notNull(),
  runId:     uuid("run_id"),
  kind:      text("kind").notNull(),
  severity:  text("severity").notNull().default("info"),
  title:     text("title").notNull(),
  message:   text("message").notNull(),
  metadata:  jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  readAt:    timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("notifications_project_created_idx").on(t.project, t.createdAt),
  index("notifications_unread_idx").on(t.readAt, t.createdAt),
]);

// A check is "blocking" when failing it means the app is dead on arrival — it
// won't install, compile, or has no runnable entrypoint. Everything else
// (tests, lint, analyze, artifact/runbook completeness) is "advisory": it ships
// with a known-issues note instead of sinking the whole run.
export type EvalTier = "blocking" | "advisory";

export interface EvalCheck {
  name: string;
  passed: boolean;
  score: number;   // 0..1
  weight: number;
  tier: EvalTier;
  detail: string;
  durationMs: number;
}
