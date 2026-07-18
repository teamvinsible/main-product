import type OpenAI from "openai";
import nodeCrypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { loadMcpServers } from "../mcp-config.js";

interface ConnectedServer {
  name: string;
  client: Client;
  transport: Transport;
}

export interface McpToolRegistry {
  tools: OpenAI.Chat.ChatCompletionTool[];
  call(name: string, args: Record<string, unknown>): Promise<string | null>;
  close(): Promise<void>;
  warnings: string[];
}

export async function createMcpToolRegistry(workspaceDir: string): Promise<McpToolRegistry> {
  const loaded = loadMcpServers(workspaceDir);
  const connected: ConnectedServer[] = [];
  const nameMap = new Map<string, { server: ConnectedServer; tool: string }>();
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  const warnings = [...loaded.warnings];

  for (const [serverName, config] of Object.entries(loaded.servers)) {
    try {
      const transport = transportForConfig(config, workspaceDir);
      if (!transport) {
        warnings.push(`${serverName}: unsupported MCP server config for DeepSeek bridge`);
        continue;
      }
      const client = new Client({ name: "agent-swarm-deepseek", version: "1.0.0" });
      await client.connect(transport);
      const server = { name: serverName, client, transport };
      connected.push(server);

      const listed = await client.listTools();
      for (const tool of listed.tools || []) {
        const functionName = mcpFunctionName(serverName, tool.name);
        nameMap.set(functionName, { server, tool: tool.name });
        tools.push({
          type: "function",
          function: {
            name: functionName,
            description: `[MCP:${serverName}] ${tool.description || tool.name}`,
            parameters: normalizeSchema(tool.inputSchema),
          },
        });
      }
    } catch (err) {
      warnings.push(`${serverName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    tools,
    warnings,
    async call(name: string, args: Record<string, unknown>): Promise<string | null> {
      const target = nameMap.get(name);
      if (!target) return null;
      const result = await target.server.client.callTool({
        name: target.tool,
        arguments: args,
      });
      return formatMcpResult(result);
    },
    async close(): Promise<void> {
      await Promise.allSettled(connected.map((server) => server.client.close()));
    },
  };
}

function transportForConfig(config: McpServerConfig, workspaceDir: string): Transport | null {
  if ("command" in config && typeof config.command === "string") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: workspaceDir,
      stderr: "pipe",
    });
  }
  if ("url" in config && typeof config.url === "string" && config.type === "http") {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }
  if ("url" in config && typeof config.url === "string" && config.type === "sse") {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
      eventSourceInit: config.headers ? { fetch: (input, init) => fetch(input, { ...init, headers: config.headers }) } : undefined,
    });
  }
  return null;
}

function mcpFunctionName(server: string, tool: string): string {
  const raw = `mcp__${sanitizeName(server)}__${sanitizeName(tool)}`;
  if (raw.length <= 64) return raw;
  const hash = nodeCrypto.createHash("sha1").update(`${server}:${tool}`).digest("hex").slice(0, 8);
  return `${raw.slice(0, 55)}_${hash}`;
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: "object", properties: {}, required: [] };
}

function formatMcpResult(result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content.map((item) => {
    if (!item || typeof item !== "object") return String(item);
    const block = item as Record<string, unknown>;
    if (block.type === "text") return String(block.text || "");
    if (block.type === "image") return `[image: ${String(block.mimeType || "unknown")}]`;
    if (block.type === "resource") return JSON.stringify(block.resource ?? block);
    return JSON.stringify(block);
  }).filter(Boolean);
  if (record.isError) return `Error: ${parts.join("\n") || JSON.stringify(record)}`;
  return parts.join("\n") || JSON.stringify(record);
}
