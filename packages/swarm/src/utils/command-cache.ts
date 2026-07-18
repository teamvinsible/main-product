import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildProjectIndex } from "./project-index.js";

interface CommandCacheEntry {
  key: string;
  command: string;
  output: string;
  createdAt: string;
  workspaceSignature: string;
}

interface CommandCacheFile {
  version: 1;
  entries: CommandCacheEntry[];
}

const MAX_ENTRIES = 80;
const CACHEABLE_RE = /\b(--version|-v|version|help|status|list|ls|pwd|typecheck|lint|test|build|tsc|vite build|npm run|pnpm run|yarn .*run|bun run|cargo test|go test|pytest)\b/i;
const MUTATING_RE = /\b(install|add|remove|update|upgrade|deploy|push|pull|commit|checkout|merge|rebase|reset|clean|rm|del|move|mv|copy|cp|mkdir|rmdir|apply|migrate|db reset|seed|create|delete|destroy|login|auth)\b/i;

export function isCommandCacheable(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) return false;
  if (/[>|;&]/.test(normalized)) return false;
  if (MUTATING_RE.test(normalized)) return false;
  return CACHEABLE_RE.test(normalized);
}

export function getCachedCommandOutput(workspaceDir: string, command: string): string | null {
  if (!isCommandCacheable(command)) return null;
  const signature = buildProjectIndex(workspaceDir).signature;
  const key = cacheKey(workspaceDir, command, signature);
  const cache = readCache(workspaceDir);
  return cache.entries.find((entry) => entry.key === key)?.output ?? null;
}

export function putCachedCommandOutput(workspaceDir: string, command: string, output: string): void {
  if (!isCommandCacheable(command)) return;
  const signature = buildProjectIndex(workspaceDir).signature;
  const key = cacheKey(workspaceDir, command, signature);
  const cache = readCache(workspaceDir);
  const next: CommandCacheEntry = {
    key,
    command,
    output,
    workspaceSignature: signature,
    createdAt: new Date().toISOString(),
  };
  cache.entries = [next, ...cache.entries.filter((entry) => entry.key !== key)].slice(0, MAX_ENTRIES);
  writeCache(workspaceDir, cache);
}

function cacheKey(workspaceDir: string, command: string, signature: string): string {
  return crypto.createHash("sha256")
    .update(path.resolve(workspaceDir))
    .update("\n")
    .update(command.trim())
    .update("\n")
    .update(signature)
    .digest("hex");
}

function cachePath(workspaceDir: string): string {
  return path.join(workspaceDir, ".swarm", "cache", "command-cache.json");
}

function readCache(workspaceDir: string): CommandCacheFile {
  const file = cachePath(workspaceDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as CommandCacheFile;
    if (parsed.version === 1 && Array.isArray(parsed.entries)) return parsed;
  } catch {
    // Missing or malformed cache: rebuild lazily.
  }
  return { version: 1, entries: [] };
}

function writeCache(workspaceDir: string, cache: CommandCacheFile): void {
  const file = cachePath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), "utf-8");
}
