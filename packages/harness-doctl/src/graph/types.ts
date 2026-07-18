// The Resource Graph: our machine-readable "Application Model" derived from the
// spec. Consumed by every renderer and exposed on the control API for agents.
// See ARCHITECTURE.md §5.

export type NodeKind = "compute" | "postgres" | "object_storage" | "auth" | "service";

export interface GraphNode {
  id: string; // e.g. "db:main", "svc:api"
  kind: NodeKind;
  attrs: Record<string, unknown>;
}

export interface ResourceGraph {
  project: string;
  region: string;
  nodes: Record<string, GraphNode>;
  /** directed dependency edges [from, to], e.g. ["svc:api", "db:main"] */
  edges: Array<[string, string]>;
}

export function nodesOfKind(graph: ResourceGraph, kind: NodeKind): GraphNode[] {
  return Object.values(graph.nodes).filter((n) => n.kind === kind);
}
