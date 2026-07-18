import fs from "node:fs";
import path from "node:path";
import type { AgentRole, FlowStep, Phase } from "../types.js";
import { PHASE_LIBRARY } from "../types.js";
import { AGENT_PROMPTS } from "../agents/prompts.js";

export type ProposalAction = "insert" | "skip" | "reorder" | "add_agent";

export interface StepProposal {
  id: string;
  action: ProposalAction;
  phase: Phase;
  agents?: AgentRole[];
  reason: string;
  proposedBy?: AgentRole;
  proposedAt: string;
  status: "pending" | "applied" | "rejected";
  rejectReason?: string;
}

const PROPOSALS_DIR = "_artifacts/agent/proposals";

export function proposalsDir(workspaceDir: string): string {
  return path.join(workspaceDir, PROPOSALS_DIR);
}

export function writeProposal(workspaceDir: string, proposal: Omit<StepProposal, "id" | "proposedAt" | "status">): StepProposal {
  const dir = proposalsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  const full: StepProposal = {
    ...proposal,
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    proposedAt: new Date().toISOString(),
    status: "pending",
  };
  fs.writeFileSync(path.join(dir, `${full.id}.json`), JSON.stringify(full, null, 2), "utf-8");
  return full;
}

export function listPendingProposals(workspaceDir: string): StepProposal[] {
  const dir = proposalsDir(workspaceDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as StepProposal;
      } catch {
        return null;
      }
    })
    .filter((p): p is StepProposal => Boolean(p && p.status === "pending"));
}

function markProposal(workspaceDir: string, proposal: StepProposal): void {
  const file = path.join(proposalsDir(workspaceDir), `${proposal.id}.json`);
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2), "utf-8");
}

function validateProposal(proposal: StepProposal): string | null {
  if (!PHASE_LIBRARY[proposal.phase]) {
    return `Unknown phase: ${proposal.phase}`;
  }
  if (proposal.agents?.length) {
    const known = new Set(Object.keys(AGENT_PROMPTS));
    for (const a of proposal.agents) {
      if (!known.has(a)) return `Unknown agent role: ${a}`;
    }
  }
  return null;
}

/** Apply pending proposals to flow; auto-apply valid ones. */
export function applyPendingProposals(workspaceDir: string, flow: FlowStep[]): { flow: FlowStep[]; applied: StepProposal[]; rejected: StepProposal[] } {
  const pending = listPendingProposals(workspaceDir);
  let next = [...flow];
  const applied: StepProposal[] = [];
  const rejected: StepProposal[] = [];

  for (const proposal of pending) {
    const err = validateProposal(proposal);
    if (err) {
      proposal.status = "rejected";
      proposal.rejectReason = err;
      markProposal(workspaceDir, proposal);
      rejected.push(proposal);
      continue;
    }

    const mode = next[0]?.mode || "greenfield";
    const base = PHASE_LIBRARY[proposal.phase];

    if (proposal.action === "skip") {
      next = next.filter((s) => s.phase !== proposal.phase);
    } else if (proposal.action === "insert") {
      if (!next.some((s) => s.phase === proposal.phase)) {
        next.push({
          phase: proposal.phase,
          mode,
          agents: proposal.agents?.length ? proposal.agents : base.agents,
          agentProposed: true,
          stepKind: "task",
        });
      }
    } else if (proposal.action === "add_agent" && proposal.agents?.length) {
      next = next.map((s) => {
        if (s.phase !== proposal.phase) return s;
        const merged = new Set([...(s.agents || base.agents), ...proposal.agents!]);
        return { ...s, agents: [...merged] };
      });
    } else if (proposal.action === "reorder" && proposal.phase) {
      const idx = next.findIndex((s) => s.phase === proposal.phase);
      if (idx > 0) {
        const [step] = next.splice(idx, 1);
        next.splice(Math.max(0, idx - 1), 0, step);
      }
    }

    proposal.status = "applied";
    markProposal(workspaceDir, proposal);
    applied.push(proposal);
  }

  return { flow: next, applied, rejected };
}
