import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "./pool.js";
import * as schema from "./schema.js";

// Typed Drizzle client backed by the shared pg pool.
export const db = drizzle(pool, { schema });
export { schema };
