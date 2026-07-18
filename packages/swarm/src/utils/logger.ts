import path from "node:path";
import chalk from "chalk";
import { insertLogs, insertAgentRun } from "../db/store.js";
import { redactSecrets, redactDeep } from "./env-scope.js";
import type { AgentRole, Phase, LogEntry, LogLevel, LogCategory, AgentRunLog } from "../types.js";

const ROLE_COLORS: Record<string, (text: string) => string> = {
  orchestrator: chalk.bold.white,
  researcher: chalk.cyan,
  "product-manager": chalk.yellow,
  designer: chalk.magenta,
  "principal-engineer": chalk.red,
  "frontend-dev": chalk.green,
  "backend-dev": chalk.blue,
  "qa-engineer": chalk.yellowBright,
  devops: chalk.gray,
};

let loggerInstance: SwarmLogger | null = null;

export class SwarmLogger {
  private project: string;
  private runId?: string; // current work order; attributes logs/agent-runs to a run
  private entries: LogEntry[] = [];
  private agentRuns: AgentRunLog[] = [];
  // Write-behind state: log() stays synchronous; entries are buffered and
  // flushed to Postgres in batches so the DB is the source of truth.
  private pending: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dbQueue: Promise<unknown> = Promise.resolve();

  constructor(workspaceDir: string) {
    // Project name is the workspace folder name (.swarm/workspaces/<name>).
    this.project = path.basename(workspaceDir);
    loggerInstance = this;
  }

  // Attribute subsequent logs/agent-runs to a specific run (work order).
  setRunId(runId: string) {
    this.runId = runId;
  }

  log(level: LogLevel, category: LogCategory, message: string, opts?: {
    agent?: AgentRole;
    phase?: Phase;
    metadata?: Record<string, unknown>;
  }) {
    // Redact secrets before the entry is buffered, printed, or persisted — this
    // is the single choke point that keeps credentials out of the DB/dashboard.
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      category,
      message: redactSecrets(message),
      agent: opts?.agent,
      phase: opts?.phase,
      metadata: opts?.metadata ? redactDeep(opts.metadata) : opts?.metadata,
    };

    this.entries.push(entry);
    this.pending.push(entry);
    this.persist();

    // Console output with colors
    this.printEntry(entry);
  }

  recordAgentRun(run: AgentRunLog) {
    // The full prompt and model output are the biggest leak surface (a model
    // may echo a `.env`, a build may print an env var). Redact before storing.
    const safeRun: AgentRunLog = {
      ...run,
      promptSent: redactSecrets(run.promptSent),
      fullOutput: redactSecrets(run.fullOutput),
      summary: redactSecrets(run.summary),
      error: run.error ? redactSecrets(run.error) : run.error,
      doubtsRaised: redactDeep(run.doubtsRaised),
    };
    this.agentRuns.push(safeRun);
    const runId = this.runId;
    this.enqueueDb(() => insertAgentRun(this.project, safeRun, runId));
  }

  getEntries(filter?: { level?: LogLevel; category?: LogCategory; agent?: AgentRole; phase?: Phase; limit?: number }): LogEntry[] {
    let result = this.entries;
    if (filter?.level) result = result.filter(e => e.level === filter.level);
    if (filter?.category) result = result.filter(e => e.category === filter.category);
    if (filter?.agent) result = result.filter(e => e.agent === filter.agent);
    if (filter?.phase) result = result.filter(e => e.phase === filter.phase);
    if (filter?.limit) result = result.slice(-filter.limit);
    return result;
  }

  getAgentRuns(filter?: { role?: AgentRole; phase?: Phase }): AgentRunLog[] {
    let result = this.agentRuns;
    if (filter?.role) result = result.filter(r => r.role === filter.role);
    if (filter?.phase) result = result.filter(r => r.phase === filter.phase);
    return result;
  }

  getRecentLogs(count: number = 50): LogEntry[] {
    return this.entries.slice(-count);
  }

  private persist() {
    // Debounce: flush buffered entries to Postgres at most every 500ms.
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, 500);
  }

  private flushPending() {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const runId = this.runId;
    this.enqueueDb(() => insertLogs(this.project, batch, runId));
  }

  private enqueueDb(fn: () => Promise<unknown>) {
    // Serialize DB writes so batches land in order and errors don't crash the run.
    this.dbQueue = this.dbQueue.then(fn).catch((err) =>
      console.error(`[logger] DB write failed: ${err instanceof Error ? err.message : err}`));
  }

  /** Flush all buffered logs/runs and await completion (call before exit). */
  async shutdown(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.flushPending();
    await this.dbQueue;
  }

  private printEntry(entry: LogEntry) {
    const time = chalk.dim(new Date(entry.timestamp).toLocaleTimeString());
    const levelColors: Record<LogLevel, (s: string) => string> = {
      debug: chalk.dim,
      info: chalk.white,
      warn: chalk.yellow,
      error: chalk.red,
    };
    const colorFn = levelColors[entry.level];

    if (entry.agent) {
      const agentColor = ROLE_COLORS[entry.agent] || chalk.white;
      console.log(`${time} ${agentColor(`[${entry.agent}]`)} ${colorFn(entry.message)}`);
    } else {
      const catTag = chalk.dim(`[${entry.category}]`);
      console.log(`${time} ${catTag} ${colorFn(entry.message)}`);
    }
  }
}

// --- Convenience functions (backward-compatible + logger-aware) ---

function getLogger(): SwarmLogger | null {
  return loggerInstance;
}

export function logAgent(role: AgentRole, message: string, phase?: Phase) {
  const logger = getLogger();
  if (logger) {
    logger.log("info", "agent", message, { agent: role, phase });
  } else {
    const colorFn = ROLE_COLORS[role] || chalk.white;
    console.log(`${colorFn(`[${role}]`)} ${message}`);
  }
}

export function logPhase(phase: Phase, status: "start" | "complete" | "error") {
  const icons = { start: ">>>", complete: "<<<", error: "!!!" };
  const message = `Phase: ${phase.toUpperCase()} ${status === "start" ? "started" : status}`;
  const logger = getLogger();
  if (logger) {
    const level: LogLevel = status === "error" ? "error" : "info";
    logger.log(level, "phase", `${icons[status]} ${message} ${icons[status]}`, { phase });
  } else {
    const colors = { start: chalk.blueBright, complete: chalk.greenBright, error: chalk.redBright };
    console.log(colors[status](`\n${icons[status]} ${message} ${icons[status]}\n`));
  }
}

export function logDoubt(role: AgentRole, question: string) {
  const logger = getLogger();
  if (logger) {
    logger.log("warn", "doubt", question, { agent: role, metadata: { question } });
  } else {
    console.log(chalk.bgYellow.black(`\n??? DOUBT from [${role}] ???`));
    console.log(chalk.yellow(question));
  }
}

export function logArtifact(artifactPath: string, role: AgentRole) {
  const logger = getLogger();
  if (logger) {
    logger.log("info", "artifact", `Created: ${artifactPath}`, { agent: role, metadata: { path: artifactPath } });
  } else {
    console.log(chalk.dim(`    -> artifact: ${artifactPath} (by ${role})`));
  }
}

export function logSystem(message: string) {
  const logger = getLogger();
  if (logger) {
    logger.log("info", "system", message);
  } else {
    console.log(chalk.dim.italic(`[system] ${message}`));
  }
}

export function logError(message: string) {
  const logger = getLogger();
  if (logger) {
    logger.log("error", "error", message);
  } else {
    console.log(chalk.red(`[error] ${message}`));
  }
}

export function logLearning(message: string, metadata?: Record<string, unknown>) {
  const logger = getLogger();
  if (logger) {
    logger.log("info", "learning", message, { metadata });
  } else {
    console.log(chalk.magentaBright(`[learning] ${message}`));
  }
}
