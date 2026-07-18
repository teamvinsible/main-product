// ──────────────────────────────────────────────────────────────────────────
// OpenAI-compatible provider adapter.
//
// Speaks the /v1/chat/completions wire format, which covers a large family of
// backends behind one class: DeepSeek, OpenAI, OpenRouter, Together, Groq,
// Mistral, and local servers (Ollama, vLLM, LM Studio). A new such model is a
// config change (baseURL + apiKey + model), not new code.
//
// Its only job is translation: neutral LlmMessage[] / ToolSpec[] -> OpenAI
// request, and OpenAI response -> neutral LlmResponse. The agentic loop never
// sees an OpenAI type.
// ──────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import type { LlmProvider, LlmChatRequest, LlmResponse, LlmMessage, LlmToolCall } from "../llm-provider.js";
import { toOpenAiTools } from "../tool-registry.js";

export interface OpenAiCompatibleConfig {
  name: string;
  model: string;
  apiKey: string;
  baseURL: string;
  timeout?: number;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(cfg: OpenAiCompatibleConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: cfg.timeout });
  }

  async chat(req: LlmChatRequest): Promise<LlmResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: req.messages.map(toOpenAiMessage),
      tools: req.tools.length ? (toOpenAiTools(req.tools) as OpenAI.Chat.ChatCompletionTool[]) : undefined,
      tool_choice: req.tools.length ? "auto" : undefined,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
    }, { signal: req.signal });

    const choice = response.choices[0];
    const msg = choice?.message;
    const toolCalls: LlmToolCall[] = [];
    for (const tc of msg?.tool_calls ?? []) {
      if (tc.type !== "function") continue;
      toolCalls.push({ id: tc.id, name: tc.function.name, arguments: safeParseArgs(tc.function.arguments) });
    }
    return {
      text: msg?.content ?? "",
      toolCalls,
      finishReason: choice?.finish_reason ?? undefined,
      usage: response.usage
        ? { prompt: response.usage.prompt_tokens, completion: response.usage.completion_tokens, total: response.usage.total_tokens }
        : undefined,
    };
  }
}

function toOpenAiMessage(m: LlmMessage): OpenAI.Chat.ChatCompletionMessageParam {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      };
  }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
