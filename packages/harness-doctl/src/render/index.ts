import type { ResourceGraph } from "../graph/types.js";
import { renderCaddy } from "./caddy.js";
import { renderCompose } from "./compose.js";
import { renderInfraConfig } from "./infra-config.js";
import { renderTofu } from "./tofu.js";
import type { RenderedStack, RenderOpts } from "./types.js";

export type { RenderedStack, RenderOpts, RenderedFile } from "./types.js";

// Pure: Resource Graph + options -> the full rendered stack. Nothing is applied.
// The result is what the gate runner inspects and the Provisioner deploys.
export function renderPlan(graph: ResourceGraph, opts: RenderOpts): RenderedStack {
  return {
    project: graph.project,
    graph,
    tofu: renderTofu(graph, opts),
    compose: renderCompose(graph),
    infraConfig: renderInfraConfig(graph, opts),
    caddy: renderCaddy(graph),
    meta: { region: opts.region, prod: opts.prod },
  };
}
