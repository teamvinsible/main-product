import { Agent, callable, getAgentByName } from "agents";
import type { Env } from "../env";
import { runEngineeringBuild, writePhaseArtifact } from "../orchestrator/agent-runner";

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

    if (input.role === "eng" || input.phase === "eng" || input.phase === "preview") {
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
