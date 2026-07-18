import type { RenderedStack } from "../render/types.js";

export type GateLevel = "pass" | "warn" | "error" | "skip";

export interface GateResult {
  id: string;
  level: GateLevel;
  message: string;
}

export interface GateReport {
  /** true only if there are zero error-level results. */
  ok: boolean;
  summary: string;
  results: GateResult[];
}

export interface Gate {
  id: string;
  run(stack: RenderedStack): GateResult[] | Promise<GateResult[]>;
}
