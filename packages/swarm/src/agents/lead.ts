import { Agent } from "../agent.js";
import { PromptStore, DEFAULT_PROMPT_STORE } from "../prompts/prompt-store.js";
import { AGENT_PROMPTS } from "./prompts.js";
import { SwarmLogger } from "../utils/logger.js";
import type { AgentRole, Phase, ModelConfig, PhaseReview, RevisionRequest, Doubt, QuestionKind } from "../types.js";

export interface DoubtResolution {
  resolution: string;
  resolvedBy: AgentRole | "human";
  needsHuman: boolean;
  // When needsHuman, what class of missing input this is (drives the UI prompt).
  inputKind?: QuestionKind;
  // For a secret: the env var name the operator should set (NEVER the value).
  envKey?: string;
}

export interface InterventionAction {
  role: AgentRole;
  instructions: string;
}

// The Engineering Lead: a reasoning agent that reviews each phase's output,
// requests revisions until the bar is met, and resolves teammates' doubts
// (escalating to a human only as a last resort).
export class Lead {
  private workspaceDir: string;
  private modelConfig: ModelConfig;
  private logger?: SwarmLogger;
  private prompts: PromptStore;

  constructor(workspaceDir: string, modelConfig: ModelConfig, logger?: SwarmLogger, promptStore?: PromptStore) {
    this.workspaceDir = workspaceDir;
    this.modelConfig = modelConfig;
    this.logger = logger;
    this.prompts = promptStore ?? DEFAULT_PROMPT_STORE;
  }

  // Build an agent on demand so its system prompt is resolved from the store at
  // call time (the store is populated after Lead is constructed).
  private makeAgent(role: AgentRole, phase: Phase = "architecture"): Agent {
    return new Agent(role, phase, this.workspaceDir, this.prompts.role(role), this.modelConfig, this.logger, this.prompts);
  }

  // Review a phase's deliverables and decide approve / request revisions.
  async reviewPhase(
    phase: Phase,
    goal: string,
    phaseAgents: AgentRole[],
    artifacts: Record<string, string>,
  ): Promise<PhaseReview> {
    const deliverables = this.formatArtifacts(artifacts);
    const prompt = `Review the "${phase}" phase of the project as the engineering lead.

PHASE GOAL: ${goal}
RESPONSIBLE AGENTS: ${phaseAgents.join(", ")}

DELIVERABLES PRODUCED:
${deliverables || "(no artifacts were produced)"}

Decide whether this work is good enough to move the project forward. Hold a senior, non-negotiable bar: functional correctness, completeness against acceptance criteria, performance, scalability, security, UX quality, and consistency with earlier phases.
${phase === "qa" ? this.qaGateDirective() : ""}
Respond with ONLY a JSON object (no prose, no code fences):
{
  "approved": boolean,          // true only if the work genuinely meets the bar
  "score": number,              // 0.0-1.0 overall quality
  "summary": "one-paragraph assessment",
  "revisions": [                // empty if approved
    { "role": "<one of the responsible agents>", "instructions": "specific, actionable changes this agent must make" }
  ]
}`;

    try {
      const strict = process.env.SWARM_LEAD_STRICT === "true";
      const out = await this.makeAgent("tech-lead").runReadOnly(prompt);
      const parsed = extractJsonObject(out);
      if (!parsed) {
        if (strict) {
          return { approved: false, score: 0, summary: "Lead review unparseable.", revisions: [] };
        }
        return { approved: true, score: 0.6, summary: "Lead review unparseable; proceeding.", revisions: [] };
      }
      const revisions: RevisionRequest[] = Array.isArray(parsed.revisions)
        ? parsed.revisions
            .filter((r: { role?: string; instructions?: string }) => r && r.role && r.instructions)
            .filter((r: { role: string }) => phaseAgents.includes(r.role as AgentRole))
            .map((r: { role: string; instructions: string }) => ({ role: r.role as AgentRole, instructions: String(r.instructions) }))
        : [];
      const approved = Boolean(parsed.approved) && revisions.length === 0;
      return {
        approved,
        score: typeof parsed.score === "number" ? parsed.score : (approved ? 0.85 : 0.5),
        summary: String(parsed.summary || ""),
        revisions: approved ? [] : revisions,
      };
    } catch (err) {
      this.logger?.log("warn", "agent", `Lead review failed: ${err instanceof Error ? err.message : err}`, { agent: "tech-lead", phase });
      return { approved: true, score: 0.6, summary: "Lead review errored; proceeding.", revisions: [] };
    }
  }

  // Resolve a teammate's doubt: the lead answers decisively, optionally deferring
  // to a named expert teammate. Escalates to a human only when it's a genuine
  // business/product call the team cannot make.
  async resolveDoubt(doubt: Doubt, projectContext: string): Promise<DoubtResolution> {
    const prompt = `A teammate raised a doubt and is waiting on a decision so they aren't blocked.

RAISED BY: ${doubt.agent} (during the ${doubt.phase} phase)
QUESTION: ${doubt.question}
CONTEXT THEY GAVE: ${doubt.context || "(none)"}

PROJECT CONTEXT:
${projectContext}

As the lead, make a clear decision. You own product, design, and engineering calls — decide those yourself with good judgment; do NOT punt them to the human.

Escalate to the human ONLY when the blocker is a piece of information the team literally cannot invent or safely stand in for:
- a required SECRET or credential (API key, DB URL/connection string, service-role key, OAuth secret, access token);
- an external CONFIG value tied to the founder's accounts (project id, domain, region, billing plan, provider identifiers);
- a choice of EXTERNAL resource/account (which Supabase/Stripe/Vercel project, which domain, which paid tier).
Never escalate design/product/business tradeoffs, tech-stack choices, or copy — decide those.

SECURITY — secrets are never handled in chat. If this is a missing secret/credential, do NOT ask the human to type or paste the value. The operator will place it in the project's env file themselves; the team must read it from process.env and never hardcode or echo it. Your job is only to name the env var.

Respond with ONLY a JSON object (no prose, no code fences):
{
  "answer": "your decisive answer/decision the teammate should act on; if needsHuman, a SAFE fallback to use if the human skips",
  "expert": "<a teammate role better placed to answer, or empty string>",
  "confident": boolean,
  "needsHuman": boolean,             // true ONLY for a missing secret/credential/external-config/account per the rule above
  "inputKind": "secret|config|external", // required when needsHuman; else ""
  "envKey": "THE_ENV_VAR_NAME"       // required when inputKind is "secret" (the var to read from process.env); else ""
}`;

    try {
      const out = await this.makeAgent("tech-lead").oneShot(prompt, 2048);
      const parsed = extractJsonObject(out) || {};
      let answer = String(parsed.answer || "").trim();
      let resolvedBy: AgentRole | "human" = "tech-lead";

      // If the lead defers to an expert teammate and isn't confident, consult them.
      const expert = String(parsed.expert || "").trim() as AgentRole;
      if (expert && !parsed.confident && AGENT_PROMPTS[expert] !== undefined && expert !== "tech-lead") {
        const expertAnswer = await this.consultExpert(expert, doubt, projectContext);
        if (expertAnswer) { answer = expertAnswer; resolvedBy = expert; }
      }

      const needsHuman = Boolean(parsed.needsHuman);
      const rawKind = String(parsed.inputKind || "").trim();
      const inputKind: QuestionKind = (["secret", "config", "external"].includes(rawKind)
        ? rawKind : "input") as QuestionKind;
      // Normalize the env var name (letters/digits/underscore); never carries a value.
      const envKey = String(parsed.envKey || "").trim().replace(/[^A-Za-z0-9_]/g, "").toUpperCase();
      return {
        resolution: answer || "Proceed using your best engineering judgment.",
        resolvedBy,
        needsHuman,
        inputKind: needsHuman ? inputKind : undefined,
        envKey: needsHuman && inputKind === "secret" ? envKey : undefined,
      };
    } catch (err) {
      this.logger?.log("warn", "agent", `Doubt resolution failed: ${err instanceof Error ? err.message : err}`, { agent: "tech-lead", phase: doubt.phase });
      return { resolution: "Proceed using your best engineering judgment.", resolvedBy: "tech-lead", needsHuman: false };
    }
  }

  async planIntervention(args: {
    phase: Phase;
    goal: string;
    plannedAgents: AgentRole[];
    failures: Array<{ role: AgentRole; error?: string; summary?: string }>;
    projectContext: string;
  }): Promise<InterventionAction[]> {
    const eligibleRoles = this.eligibleInterventionRoles();
    const prompt = `You are the active engineering lead. The current phase is blocked or taking too long.

PHASE: ${args.phase}
PHASE GOAL: ${args.goal}
PLANNED AGENTS: ${args.plannedAgents.join(", ")}
AVAILABLE SPECIALISTS: ${eligibleRoles.join(", ")}

FAILURE / STALL SIGNALS:
${args.failures.map((f) => `- ${f.role}: ${f.error || f.summary || "no details"}`).join("\n")}

PROJECT CONTEXT:
${args.projectContext}

Act like a senior principal engineer and delivery lead. Identify the likely root cause and assemble the smallest cross-functional intervention team needed. Prefer parallel collaboration when independent work can proceed at the same time. Do not simply retry the same agent unless that is actually the right move.

Examples:
- DB schema/migration/config issue: bring in principal-engineer or backend-dev plus qa-engineer.
- UI/build/typecheck/test failure: bring in frontend-dev plus qa-engineer.
- deployment/env/provider issue: bring in devops plus the implementation owner.
- ambiguous product/design behavior: bring in product-manager or designer plus the implementation owner.

Respond with ONLY a JSON object:
{
  "actions": [
    { "role": "<one of AVAILABLE SPECIALISTS>", "instructions": "specific recovery task with concrete evidence to gather or command/output to verify" }
  ]
}`;

    try {
      const out = await this.makeAgent("tech-lead").oneShot(prompt, 4096);
      const parsed = extractJsonObject(out) || {};
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const valid = new Set<AgentRole>(eligibleRoles);
      return actions
        .filter((a: { role?: string; instructions?: string }) => a && valid.has(a.role as AgentRole) && a.instructions)
        .map((a: { role: string; instructions: string }) => ({
          role: a.role as AgentRole,
          instructions: String(a.instructions),
        }))
        .slice(0, 4);
    } catch (err) {
      this.logger?.log("warn", "agent", `Lead intervention planning failed: ${err instanceof Error ? err.message : err}`, {
        agent: "tech-lead",
        phase: args.phase,
      });
      return [];
    }
  }

  // Ask a specific teammate to answer a question (one-shot, no tools).
  private async consultExpert(role: AgentRole, doubt: Doubt, projectContext: string): Promise<string> {
    const expert = this.makeAgent(role, doubt.phase);
    const prompt = `A teammate (${doubt.agent}) asked you a question. Answer it directly and concisely from your expertise so they can proceed.

QUESTION: ${doubt.question}
CONTEXT: ${doubt.context || "(none)"}

PROJECT CONTEXT:
${projectContext}

Give just your answer/recommendation (a few sentences). No preamble.`;
    try {
      const out = await expert.oneShot(prompt, 1024);
      return out.trim();
    } catch {
      return "";
    }
  }

  private eligibleInterventionRoles(): AgentRole[] {
    return (Object.keys(AGENT_PROMPTS) as AgentRole[])
      .filter((role) => !["orchestrator", "tech-lead"].includes(role));
  }

  // Extra, stricter instructions for gating the QA phase. The lead must judge on
  // real evidence (_artifacts/qa/qa-report.json) rather than a prose test plan, and
  // refuse to approve shipping broken software.
  private qaGateDirective(): string {
    return `
QA GATE — judge on EVIDENCE, not prose. Read _artifacts/qa/qa-report.json above. Do NOT approve unless ALL of these hold:
- appBooted is true (if the app never booted, this is an automatic revision).
- Every acceptance criterion has status "pass". Any "fail" or "blocked" criterion means NOT approved.
- There are no open P0 (blocker) or P1 (major) bugs.
If the bar isn't met, route a revision to "qa-engineer" with the exact failing AC ids / bugs, and require them to fix the underlying issue in app/ and RE-RUN the affected tests until _artifacts/qa/qa-report.json shows real passes. Be specific; a vague "improve tests" is unacceptable.
`;
  }

  private formatArtifacts(artifacts: Record<string, string>): string {
    const sections: string[] = [];
    let total = 0;
    const PER_FILE = 80_000;
    const TOTAL = 180_000;
    for (const [file, content] of Object.entries(artifacts)) {
      if (total >= TOTAL) { sections.push(`--- ${file} (omitted, review budget reached) ---`); continue; }
      const slice = content.length > PER_FILE
        ? content.slice(0, PER_FILE) + `\n... [truncated ${content.length - PER_FILE} chars]`
        : content;
      sections.push(`--- ${file} ---\n${slice}`);
      total += slice.length;
    }
    return sections.join("\n\n");
  }
}

// Extract the first JSON object from model output (tolerates code fences / prose).
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
