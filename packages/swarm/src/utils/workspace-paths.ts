import path from "node:path";

export const SWARM_DIR = ".swarm";
export const WORKSPACES_DIR = "workspaces";

export function swarmDir(root = process.cwd()): string {
  return path.resolve(root, SWARM_DIR);
}

export function workspaceRoot(root = process.cwd()): string {
  return path.join(swarmDir(root), WORKSPACES_DIR);
}

export function projectWorkspace(project: string, root = process.cwd()): string {
  return path.join(workspaceRoot(root), project);
}

export function isWorkspaceRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return path.basename(resolved) === WORKSPACES_DIR && path.basename(path.dirname(resolved)) === SWARM_DIR;
}
