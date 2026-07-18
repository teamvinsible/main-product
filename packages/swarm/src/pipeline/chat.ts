import fs from "node:fs";
import path from "node:path";
import { Agent } from "../agent.js";
import { PromptStore, DEFAULT_PROMPT_STORE } from "../prompts/prompt-store.js";
import { SwarmLogger } from "../utils/logger.js";
import { INTENTS } from "../types.js";
import type { ChatMessage, ModelConfig } from "../types.js";
import { buildProjectIndex, formatProjectIndex } from "../utils/project-index.js";
import { ARTIFACT_BASE } from "../utils/artifacts.js";

// What a single chat message resolves to after classification.
export interface ChatIntent {
  intent: "question" | "change";
  // for change: the best-fitting work-order intent (feature/bugfix/refactor/seo/marketing)
  changeIntent: string;
  summary: string;
}

const CHANGE_INTENTS = Object.values(INTENTS).filter((i) => i.key !== "new-build");

// Append a chat request to the project's local artifact trail so there is a
// durable, on-disk record of what was asked via chat — especially change
// requests that alter the project's current setup. Best-effort; a logging
// failure never blocks the chat.
export function recordChatArtifact(
  workspaceDir: string,
  entry: { role: "user" | "swarm"; kind: string; text: string; intent?: string; summary?: string },
): void {
  try {
    const dir = path.join(workspaceDir, ARTIFACT_BASE, "chat");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "requests.md");
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "# Chat request log\n\nA durable record of requests made through the project Chat, so major changes to the project's setup are traceable.\n", "utf-8");
    }
    const when = new Date().toISOString();
    const tag = entry.intent ? ` · ${entry.intent}` : "";
    const summary = entry.summary ? `\n- summary: ${entry.summary}` : "";
    fs.appendFileSync(file, `\n## ${when} — ${entry.role} (${entry.kind}${tag})\n\n${entry.text}${summary}\n`, "utf-8");
  } catch {
    // best-effort; never block chat on a logging failure
  }
}

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

// Decide whether a chat message is a QUESTION about the project (answer it,
// read-only) or a CHANGE request (launch a change run). Always resolves — on a
// model hiccup it defaults to treating the message as a question, which is the
// safe, non-destructive choice.
export async function classifyChatIntent(
  text: string,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
  history: ChatMessage[] = [],
): Promise<ChatIntent> {
  const prompts = promptStore ?? DEFAULT_PROMPT_STORE;
  const fallback: ChatIntent = { intent: "question", changeIntent: "feature", summary: "" };

  const intentOptions = CHANGE_INTENTS.map((i) => `- ${i.key}: ${i.label}`).join("\n");
  const recentThread = history.slice(-12)
    .map((m) => `${m.role}/${m.kind}: ${m.text.slice(0, 1200)}`)
    .join("\n\n");

  const prompt = `You route a chat message about an EXISTING software project to one of two handlers.

RECENT CHAT THREAD:
${recentThread || "(no earlier chat turns)"}

USER MESSAGE:
${text}

Decide the intent:
- If the latest message corrects, clarifies, or comments on an existing conversation, preserve that context in the summary. Do not treat a correction as an unrelated fresh request.
- "question" — the user is ASKING about the project (how it works, where something is, what tech/decisions were made, status). Answer, don't build.
- "change" — the user wants the project MODIFIED (add/build/implement a feature, fix a bug, refactor, SEO, marketing). This launches a work-order run.

If "change", also pick the best-fitting changeIntent from:
${intentOptions}

Respond with ONLY a JSON object, no markdown, exactly these keys:
{"intent":"question"|"change","changeIntent":"<key or empty>","summary":"<one sentence describing the answer topic or the change>"}`;

  try {
    const agent = new Agent("tech-lead", "research", workspaceDir, prompts.role("tech-lead"), modelConfig, logger, prompts);
    const raw = await agent.oneShot(prompt, 200);
    const obj = extractJson(raw);
    if (!obj) return fallback;
    const intent = String(obj.intent || "").toLowerCase() === "change" ? "change" : "question";
    const wanted = String(obj.changeIntent || "").trim().toLowerCase();
    const changeIntent = CHANGE_INTENTS.find((i) => i.key === wanted)?.key || "feature";
    return { intent, changeIntent, summary: String(obj.summary || "").trim() };
  } catch (err) {
    logger?.log("warn", "system", `Chat intent classification failed (${err instanceof Error ? err.message : err}); treating as a question`);
    return fallback;
  }
}

// Read a small, size-budgeted set of grounding files (runbooks + key artifacts)
// so the answer is concrete and cites real content instead of guessing.
function gatherGroundingFiles(workspaceDir: string, budgetBytes = 60_000): string {
  const candidates = [
    "README.md",
    "app/README.md",
    "app/PROJECT-MANIFEST.md",
    "_artifacts/product/prd.md",
    "_artifacts/product/features.md",
    "_artifacts/architecture/tech-stack.md",
    "_artifacts/architecture/system-design.md",
    "_artifacts/architecture/api-design.md",
    "_artifacts/qa/qa-report.json",
  ];
  const parts: string[] = [];
  let used = 0;
  for (const rel of candidates) {
    if (used >= budgetBytes) break;
    const full = path.join(workspaceDir, rel);
    try {
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      const raw = fs.readFileSync(full, "utf-8");
      const slice = raw.slice(0, Math.max(0, budgetBytes - used));
      parts.push(`----- ${rel} -----\n${slice}`);
      used += slice.length;
    } catch {
      // best-effort; skip unreadable files
    }
  }
  return parts.join("\n\n");
}

// Answer a read-only question about the project, grounded in its file index +
// key documents. No tools, no writes — purely a reasoning call over context, so
// it can never modify the project.
export async function answerProjectQuestion(
  text: string,
  modelConfig: ModelConfig,
  workspaceDir: string,
  logger?: SwarmLogger,
  promptStore?: PromptStore,
  history: ChatMessage[] = [],
): Promise<string> {
  const prompts = promptStore ?? DEFAULT_PROMPT_STORE;

  let indexBlock = "";
  try {
    indexBlock = formatProjectIndex(buildProjectIndex(workspaceDir), 200);
  } catch {
    indexBlock = "(project index unavailable)";
  }
  const grounding = gatherGroundingFiles(workspaceDir);
  const recentThread = history.slice(-12)
    .map((m) => `${m.role}/${m.kind}: ${m.text.slice(0, 1200)}`)
    .join("\n\n");

  const systemPrompt = `You are a senior engineer answering a question about an EXISTING software project you help maintain. Answer ONLY from the project context provided (file index + document excerpts). Be concise, concrete, and cite specific files/paths when relevant. If the context doesn't contain the answer, say so plainly and point to where the user could look — never invent files, APIs, or facts. You are read-only: you are explaining, not changing anything.`;

  const userPrompt = `PROJECT FILE INDEX:
${indexBlock}

KEY PROJECT DOCUMENTS (excerpts):
${grounding || "(no runbook or key documents found)"}

RECENT CHAT THREAD:
${recentThread || "(no earlier chat turns)"}

QUESTION:
${text}

Answer the question using the context above.`;

  const agent = new Agent("tech-lead", "research", workspaceDir, systemPrompt, modelConfig, logger, prompts);
  return (await agent.oneShot(userPrompt, 1500)).trim();
}
