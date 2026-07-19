import type { IntakePlan, PlatformProject, SpineSnapshot } from "@teamvinsible/shared";
import type { Authed } from "../auth";
import {
  d1AddActivity,
  d1CreateProject,
  d1CreateRun,
  d1CountActiveRuns,
  d1CreateNotification,
  d1GetProject,
  d1ListProjects,
  d1UpdateProject,
  hasD1,
  type CfProjectRow,
} from "../d1";
import { isDevelopment, type Env } from "../env";
import { memoryStore } from "../db";
import { swarmNameForUser } from "../swarm";
import { getMediator, mediatorToSpine } from "../agents/mediator";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project"
  );
}

function rowToPlatform(row: CfProjectRow): PlatformProject {
  return {
    id: row.id,
    swarmName: row.swarm_name,
    title: row.title,
    brief: row.brief,
    status: row.status,
    previewUrl: row.preview_url,
    sandboxId: row.sandbox_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function cfListProjects(env: Env, userId: string): Promise<PlatformProject[]> {
  if (hasD1(env)) {
    return (await d1ListProjects(env, userId)).map(rowToPlatform);
  }
  if (isDevelopment(env)) return memoryStore.list(userId);
  throw new Error("D1 binding is unavailable");
}

export async function cfGetProject(
  env: Env,
  userId: string,
  key: string,
): Promise<PlatformProject | null> {
  if (hasD1(env)) {
    const row = await d1GetProject(env, userId, key);
    return row ? rowToPlatform(row) : null;
  }
  if (isDevelopment(env)) return memoryStore.get(userId, key);
  throw new Error("D1 binding is unavailable");
}

export async function cfIntake(
  env: Env,
  auth: Authed,
  body: { idea?: string; text?: string; kind?: string; url?: string },
): Promise<IntakePlan & Record<string, unknown>> {
  const idea = String(body.idea || body.text || "").trim();
  if (!idea) {
    return {
      ok: false,
      summary: "",
      clarifyingQuestions: [],
      suggestedName: "project",
      projectType: "web-app",
      projectTypeLabel: "Web app",
      error: "idea required",
    } as IntakePlan & Record<string, unknown>;
  }

  // Optional LLM classify via DeepSeek; fall back to heuristics
  if (env.DEEPSEEK_API_KEY) {
    try {
      const { deepseekText } = await import("../llm/deepseek");
      const text = await deepseekText(
        env,
        `Classify this product brief for an agent swarm. Return JSON only with keys: summary, projectType, projectTypeLabel, suggestedName (kebab-case), clarifyingQuestions (string array, max 4).\n\nBrief:\n${idea}`,
        { maxTokens: 600 },
      );
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as IntakePlan;
        return {
          ok: true,
          idea,
          mode: "new",
          summary: parsed.summary,
          projectType: parsed.projectType || parsed.category || "web-app",
          projectTypeLabel: parsed.projectTypeLabel || parsed.categoryLabel || "Web app",
          category: parsed.projectType || parsed.category,
          categoryLabel: parsed.projectTypeLabel || parsed.categoryLabel,
          suggestedName: slugify(parsed.suggestedName || idea.split(/\s+/).slice(0, 3).join("-")),
          clarifyingQuestions: parsed.clarifyingQuestions || [],
          suggestedAgents: ["mediator", "research", "product", "design", "eng"],
        };
      }
    } catch {
      /* fall through */
    }
  }

  const words = idea.split(/\s+/).filter(Boolean);
  const suggestedName = slugify(words.slice(0, 3).join("-") || "new-project");
  return {
    ok: true,
    idea,
    mode: "new",
    summary: idea.length > 180 ? `${idea.slice(0, 177)}…` : idea,
    projectType: "web-app",
    projectTypeLabel: "Web app",
    category: "web-app",
    categoryLabel: "Web app",
    suggestedName,
    clarifyingQuestions: [
      "Who is the primary user?",
      "What does success look like in the first week?",
      "Any must-have integrations?",
    ],
    suggestedAgents: ["mediator", "research", "product", "design", "eng"],
  };
}

export async function cfStartRun(
  env: Env,
  auth: Authed,
  body: { idea?: string; name?: string; type?: string },
): Promise<{ ok: boolean; name: string; swarmName: string; projectId: string; runId: string }> {
  const idea = String(body.idea || "").trim();
  if (!idea) throw new Error("idea is required");

  const suggested = String(body.name || "project");
  let swarmName = swarmNameForUser(auth.user.id, suggested);
  const projectId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  if (hasD1(env)) {
    if ((await d1CountActiveRuns(env, auth.user.id)) >= 3) {
      throw new Error("You already have 3 active runs. Wait for one to finish before starting another.");
    }
    try {
      await d1CreateProject(env, {
        id: projectId,
        user_id: auth.user.id,
        swarm_name: swarmName,
        title: suggested,
        brief: idea,
        status: "running",
      });
    } catch (err) {
      // swarm_name is globally UNIQUE; re-running the same idea gets a suffixed name.
      if (!/UNIQUE/i.test(String(err))) throw err;
      swarmName = `${swarmName.slice(0, 58)}-${crypto.randomUUID().slice(0, 4)}`;
      await d1CreateProject(env, {
        id: projectId,
        user_id: auth.user.id,
        swarm_name: swarmName,
        title: suggested,
        brief: idea,
        status: "running",
      });
    }
    await d1CreateRun(env, {
      id: runId,
      project_id: projectId,
      user_id: auth.user.id,
      idea,
      status: "running",
      stage: "drafting",
      current_phase: "research",
    });
    await d1AddActivity(env, {
      id: crypto.randomUUID(),
      project_id: projectId,
      run_id: runId,
      message: "Run accepted by Mediator on Cloudflare",
      kind: "gate",
      agent: "Mediator",
      phase: "intake",
    });
    await d1CreateNotification(env, {
      userId: auth.user.id,
      projectId,
      runId,
      kind: "run.started",
      title: "Run started",
      message: `${suggested} was accepted and is now running.`,
      metadata: { swarmName },
    });
  } else {
    if (!isDevelopment(env)) throw new Error("D1 binding is unavailable");
    memoryStore.create({
      id: projectId,
      userId: auth.user.id,
      swarmName,
      title: suggested,
      brief: idea,
      status: "running",
    });
  }

  if (env.Mediator) {
    const mediator = await getMediator(env, projectId);
    await mediator.bootstrap({
      projectId,
      swarmName,
      userId: auth.user.id,
      title: suggested,
      brief: idea,
      runId,
    });
  }

  // Sole creation point for the CrewRun Workflow (Mediator.bootstrap deliberately
  // does not create it). runId doubles as the instance id, so a client retry of
  // this request cannot spawn a second workflow for the same run.
  if (env.CREW_WORKFLOW) {
    try {
      await env.CREW_WORKFLOW.create({
        id: runId,
        params: {
          projectId,
          runId,
          userId: auth.user.id,
          swarmName,
          title: suggested,
          brief: idea,
        },
      });
    } catch (err) {
      console.error(JSON.stringify({ event: "workflow.create_failed", runId, error: String(err) }));
      // Keep the run alive via the Mediator's scheduled phase loop.
      if (env.Mediator) {
        const mediator = await getMediator(env, projectId);
        await mediator.schedulePhases();
      }
    }
  }

  // Queue consumers may warm supporting build capacity; the Workflow owns run state.
  if (env.RUN_QUEUE) {
    await env.RUN_QUEUE.send({
      type: "run.start",
      projectId,
      runId,
      userId: auth.user.id,
      swarmName,
      idea,
      title: suggested,
    });
  }

  return { ok: true, name: swarmName, swarmName, projectId, runId };
}

export async function cfLoadSpine(
  env: Env,
  auth: Authed,
  projectKey: string | null,
): Promise<SpineSnapshot> {
  const owned = await cfListProjects(env, auth.user.id);
  const projects = owned.map((p) => ({
    name: p.swarmName,
    id: p.id,
    status: p.status,
    idea: p.brief,
    updatedAt: p.updatedAt,
    previewUrl: p.previewUrl,
  }));

  if (!projectKey) {
    if (!owned[0]) {
      return {
        empty: true,
        project: null,
        workstreams: [],
        agents: [],
        dataFlows: [],
        specs: [],
        decisions: [],
        dependencies: { nodes: [], edges: [] },
        timeline: [],
        activity: [],
        health: { alignedPct: 0, aligned: 0, inProgress: 0, needsAttention: 0, blocked: 0 },
        nextUp: [],
        specsTotal: 0,
        live: true,
        source: "swarm",
        projects,
        swarmOnline: true,
        message: "No projects yet. Start a brief to assign the Mediator crew.",
      };
    }
    projectKey = owned[0].id;
  }

  const project = await cfGetProject(env, auth.user.id, projectKey);
  if (!project) {
    return {
      empty: true,
      project: null,
      workstreams: [],
      agents: [],
      dataFlows: [],
      specs: [],
      decisions: [],
      dependencies: { nodes: [], edges: [] },
      timeline: [],
      activity: [],
      health: { alignedPct: 0, aligned: 0, inProgress: 0, needsAttention: 0, blocked: 0 },
      nextUp: [],
      specsTotal: 0,
      live: true,
      source: "swarm",
      projects,
      swarmOnline: true,
      message: "Project not found.",
    };
  }

  if (env.Mediator) {
    const mediator = await getMediator(env, project.id);
    const snap = await mediator.getSnapshot();
    if (snap.projectId) {
      return mediatorToSpine(snap, projects);
    }
  }

  return {
    empty: true,
    project: {
      id: project.id,
      title: project.title,
      brief: project.brief,
      stage: "drafting",
      status: project.status,
      createdAt: project.createdAt.slice(0, 10),
      updatedAt: "Just now",
    },
    workstreams: [],
    agents: [],
    dataFlows: [],
    specs: [],
    decisions: [],
    dependencies: { nodes: [], edges: [] },
    timeline: [],
    activity: [],
    health: { alignedPct: 0, aligned: 0, inProgress: 0, needsAttention: 0, blocked: 0 },
    nextUp: [],
    specsTotal: 0,
    live: true,
    source: "swarm",
    projects,
    swarmOnline: true,
    previewUrl: project.previewUrl,
    sandboxId: project.sandboxId,
    message: "Mediator is warming up…",
  };
}

export async function cfSetPreview(
  env: Env,
  projectId: string,
  previewUrl: string | null,
  sandboxId: string | null,
): Promise<void> {
  if (hasD1(env)) {
    await d1UpdateProject(env, projectId, { preview_url: previewUrl, sandbox_id: sandboxId, status: "preview" });
  } else {
    if (!isDevelopment(env)) throw new Error("D1 binding is unavailable");
    try {
      memoryStore.updatePreview(projectId, { previewUrl, sandboxId, status: "preview" });
    } catch {
      /* ignore */
    }
  }
  if (env.Mediator) {
    const mediator = await getMediator(env, projectId);
    if (previewUrl && sandboxId) {
      await mediator.setPreview(previewUrl, sandboxId);
    }
  }
}
