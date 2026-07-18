import fs from "node:fs";
import path from "node:path";
import { isArtifactPathAllowed, isProjectCodePath, shouldSkipArtifactEntry } from "./artifacts.js";
import { detectCodeRoots, shouldSkipWorkspaceIndexPath } from "./workspace-layout.js";

export type ProjectFileKind =
  | "runbook"
  | "package"
  | "entrypoint"
  | "source"
  | "test"
  | "doc"
  | "config"
  | "asset"
  | "other";

export interface ProjectFileSummary {
  path: string;
  size: number;
  mtimeMs: number;
  kind: ProjectFileKind;
}

export interface ProjectIndex {
  files: ProjectFileSummary[];
  roots: string[];
  markers: string[];
  packageManagers: string[];
  scripts: Record<string, string>;
  envVars: string[];
  likelyCommands: string[];
  totalFiles: number;
  totalBytes: number;
  signature: string;
  generatedAt: string;
}

const MAX_INDEX_FILES = 2000;

const MARKER_FILES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "index.html",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pubspec.yaml",
  "build.gradle",
  "settings.gradle",
  "Package.swift",
  "PROJECT-MANIFEST.md",
  "README.md",
]);

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".swift", ".dart",
  ".html", ".css", ".scss", ".vue", ".svelte",
]);

const TEST_RE = /(^|[./_-])(test|spec|e2e|playwright|vitest|jest|pytest)([./_-]|$)/i;

export function buildProjectIndex(workspaceDir: string): ProjectIndex {
  const files: ProjectFileSummary[] = [];
  const markers = new Set<string>();
  const packageManagers = new Set<string>();
  const scripts: Record<string, string> = {};
  const envVars = new Set<string>();
  let totalFiles = 0;
  let totalBytes = 0;

  const walk = (dir: string) => {
    if (files.length >= MAX_INDEX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || shouldSkipArtifactEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(workspaceDir, full).replace(/\\/g, "/");
      if (!isArtifactPathAllowed(rel) || shouldSkipWorkspaceIndexPath(rel)) continue;

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      totalFiles++;
      totalBytes += stat.size;
      if (MARKER_FILES.has(entry.name)) markers.add(rel);
      detectPackageManager(rel, packageManagers);
      collectFileFacts(full, rel, scripts, envVars);
      files.push({
        path: rel,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        kind: classifyFile(rel),
      });
    }
  };

  walk(workspaceDir);
  files.sort((a, b) => filePriority(a) - filePriority(b) || a.path.localeCompare(b.path));
  return {
    files,
    roots: detectCodeRoots(workspaceDir),
    markers: Array.from(markers).sort(),
    packageManagers: Array.from(packageManagers).sort(),
    scripts,
    envVars: Array.from(envVars).sort(),
    likelyCommands: likelyCommands(scripts, packageManagers),
    totalFiles,
    totalBytes,
    signature: indexSignature(files),
    generatedAt: new Date().toISOString(),
  };
}

export function formatProjectIndex(index: ProjectIndex, limit = 160): string {
  const visible = index.files.slice(0, limit);
  const lines = [
    `Files indexed: ${index.totalFiles} (${Math.round(index.totalBytes / 1024)}KB)`,
    `Roots: ${index.roots.join(", ") || "(none)"}`,
    `Markers: ${index.markers.join(", ") || "(none)"}`,
    `Package managers: ${index.packageManagers.join(", ") || "(unknown)"}`,
    `Likely local commands: ${index.likelyCommands.join(" | ") || "(none detected)"}`,
    `Env vars referenced: ${index.envVars.slice(0, 40).join(", ") || "(none detected)"}`,
    `Package scripts: ${Object.entries(index.scripts).slice(0, 20).map(([k, v]) => `${k}=${v}`).join(" | ") || "(none)"}`,
    "Key files:",
    ...visible.map((file) => `- ${file.path} (${file.kind}, ${Math.round(file.size / 1024)}KB)`),
  ];
  if (index.files.length > visible.length) lines.push(`- ... ${index.files.length - visible.length} more indexed files omitted from prompt`);
  return lines.join("\n");
}

function detectPackageManager(filePath: string, out: Set<string>) {
  const base = path.posix.basename(filePath);
  if (base === "pnpm-lock.yaml" || filePath === "pnpm-workspace.yaml") out.add("pnpm");
  if (base === "yarn.lock") out.add("yarn");
  if (base === "package-lock.json") out.add("npm");
  if (base === "bun.lockb" || base === "bun.lock") out.add("bun");
  if (base === "requirements.txt" || base === "pyproject.toml") out.add("python");
  if (base === "Cargo.toml") out.add("cargo");
  if (base === "go.mod") out.add("go");
}

function collectFileFacts(fullPath: string, relPath: string, scripts: Record<string, string>, envVars: Set<string>) {
  const base = path.posix.basename(relPath);
  const ext = path.posix.extname(relPath).toLowerCase();
  if (base === "package.json") {
    try {
      const pkg = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as { scripts?: Record<string, unknown> };
      for (const [name, value] of Object.entries(pkg.scripts || {})) {
        if (typeof value === "string") scripts[name] = value;
      }
    } catch {
      // Ignore malformed/generated package files; agents can inspect them if needed.
    }
  }
  if (!SOURCE_EXTENSIONS.has(ext) && ![".json", ".yaml", ".yml", ".toml", ".md", ".env"].includes(ext)) return;
  let content = "";
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 120_000) return;
    content = fs.readFileSync(fullPath, "utf-8");
  } catch {
    return;
  }
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
    /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
    /\b([A-Z][A-Z0-9_]{2,})=/g,
  ];
  for (const re of patterns) {
    for (const match of content.matchAll(re)) {
      const key = match[1];
      if (key && !key.startsWith("npm_") && key !== "PATH") envVars.add(key);
    }
  }
}

function likelyCommands(scripts: Record<string, string>, managers: Set<string>): string[] {
  const pm = managers.has("pnpm") ? "pnpm" : managers.has("yarn") ? "yarn" : managers.has("bun") ? "bun" : "npm";
  const out: string[] = [];
  for (const name of ["install", "typecheck", "lint", "test", "build", "dev", "start"]) {
    if (name === "install") {
      out.push(managers.has("pnpm") ? "pnpm install" : managers.has("yarn") ? "yarn install" : managers.has("bun") ? "bun install" : "npm install");
      continue;
    }
    if (scripts[name]) out.push(`${pm} run ${name}`);
  }
  if (managers.has("cargo")) out.push("cargo test");
  if (managers.has("go")) out.push("go test ./...");
  if (managers.has("python")) out.push("python -m pytest");
  return Array.from(new Set(out)).slice(0, 12);
}

function indexSignature(files: ProjectFileSummary[]): string {
  return files.map((f) => `${f.path}:${f.size}:${Math.round(f.mtimeMs)}`).join("|").slice(0, 20_000);
}

export function selectContextFiles(index: ProjectIndex, patterns: string[], maxFiles = 28): string[] {
  const normalizedPatterns = patterns.map((pattern) => pattern.replace(/\\/g, "/").replace(/\/$/, ""));
  const matches = index.files.filter((file) => normalizedPatterns.some((pattern) => matchesPattern(file.path, pattern)));
  const docs = matches.filter((file) => !isProjectCodePath(file.path) && ["doc", "config", "package", "runbook"].includes(file.kind));
  const keyCode = matches.filter((file) => isProjectCodePath(file.path) && isKeyCodeContext(file));
  const tests = matches.filter((file) => file.kind === "test").slice(0, 6);
  const selected = [...docs, ...keyCode, ...tests]
    .sort((a, b) => filePriority(a) - filePriority(b) || a.path.localeCompare(b.path));
  return Array.from(new Set(selected.map((file) => file.path))).slice(0, maxFiles);
}

function classifyFile(filePath: string): ProjectFileKind {
  const base = path.posix.basename(filePath);
  const ext = path.posix.extname(filePath).toLowerCase();
  if (/PROJECT-MANIFEST\.md|README\.md|RUNBOOK\.md/i.test(base)) return "runbook";
  if (/^(package\.json|pnpm-workspace\.yaml|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pubspec\.yaml)$/i.test(base)) return "package";
  if (/^(index\.html|main\.[jt]sx?|app\.[jt]sx?|server\.[jt]s|main\.py)$/i.test(base)) return "entrypoint";
  if (TEST_RE.test(filePath)) return "test";
  if ([".md", ".mdx", ".txt"].includes(ext)) return "doc";
  if ([".json", ".yaml", ".yml", ".toml", ".env", ".config"].includes(ext) || /\.(config|rc)\.[cm]?[jt]s$/i.test(base)) return "config";
  if (SOURCE_EXTENSIONS.has(ext)) return "source";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".mp4", ".mp3", ".wav", ".pdf"].includes(ext)) return "asset";
  return "other";
}

function matchesPattern(filePath: string, pattern: string): boolean {
  if (!pattern || pattern === ".") return true;
  if (filePath === pattern) return true;
  return filePath.startsWith(`${pattern}/`);
}

function isKeyCodeContext(file: ProjectFileSummary): boolean {
  if (file.size > 60_000) return false;
  return ["runbook", "package", "entrypoint", "config"].includes(file.kind)
    || /(^|\/)(README|PROJECT-MANIFEST)\.md$/i.test(file.path);
}

function filePriority(file: ProjectFileSummary): number {
  const priorities: Record<ProjectFileKind, number> = {
    runbook: 0,
    package: 1,
    entrypoint: 2,
    doc: 3,
    config: 4,
    test: 5,
    source: 6,
    asset: 7,
    other: 8,
  };
  return priorities[file.kind] ?? 9;
}
