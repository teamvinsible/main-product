import { Agent } from "../agent.js";
import { PromptStore, DEFAULT_PROMPT_STORE } from "../prompts/prompt-store.js";
import { SwarmLogger } from "../utils/logger.js";
import { INTENTS } from "../types.js";
import type { ModelConfig, SwarmState } from "../types.js";

// Intents that apply to a CHANGE on an existing project (new-build is excluded —
// the project already exists by the time we classify an intent).
const CHANGE_INTENTS = Object.values(INTENTS).filter((i) => i.key !== "new-build");
const DEFAULT_CHANGE_INTENT = "feature";

// Classify a change request against an existing project into one of the change
// intents (feature, bugfix, refactor, ...). Falls back to "feature".
export async function classifyIntent(
  request: string,
  project: SwarmState,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
): Promise<string> {
  const prompts = promptStore ?? DEFAULT_PROMPT_STORE;
  const options = CHANGE_INTENTS.map((i) => `- ${i.key}: ${i.label} — ${i.description}`).join("\n");

  const prompt = `Classify this change request for an EXISTING software project into exactly one intent.

PROJECT: ${project.projectName} (${project.projectType})
ORIGINAL IDEA: ${project.idea}

CHANGE REQUEST: ${request}

INTENTS:
${options}

Pick the single best-fitting intent. A request to add new capability is "feature"; fixing broken behavior is "bugfix"; restructuring/cleanup without behavior change is "refactor"; search optimization, metadata, structured data, sitemap/robots, AEO, GEO, answer-engine optimization, or generative-engine optimization is "seo"; social media, launch copy, content calendar, content strategy, platform playbooks, or marketing campaign work is "marketing".

Respond with ONLY the intent key (e.g. "feature"). No other text.`;

  try {
    const agent = new Agent("change-analyst", "scoping", workspaceDir, prompts.role("change-analyst"), modelConfig, logger, prompts);
    const out = (await agent.oneShot(prompt, 16)).trim().toLowerCase();

    if (INTENTS[out] && out !== "new-build") return out;
    const match = CHANGE_INTENTS.find((i) => out.includes(i.key));
    if (match) return match.key;

    logger?.log("warn", "system", `Intent classifier returned "${out}"; defaulting to ${DEFAULT_CHANGE_INTENT}`);
    return DEFAULT_CHANGE_INTENT;
  } catch (err) {
    logger?.log("warn", "system", `Intent classification failed (${err instanceof Error ? err.message : err}); defaulting to ${DEFAULT_CHANGE_INTENT}`);
    return DEFAULT_CHANGE_INTENT;
  }
}
