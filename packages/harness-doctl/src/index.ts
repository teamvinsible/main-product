// @ansi2u/harness-doctl — public surface consumed by agent-swarm (INTEGRATION §2).
// Infrastructure from Spec: parseSpec -> renderPlan -> runGates -> Provisioner.

export { parseSpec } from "./spec/parse.js";
export type { ParseResult } from "./spec/parse.js";
export { validateSpec } from "./spec/validate.js";
export type * from "./spec/types.js";

export { buildGraph } from "./graph/build.js";
export { nodesOfKind } from "./graph/types.js";
export type { ResourceGraph, GraphNode, NodeKind } from "./graph/types.js";

export { renderPlan } from "./render/index.js";
export type { RenderedStack, RenderOpts, RenderedFile } from "./render/types.js";

export { runGates } from "./gates/index.js";
export type { GateReport, GateResult, GateLevel } from "./gates/types.js";

export { Provisioner, ProvisionError, materialize, packageRoot } from "./provision/index.js";
export type { ProvisionerOpts, Layout } from "./provision/index.js";
export type { ApplyResult, BackendHealth, PlanDiff, StateRef, LogFn } from "./provision/types.js";

export {
  SopsProvider, EnvProvider, OpenBaoProvider, SecretsError,
  selectProvider, computeRequiredEnv, buildDotenv,
} from "./secrets/index.js";
export type { SecretsProvider, EnvMap } from "./secrets/index.js";
