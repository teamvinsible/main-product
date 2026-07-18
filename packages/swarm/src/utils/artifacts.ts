import path from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".swarm",
  ".wt",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  ".cache",
  ".logs",
  ".turbo",
  ".parcel-cache",
  ".vite",
  "__pycache__",
  "-p",
  // Playwright / test-run output: heavy, regenerated, never a real deliverable.
  "test-results",
  "playwright-report",
  ".playwright",
]);

const SKIP_FILE_PATTERNS = [
  /^tsc?-.+\.txt$/i,
  /^ts-.+\.txt$/i,
  /^npm-debug\.log$/i,
  /^yarn-error\.log$/i,
  /^pnpm-debug\.log$/i,
  /^\$null$/i,
  /^\{$/i,
];

// Single project-local folder that holds ALL generated support documents. Every
// support-doc directory lives UNDER this folder (e.g. _artifacts/product/prd.md)
// so the project root shows only the real app code. Everything under it is kept
// LOCAL-ONLY — gitignored, never committed or pushed to the project's git repo.
export const ARTIFACT_BASE = "_artifacts";

// Build the on-disk location of a support-doc directory (or file) under the
// artifact base, e.g. artifactDir("qa") -> "_artifacts/qa".
export function artifactDir(...segments: string[]): string {
  return [ARTIFACT_BASE, ...segments].join("/");
}

// The support-document sub-directory names (research, PRDs, design specs, test
// plans, marketing copy, …). On disk they live at `${ARTIFACT_BASE}/<name>`.
// Kept as bare names for classification and legacy-layout cleanup.
export const ARTIFACT_DOC_DIRS = [
  "research",
  "product",
  "branding",
  "design",
  "architecture",
  "qa",
  "seo",
  "marketing",
  "analytics",
  "change",
  "retro",
  "chat",
];

// Directories that hold actual project code (plus infra/config that belongs in
// the repo, e.g. devops/). These are committed & pushed to git and are NOT
// listed as document artifacts.
export const CODE_ROOT_DIRS = [
  "app",
  "web",
  "api",
  "widget",
  "frontend",
  "backend",
  "packages",
  "src",
  "devops",
];

export function normalizeArtifactPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function isArtifactPathAllowed(filePath: string): boolean {
  const normalized = normalizeArtifactPath(filePath);
  if (!normalized || normalized.startsWith("../")) return false;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => SKIP_DIRS.has(part))) return false;
  const base = path.posix.basename(normalized);
  if (SKIP_FILE_PATTERNS.some((pattern) => pattern.test(base))) return false;
  return true;
}

export function shouldSkipArtifactEntry(name: string): boolean {
  return SKIP_DIRS.has(name);
}

function topSegment(filePath: string): string {
  return normalizeArtifactPath(filePath).split("/").filter(Boolean)[0] || "";
}

// True when the path lives under a code root (project code / infra). Such files
// are committed to git and excluded from the document-artifact list.
export function isProjectCodePath(filePath: string): boolean {
  return CODE_ROOT_DIRS.includes(topSegment(filePath));
}

// True when the path is a generated support document that should stay local and
// out of the project's git repo. Matches anything under the artifact base, plus
// the legacy top-level doc dirs (pre-`_artifacts/` projects).
export function isDocumentArtifactPath(filePath: string): boolean {
  const top = topSegment(filePath);
  return top === ARTIFACT_BASE || ARTIFACT_DOC_DIRS.includes(top);
}
