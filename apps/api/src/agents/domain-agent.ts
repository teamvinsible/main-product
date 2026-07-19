import { Agent, callable, getAgentByName } from "agents";
import type { Env } from "../env";
import { runEngineeringBuild, writePhaseArtifact } from "../orchestrator/agent-runner";
import { leadEnsureWorkspaceReady } from "../orchestrator/lead-gate";
import { CREW_PHASES } from "../orchestrator/phases";

export type DomainAgentState = {
  role: string;
  projectId: string;
  lastPhase: string;
  lastSummary: string;
  updatedAt: string;
};

function phaseHint(phase: string, label: string): string {
  return CREW_PHASES.find((p) => p.phase === phase)?.briefHint || `You are the ${label} agent on Teamvinsible.`;
}

/**
 * Per-domain crew member (product / design / architect / eng / qa / devops / marketing / growth).
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
    briefHint?: string;
  }): Promise<{ summary: string; path: string; filesWritten: string[] }> {
    let summary = "";
    const docPath = `artifacts/${input.phase}.md`;
    let filesWritten: string[] = [];
    const hint = input.briefHint || phaseHint(input.phase, input.label);

    if (input.phase === "devops" || input.phase === "lead") {
      // DevOps owns workspace completeness before Launch (legacy "lead" alias kept).
      const gate = await leadEnsureWorkspaceReady(this.env, {
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        swarmName: input.swarmName,
        allowRebuild: true,
      });
      summary = gate.summary;
      filesWritten = gate.present.filter((p) => !p.startsWith("artifacts/"));
      await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: `${input.brief}\n\n## DevOps / release gate\n${gate.summary}\n\nRequired: ${gate.required.join(", ")}\nPresent: ${gate.present.join(", ")}\nMissing: ${gate.missing.join(", ") || "none"}\nRepaired: ${gate.fixed.join("; ") || "none"}`,
        label: input.label,
        briefHint: hint,
      });
    } else if (input.phase === "eng" || input.phase === "eng-frontend") {
      const build = await runEngineeringBuild(this.env, {
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        swarmName: input.swarmName,
      });
      summary = build.summary;
      filesWritten = build.filesWritten.filter((p) => !p.startsWith("artifacts/"));
      await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: `${input.brief}\n\n## Frontend build\n${build.summary}\n\nFiles: ${build.filesWritten.join(", ")}`,
        label: input.label,
        briefHint: hint,
      });
    } else {
      // strategy / design / architecture / eng-backend / qa / launch / growth — docs only.
      summary = await writePhaseArtifact(this.env, {
        projectId: input.projectId,
        phase: input.phase,
        title: input.title,
        brief: input.brief,
        label: input.label,
        briefHint: hint,
      });
    }

    this.setState({
      role: input.role,
      projectId: input.projectId,
      lastPhase: input.phase,
      lastSummary: summary,
      updatedAt: new Date().toISOString(),
    });

    return { summary, path: docPath, filesWritten };
  }
}

export async function getDomainAgent(env: Env, projectId: string, role: string) {
  if (!env.DomainAgent) {
    throw new Error("DomainAgent binding is not configured");
  }
  return getAgentByName<Env, DomainAgent>(env.DomainAgent, `${projectId}:${role}`);
}
