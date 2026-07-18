import fs from "node:fs";
import path from "node:path";
import {
  ARTIFACT_BASE,
  ARTIFACT_DOC_DIRS,
  CODE_ROOT_DIRS,
  isDocumentArtifactPath,
  shouldSkipArtifactEntry,
} from "./artifacts.js";

const PROJECT_MARKERS = new Set([
  "package.json",
  "index.html",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pubspec.yaml",
  "build.gradle",
  "settings.gradle",
  "Package.swift",
]);

const DEFAULT_CODE_ROOT = "app";

export interface WorkspaceLayoutReport {
  migratedArtifactDirs: string[];
  removedEmptyCodeRoots: string[];
  primaryCodeRoot: string;
  codeRoots: string[];
}

export function directoryHasFiles(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const walk = (current: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || shouldSkipSourceEntry(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory() && walk(fullPath)) return true;
    }
    return false;
  };
  return walk(dir);
}

export function resolveCodeRootPath(workspaceDir: string, root: string): string {
  const normalized = root.replace(/\/$/, "") || ".";
  return normalized === "." ? path.resolve(workspaceDir) : path.join(workspaceDir, normalized);
}

export function detectCodeRoots(workspaceDir: string): string[] {
  const roots = new Set<string>();
  const commonCandidates = [...CODE_ROOT_DIRS, "android", "ios"];
  for (const dir of commonCandidates) {
    const abs = path.join(workspaceDir, dir);
    if (directoryHasFiles(abs)) roots.add(`${dir}/`);
  }

  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && PROJECT_MARKERS.has(entry.name))) {
      const rel = path.relative(workspaceDir, dir).replace(/\\/g, "/");
      roots.add(rel ? `${rel}/` : "./");
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || shouldSkipSourceEntry(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(path.resolve(workspaceDir), 0);
  return Array.from(roots).sort();
}

export function resolvePrimaryCodeRoot(workspaceDir: string): string {
  for (const root of detectCodeRoots(workspaceDir)) {
    const abs = resolveCodeRootPath(workspaceDir, root);
    if (directoryHasFiles(abs)) return abs;
  }
  return path.join(workspaceDir, DEFAULT_CODE_ROOT);
}

export function resolveImportTarget(workspaceDir: string): string {
  if (hasImportedSource(workspaceDir)) {
    return resolvePrimaryCodeRoot(workspaceDir);
  }
  return path.join(workspaceDir, DEFAULT_CODE_ROOT);
}

export function hasImportedSource(workspaceDir: string): boolean {
  return detectCodeRoots(workspaceDir).some((root) => directoryHasFiles(resolveCodeRootPath(workspaceDir, root)));
}

export function primaryCodeRootLabel(workspaceDir: string): string {
  const abs = resolvePrimaryCodeRoot(workspaceDir);
  const rel = path.relative(workspaceDir, abs).replace(/\\/g, "/");
  return rel ? `${rel}/` : "./";
}

export function migrateLegacyArtifactLayout(workspaceDir: string): string[] {
  const migrated: string[] = [];
  fs.mkdirSync(path.join(workspaceDir, ARTIFACT_BASE), { recursive: true });
  for (const dir of ARTIFACT_DOC_DIRS) {
    const legacy = path.join(workspaceDir, dir);
    if (!fs.existsSync(legacy)) continue;
    const modern = path.join(workspaceDir, ARTIFACT_BASE, dir);
    if (fs.existsSync(modern)) mergeDir(legacy, modern);
    else fs.renameSync(legacy, modern);
    if (fs.existsSync(legacy)) fs.rmSync(legacy, { recursive: true, force: true });
    migrated.push(dir);
  }
  return migrated;
}

export function removeEmptyCodeRootDirs(workspaceDir: string): string[] {
  const removed: string[] = [];
  const roots = detectCodeRoots(workspaceDir);
  const rootHasMarkers = directoryHasProjectMarkers(workspaceDir);
  for (const dir of CODE_ROOT_DIRS) {
    const abs = path.join(workspaceDir, dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory() || directoryHasFiles(abs)) continue;
    const othersHaveFiles = roots
      .filter((root) => root !== `${dir}/`)
      .some((root) => directoryHasFiles(resolveCodeRootPath(workspaceDir, root)));
    if (!othersHaveFiles && !rootHasMarkers) continue;
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(`${dir}/`);
    } catch {
      // Best-effort cleanup only.
    }
  }
  return removed;
}

export function ensureWorkspaceLayout(workspaceDir: string): WorkspaceLayoutReport {
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, ARTIFACT_BASE), { recursive: true });
  const migratedArtifactDirs = migrateLegacyArtifactLayout(workspaceDir);
  const removedEmptyCodeRoots = removeEmptyCodeRootDirs(workspaceDir);
  const codeRoots = detectCodeRoots(workspaceDir);
  return {
    migratedArtifactDirs,
    removedEmptyCodeRoots,
    primaryCodeRoot: primaryCodeRootLabel(workspaceDir),
    codeRoots,
  };
}

export function copySourceTree(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const sourceRoot = path.resolve(sourceDir);
  const targetRoot = path.resolve(targetDir);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipSourceEntry(entry.name)) continue;
      const src = path.join(dir, entry.name);
      const rel = path.relative(sourceRoot, src);
      const dest = path.join(targetRoot, rel);
      if (!dest.startsWith(targetRoot)) continue;
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        walk(src);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  };
  walk(sourceRoot);
}

function directoryHasProjectMarkers(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isFile() && PROJECT_MARKERS.has(entry.name));
  } catch {
    return false;
  }
}

function shouldSkipSourceEntry(name: string): boolean {
  return name === ARTIFACT_BASE || shouldSkipArtifactEntry(name);
}

function mergeDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) mergeDir(src, dest);
    else if (entry.isFile() && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
  }
}

export function shouldSkipWorkspaceIndexPath(filePath: string): boolean {
  return isDocumentArtifactPath(filePath);
}
