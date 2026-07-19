import pg from "pg";

// Single shared connection pool. Config comes from DATABASE_URL (preferred) or
// discrete PG* vars, defaulting to the docker-compose Postgres on localhost.
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when NODE_ENV=production");
}
const connectionString = process.env.DATABASE_URL || "postgres://swarm:swarm@localhost:5432/swarm";

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

let warned = false;
pool.on("error", (err) => {
  // Background idle-client errors shouldn't crash the process.
  if (!warned) {
    console.error(`[db] pool error: ${err.message}`);
    warned = true;
  }
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Verify connectivity; throws a clear, actionable error if Postgres is down. */
export async function assertConnected(): Promise<void> {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot connect to Postgres (${connectionString.replace(/:[^:@/]+@/, ":****@")}): ${msg}\n` +
      `Start the database with:  docker compose up -d`,
    );
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
