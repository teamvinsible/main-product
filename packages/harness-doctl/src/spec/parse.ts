import { parse as parseYaml } from "yaml";
import { buildGraph } from "../graph/build.js";
import type { ResourceGraph } from "../graph/types.js";
import { validateSpec } from "./validate.js";
import type { HarnessSpec, SpecError } from "./types.js";

export interface ParseResult {
  spec: HarnessSpec | null;
  graph: ResourceGraph | null;
  errors: SpecError[];
}

// yaml text -> validated spec -> Resource Graph. The single entry point agent-swarm
// (and the CLI) calls. Never throws on bad input; returns structured errors.
export function parseSpec(yaml: string): ParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (e) {
    return { spec: null, graph: null, errors: [{ path: "$", message: `YAML parse error: ${message(e)}` }] };
  }

  const { spec, errors } = validateSpec(raw);
  if (!spec || errors.length) return { spec: null, graph: null, errors };

  return { spec, graph: buildGraph(spec), errors: [] };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
