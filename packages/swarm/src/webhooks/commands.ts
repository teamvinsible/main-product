import { getProject, listProjects } from "../db/store.js";

export interface SwarmCommandResult {
  reply: string;
  spawnArgs?: string[];
}

function slugifyName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "project";
}

/** Parse /run, /change, /status, /resume commands shared by chat webhooks. */
export async function handleSwarmCommand(text: string): Promise<SwarmCommandResult> {
  const cmd = text.trim().replace(/^@\S+\s+/, "").trim();
  if (!cmd) {
    return { reply: "Commands: /run, /change, /status, /resume" };
  }

  if (cmd.startsWith("/status")) {
    const project = cmd.replace(/^\/status\s*/i, "").trim();
    if (!project) {
      const projects = await listProjects();
      return { reply: `Projects: ${projects.map((p) => p.name).join(", ") || "(none)"}` };
    }
    const state = await getProject(project);
    if (!state) return { reply: `Unknown project: ${project}` };
    return { reply: `${project}: ${state.status}${state.currentPhase ? ` (${state.currentPhase})` : ""}` };
  }

  if (cmd.startsWith("/run ")) {
    const idea = cmd.slice(5).trim();
    if (!idea) return { reply: "Usage: /run <idea>" };
    const name = slugifyName(idea);
    return {
      reply: `Queued new run: ${name}`,
      spawnArgs: ["run", idea, "--no-ui", "--name", name, "--provider", "claude"],
    };
  }

  if (cmd.startsWith("/change ")) {
    const rest = cmd.slice(8).trim();
    const space = rest.indexOf(" ");
    if (space < 1) return { reply: "Usage: /change <project> <request>" };
    const project = rest.slice(0, space).trim();
    const request = rest.slice(space + 1).trim();
    return {
      reply: `Queued change on ${project}`,
      spawnArgs: ["change", project, request, "--no-ui", "--local-only"],
    };
  }

  if (cmd.startsWith("/resume")) {
    const project = cmd.replace(/^\/resume\s*/i, "").trim();
    if (!project) return { reply: "Usage: /resume <project>" };
    return {
      reply: `Resuming ${project}`,
      spawnArgs: ["resume", project, "--no-ui"],
    };
  }

  return { reply: "Commands: /run, /change, /status, /resume" };
}
