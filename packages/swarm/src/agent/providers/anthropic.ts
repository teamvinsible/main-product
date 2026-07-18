// ──────────────────────────────────────────────────────────────────────────
// Anthropic (raw Messages API) provider adapter.
//
// Speaks POST /v1/messages directly (not the Claude Agent SDK), so Claude runs
// the SAME generic agentic loop and the SAME tool registry as every other
// provider — web_fetch and the file/shell tools reach it too. Uses an
// ANTHROPIC_API_KEY (pay-as-you-go / prompt-caching / batch), which is the
// deliberate tradeoff vs the subscription-billed Agent SDK path.
//
// Its only job is translation: neutral LlmMessage[] / ToolSpec[] <-> Anthropic
// Messages shapes. The agentic loop never sees an Anthropic type.
// ──────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmChatRequest, LlmResponse, LlmMessage, LlmToolCall } from "../llm-provider.js";
import { toAnthropicTools } from "../tool-registry.js";

export interface AnthropicConfig {
  name: string;
  model: string;
  apiKey: string;
  /** Override the API host (proxies, gateways, Anthropic-compatible endpoints). */
  baseURL?: string;
  timeout?: number;
  /** Hard ceiling on output tokens; also the API-required max_tokens default. */
  maxTokens?: number;
}

// Anthropic content-block shapes we produce/consume (kept local so the loop
// stays provider-neutral).
type CacheControl = { type: "ephemeral" };
interface TextBlock { type: "text"; text: string; cache_control?: CacheControl }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; cache_control?: CacheControl }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export class AnthropicProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(cfg: AnthropicConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
    this.maxTokens = cfg.maxTokens ?? 16000;
    this.client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: cfg.timeout });
  }

  async chat(req: LlmChatRequest): Promise<LlmResponse> {
    const { system, messages } = toAnthropicMessages(req.messages);

    // Prompt caching. Render order is tools -> system -> messages, so a single
    // breakpoint on the system block caches the entire stable prefix (tool
    // schemas + the large, unchanging system prompt) — re-read at ~0.1x every
    // turn. A second breakpoint on the latest message caches the growing
    // conversation prefix so each turn re-reads history instead of paying full
    // price. Both are within the 4-breakpoint limit.
    const systemParam = system
      ? [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }]
      : undefined;
    markLastBlockCacheable(messages);

    // Note: temperature and thinking are intentionally omitted — they are
    // rejected (400) on Opus 4.7/4.8 and vary by model; the loop doesn't need
    // them. max_tokens is required by the API.
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: Math.min(req.maxTokens ?? this.maxTokens, this.maxTokens),
      ...(systemParam ? { system: systemParam } : {}),
      messages: messages as Anthropic.MessageParam[],
      ...(req.tools.length ? { tools: toAnthropicTools(req.tools) as Anthropic.Tool[] } : {}),
    }, { signal: req.signal });

    let text = "";
    const toolCalls: LlmToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, arguments: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    return {
      text,
      toolCalls,
      finishReason: response.stop_reason ?? undefined,
      usage: response.usage
        ? {
            prompt: response.usage.input_tokens,
            completion: response.usage.output_tokens,
            total: response.usage.input_tokens + response.usage.output_tokens,
            cacheRead: response.usage.cache_read_input_tokens ?? undefined,
            cacheWrite: response.usage.cache_creation_input_tokens ?? undefined,
          }
        : undefined,
    };
  }
}

/**
 * Mark the last content block of the last message as a cache breakpoint. Each
 * turn appends new blocks, so the breakpoint moves forward and the API reuses
 * the prior conversation prefix (system + tools + history) on the next request.
 */
function markLastBlockCacheable(messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }>): void {
  const last = messages[messages.length - 1];
  if (!last || last.content.length === 0) return;
  last.content[last.content.length - 1].cache_control = { type: "ephemeral" };
}

/**
 * Translate neutral messages into Anthropic's shape: `system` is a top-level
 * string (Anthropic has no system role in `messages`), assistant tool calls
 * become `tool_use` blocks, and tool results become `tool_result` blocks inside
 * a user turn (the API coalesces consecutive user turns).
 */
function toAnthropicMessages(msgs: LlmMessage[]): { system: string; messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }> } {
  const systemParts: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }> = [];

  for (const m of msgs) {
    switch (m.role) {
      case "system":
        if (m.content) systemParts.push(m.content);
        break;
      case "user":
        messages.push({ role: "user", content: [{ type: "text", text: m.content }] });
        break;
      case "assistant": {
        const content: ContentBlock[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        // Anthropic rejects an assistant turn with empty content.
        if (content.length) messages.push({ role: "assistant", content });
        break;
      }
      case "tool":
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }],
        });
        break;
    }
  }
  return { system: systemParts.join("\n\n"), messages };
}
