import { stringify } from "yaml";
import { nodesOfKind, type ResourceGraph } from "../graph/types.js";
import type { RenderedFile } from "./types.js";

// linux/amd64 manifests verified from their upstream registries. DigitalOcean's
// standard Droplet sizes used by this renderer are amd64.
const IMAGES = {
  caddy: "caddy:2@sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a",
  postgres16: "postgres:16@sha256:67d92986b34dce02e7a8fc0c3cbed2f905356d74c8e52b96b898e48b18e20018",
  gotrue: "supabase/gotrue:v2.170.0@sha256:d101059c3471433a25ce23b8c4f0275c447dd7f1c4ed0f30cc15893fa562fee7",
  postgrest: "postgrest/postgrest:v12.2.3@sha256:bd918a7d03c801d03802e27c19e589b53fd71ab181a5ec942705551c7dbc3d53",
  prometheus: "prom/prometheus:v3.1.0@sha256:da1630c5102817ed365a523448c766e417030a53ec3dfbe064d429df504e023e",
  nodeExporter: "prom/node-exporter:v1.8.2@sha256:065914c03336590ebed517e7df38520f0efb44465fde4123c3f6b7328f5a9396",
  cadvisor: "gcr.io/cadvisor/cadvisor:v0.49.2@sha256:ac7ec5621245371c85630f861813c8e7571d18eaeeec3fdea629eedc6ba48430",
} as const;

// Renders a hardened docker-compose.yml. Guardrails baked in:
//  - Caddy is the ONLY service that publishes host ports (80/443)
//  - Postgres sits on the `internal` network only (internal: true) => no egress,
//    no ingress port. It cannot phone home and is unreachable from the host.
//  - Services that need egress (gotrue OAuth, backup->Spaces, app services) also
//    attach to `edge`.
//  - Secrets come via ${ENV} indirection (populated from SOPS at deploy time).
// The gate runner re-parses this file and FAILS the build if a guardrail is broken.
export function renderCompose(graph: ResourceGraph): RenderedFile {
  const services: Record<string, unknown> = {};
  const dbNodes = nodesOfKind(graph, "postgres");
  const hasAuth = nodesOfKind(graph, "auth").length > 0;
  const hasDb = dbNodes.length > 0;

  // Edge — the ONLY internet-facing service. On both networks (egress for ACME).
  services.caddy = {
    image: IMAGES.caddy,
    restart: "unless-stopped",
    ports: ["80:80", "443:443"],
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data", "caddy_config:/config"],
    environment: { SITE_DOMAIN: "${SITE_DOMAIN}" }, // least-privilege: only the var Caddy needs
    networks: ["edge", "internal"],
    depends_on: dependsList(hasAuth, hasDb),
  };

  // Database — internal-only (no egress), no published port, init scripts bootstrap
  // the PostgREST roles. Data lives on the encrypted block volume via Docker data-root.
  for (const db of dbNodes) {
    const name = db.id.split(":")[1] ?? "main";
    services[`postgres_${name}`] = {
      image: pgImage(String(db.attrs.engine ?? "postgres@16")),
      restart: "unless-stopped",
      environment: {
        POSTGRES_DB: name,
        POSTGRES_USER: "${PG_USER}",
        POSTGRES_PASSWORD: "${PG_PASSWORD}",
      },
      volumes: [
        `pgdata_${name}:/var/lib/postgresql/data`,
        "./services/postgres/init:/docker-entrypoint-initdb.d:ro",
      ],
      networks: ["internal"], // NO edge => no egress. NO ports => no ingress.
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"],
        interval: "10s",
        timeout: "5s",
        retries: 5,
      },
    };

    // Backup sidecar (mandatory when backups are declared). Needs egress to Spaces.
    const backups = db.attrs.backups as { schedule?: string } | null;
    if (backups) {
      services[`pgbackup_${name}`] = {
        build: "./services/postgres/backup",
        restart: "unless-stopped",
        environment: {
          PGHOST: `postgres_${name}`,
          PGDATABASE: name,
          PGUSER: "${PG_USER}",
          PGPASSWORD: "${PG_PASSWORD}",
          BACKUP_SCHEDULE: backups.schedule ?? "0 */6 * * *",
          S3_ENDPOINT: "${SPACES_ENDPOINT}",
          S3_BUCKET: "${SPACES_BACKUP_BUCKET}",
          AWS_ACCESS_KEY_ID: "${SPACES_KEY}",
          AWS_SECRET_ACCESS_KEY: "${SPACES_SECRET}",
        },
        networks: ["internal", "edge"],
        depends_on: [`postgres_${name}`],
      };
    }
  }

  const firstDb = dbNodes[0]?.id.split(":")[1];

  if (hasAuth) {
    services.gotrue = {
      image: IMAGES.gotrue,
      restart: "unless-stopped",
      environment: {
        GOTRUE_DB_DRIVER: "postgres",
        DATABASE_URL: "${GOTRUE_DATABASE_URL}",
        GOTRUE_JWT_SECRET: "${JWT_SECRET}",
        GOTRUE_SITE_URL: "${SITE_URL}",
      },
      networks: ["internal", "edge"], // OAuth providers need egress
    };
  }

  if (firstDb) {
    services.postgrest = {
      image: IMAGES.postgrest,
      restart: "unless-stopped",
      environment: {
        PGRST_DB_URI: "${POSTGREST_DATABASE_URL}",
        PGRST_JWT_SECRET: "${JWT_SECRET}",
        PGRST_DB_ANON_ROLE: "web_anon",
      },
      networks: ["internal"], // talks only to Postgres; no egress needed
    };
  }

  // Project services (any language). Built from context; internal + edge (egress).
  for (const svc of nodesOfKind(graph, "service")) {
    const name = svc.id.split(":")[1] ?? "svc";
    services[name] = {
      build: String(svc.attrs.build ?? "."),
      restart: "unless-stopped",
      environment: svc.attrs.env ?? {},
      networks: ["internal", "edge"],
    };
  }

  services.prometheus = {
    image: IMAGES.prometheus,
    restart: "unless-stopped",
    volumes: ["./services/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro"],
    networks: ["internal"],
  };

  services.node_exporter = {
    image: IMAGES.nodeExporter,
    restart: "unless-stopped",
    command: ["--path.rootfs=/host"],
    volumes: ["/:/host:ro,rslave"],
    networks: ["internal"],
    read_only: true,
    security_opt: ["no-new-privileges:true"],
  };

  services.cadvisor = {
    image: IMAGES.cadvisor,
    restart: "unless-stopped",
    privileged: false,
    devices: ["/dev/kmsg:/dev/kmsg"],
    volumes: ["/:/rootfs:ro", "/var/run:/var/run:ro", "/sys:/sys:ro", "/var/lib/docker:/var/lib/docker:ro", "/dev/disk:/dev/disk:ro"],
    networks: ["internal"],
    security_opt: ["no-new-privileges:true"],
  };

  const doc = {
    name: graph.project,
    services,
    networks: {
      edge: {},
      internal: { internal: true },
    },
    volumes: volumeSet(graph),
  };

  return { path: "docker-compose.yml", content: stringify(doc) };
}

function dependsList(hasAuth: boolean, hasDb: boolean): string[] {
  const deps: string[] = [];
  if (hasAuth) deps.push("gotrue");
  if (hasDb) deps.push("postgrest");
  return deps;
}

function volumeSet(graph: ResourceGraph): Record<string, unknown> {
  const vols: Record<string, unknown> = { caddy_data: {}, caddy_config: {} };
  for (const db of nodesOfKind(graph, "postgres")) {
    const name = db.id.split(":")[1] ?? "main";
    vols[`pgdata_${name}`] = {};
  }
  return vols;
}

function pgImage(engine: string): string {
  const m = engine.match(/^postgres@(\d+)/);
  return (m?.[1] ?? "16") === "16" ? IMAGES.postgres16 : `postgres:${m?.[1] ?? "16"}`;
}
