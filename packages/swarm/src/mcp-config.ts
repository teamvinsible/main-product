import fs from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export interface McpLoadResult {
  servers: Record<string, McpServerConfig>;
  paths: string[];
  warnings: string[];
}

export function loadMcpServers(workspaceDir: string, globalDir = process.cwd()): McpLoadResult {
  const result: McpLoadResult = { servers: {}, paths: [], warnings: [] };
  const candidates = uniquePaths([
    path.join(globalDir, "mcp.json"),
    path.join(workspaceDir, "mcp.json"),
  ]);

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
      const servers = extractServers(raw);
      if (!servers) {
        result.warnings.push(`${filePath}: expected { "mcpServers": { ... } } or a server map`);
        continue;
      }
      Object.assign(result.servers, expandEnv(servers));
      result.paths.push(filePath);
    } catch (err) {
      result.warnings.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

function extractServers(raw: unknown): Record<string, McpServerConfig> | null {
  if (!isRecord(raw)) return null;
  const nested = raw.mcpServers;
  if (isRecord(nested)) return nested as Record<string, McpServerConfig>;
  if (looksLikeServerMap(raw)) return raw as Record<string, McpServerConfig>;
  return null;
}

function looksLikeServerMap(value: Record<string, unknown>): boolean {
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) =>
    isRecord(entry) && (
      typeof entry.command === "string"
      || typeof entry.url === "string"
      || entry.type === "sdk"
    ));
}

function expandEnv<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => process.env[name] || "") as T;
  }
  if (Array.isArray(value)) return value.map((item) => expandEnv(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnv(item)])) as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths.map((item) => path.resolve(item))) {
    const key = process.platform === "win32" ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
