/**
 * DeepSeek-only LLM client for Teamvinsible (OpenAI-compatible Chat Completions).
 * Docs: https://api-docs.deepseek.com/
 */
import type { Env } from "../env";

export const DEEPSEEK_BASE = "https://api.deepseek.com";
/** Prefer V4 flash; falls back via DeepSeek routing if account still uses aliases. */
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type DeepSeekTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function deepseekConfigured(env: Env): boolean {
  return Boolean(env.DEEPSEEK_API_KEY?.trim());
}

export function deepseekModel(env: Env): string {
  return env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL;
}

export async function deepseekChat(
  env: Env,
  opts: {
    messages: ChatMessage[];
    tools?: DeepSeekTool[];
    temperature?: number;
    maxTokens?: number;
  },
): Promise<{
  content: string | null;
  tool_calls: ToolCall[];
  raw: unknown;
}> {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");

  const body: Record<string, unknown> = {
    model: deepseekModel(env),
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    // A hung upstream must not stall a Workflow step or queue consumer for the
    // full invocation limit.
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ToolCall[];
      };
    }>;
  };

  const message = data.choices?.[0]?.message;
  return {
    content: message?.content ?? null,
    tool_calls: message?.tool_calls || [],
    raw: data,
  };
}

/** Simple text completion (no tools). */
export async function deepseekText(
  env: Env,
  userPrompt: string,
  opts?: { system?: string; maxTokens?: number },
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: userPrompt });
  const { content } = await deepseekChat(env, {
    messages,
    maxTokens: opts?.maxTokens ?? 1200,
  });
  return (content || "").trim();
}

export function toDeepSeekTools(
  specs: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>,
): DeepSeekTool[] {
  return specs.map((s) => ({
    type: "function" as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: s.input_schema,
    },
  }));
}
