import { Agent } from "../agent.js";
import { PromptStore, DEFAULT_PROMPT_STORE } from "../prompts/prompt-store.js";
import { SwarmLogger } from "../utils/logger.js";
import { PROJECT_TYPES, DEFAULT_PROJECT_TYPE, INTENTS } from "../types.js";
import type { ModelConfig } from "../types.js";

// Result of a single conversational-intake inference. The chat Launch UI uses
// this to pre-fill an infer-and-confirm card so the user only overrides what's
// wrong, instead of filling a form field-by-field.
export interface IntakeResult {
  mode: "new" | "change";
  // new-build fields
  idea: string;
  suggestedName: string;
  projectType: string;
  projectTypeLabel: string;
  repo: string;
  // change-request fields
  project: string;
  intent: string;
  // shared
  summary: string;
}

const CHANGE_INTENTS = Object.values(INTENTS).filter((i) => i.key !== "new-build");

function typeLabel(key: string): string {
  return PROJECT_TYPES[key]?.label || key;
}

// Pull the first balanced JSON object out of a model response (tolerates code
// fences and stray prose around it).
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

// Analyze one free-form message from the user and infer everything needed to
// launch — new-build vs. change, project type/name, or target project/intent —
// in a single LLM round-trip. Always resolves (falls back to a safe new-build
// inference) so the chat UI never dead-ends on a model hiccup.
export async function analyzeIntake(
  text: string,
  projectNames: string[],
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
): Promise<IntakeResult> {
  const prompts = promptStore ?? DEFAULT_PROMPT_STORE;

  const fallback = (): IntakeResult => ({
    mode: "new",
    idea: text.trim(),
    suggestedName: "",
    projectType: DEFAULT_PROJECT_TYPE,
    projectTypeLabel: typeLabel(DEFAULT_PROJECT_TYPE),
    repo: "",
    project: "",
    intent: "",
    summary: "",
  });

  const typeOptions = Object.values(PROJECT_TYPES)
    .map((t) => `- ${t.key}: ${t.label} — ${t.description}`)
    .join("\n");
  const intentOptions = CHANGE_INTENTS.map((i) => `- ${i.key}: ${i.label}`).join("\n");
  const projectList = projectNames.length ? projectNames.join(", ") : "(none yet)";

  const prompt = `You triage requests to an autonomous software-building swarm. Decide whether the user wants to BUILD A NEW project or CHANGE an EXISTING one, then extract the launch details.

USER MESSAGE:
${text}

EXISTING PROJECTS (a change must target one of these by exact name):
${projectList}

PROJECT TYPES (for a new build):
${typeOptions}

CHANGE INTENTS (for a change):
${intentOptions}

Rules:
- mode is "change" ONLY if the message clearly refers to one of the existing projects above; otherwise "new".
- For a new build: pick the single best projectType key, propose a short kebab-case name (2-4 words), and set repo to any "owner/repo" the user mentioned (else "").
- For a change: set project to the exact existing name and intent to the best-fitting key.
- summary: one plain sentence describing what will be built or changed.

Respond with ONLY a JSON object, no markdown, using exactly these keys:
{"mode":"new","idea":"<restated idea>","projectType":"<key>","suggestedName":"<slug>","repo":"","summary":"<sentence>"}
OR
{"mode":"change","project":"<existing name>","intent":"<key>","summary":"<sentence>"}`;

  try {
    const agent = new Agent("tech-lead", "research", workspaceDir, prompts.role("tech-lead"), modelConfig, logger, prompts);
    const raw = await agent.oneShot(prompt, 256);
    const obj = extractJson(raw);
    if (!obj) {
      logger?.log("warn", "system", `Intake returned unparseable output; using fallback. Raw: ${raw.slice(0, 120)}`);
      return fallback();
    }

    const mode = String(obj.mode || "new").toLowerCase() === "change" ? "change" : "new";

    if (mode === "change") {
      // Only honor change mode if it resolves to a real project.
      const wanted = String(obj.project || "").trim();
      const project = projectNames.find((n) => n.toLowerCase() === wanted.toLowerCase()) || "";
      if (!project) return fallback();
      const intentRaw = String(obj.intent || "").trim().toLowerCase();
      const intent = CHANGE_INTENTS.find((i) => i.key === intentRaw)?.key || "feature";
      return {
        mode: "change",
        idea: text.trim(),
        suggestedName: "",
        projectType: "",
        projectTypeLabel: "",
        repo: "",
        project,
        intent,
        summary: String(obj.summary || "").trim(),
      };
    }

    const typeRaw = String(obj.projectType || "").trim().toLowerCase();
    const projectType = PROJECT_TYPES[typeRaw]
      ? typeRaw
      : Object.keys(PROJECT_TYPES).find((k) => typeRaw.includes(k)) || DEFAULT_PROJECT_TYPE;
    return {
      mode: "new",
      idea: String(obj.idea || text).trim() || text.trim(),
      suggestedName: String(obj.suggestedName || "").trim(),
      projectType,
      projectTypeLabel: typeLabel(projectType),
      repo: String(obj.repo || "").trim(),
      project: "",
      intent: "",
      summary: String(obj.summary || "").trim(),
    };
  } catch (err) {
    logger?.log("warn", "system", `Intake analysis failed (${err instanceof Error ? err.message : err}); using fallback`);
    return fallback();
  }
}
