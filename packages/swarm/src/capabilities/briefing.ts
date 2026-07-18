import type { SkillEntry } from "../skills/registry.js";
import { formatSkillsCatalog } from "../skills/registry.js";
import type { ToolSpec } from "../agent/tool-registry.js";

export function buildCapabilityBriefing(args: {
  skills: SkillEntry[];
  builtinTools: ToolSpec[];
  mcpToolNames: string[];
  mcpServers: string[];
}): string {
  const builtin = args.builtinTools.map((t) => t.name).join(", ");
  const mcp = args.mcpToolNames.length
    ? args.mcpToolNames.join(", ")
    : "(none — add mcp.json to enable MCP tools)";
  const servers = args.mcpServers.length
    ? args.mcpServers.join(", ")
    : "(none configured)";

  return `## Available capabilities

Skills (${args.skills.length}):
${formatSkillsCatalog(args.skills)}

Built-in tools: ${builtin}

MCP servers connected: ${servers}
MCP tools: ${mcp}

You have the full capability set above — pick skills and tools yourself; no permission needed to load a skill or call a tool.
Use load_skill before improvising on unfamiliar domains (framework setup, deploy, SEO, migrations, etc.).
Use propose_step if the planned route misses required work (insert/skip/reorder phases).`;
}
