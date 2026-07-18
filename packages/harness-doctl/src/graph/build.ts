import type { HarnessSpec } from "../spec/types.js";
import type { GraphNode, ResourceGraph } from "./types.js";

// Pure transform: validated spec -> Resource Graph. No I/O, no side effects.
export function buildGraph(spec: HarnessSpec): ResourceGraph {
  const nodes: Record<string, GraphNode> = {};
  const edges: Array<[string, string]> = [];

  // One Droplet per project (isolation model: one Droplet + DB per project).
  const droplet = "droplet:main";
  nodes[droplet] = {
    id: droplet,
    kind: "compute",
    attrs: { region: spec.region, tier: spec.tier ?? "standard" },
  };

  for (const [name, db] of Object.entries(spec.resources.db ?? {})) {
    const id = `db:${name}`;
    nodes[id] = {
      id,
      kind: "postgres",
      attrs: { engine: db.engine, rls: db.rls ?? "required", backups: db.backups ?? null },
    };
    edges.push([droplet, id]);
  }

  for (const [name, bucket] of Object.entries(spec.resources.bucket ?? {})) {
    const id = `bucket:${name}`;
    nodes[id] = { id, kind: "object_storage", attrs: { public: bucket.public ?? false } };
  }

  if (spec.resources.auth) {
    const id = `auth:${spec.resources.auth.provider}`;
    nodes[id] = {
      id,
      kind: "auth",
      attrs: { provider: spec.resources.auth.provider, providers: spec.resources.auth.providers ?? ["email"] },
    };
    edges.push([droplet, id]);
  }

  for (const [name, svc] of Object.entries(spec.services)) {
    const id = `svc:${name}`;
    nodes[id] = {
      id,
      kind: "service",
      attrs: { build: svc.build, routes: svc.routes ?? [], env: svc.env ?? {} },
    };
    edges.push([droplet, id]);
    for (const need of svc.needs ?? []) {
      const target = resolveNeed(need, spec);
      if (target && nodes[target]) edges.push([id, target]);
    }
  }

  return { project: spec.project, region: spec.region, nodes, edges };
}

// "db.main" -> "db:main", "bucket.uploads" -> "bucket:uploads", "auth" -> "auth:<provider>"
function resolveNeed(need: string, spec: HarnessSpec): string | null {
  if (need === "auth") return spec.resources.auth ? `auth:${spec.resources.auth.provider}` : null;
  const [kind, name] = need.split(".", 2);
  if (!kind || !name) return null;
  return `${kind}:${name}`;
}
