// ──────────────────────────────────────────────────────────────────────────
// Provider-agnostic tool registry.
//
// A tool is defined ONCE here — a name, a JSON-Schema parameter spec, and a
// handler — and each LLM provider adapter translates that neutral spec into its
// own wire format (OpenAI `tools`, Anthropic `tools`, or a text convention for
// models without native tool-calling). So a capability added once (e.g.
// web_fetch) reaches every model instead of living inside one provider's loop.
//
// The registry deliberately knows nothing about any provider SDK; the
// converters below are the only provider-shaped surface.
// ──────────────────────────────────────────────────────────────────────────

export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/** The neutral, provider-independent description of a tool. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string> | string;

export interface Tool extends ToolSpec {
  handler: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Register (or override) a tool. Chainable. */
  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** The neutral specs (no handlers) — feed these to a provider converter. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map(({ name, description, parameters }) => ({
      name, description, parameters,
    }));
  }

  /**
   * Execute a tool by name. Returns the tool's string result, or `null` if no
   * tool with that name is registered (so a caller can fall through to, e.g.,
   * an MCP bridge before reporting "unknown tool").
   */
  async call(name: string, args: Record<string, unknown>): Promise<string | null> {
    const tool = this.tools.get(name);
    if (!tool) return null;
    return tool.handler(args);
  }
}

// ── Provider format converters ─────────────────────────────────────────────
// Structural shapes (no SDK imports) so this module stays provider-neutral;
// callers cast to the concrete SDK type at the boundary.

export interface OpenAiToolShape {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

/** OpenAI / DeepSeek / any openai-compatible chat-completions `tools` array. */
export function toOpenAiTools(specs: ToolSpec[]): OpenAiToolShape[] {
  return specs.map((s) => ({
    type: "function",
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
}

export interface AnthropicToolShape {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/** Anthropic Messages API `tools` array. */
export function toAnthropicTools(specs: ToolSpec[]): AnthropicToolShape[] {
  return specs.map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));
}

/**
 * Reverse of {@link toOpenAiTools}: normalize already-OpenAI-shaped tool defs
 * (e.g. from the MCP bridge) back into neutral specs so they can travel through
 * a provider adapter alongside registry tools. Non-function tools are skipped.
 */
export function fromOpenAiTools(tools: Array<{ type?: string; function?: { name?: string; description?: string; parameters?: unknown } }>): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const t of tools) {
    if (t.type !== "function" || !t.function?.name) continue;
    const params = t.function.parameters;
    const parameters: JsonSchema = params && typeof params === "object"
      ? (params as JsonSchema)
      : { type: "object", properties: {} };
    specs.push({ name: t.function.name, description: t.function.description || "", parameters });
  }
  return specs;
}
