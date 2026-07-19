import { Agent, callable, getAgentByName } from "agents";
import type { Env } from "../env";
import { runEngineeringBuild, writePhaseArtifact } from "../orchestrator/agent-runner";
import { leadEnsureWorkspaceReady } from "../orchestrator/lead-gate";

export type DomainAgentState = {
  role: string;
  projectId: string;
  lastPhase: string;
  lastSummary: string;
  updatedAt: string;
};

/**
 * Per-domain crew member (research / product / design / eng).
 * One DO instance per project+role: `${projectId}:${role}`
 */
export class DomainAgent extends Agent<Env, DomainAgentState> {
  initialState: DomainAgentState = {
    role: "",
    projectId: "",
    lastPhase: "",
    lastSummary: "",
    updatedAt: "",
  };

  @callable()
  async runPhase(input: {
    role: string;
    projectId: string;
    swarmName: string;
    title: string;
    brief: string;
    phase: string;
    label: string;
  }): Promise<{ summary: string; path: string; filesWritten: string[] }> {
    let summary = "";
    let path = `artifacts/${input.phase}.md`;
    let filesWritten: string[] = [];

    // Lead / Mediator: completeness gate is the primary job before Ship.
    if (input.phase === "lead" || input.label.toLowerCase().includes("consolidat")) {
      const gate = await leadEnsureWorkspaceReady(this.env, {
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        swarmName: input.swarmName,
        allowRebuild: true,
      });
      summary = gate.summary;
      filesWritten = gate.present;
      path = "index.html";
      await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: `${input.brief}\n\n## Lead gate\n${gate.summary}\n\nRequired: ${gate.required.join(", ")}\nPresent: ${gate.present.join(", ")}\nMissing: ${gate.missing.join(", ") || "none"}\nRepaired: ${gate.fixed.join("; ") || "none"}`,
        label: input.label,
      });
    } else if (input.phase === "preview") {
      // Ship: re-run Lead gate; rebuild if incomplete.
      const gate = await leadEnsureWorkspaceReady(this.env, {
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        swarmName: input.swarmName,
        allowRebuild: true,
      });
      summary = gate.summary;
      filesWritten = gate.present;
      path = "index.html";
      await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: `${input.brief}\n\n## Pre-ship gate\n${gate.summary}`,
        label: input.label,
      });
    } else if (input.role === "eng" || input.phase === "eng") {
      const build = await runEngineeringBuild(this.env, {
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        swarmName: input.swarmName,
      });
      summary = build.summary;
      filesWritten = build.filesWritten;
      path = "index.html";
      await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: `${input.brief}\n\nBuild: ${build.summary}\nFiles: ${build.filesWritten.join(", ")}`,
        label: input.label,
      });
    } else {
      summary = await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: input.brief,
        label: input.label,
      });
    }

    this.setState({
      role: input.role,
      projectId: input.projectId,
      lastPhase: input.phase,
      lastSummary: summary,
      updatedAt: new Date().toISOString(),
    });

    return { summary, path, filesWritten };
  }
}

export async function getDomainAgent(env: Env, projectId: string, role: string) {
  if (!env.DomainAgent) {
    throw new Error("DomainAgent binding is not configured");
  }
  return getAgentByName<Env, DomainAgent>(env.DomainAgent, `${projectId}:${role}`);
}
