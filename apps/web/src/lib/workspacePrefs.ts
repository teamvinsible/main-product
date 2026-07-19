export type WorkspacePrefs = {
  displayName: string;
  workspaceName: string;
  notifyLive: boolean;
  notifyDecisions: boolean;
  notifyReady: boolean;
};

const STORAGE_KEY = "teamvinsible-workspace";

const DEFAULTS: WorkspacePrefs = {
  displayName: "You",
  workspaceName: "Workspace",
  notifyLive: true,
  notifyDecisions: true,
  notifyReady: false,
};

export function readWorkspacePrefs(): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<WorkspacePrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeWorkspacePrefs(next: WorkspacePrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function clearWorkspacePrefs() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "TV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
