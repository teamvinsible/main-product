// One-shot maintenance: redact secrets already persisted in the DB before
// write-time redaction was added. Idempotent — re-running only rewrites rows
// that still contain something secret-shaped.
//
// Coverage mirrors the live redaction sinks: logs (message + metadata),
// agent_runs (prompt/output/summary/error/doubts) and evals (check details,
// which carry raw command output).
//
// Note: exact-value redaction matches secrets present in the CURRENT
// environment (the loaded global .env). Rotated keys and per-project secrets
// are still caught by the shape-based patterns (provider tokens, PEM, AWS, JWT)
// and dotenv-line masking, but not by exact value.
import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { logs, agentRuns, evals } from "./schema.js";
import { redactSecrets, redactDeep } from "../utils/env-scope.js";
import type { EvalCheck } from "./schema.js";

export interface ScrubStats {
  logs: number;
  agentRuns: number;
  evals: number;
}

const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
const red = (s: string | null): string | null => (s ? redactSecrets(s) : s);

export async function scrubHistoricalSecrets(): Promise<ScrubStats> {
  const stats: ScrubStats = { logs: 0, agentRuns: 0, evals: 0 };

  // logs — message + metadata
  for (const row of await db.select().from(logs)) {
    const message = redactSecrets(row.message);
    const metadata = row.metadata ? redactDeep(row.metadata) : row.metadata;
    if (message !== row.message || changed(metadata, row.metadata)) {
      await db.update(logs).set({ message, metadata }).where(eq(logs.id, row.id));
      stats.logs++;
    }
  }

  // agent_runs — the biggest surface: full prompt + model output
  for (const row of await db.select().from(agentRuns)) {
    const promptSent = red(row.promptSent);
    const fullOutput = red(row.fullOutput);
    const summary = red(row.summary);
    const error = red(row.error);
    const doubtsRaised = redactDeep(row.doubtsRaised);
    if (
      promptSent !== row.promptSent || fullOutput !== row.fullOutput ||
      summary !== row.summary || error !== row.error || changed(doubtsRaised, row.doubtsRaised)
    ) {
      await db.update(agentRuns)
        .set({ promptSent, fullOutput, summary, error, doubtsRaised })
        .where(eq(agentRuns.id, row.id));
      stats.agentRuns++;
    }
  }

  // evals — check `detail` embeds the raw `$ command` output
  for (const row of await db.select().from(evals)) {
    const checks = redactDeep(row.checks) as EvalCheck[];
    if (changed(checks, row.checks)) {
      await db.update(evals).set({ checks }).where(eq(evals.id, row.id));
      stats.evals++;
    }
  }

  return stats;
}
