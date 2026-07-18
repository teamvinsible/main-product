import fs from "node:fs";
import path from "node:path";
import { Agent } from "../agent.js";
import { PromptStore, DEFAULT_PROMPT_STORE } from "../prompts/prompt-store.js";
import { SwarmLogger } from "../utils/logger.js";
import {
  DEFAULT_PROJECT_TYPE,
  INTENTS,
  PHASE_LIBRARY,
  PROJECT_TYPES,
  ensureChangeScoping,
  resolveFlow,
  type AgentRole,
  type FlowStep,
  type ModelConfig,
  type Phase,
  type PhaseMode,
} from "../types.js";

export interface BuildPlan {
  projectType: string;
  steps: FlowStep[];
  rationale: string;
}

const ORDERED_PHASES: Phase[] = ["research", "product", "branding", "design", "architecture", "development", "qa", "seo", "deployment", "marketing", "analytics"];
const META_PHASES = new Set<Phase>(["scoping"]);

// Back-compat for older callers. Prefer planProject() when the concrete route matters.
// Build the change-request route: intent flow template → mandatory scoping →
// optional planner refinement of agent assignments (never add/remove phases).
export async function buildChangeRoute(
  projectType: string,
  intent: string,
  request: string,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
): Promise<BuildPlan> {
  const base = ensureChangeScoping(resolveFlow(projectType, intent));
  const refined = await refineFlow(base, request, modelConfig, workspaceDir, logger, promptStore);
  const intentLabel = INTENTS[intent]?.label || intent;
  return {
    projectType,
    steps: refined.steps,
    rationale: `Change harness (${intentLabel}): ${refined.rationale}`,
  };
}

// Adjust per-phase agents/parallelism on a fixed route. The phase list, order,
// optional flags, and requires tags from the intent template are preserved.
export async function refineFlow(
  baseFlow: FlowStep[],
  request: string,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
): Promise<{ steps: FlowStep[]; rationale: string }> {
  if (baseFlow.length === 0) {
    return { steps: baseFlow, rationale: "empty route" };
  }

  const prompts = promptStore ?? DEFAULT_PROMPT_STORE;
  const routeDesc = baseFlow
    .map((s) => {
      const agents = s.agents?.length ? `[${s.agents.join("+")}]` : "(default agents)";
      const opt = s.optional ? " optional" : "";
      const tag = s.requires ? ` requires:${s.requires}` : "";
      return `${s.phase} ${agents}${opt}${tag}`;
    })
    .join(" → ");

  const prompt = `You refine agent assignments for an EXISTING change route. The phase list and order are FIXED — do NOT add, remove, or reorder phases.

CHANGE REQUEST:
${request}

WORKSPACE SNAPSHOT:
${describeWorkspace(workspaceDir)}

FIXED ROUTE (phases and optional gates cannot change):
${routeDesc}

You may only override, per phase that appears above:
- agents: array of agent role names valid for that phase
- parallel: boolean (mainly for development when both frontend-dev and backend-dev are needed)

Respond with ONLY JSON:
{
  "rationale": "<one sentence on agent choices>",
  "overrides": [
    {"phase":"development","agents":["frontend-dev"],"parallel":false}
  ]
}`;

  try {
    const agent = new Agent("tech-lead", "research", workspaceDir, prompts.role("tech-lead"), modelConfig, logger, prompts);
    const raw = await agent.oneShot(prompt, 512);
    const parsed = extractJson(raw);
    if (!parsed) {
      return { steps: baseFlow, rationale: "intent template route (planner returned unparseable output)" };
    }
    const steps = mergeFlowOverrides(baseFlow, parsed);
    const rationale = String(parsed.rationale || "planner-refined agent assignments").trim();
    logger?.log("info", "system", `Change route refined: ${rationale}`);
    return { steps, rationale };
  } catch (err) {
    logger?.log("warn", "system", `Change route refinement failed (${err instanceof Error ? err.message : err}); using intent template.`);
    return { steps: baseFlow, rationale: "intent template route (refinement skipped)" };
  }
}

function mergeFlowOverrides(baseFlow: FlowStep[], parsed: Record<string, unknown>): FlowStep[] {
  const raw = Array.isArray(parsed.overrides) ? parsed.overrides : [];
  const byPhase = new Map<Phase, { agents?: AgentRole[]; parallel?: boolean; isolate?: boolean }>();

  for (const item of raw) {
    const obj = item as Record<string, unknown>;
    const phase = String(obj.phase || "").trim() as Phase;
    if (!PHASE_LIBRARY[phase]) continue;
    const base = PHASE_LIBRARY[phase];
    const agents = Array.isArray(obj.agents)
      ? obj.agents.map(String).filter((role): role is AgentRole => base.agents.includes(role as AgentRole))
      : undefined;
    byPhase.set(phase, {
      agents: agents?.length ? agents : undefined,
      parallel: typeof obj.parallel === "boolean" ? obj.parallel : undefined,
      isolate: typeof obj.isolate === "boolean" ? obj.isolate : undefined,
    });
  }

  return baseFlow.map((step) => {
    const o = byPhase.get(step.phase);
    if (!o) return step;
    return {
      ...step,
      ...(o.agents?.length ? { agents: o.agents } : {}),
      ...(o.parallel !== undefined ? { parallel: o.parallel } : {}),
      ...(o.isolate !== undefined ? { isolate: o.isolate } : {}),
    };
  });
}

export async function classifyProject(
  idea: string,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
): Promise<string> {
  const plan = await planProject(idea, modelConfig, workspaceDir, logger, promptStore);
  return plan.projectType;
}

// Understand the request and produce the actual route the orchestrator should run.
// The planner may select any valid phase subset and per-phase agent assignment,
// rather than blindly following a fixed project-type path.
export async function planProject(
  idea: string,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
  mode: PhaseMode = "greenfield",
): Promise<BuildPlan> {
  const prompts = promptStore ?? DEFAULT_PROMPT_STORE;
  const workspaceSnapshot = describeWorkspace(workspaceDir);
  const typeOptions = Object.values(PROJECT_TYPES)
    .map((t) => `- ${t.key}: ${t.label} - ${t.description}`)
    .join("\n");
  const phaseOptions = ORDERED_PHASES
    .map((p) => {
      const cfg = PHASE_LIBRARY[p];
      return `- ${p}: default agents ${cfg.agents.join(", ")} - ${cfg.description}`;
    })
    .join("\n");

  const prompt = `You are the swarm planner. Understand the user's request and choose the leanest route that can complete it correctly.

USER REQUEST:
${idea}

WORKSPACE SNAPSHOT:
${workspaceSnapshot}

PROJECT TYPES:
${typeOptions}

AVAILABLE PHASES:
${phaseOptions}

Rules:
- Do not run phases just because they exist. Only include phases that materially reduce risk or are needed for the requested deliverable.
- Simple client-side/browser/localStorage/static apps usually need development and QA, optionally architecture if the request is technically ambiguous.
- Backend/API/service projects usually need architecture, development, and QA.
- CLI/library/dev-tool projects usually need architecture, development, and QA.
- Marketing, SEO, branding, and analytics run only when the request asks for them or the project clearly needs launch/growth work.
- Choose agents per phase. For development, use frontend-dev for UI/browser/mobile work, backend-dev for backend/CLI/library/data/service work, or both only when both are truly needed.
- For existing-project changes, prefer the smallest incremental route that can satisfy and verify the request.

Respond with ONLY JSON:
{
  "projectType": "<one PROJECT TYPES key>",
  "rationale": "<short reason>",
  "steps": [
    {"phase":"development","agents":["frontend-dev"],"parallel":false},
    {"phase":"qa","agents":["qa-engineer"],"parallel":false}
  ]
}`;

  try {
    const agent = new Agent("tech-lead", "research", workspaceDir, prompts.role("tech-lead"), modelConfig, logger, prompts);
    const raw = await agent.oneShot(prompt, 1024);
    const parsed = extractJson(raw);
    const plan = normalizePlan(parsed, idea, mode);
    logger?.log("info", "system", `Planner selected ${plan.projectType}: ${plan.rationale}`);
    return plan;
  } catch (err) {
    logger?.log("warn", "system", `Project planning failed (${err instanceof Error ? err.message : err}); using heuristic fallback route.`);
    return fallbackPlan(idea, mode);
  }
}

function heuristicPlan(idea: string, mode: PhaseMode = "greenfield"): BuildPlan | null {
  const text = idea.toLowerCase();
  const noBackend = /\b(no backend|without backend|client[- ]side only|localstorage|local storage|static html|vanilla js|single html|no server)\b/.test(text);
  const browserApp = /\b(todo|to-do|calculator|timer|pomodoro|counter|stopwatch|quiz|flashcard|notes?|kanban|game|canvas|widget|prototype|pwa)\b/.test(text)
    && /\b(app|web|browser|html|css|javascript|js|client[- ]side|localstorage|local storage|pwa)\b/.test(text);
  if (noBackend || browserApp) {
    return {
      projectType: PROJECT_TYPES["static-app"] ? "static-app" : DEFAULT_PROJECT_TYPE,
      rationale: "Small browser/client-side app; build directly and verify with QA.",
      steps: [
        { phase: "development", mode, agents: ["frontend-dev"], parallel: false, isolate: false },
        { phase: "qa", mode, agents: ["qa-engineer"], parallel: false },
      ],
    };
  }

  if (/\b(cli|command[- ]line|terminal|shell command|npm binary|developer command)\b/.test(text)) {
    return engineeringPlan("cli-tool", "Terminal utility; architecture, implementation, and QA are enough.", ["backend-dev"], mode);
  }
  if (/\b(api|backend|microservice|server|rest|graphql|webhook|worker service)\b/.test(text) && !/\b(frontend|ui|web app|page|landing)\b/.test(text)) {
    return engineeringPlan("api-service", "Backend/API service; no UI/brand/SEO route needed.", ["backend-dev"], mode);
  }
  if (/\b(library|sdk|package|module|npm package|crate|gem|pip package)\b/.test(text)) {
    return engineeringPlan("library", "Reusable package; focus on API design, implementation, and tests.", ["backend-dev"], mode);
  }
  if (/\b(harness|framework|build tool|developer tool|internal platform|agent system)\b/.test(text)) {
    return engineeringPlan("dev-tool", "Developer tool; focus on architecture, implementation, and verification.", ["backend-dev"], mode);
  }
  return null;
}

function engineeringPlan(projectType: string, rationale: string, devAgents: AgentRole[], mode: PhaseMode): BuildPlan {
  return {
    projectType: PROJECT_TYPES[projectType] ? projectType : DEFAULT_PROJECT_TYPE,
    rationale,
    steps: [
      { phase: "architecture", mode, agents: ["principal-engineer"], parallel: false },
      { phase: "development", mode, agents: devAgents, parallel: devAgents.length > 1 },
      { phase: "qa", mode, agents: ["qa-engineer"], parallel: false },
    ],
  };
}

function fallbackPlan(idea: string, mode: PhaseMode = "greenfield"): BuildPlan {
  return heuristicPlan(idea, mode) || {
    projectType: DEFAULT_PROJECT_TYPE,
    rationale: "Fallback route for a general web application.",
    steps: PROJECT_TYPES[DEFAULT_PROJECT_TYPE].phases.map((phase) => ({ phase, mode })),
  };
}

function normalizePlan(input: Record<string, unknown> | null, idea: string, mode: PhaseMode): BuildPlan {
  if (!input) return fallbackPlan(idea, mode);
  const projectTypeRaw = String(input.projectType || "").trim();
  const projectType = PROJECT_TYPES[projectTypeRaw] ? projectTypeRaw : DEFAULT_PROJECT_TYPE;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps: FlowStep[] = [];

  for (const item of rawSteps) {
    const obj = item as Record<string, unknown>;
    const phase = String(obj.phase || "").trim() as Phase;
    if (!PHASE_LIBRARY[phase] || META_PHASES.has(phase)) continue;
    const base = PHASE_LIBRARY[phase];
    const agents = Array.isArray(obj.agents)
      ? obj.agents.map(String).filter((role): role is AgentRole => base.agents.includes(role as AgentRole))
      : undefined;
    steps.push({
      phase,
      mode,
      agents: agents?.length ? agents : undefined,
      parallel: typeof obj.parallel === "boolean" ? obj.parallel : undefined,
      isolate: typeof obj.isolate === "boolean" ? obj.isolate : undefined,
    });
  }

  const ordered = steps
    .filter((step, index, all) => all.findIndex((s) => s.phase === step.phase) === index)
    .sort((a, b) => ORDERED_PHASES.indexOf(a.phase) - ORDERED_PHASES.indexOf(b.phase));
  const valid = ordered.some((s) => s.phase === "development") ? ordered : fallbackPlan(idea, mode).steps;

  return {
    projectType,
    rationale: String(input.rationale || "Planner-selected route.").trim(),
    steps: valid,
  };
}

function describeWorkspace(workspaceDir: string): string {
  const skip = new Set([".git", ".swarm", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);
  try {
    const entries = fs.readdirSync(workspaceDir, { withFileTypes: true })
      .filter((entry) => !skip.has(entry.name))
      .slice(0, 40);
    const topLevel = entries.map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name).join(", ") || "(empty)";
    const markers = [
      "package.json",
      "pnpm-workspace.yaml",
      "index.html",
      "pyproject.toml",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "pubspec.yaml",
      "build.gradle",
      "settings.gradle",
    ].filter((file) => fs.existsSync(path.join(workspaceDir, file)));
    const roots = discoverRoots(workspaceDir);
    return [
      `Top-level: ${topLevel}`,
      `Detected roots: ${roots.join(", ") || "(none)"}`,
      `Tool markers: ${markers.join(", ") || "(none)"}`,
    ].join("\n");
  } catch (err) {
    return `Unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function discoverRoots(workspaceDir: string): string[] {
  const roots = new Set<string>();
  const skip = new Set([".git", ".swarm", "node_modules", "dist", "build", "coverage", ".next", ".turbo", "__pycache__"]);
  const common = ["app", "web", "api", "widget", "frontend", "backend", "packages", "src", "android", "ios"];
  for (const dir of common) {
    const full = path.join(workspaceDir, dir);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) roots.add(`${dir}/`);
  }

  const markerFiles = new Set([
    "package.json",
    "index.html",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pubspec.yaml",
    "build.gradle",
    "settings.gradle",
    "Package.swift",
  ]);
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && markerFiles.has(entry.name))) {
      const rel = path.relative(workspaceDir, dir).replace(/\\/g, "/");
      roots.add(rel ? `${rel}/` : "./");
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || skip.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(workspaceDir, 0);
  return Array.from(roots);
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
