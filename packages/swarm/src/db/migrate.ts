import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.js";
import { assertConnected, pool } from "./pool.js";
import { backfillRuns } from "./store.js";

// Apply generated Drizzle migrations (drizzle/) idempotently. The migrator
// tracks applied migrations in a __drizzle_migrations table, so this is safe to
// run on every startup. After DDL, backfill legacy projects into the runs table.
export async function migrate(): Promise<void> {
  await assertConnected();
  const here = path.dirname(fileURLToPath(import.meta.url)); // dist/db
  const migrationsFolder = path.resolve(here, "..", "..", "drizzle");
  await drizzleMigrate(db, { migrationsFolder });
  await backfillRuns();
}

// Allow running directly: `node dist/db/migrate.js`
if (process.argv[1]?.endsWith("migrate.js")) {
  migrate()
    .then(() => { console.log("[db] migrations applied"); return pool.end(); })
    .then(() => process.exit(0))
    .catch((err) => { console.error(`[db] migration failed: ${err.message}`); process.exit(1); });
}
