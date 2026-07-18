export interface StateRef {
  project: string;
  tofuStateRef?: string;
  tailnetHost?: string;
}

export interface PlanDiff {
  summary: string;
  changes: string[];
}

export interface ApplyResult {
  url?: string;
  logsUrl?: string;
  dropletId?: string;
  stateRef: string;
}

export interface BackendHealth {
  ok: boolean;
  containers: Record<string, string>;
  db: string;
  backups: string;
}

export type LogFn = (level: "info" | "warn" | "error", message: string) => void;
