/** True when a SpecCard path is a planning/spec markdown doc (Artifacts tab). */
export function isArtifactDocPath(path?: string | null): boolean {
  if (!path) return true;
  const p = path.replace(/^\/+/, "").toLowerCase();
  if (p.startsWith("artifacts/") && (p.endsWith(".md") || p.endsWith(".markdown") || p.endsWith(".mdx"))) {
    return true;
  }
  // Legacy cards with no path — treat as docs.
  if (!p.includes(".") && !p.includes("/")) return true;
  return false;
}

/** App/workspace code paths shown under Files / Code. */
export function isWorkspaceFilePath(path?: string | null): boolean {
  if (!path) return false;
  return !isArtifactDocPath(path);
}

export function workspaceFileTitle(path: string): string {
  return path.split("/").pop() || path;
}
