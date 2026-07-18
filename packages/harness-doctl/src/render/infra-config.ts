import { nodesOfKind, type ResourceGraph } from "../graph/types.js";
import type { RenderedFile, RenderOpts } from "./types.js";

// The seam stolen from Encore: a $env-indirected map from declared resources to
// real endpoints. Secrets never appear inline — only {"$env": "NAME"} references
// resolved from SOPS-decrypted env at deploy time. See ARCHITECTURE §3 / INTEGRATION.
export function renderInfraConfig(graph: ResourceGraph, opts: RenderOpts): RenderedFile {
  const sqlServers = nodesOfKind(graph, "postgres").map((db) => {
    const name = db.id.split(":")[1] ?? "main";
    return {
      host: `postgres_${name}:5432`,
      databases: {
        [name]: {
          username: { $env: "PG_USER" },
          password: { $env: "PG_PASSWORD" },
          sslmode: "require",
          max_connections: 100,
        },
      },
    };
  });

  const objectStorage = nodesOfKind(graph, "object_storage").map((b) => {
    const name = b.id.split(":")[1] ?? "bucket";
    return {
      type: "s3", // DO Spaces is S3-compatible
      provider: "do_spaces",
      access_key: { $env: "SPACES_KEY" },
      secret_key: { $env: "SPACES_SECRET" },
      buckets: { [name]: { name: `${graph.project}-${name}`, public: Boolean(b.attrs.public) } },
    };
  });

  const auth = nodesOfKind(graph, "auth").map(() => ({
    provider: "gotrue",
    jwt_secret: { $env: "JWT_SECRET" },
  }));

  const config = {
    metadata: {
      app_id: graph.project,
      env_type: opts.prod ? "production" : "development",
      cloud: "digitalocean",
      region: opts.region,
    },
    sql_servers: sqlServers,
    object_storage: objectStorage,
    auth,
    secrets: {
      PG_PASSWORD: { $env: "PG_PASSWORD" },
      JWT_SECRET: { $env: "JWT_SECRET" },
    },
    graceful_shutdown: { total: 30, handlers: 20, shutdown_hooks: 10 },
  };

  return { path: "infra-config.json", content: JSON.stringify(config, null, 2) + "\n" };
}
