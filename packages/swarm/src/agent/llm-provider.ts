// ──────────────────────────────────────────────────────────────────────────
// Provider-agnostic LLM interface.
//
// A provider does exactly ONE thing: given a conversation and a set of tool
// specs, return the model's text and/or tool calls in a normalized shape. The
// agentic loop (turns, tool execution, compression, logging, retries, failover)
// lives above this boundary and is provider-independent — so swapping the LLM
// is an adapter change, not a loop rewrite.
//
// Tool-calling is normalized to `LlmToolCall[]`. OpenAI-compatible and Anthropic
// map cleanly; a model without native tool-calling can emulate it in its adapter
// (the loop only reads `toolCalls`, never a wire format).
// ──────────────────────────────────────────────────────────────────────────

import type { ToolSpec } from "./tool-registry.js";

export interface LlmToolCall {
  /** Provider-issued id, echoed back on the matching tool-result message. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: LlmToolCall[];
  /** Present on tool-result messages; matches the originating call's id. */
  toolCallId?: string;
}

export interface LlmUsage {
  prompt: number;
  completion: number;
  total: number;
  /** Prompt-cache tokens read at ~0.1x (providers that support caching). */
  cacheRead?: number;
  /** Prompt-cache tokens written at ~1.25x. */
  cacheWrite?: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
  finishReason?: string;
}

export interface LlmChatRequest {
  messages: LlmMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Stable id for logging/telemetry, e.g. "deepseek" or "openai". */
  readonly name: string;
  /** The concrete model id this instance targets. */
  readonly model: string;
  chat(req: LlmChatRequest): Promise<LlmResponse>;
}
