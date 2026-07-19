import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { getDomainAgent } from "../agents/domain-agent";
import { getMediator } from "../agents/mediator";
import { d1CreateNotification, d1UpdateProject, d1UpdateRun } from "../d1";

export type CrewRunParams = {
  projectId: string;
  runId: string;
  userId: string;
  swarmName: string;
  title: string;
  brief: string;
};

const PHASES = [
  { stage: "drafting" as const, phase: "research", agentId: "research", label: "Research brief" },
  { stage: "drafting" as const, phase: "product", agentId: "product", label: "Product spec" },
  { stage: "cross-review" as const, phase: "design", agentId: "design", label: "Design review" },
  { stage: "cross-review" as const, phase: "eng", agentId: "eng", label: "Engineering plan" },
  { stage: "consolidating" as const, phase: "lead", agentId: "mediator", label: "Lead completeness gate" },
  { stage: "ready" as const, phase: "preview", agentId: "eng", label: "Ship live" },
];

/**
 * Durable multi-step crew run: each phase is a Workflow step calling a DomainAgent.
 *
 * Agent execution and state application are separate steps so a retry of the
 * apply step never re-runs the (expensive, LLM-driven) agent work, and each
 * apply is idempotent: applyPhaseResult is keyed by phase, the D1 updates are
 * absolute values, and the completion notification uses a deterministic id.
 *
 * Lead phase owns the workspace completeness gate (required files present and
 * linked) before Ship/publish.
 */
export class CrewRunWorkflow extends WorkflowEntrypoint<Env, CrewRunParams> {
  async run(event: WorkflowEvent<CrewRunParams>, step: WorkflowStep) {
    const params = event.payload;

    for (let i = 0; i < PHASES.length; i++) {
      const phase = PHASES[i]!;
      const done = i === PHASES.length - 1;

      const result = await step.do(
        `phase:${phase.phase}`,
        { retries: { limit: 2, delay: "5 seconds", backoff: "linear" } },
        async () => {
          // Lead phase must run as the Mediator completeness gate, not product.
          const role =
            phase.phase === "lead"
              ? "mediator"
              : phase.agentId === "mediator"
                ? "product"
                : phase.agentId;
          const agent = await getDomainAgent(this.env, params.projectId, role);
          const phaseResult = await agent.runPhase({
            role,
            projectId: params.projectId,
            swarmName: params.swarmName,
            title: params.title,
            brief: params.brief,
            phase: phase.phase,
            label: phase.label,
          });
          return { summary: phaseResult.summary, path: phaseResult.path, files: phaseResult.filesWritten.length };
        },
      );

      await step.do(
        `phase:${phase.phase}:apply`,
        { retries: { limit: 3, delay: "3 seconds", backoff: "linear" } },
        async () => {
          if (this.env.Mediator) {
            const mediator = await getMediator(this.env, params.projectId);
            await mediator.applyPhaseResult({
              phaseIndex: i,
              phase: phase.phase,
              stage: phase.stage,
              label: phase.label,
              agentId: phase.agentId,
              summary: result.summary,
              path: result.path,
              done,
            });
          }

          if (this.env.DB) {
            await d1UpdateRun(this.env, params.runId, {
              status: done ? "completed" : "running",
              stage: phase.stage,
              current_phase: phase.phase,
            });
            await d1UpdateProject(this.env, params.projectId, {
              status: done ? "completed" : "running",
            });
            if (done) {
              await d1CreateNotification(this.env, {
                id: `run-completed-${params.runId}`,
                userId: params.userId,
                projectId: params.projectId,
                runId: params.runId,
                kind: "run.completed",
                severity: "success",
                title: "Run completed",
                message: `${params.title} is ready for review.`,
                metadata: { swarmName: params.swarmName },
              });
            }
          }
        },
      );

      if (done) {
        await step.do(
          "publish-live",
          { retries: { limit: 2, delay: "5 seconds", backoff: "linear" } },
          async () => {
            const { leadEnsureWorkspaceReady } = await import("../orchestrator/lead-gate");
            const gate = await leadEnsureWorkspaceReady(this.env, {
              projectId: params.projectId,
              title: params.title,
              brief: params.brief,
              swarmName: params.swarmName,
              allowRebuild: true,
            });
            if (!gate.ready) {
              console.warn(
                JSON.stringify({
                  event: "lead_gate.pre_publish_incomplete",
                  projectId: params.projectId,
                  missing: gate.missing,
                  weak: gate.summary,
                }),
              );
            }

            const { autoPublishProject } = await import("../orchestrator/auto-publish");
            const published = await autoPublishProject(this.env, {
              userId: params.userId,
              projectId: params.projectId,
              swarmName: params.swarmName,
              title: params.title,
            });

            if (published?.ok && this.env.DB) {
              await d1CreateNotification(this.env, {
                id: `run-published-${params.runId}`,
                userId: params.userId,
                projectId: params.projectId,
                runId: params.runId,
                kind: "run.published",
                severity: "success",
                title: "App is live",
                message: published.url,
                metadata: {
                  url: published.url,
                  slug: published.slug,
                  leadGate: gate.summary,
                },
              });
            }

            return {
              ok: Boolean(published?.ok),
              url: published?.url || null,
              message: published?.message || null,
              gateReady: gate.ready,
            };
          },
        );
      }

      if (!done) {
        await step.sleep(`pause-after-${phase.phase}`, "2 seconds");
      }
    }

    return { ok: true, projectId: params.projectId, runId: params.runId };
  }
}
