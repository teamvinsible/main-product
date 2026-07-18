import fs from "node:fs";
import path from "node:path";
import type { AgentRole, ChangePlan, FlowStep, Phase, SwarmState } from "../types.js";
import { PHASE_LIBRARY } from "../types.js";

export type WorkNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_input";
export type WorkGateStatus = "pending" | "passed" | "failed" | "skipped";

export interface WorkNode {
  id: string;
  kind: "phase" | "task" | "spike";
  phase: Phase;
  agents: AgentRole[];
  mode: "greenfield" | "incremental";
  optional?: boolean;
  requires?: string;
  status: WorkNodeStatus;
  agentProposed?: boolean;
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
  status: SwarmState["status"];
  currentPhase?: Phase;
  route: WorkNode[];
  scope?: ChangePlan;
  gates: WorkGate[];
  delivery?: {
    mode: "pr" | "deploy" | "local";
    prUrl?: string;
    deployUrl?: string;
  };
  appliedLearningIds?: string[];
}

const WORK_SPEC_VERSION = 1 as const;

export function buildWorkSpec(args: {
  state: SwarmState;
  flow: FlowStep[];
  scope?: ChangePlan | null;
  gates?: WorkGate[];
  delivery?: WorkSpec["delivery"];
  appliedLearningIds?: string[];
}): WorkSpec {
  const route = args.flow.map((step) => workNodeFromStep(step, args.state));
  return {
    version: WORK_SPEC_VERSION,
    runId: args.state.runId,
    project: args.state.projectName,
    mode: args.state.kind === "new-build" ? "new-build" : "change",
    intent: args.state.kind,
    request: args.state.request || args.state.idea,
    rationale: args.state.plannerRationale,
    updatedAt: args.state.updatedAt,
    status: args.state.status,
    currentPhase: args.state.currentPhase,
    route,
    scope: args.scope || undefined,
    gates: args.gates ?? [],
    delivery: args.delivery,
    appliedLearningIds: args.appliedLearningIds,
  };
}

function workNodeFromStep(step: FlowStep, state: SwarmState): WorkNode {
  const base = PHASE_LIBRARY[step.phase];
  return {
    id: `phase:${step.phase}`,
    kind: step.stepKind || "phase",
    phase: step.phase,
    agents: step.agents?.length ? step.agents : base.agents,
    mode: step.mode,
    optional: step.optional,
    requires: step.requires,
    status: deriveNodeStatus(step.phase, state),
    agentProposed: step.agentProposed,
  };
}

function deriveNodeStatus(phase: Phase, state: SwarmState): WorkNodeStatus {
  if (state.completedPhases.includes(phase)) return "completed";
  if (state.currentPhase === phase) {
    if (state.status === "awaiting_input") return "awaiting_input";
    if (state.status === "failed" || state.status === "stopped") return "failed";
    return "running";
  }
  return "pending";
}

export function writeWorkSpec(workspaceDir: string, spec: WorkSpec): void {
  const runDir = path.join(workspaceDir, ".swarm", "runs", spec.runId);
  fs.mkdirSync(runDir, { recursive: true });
  const payload = JSON.stringify(spec, null, 2);
  fs.writeFileSync(path.join(runDir, "work.spec.json"), payload, "utf-8");
  fs.writeFileSync(path.join(workspaceDir, ".swarm", "work.spec.json"), payload, "utf-8");
}

export function readWorkSpec(workspaceDir: string, runId?: string): WorkSpec | null {
  const candidates = [
    runId ? path.join(workspaceDir, ".swarm", "runs", runId, "work.spec.json") : "",
    path.join(workspaceDir, ".swarm", "work.spec.json"),
  ].filter(Boolean);

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as WorkSpec;
      if (parsed?.version === WORK_SPEC_VERSION && Array.isArray(parsed.route)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}
