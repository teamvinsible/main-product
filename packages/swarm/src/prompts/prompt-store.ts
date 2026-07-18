import { AGENT_PROMPTS } from "../agents/prompts.js";
import { getPromptOverrides } from "../db/store.js";
import { DEFAULT_TEMPLATES, renderTemplate } from "./templates.js";
import type { AgentRole } from "../types.js";

// The code-default layer: role system prompts + template constants. This is the
// floor — a key always resolves to something here unless it's genuinely unknown.
export const DEFAULT_PROMPTS: Record<string, string> = {
  ...AGENT_PROMPTS,
  ...DEFAULT_TEMPLATES,
};

// Resolves prompt keys with layered precedence: project override > global
// override > code default. Load() pulls overrides from the DB once per run; if
// it's never called (or the DB is unreachable), resolution falls back to code
// defaults so the swarm always has working prompts.
export class PromptStore {
  private global = new Map<string, string>();
  private project = new Map<string, string>();
  private projectName?: string;

  // Load global + (optionally) one project's overrides. Safe to call again to
  // refresh. Failures are swallowed — code defaults remain in effect.
  async load(projectName?: string): Promise<void> {
    this.projectName = projectName;
    this.global.clear();
    this.project.clear();
    try {
      const rows = await getPromptOverrides(projectName);
      for (const r of rows) {
        if (r.scope === "global") this.global.set(r.key, r.content);
        else if (r.scope === "project" && r.projectName === projectName) this.project.set(r.key, r.content);
      }
    } catch {
      // Leave the maps empty; resolve() falls through to DEFAULT_PROMPTS.
    }
  }

  // Raw resolved content for a key (no templating). Returns "" if unknown.
  resolve(key: string): string {
    return this.project.get(key) ?? this.global.get(key) ?? DEFAULT_PROMPTS[key] ?? "";
  }

  // Resolve a role's system prompt (typed convenience over resolve()).
  role(role: AgentRole): string {
    return this.resolve(role);
  }

  // Resolve a key and fill its {{placeholders}}.
  render(key: string, vars: Record<string, unknown> = {}): string {
    return renderTemplate(this.resolve(key), vars);
  }

  // Whether any layer (including code default) defines this key.
  has(key: string): boolean {
    return this.project.has(key) || this.global.has(key) || key in DEFAULT_PROMPTS;
  }
}

// A store with no overrides loaded — pure code defaults. Used as a fallback when
// a component is constructed without a shared store (e.g. direct Agent use).
export const DEFAULT_PROMPT_STORE = new PromptStore();

export type PromptKind = "role" | "template" | "directive";

// The editable prompt keys (those with a non-empty code default), tagged by kind.
// Used by the Settings prompt editor to enumerate what can be overridden.
export function promptCatalog(): Array<{ key: string; kind: PromptKind }> {
  return Object.keys(DEFAULT_PROMPTS)
    .filter((k) => (DEFAULT_PROMPTS[k] || "").trim().length > 0)
    .map((key) => ({
      key,
      kind: key.startsWith("template.") ? "template" : key.startsWith("directive.") ? "directive" : "role",
    }));
}
