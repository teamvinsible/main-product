import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { logSystem, logError } from "../utils/logger.js";
import {
  getProject, listProjects, getLogs, getActivity, getAgentRuns,
  getAllLearnings, getAllProjectHistory, getEvals, getAllEvals, getCommits, listRuns, getLatestRun,
  getPromptOverrides, upsertPrompt, deletePrompt, updateProjectGitBinding,
  updateProjectDeployBinding, getDeployments, upsertProject, upsertRun, insertLogs,
  getOpenQuestions, getQuestions, resolveQuestion, getQuestion,
  getChatMessages, addChatMessage,
} from "../db/store.js";
import { looksLikeSecretValue } from "../utils/env-scope.js";
import { DEFAULT_PROMPTS, promptCatalog } from "../prompts/prompt-store.js";
import { PROJECT_TYPES, PHASE_LIBRARY, DEFAULT_PROJECT_TYPE } from "../types.js";
import type { ModelConfig, PendingQuestion } from "../types.js";
import { analyzeIntake } from "../pipeline/intake.js";
import { runPreflight } from "../harness/preflight.js";
import { loadPolicy } from "../harness/policy.js";
import { recordChatArtifact } from "../pipeline/chat.js";
import { buildDockerRunArgs, sandboxConfigFromEnv } from "../sandbox.js";
import { isWorkspaceRoot } from "../utils/workspace-paths.js";
import { readWorkSpec, buildWorkSpec } from "../harness/work-spec.js";
import type { FlowStep } from "../types.js";
import { configuredGitProfiles, normalizeGitProfile, gitProfileEnvName } from "../git/credentials.js";
import {
  configuredDeployProfiles, normalizeDeployProfile, isDeployProvider, deployEnvName,
  deploySecretBases, deployConfigBases, DEPLOY_PROVIDERS, DEPLOY_PROVIDER_LABELS,
} from "../deploy/credentials.js";
import { handleGitHubWebhook } from "../webhooks/github.js";
import { handleGoogleChatWebhook } from "../webhooks/google-chat.js";
import { handleTelegramWebhook } from "../webhooks/telegram.js";
import { redactSecrets, scrubSecretsFromEnv } from "../utils/env-scope.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

interface DashboardOptions {
  // Control mode binds the dashboard to the workspace ROOT and enables the
  // launch/settings endpoints so runs can be started from the UI.
  controlMode?: boolean;
}

interface RunningProcess {
  name: string;
  idea: string;
  startedAt: string;
  pid: number;
  child: ChildProcess;
  stopping?: boolean;
}

interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "exited";
  exitCode?: number | null;
  child: ChildProcess;
  output: string[];
}

export class DashboardServer {
  private workspaceDir: string;
  private port: number;
  private server: http.Server | null = null;
  private workspaceRoot: string; // dir containing all project workspaces (".swarm/workspaces/")
  private projectRoot: string;   // repository root — child run cwd
  private controlMode: boolean;
  private boundProject: string | null = null; // pinned project for single-project tabs
  private running = new Map<string, RunningProcess>();
  private terminals = new Map<string, TerminalSession>();
  // Built Vite SPA (web/dist). When present it serves the UI; otherwise we fall
  // back to the legacy template-literal dashboard so nothing breaks mid-migration.
  private webDist: string | null = null;
  // ── Access control ──
  // Bind to loopback by default so the dashboard (which can write secrets and
  // launch code-executing runs) is never exposed to the LAN unless the operator
  // explicitly opts in via SWARM_BIND. A token gates every request when bound
  // non-loopback; on loopback the OS boundary + CSRF origin check suffice.
  private bind: string;
  private token: string;
  private enforceToken: boolean;
  private allowedOrigins: Set<string>;

  constructor(workspaceDir: string, port: number = 3456, options: DashboardOptions = {}) {
    this.workspaceDir = workspaceDir;
    this.port = port;
    this.controlMode = options.controlMode ?? false;

    if (this.controlMode || isWorkspaceRoot(workspaceDir) || path.basename(workspaceDir) === "workspace") {
      // Pointed at the workspace ROOT — projects live directly under it, and the
      // "active" project is resolved dynamically (most recent / running).
      this.workspaceRoot = workspaceDir;
      this.projectRoot = isWorkspaceRoot(workspaceDir)
        ? path.dirname(path.dirname(workspaceDir))
        : path.dirname(workspaceDir);
      this.boundProject = null;
    } else {
      // Pointed at a specific project (".swarm/workspaces/<name>"): pin it.
      this.boundProject = path.basename(workspaceDir);
      this.workspaceRoot = path.dirname(workspaceDir);
      this.projectRoot = isWorkspaceRoot(this.workspaceRoot)
        ? path.dirname(path.dirname(this.workspaceRoot))
        : path.dirname(this.workspaceRoot);
    }

    // Resolve the built SPA. From dist/dashboard/server.js (prod) or
    // src/dashboard/server.ts (tsx dev) the repo root is two levels up.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(here, "../../web/dist");
    if (fs.existsSync(path.join(candidate, "index.html"))) this.webDist = candidate;

    // Access control. Loopback by default; token generated always but only
    // *required* when bound non-loopback (or when SWARM_DASHBOARD_TOKEN is set).
    this.bind = (process.env.SWARM_BIND || "127.0.0.1").trim();
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(this.bind);
    this.token = process.env.SWARM_DASHBOARD_TOKEN?.trim() || randomBytes(24).toString("hex");
    this.enforceToken = !loopback || Boolean(process.env.SWARM_DASHBOARD_TOKEN);

    const hosts = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
    if (this.bind && this.bind !== "0.0.0.0" && this.bind !== "::") hosts.add(this.bind);
    this.allowedOrigins = new Set<string>();
    for (const h of hosts) this.allowedOrigins.add(`http://${h}:${this.port}`);
    for (const extra of (process.env.SWARM_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      this.allowedOrigins.add(extra);
    }
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${this.port}`);

      // Reflect only allowed origins (no wildcard) so foreign sites cannot read
      // responses; same-origin requests need no ACAO header at all.
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
      if (origin && this.allowedOrigins.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-swarm-token");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Auth: when bound non-loopback (or an explicit token is set), every
      // request must present the token via header, ?token=, or the cookie we
      // pin on first tokened load. Loopback default skips this.
      // Webhooks use their own secrets — exempt from dashboard token.
      const isWebhook = url.pathname.startsWith("/api/webhooks/");
      if (this.enforceToken && !isWebhook) {
        if (!this.tokenValid(this.extractToken(req, url))) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized: a valid dashboard token is required. Open the URL printed at startup (…/?token=…)." }));
          return;
        }
        // Bootstrap the browser: pin the token in a SameSite=Strict, HttpOnly
        // cookie so subsequent same-origin asset/API requests carry it and JS
        // can't read (or leak) it.
        if (url.searchParams.get("token")) {
          res.setHeader("Set-Cookie", `swarm_token=${this.token}; Path=/; HttpOnly; SameSite=Strict`);
        }
      }

      // CSRF: reject state-changing requests coming from a foreign origin. A
      // same-origin fetch sends a matching Origin; a malicious page's does not.
      // Webhooks (Telegram/GitHub) are server-to-server — no browser Origin.
      if (req.method === "POST" && origin && !this.allowedOrigins.has(origin) && !isWebhook) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: cross-origin request rejected." }));
        return;
      }

      // ── Webhooks (control mode; own auth) ──
      if (req.method === "POST" && isWebhook) {
        if (!this.controlMode) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Webhooks require control mode (swarm serve)." }));
          return;
        }
        this.handleWebhookPost(url.pathname, req, res);
        return;
      }

      // ── Control-mode POST endpoints ──
      if (req.method === "POST") {
        if (!this.controlMode) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Dashboard is read-only. Start it with `swarm serve` to launch runs from the UI." }));
          return;
        }
        this.handlePost(url.pathname, req, res);
        return;
      }

      // API GETs are database-backed (async).
      if (url.pathname.startsWith("/api/")) {
        void this.handleApiGet(url, res);
        return;
      }

      // The React SPA serves all non-API routes (with index.html fallback so
      // client-side routes like /project/<name> resolve on refresh).
      if (this.webDist) {
        this.serveSpa(url.pathname, res);
        return;
      }

      // No build present — tell the user how to produce one.
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><body style=\"font-family:ui-monospace,monospace;background:#0a0a0f;color:#e0e0e8;padding:40px\">" +
        "<h2>Dashboard UI not built</h2>" +
        "<p>Run <code style=\"background:#1a1a2e;padding:2px 6px;border-radius:4px\">npm run web:install &amp;&amp; npm run web:build</code> from the project root, then reload.</p>" +
        "</body></html>",
      );
      return;

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, this.bind, () => {
        const loopback = ["127.0.0.1", "::1", "localhost"].includes(this.bind);
        if (!loopback) {
          logSystem(`⚠ Dashboard bound to ${this.bind} (network-exposed). Token authentication is REQUIRED.`);
        }
        if (this.enforceToken) {
          const host = this.bind === "0.0.0.0" || this.bind === "::" ? "<this-host>" : this.bind;
          logSystem(`Dashboard access URL (token required): http://${host}:${this.port}/?token=${this.token}`);
        }
        resolve();
      });
    });
  }

  stop() {
    this.server?.close();
  }

  // Pull the token from (in order) the x-swarm-token header, the ?token= query,
  // or the swarm_token cookie pinned on first tokened load.
  private extractToken(req: http.IncomingMessage, url: URL): string | null {
    const header = req.headers["x-swarm-token"];
    if (typeof header === "string" && header.trim()) return header.trim();
    const q = url.searchParams.get("token");
    if (q) return q;
    const cookie = req.headers.cookie || "";
    const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("swarm_token="));
    return match ? decodeURIComponent(match.slice("swarm_token=".length)) : null;
  }

  // Constant-time comparison so a wrong token can't be recovered by timing.
  private tokenValid(provided: string | null): boolean {
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ── Control-mode handlers ──

  private handleWebhookPost(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      void (async () => {
        try {
          if (pathname === "/api/webhooks/telegram") {
            const result = await handleTelegramWebhook(body, req.headers, (args) => this.spawnRun(args));
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(result.body);
            return;
          }
          if (pathname === "/api/webhooks/github") {
            const result = handleGitHubWebhook(body, req.headers, (args) => this.spawnRun(args));
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(result.body);
            return;
          }
          if (pathname === "/api/webhooks/google-chat") {
            const result = await handleGoogleChatWebhook(body, req.headers, (args) => this.spawnRun(args));
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(result.body);
            return;
          }
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      })();
    });
  }

  private handlePost(pathname: string, req: http.IncomingMessage, res: http.ServerResponse) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy(); // basic guard
    });
    req.on("end", () => {
      let payload: Record<string, unknown> = {};
      try { payload = body ? JSON.parse(body) : {}; } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      const handle = async () => {
        if (pathname === "/api/intake") return this.handleIntake(payload, res);
        if (pathname === "/api/preflight") return this.handlePreflight(payload, res);
        if (pathname === "/api/run") return this.startRun(payload, res);
        if (pathname === "/api/run/stop") return this.stopRun(payload, res);
        if (pathname === "/api/resume") return this.startResume(payload, res);
        if (pathname === "/api/settings") return this.saveSettings(payload, res);
        if (pathname === "/api/env") return this.saveEnv(payload, res);
        if (pathname === "/api/mcp") return this.saveMcp(payload, res);
        if (pathname === "/api/project/git") return this.saveProjectGit(payload, res);
        if (pathname === "/api/deploy") return this.startDeploy(payload, res);
        if (pathname === "/api/project/deploy") return this.saveProjectDeploy(payload, res);
        if (pathname === "/api/prompts") return this.savePrompt(payload, res);
        if (pathname === "/api/prompts/reset") return this.resetPrompt(payload, res);
        if (pathname === "/api/questions/answer") return this.answerQuestion(payload, res);
        if (pathname === "/api/chat") return this.sendChat(payload, res);
        if (pathname === "/api/terminal/start") return this.startTerminal(payload, res);
        if (pathname === "/api/terminal/send") return this.sendTerminal(payload, res);
        if (pathname === "/api/terminal/stop") return this.stopTerminal(payload, res);

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      };

      void handle().catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        } else if (!res.writableEnded) {
          res.end();
        }
      });
    });
  }

  // Conversational intake: infer launch details (new-build vs. change, project
  // type/name, target project/intent) from one free-form message so the chat
  // Launch UI can present an infer-and-confirm card. Read-only — it never
  // spawns a run; the client still posts /api/run to actually launch.
  private async handleIntake(payload: Record<string, unknown>, res: http.ServerResponse) {
    const text = String(payload.idea || payload.text || "").trim();
    if (!text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Describe what you want to build or change." }));
      return;
    }
    const projects = Array.isArray(payload.projects) ? payload.projects.map(String) : [];
    // Planning-grade Claude for the triage — fast, and available via Claude Code
    // auth without any saved key (unlike DeepSeek).
    const modelConfig: ModelConfig = { provider: "claude", model: "claude-sonnet-4-6", tier: "low" };
    try {
      const result = await analyzeIntake(text, projects, modelConfig, this.projectRoot);
      // Re-slugify server-side so the suggested name is always launch-safe.
      if (result.mode === "new") {
        result.suggestedName = this.slugify(result.suggestedName || text);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      // Never dead-end the UI on inference failure — return a usable default.
      logError(`Intake failed: ${err instanceof Error ? err.message : String(err)}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true, mode: "new", idea: text, suggestedName: this.slugify(text),
        projectType: DEFAULT_PROJECT_TYPE, projectTypeLabel: PROJECT_TYPES[DEFAULT_PROJECT_TYPE]?.label || DEFAULT_PROJECT_TYPE,
        repo: "", project: "", intent: "", summary: "",
      }));
    }
  }

  private async handlePreflight(payload: Record<string, unknown>, res: http.ServerResponse) {
    const text = String(payload.request || payload.idea || payload.text || "").trim();
    const project = String(payload.project || "").trim();
    if (!text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request is required" }));
      return;
    }
    const dir = project
      ? path.join(this.workspaceRoot, project)
      : path.join(this.workspaceRoot, this.slugify(String(payload.name || text)));
    const state = project ? await getProject(project) : null;
    const result = runPreflight({
      request: text,
      workspaceDir: dir,
      deployProvider: state?.deployProvider,
      deployProfile: state?.deployProfile,
      env: process.env,
      policy: loadPolicy(),
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...result }));
  }

  // Launch a swarm run as a detached child process. State is written to files
  // which the existing GET endpoints surface, so the UI updates live.
  private startRun(payload: Record<string, unknown>, res: http.ServerResponse) {
    // Change-request mode: apply a feature/bugfix/etc. to an existing project.
    if (String(payload.mode || "") === "change") return this.startChange(payload, res);

    const idea = String(payload.idea || "").trim();
    if (!idea) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "An idea is required to start a run." }));
      return;
    }

    const name = (payload.name ? String(payload.name) : this.slugify(idea)).trim();
    const provider = String(payload.provider || "claude");
    const highProvider = payload.highProvider ? String(payload.highProvider) : undefined;
    const lowProvider = payload.lowProvider ? String(payload.lowProvider) : undefined;

    if (this.running.has(name)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `A run named "${name}" is already in progress.` }));
      return;
    }

    // Validate keys before spawning so the user gets an immediate, clear error.
    const settings = this.readSettings();
    const usesDeepseek = [provider, highProvider, lowProvider].includes("deepseek");
    if (usesDeepseek && !settings.deepseekKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DeepSeek is selected but no DEEPSEEK_API_KEY is saved. Add it in Settings first." }));
      return;
    }
    const usesAnthropic = [provider, highProvider, lowProvider].includes("anthropic");
    if (usesAnthropic && !settings.anthropicKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "The 'anthropic' provider is selected but no ANTHROPIC_API_KEY is saved. Add it in Settings, or use 'claude' (Agent SDK / subscription auth) instead." }));
      return;
    }
    const usesOpenRouter = [provider, highProvider, lowProvider].includes("openrouter");
    if (usesOpenRouter && !settings.openrouterKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "OpenRouter is selected but no OPENROUTER_API_KEY is saved. Add it in Settings first." }));
      return;
    }

    const repo = payload.repo ? String(payload.repo).trim() : "";
    const repoProfile = normalizeGitProfile(String(payload.repoProfile || "default"));
    const profile = settings.gitProfiles.find((p) => p.name === repoProfile);
    if (repo && !profile?.tokenSet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `A GitHub repo was given but credential profile "${repoProfile}" is not configured. Add it in Settings first.` }));
      return;
    }

    // Per-project env overrides for this new project (written to its workspace .env).
    if (payload.env && typeof payload.env === "object") {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.env as Record<string, unknown>)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(k).trim())) clean[String(k).trim()] = String(v ?? "");
      }
      if (Object.keys(clean).length) {
        this.writeEnvFile(path.join(this.workspaceRoot, name, ".env"), clean, [], false);
      }
    }

    const cliArgs = ["run", idea, "--no-ui", "--name", name, "--provider", provider];
    const projectType = payload.type ? String(payload.type) : "";
    if (projectType && projectType !== "auto") cliArgs.push("--type", projectType);
    if (repo) cliArgs.push("--repo", repo);
    cliArgs.push("--repo-profile", repoProfile);
    if (highProvider) cliArgs.push("--high-provider", highProvider);
    if (lowProvider) cliArgs.push("--low-provider", lowProvider);
    if (payload.highModel) cliArgs.push("--high-model", String(payload.highModel));
    if (payload.lowModel) cliArgs.push("--low-model", String(payload.lowModel));

    const child = this.spawnRun(cliArgs);

    const proc: RunningProcess = {
      name, idea, startedAt: new Date().toISOString(), pid: child.pid ?? -1, child,
    };
    this.running.set(name, proc);
    logSystem(`UI launched run "${name}" (pid ${child.pid}) [${provider}]`);

    child.on("exit", (code) => {
      this.running.delete(name);
      logSystem(proc.stopping ? `Run "${name}" stopped by user.` : `Run "${name}" exited with code ${code}`);
    });
    child.on("error", (err) => {
      this.running.delete(name);
      logError(`Run "${name}" failed to start: ${err.message}`);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name, pid: child.pid }));
  }

  // Launch a change-request run against an existing project (its own work order,
  // branch and PR). Spawns `swarm change <project> "<request>" [--intent ...]`.
  private async startChange(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || "").trim();
    const request = String(payload.request || "").trim();
    if (!project || !request) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A project and a change request are both required." }));
      return;
    }
    if (this.running.has(project)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `A run for "${project}" is already in progress.` }));
      return;
    }
    const existing = await getProject(project);
    if (!existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" not found. Build it first from the New Run tab.` }));
      return;
    }

    const provider = String(payload.provider || "claude");
    const highProvider = payload.highProvider ? String(payload.highProvider) : undefined;
    const lowProvider = payload.lowProvider ? String(payload.lowProvider) : undefined;
    const settings = this.readSettings();
    if ([provider, highProvider, lowProvider].includes("deepseek") && !settings.deepseekKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DeepSeek is selected but no DEEPSEEK_API_KEY is saved. Add it in Settings first." }));
      return;
    }
    if ([provider, highProvider, lowProvider].includes("anthropic") && !settings.anthropicKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "The 'anthropic' provider is selected but no ANTHROPIC_API_KEY is saved. Add it in Settings, or use 'claude' (Agent SDK / subscription auth) instead." }));
      return;
    }
    if ([provider, highProvider, lowProvider].includes("openrouter") && !settings.openrouterKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "OpenRouter is selected but no OPENROUTER_API_KEY is saved. Add it in Settings first." }));
      return;
    }

    const intent = payload.intent ? String(payload.intent) : "";
    const localOnly = Boolean(payload.localOnly);
    const repo = payload.repo ? String(payload.repo).trim() : (existing.repoUrl || "");
    const repoProfile = normalizeGitProfile(String(payload.repoProfile || existing.credentialProfile || "default"));
    const profile = settings.gitProfiles.find((p) => p.name === repoProfile);
    if (!repo && !localOnly) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" is not linked to a GitHub repo. Link a repo/profile or enable local-only for this run.` }));
      return;
    }
    if (repo && !profile?.tokenSet && !localOnly) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Credential profile "${repoProfile}" is not configured for project "${project}". Add it in Settings or use local-only.` }));
      return;
    }
    const cliArgs = ["change", project, request, "--no-ui", "--provider", provider];
    if (intent && intent !== "auto") cliArgs.push("--intent", intent);
    if (repo) cliArgs.push("--repo", repo);
    cliArgs.push("--repo-profile", repoProfile);
    if (localOnly) cliArgs.push("--local-only");
    if (highProvider) cliArgs.push("--high-provider", highProvider);
    if (lowProvider) cliArgs.push("--low-provider", lowProvider);
    if (payload.highModel) cliArgs.push("--high-model", String(payload.highModel));
    if (payload.lowModel) cliArgs.push("--low-model", String(payload.lowModel));

    const child = this.spawnRun(cliArgs);

    const proc: RunningProcess = { name: project, idea: `[${intent || "change"}] ${request}`, startedAt: new Date().toISOString(), pid: child.pid ?? -1, child };
    this.running.set(project, proc);
    logSystem(`UI launched change "${project}" (pid ${child.pid}) [${intent || "auto"}]`);

    child.on("exit", (code) => { this.running.delete(project); logSystem(proc.stopping ? `Change "${project}" stopped by user.` : `Change "${project}" exited with code ${code}`); });
    child.on("error", (err) => { this.running.delete(project); logError(`Change "${project}" failed to start: ${err.message}`); });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: project, pid: child.pid }));
  }

  // Send one message to a project's interactive chat. The user turn is stored
  // immediately (instant echo); a spawned `swarm chat` child classifies it and
  // either answers (read-only) or launches a change run. Every request is also
  // recorded to the project's local _artifacts/chat trail by the CLI.
  private async sendChat(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || "").trim();
    const message = String(payload.message || payload.text || "").trim();
    if (!project || !message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A project and a message are both required." }));
      return;
    }
    const existing = await getProject(project);
    if (!existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" not found.` }));
      return;
    }
    if (this.running.has(project) || existing.status === "running" || existing.status === "awaiting_input") {
      await addChatMessage({
        id: randomUUID(),
        project,
        runId: existing.runId || undefined,
        role: "user",
        kind: "note",
        text: message,
        meta: { duringRun: true },
      });
      const workspaceDir = existing.workspaceDir && fs.existsSync(existing.workspaceDir)
        ? existing.workspaceDir
        : path.join(this.workspaceRoot, project);
      recordChatArtifact(workspaceDir, { role: "user", kind: "run-comment", text: message });
      logSystem(`Recorded chat comment for active run "${project}"`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: project, comment: true }));
      return;
    }

    const provider = String(payload.provider || "claude");
    const highProvider = payload.highProvider ? String(payload.highProvider) : undefined;
    const lowProvider = payload.lowProvider ? String(payload.lowProvider) : undefined;
    const settings = this.readSettings();
    const usesKey = [provider, highProvider, lowProvider];
    if (usesKey.includes("deepseek") && !settings.deepseekKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DeepSeek is selected but no DEEPSEEK_API_KEY is saved. Add it in Settings first." }));
      return;
    }
    if (usesKey.includes("anthropic") && !settings.anthropicKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "The 'anthropic' provider is selected but no ANTHROPIC_API_KEY is saved." }));
      return;
    }
    if (usesKey.includes("openrouter") && !settings.openrouterKeySet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "OpenRouter is selected but no OPENROUTER_API_KEY is saved. Add it in Settings first." }));
      return;
    }

    // Instant echo: store the user's turn now; the child runs with --echoed.
    await addChatMessage({ id: randomUUID(), project, role: "user", kind: "message", text: message });

    const cliArgs = ["chat", project, message, "--echoed", "--provider", provider];
    if (highProvider) cliArgs.push("--high-provider", highProvider);
    if (lowProvider) cliArgs.push("--low-provider", lowProvider);
    if (payload.highModel) cliArgs.push("--high-model", String(payload.highModel));
    if (payload.lowModel) cliArgs.push("--low-model", String(payload.lowModel));

    const child = this.spawnRun(cliArgs);
    const proc: RunningProcess = { name: project, idea: `[chat] ${message}`, startedAt: new Date().toISOString(), pid: child.pid ?? -1, child };
    this.running.set(project, proc);
    logSystem(`UI chat "${project}" (pid ${child.pid})`);
    child.on("exit", (code) => { this.running.delete(project); logSystem(proc.stopping ? `Chat "${project}" stopped.` : `Chat "${project}" exited (${code})`); });
    child.on("error", (err) => { this.running.delete(project); logError(`Chat "${project}" failed to start: ${err.message}`); });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: project, pid: child.pid }));
  }

  // Resume the latest failed/running work order for a project from the first
  // incomplete phase/agent.
  private async startResume(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || payload.name || "").trim();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A project name is required to resume a run." }));
      return;
    }
    if (this.running.has(project)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `A run for "${project}" is already in progress.` }));
      return;
    }

    const existing = await getProject(project);
    if (!existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" not found.` }));
      return;
    }

    const workspace = existing.workspaceDir && fs.existsSync(existing.workspaceDir)
      ? existing.workspaceDir
      : path.join(this.workspaceRoot, project);
    if (!fs.existsSync(workspace)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Workspace for "${project}" not found.` }));
      return;
    }

    const child = this.spawnRun(["resume", workspace, "--no-ui"]);

    const proc: RunningProcess = {
      name: project,
      idea: `Resume ${existing.kind || "run"} from ${existing.currentPhase || "failed step"}`,
      startedAt: new Date().toISOString(),
      pid: child.pid ?? -1,
      child,
    };
    this.running.set(project, proc);
    logSystem(`UI resumed "${project}" (pid ${child.pid})`);

    child.on("exit", (code) => {
      this.running.delete(project);
      logSystem(proc.stopping ? `Resume "${project}" stopped by user.` : `Resume "${project}" exited with code ${code}`);
    });
    child.on("error", (err) => {
      this.running.delete(project);
      logError(`Resume "${project}" failed to start: ${err.message}`);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: project, pid: child.pid }));
  }

  // Resolve the CLI entry for both built (`dist`) and source (`tsx`) dashboard runs.
  private resolveCliInvocation(): { command: string; args: string[] } {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const compiledEntry = path.resolve(here, "..", "index.js");
    if (fs.existsSync(compiledEntry)) {
      return { command: process.execPath, args: [compiledEntry] };
    }

    const sourceEntry = path.resolve(here, "..", "index.ts");
    const tsxCli = path.join(this.projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
    if (fs.existsSync(sourceEntry) && fs.existsSync(tsxCli)) {
      return { command: process.execPath, args: [tsxCli, sourceEntry] };
    }

    return { command: process.execPath, args: [compiledEntry] };
  }

  private spawnRun(cliArgs: string[]): ChildProcess {
    const env = { ...process.env, ...this.envFromFile() };
    const sandbox = sandboxConfigFromEnv(env);
    if (sandbox.mode === "full") {
      const cli = this.resolveContainerCliInvocation();
      const args = buildDockerRunArgs(
        this.projectRoot,
        cli.command,
        [...cli.args, ...this.toContainerCliArgs(cliArgs)],
        env,
        sandbox,
      );
      return spawn("docker", args, {
        cwd: this.projectRoot,
        env,
        stdio: "ignore",
        detached: false,
      });
    }

    const cli = this.resolveCliInvocation();
    return spawn(cli.command, [...cli.args, ...cliArgs], {
      cwd: this.projectRoot,
      env,
      stdio: "ignore",
      detached: false,
    });
  }

  private async stopRun(payload: Record<string, unknown>, res: http.ServerResponse) {
    const name = String(payload.name || payload.project || "").trim();
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A run name is required." }));
      return;
    }

    const proc = this.running.get(name);
    if (!proc) {
      const force = payload.force === true;
      let projectName = name;
      let state = await getProject(projectName);
      if (!state) {
        const match = (await listProjects()).find((p) => p.name.toLowerCase() === name.toLowerCase() || p.state.projectName.toLowerCase() === name.toLowerCase());
        projectName = match?.name ?? name;
        state = match?.state ?? null;
      }
      if (!state || (state.status !== "running" && !force)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No dashboard-launched run named "${name}" is in progress.` }));
        return;
      }

      await this.markRunStopped(projectName, "External run cleared from the dashboard.", force);
      logSystem(`UI cleared external run "${projectName}"`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: projectName, external: true }));
      return;
    }

    proc.stopping = true;
    const stopped = await this.killProcess(proc);
    if (!stopped) {
      proc.stopping = false;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Failed to stop "${name}".` }));
      return;
    }

    this.running.delete(name);
    await this.markRunStopped(proc.name);
    logSystem(`UI stopped run "${name}" (pid ${proc.pid})`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name }));
  }

  private terminalShell(kind: unknown): { command: string; args: string[]; label: string } {
    const requested = String(kind || "").toLowerCase();
    if (process.platform === "win32") {
      if (requested === "cmd") return { command: "cmd.exe", args: [], label: "cmd" };
      return { command: "powershell.exe", args: ["-NoLogo", "-NoProfile"], label: "powershell" };
    }
    const shell = requested === "bash" ? "bash" : process.env.SHELL || "sh";
    return { command: shell, args: [], label: path.basename(shell) };
  }

  private resolveTerminalCwd(value: unknown): string {
    const raw = String(value || "").trim();
    const base = this.workspaceRoot || this.projectRoot;
    const cwd = raw ? path.resolve(this.projectRoot, raw) : base;
    const allowed = [this.projectRoot, this.workspaceRoot].map((p) => path.resolve(p));
    const resolved = path.resolve(cwd);
    if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
      throw new Error("Terminal cwd must stay inside the swarm project/workspace.");
    }
    return resolved;
  }

  private appendTerminalOutput(session: TerminalSession, chunk: string) {
    const text = redactSecrets(chunk.replace(/\r\n/g, "\n"));
    session.updatedAt = new Date().toISOString();
    session.output.push(text);
    const joined = session.output.join("");
    if (joined.length > 80_000) session.output = [joined.slice(-80_000)];
  }

  private publicTerminal(session: TerminalSession) {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      shell: session.shell,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      status: session.status,
      exitCode: session.exitCode,
      pid: session.child.pid ?? -1,
      output: session.output.join(""),
    };
  }

  private startTerminal(payload: Record<string, unknown>, res: http.ServerResponse) {
    const shell = this.terminalShell(payload.shell);
    const cwd = this.resolveTerminalCwd(payload.cwd);
    const name = String(payload.name || payload.command || shell.label).trim().slice(0, 80) || shell.label;
    const initialCommand = String(payload.command || "").trim();
    const child = spawn(shell.command, shell.args, {
      cwd,
      env: scrubSecretsFromEnv(process.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const now = new Date().toISOString();
    const session: TerminalSession = {
      id: randomUUID(),
      name,
      cwd,
      shell: shell.label,
      startedAt: now,
      updatedAt: now,
      status: "running",
      child,
      output: [],
    };
    this.terminals.set(session.id, session);

    child.stdout?.on("data", (data: Buffer) => this.appendTerminalOutput(session, data.toString()));
    child.stderr?.on("data", (data: Buffer) => this.appendTerminalOutput(session, data.toString()));
    child.on("exit", (code) => {
      session.status = "exited";
      session.exitCode = code;
      session.updatedAt = new Date().toISOString();
      this.appendTerminalOutput(session, `\n[session exited with code ${code ?? "unknown"}]\n`);
    });
    child.on("error", (err) => {
      session.status = "exited";
      session.updatedAt = new Date().toISOString();
      this.appendTerminalOutput(session, `\n[session error: ${err.message}]\n`);
    });

    if (initialCommand) {
      child.stdin?.write(initialCommand + "\n");
      this.appendTerminalOutput(session, `> ${initialCommand}\n`);
    }

    logSystem(`Terminal session started "${session.name}" (${session.shell}, pid ${child.pid})`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, session: this.publicTerminal(session) }));
  }

  private sendTerminal(payload: Record<string, unknown>, res: http.ServerResponse) {
    const id = String(payload.id || "").trim();
    const input = String(payload.input ?? "");
    const session = this.terminals.get(id);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Terminal session not found." }));
      return;
    }
    if (session.status !== "running" || !session.child.stdin) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Terminal session is not running." }));
      return;
    }
    session.child.stdin.write(input);
    session.updatedAt = new Date().toISOString();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, session: this.publicTerminal(session) }));
  }

  private stopTerminal(payload: Record<string, unknown>, res: http.ServerResponse) {
    const id = String(payload.id || "").trim();
    const session = this.terminals.get(id);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Terminal session not found." }));
      return;
    }
    if (session.status === "running") {
      if (process.platform === "win32" && session.child.pid) {
        spawn("taskkill", ["/pid", String(session.child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      } else {
        session.child.kill("SIGTERM");
      }
    }
    session.status = "exited";
    session.updatedAt = new Date().toISOString();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, session: this.publicTerminal(session) }));
  }

  // Resolve a paused run's input-request. Body:
  //   { id, skip: true }            → skip (run applies the team's safe fallback)
  //   { id, confirm: true }         → operator has set the secret in the env file
  //   { id, answer }                → a non-secret answer (domain, id, choice, …)
  //
  // SECURITY: secret values are NEVER accepted here. For a 'secret' question we
  // reject any value and only take a confirm/skip; for any other question we
  // reject a submission that looks like a credential. Nothing sensitive is ever
  // written to the DB, logs, or the model prompt — the operator puts the secret
  // in the project's .env and the agent reads it from process.env.
  private async answerQuestion(payload: Record<string, unknown>, res: http.ServerResponse) {
    const id = String(payload.id || "").trim();
    const skip = payload.skip === true;
    const confirm = payload.confirm === true;
    const answer = String(payload.answer ?? "").trim();
    const reject = (code: number, error: string) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
    };

    if (!id) return reject(400, "A question id is required.");

    const q = await getQuestion(id);
    if (!q) return reject(404, "That question does not exist.");
    if (q.status !== "open") return reject(409, "That question was already resolved.");

    let outcome: { answer: string } | { skip: true };
    if (skip) {
      outcome = { skip: true };
    } else if (q.kind === "secret") {
      // Never accept a value for a secret — only a confirmation it's in the env.
      if (answer) {
        return reject(422, `Do not paste secrets here. Add ${q.envKey ? "`" + q.envKey + "`" : "the key"} to the project's .env file, then confirm. The value never leaves your machine.`);
      }
      if (!confirm) return reject(400, "Set confirm:true once the secret is in the env file, or skip:true.");
      // Opt-in: let the build (LLM-run shell commands) read this specific key by
      // adding it to the project's SWARM_SHELL_ENV_ALLOW. Off by default keeps
      // the credential hidden from tool commands (runtime-only secrets).
      if (payload.allowBuild === true && q.envKey) {
        await this.allowShellEnvKey(q.project, q.envKey);
      }
      // Store a non-sensitive marker; the run resolves this to an env reference.
      outcome = { answer: `[operator set ${q.envKey || "the secret"} in the env file]` };
    } else {
      if (!answer) return reject(400, "Provide an answer, confirm:true, or skip:true.");
      if (looksLikeSecretValue(answer)) {
        return reject(422, "That looks like a secret/credential. Don't send secrets here — put it in the project's .env file and answer with the env var name to read instead.");
      }
      outcome = { answer };
    }

    const updated = await resolveQuestion(id, outcome);
    if (!updated) return reject(409, "That question was already resolved.");
    const action = skip ? "skipped" : q.kind === "secret" ? "confirmed (env)" : "answered";
    logSystem(`UI ${action} question "${updated.question}" (${updated.project})`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, question: this.publicQuestion(updated) }));
  }

  // Strip any stored answer from a secret question before it leaves the server,
  // and attach the env-file paths the operator should use. Defense in depth: even
  // the confirmation marker is never echoed for secrets.
  private async enrichQuestion(q: PendingQuestion): Promise<PendingQuestion & { envPath?: string; globalEnvPath?: string }> {
    const base = this.publicQuestion(q);
    if (q.kind !== "secret") return base;
    return { ...base, envPath: await this.projectEnvPath(q.project), globalEnvPath: this.globalEnvPath() };
  }

  private publicQuestion(q: PendingQuestion): PendingQuestion {
    // A secret question's answer is only ever a marker, but never send it.
    return q.kind === "secret" ? { ...q, answer: undefined } : q;
  }

  private async killProcess(proc: RunningProcess): Promise<boolean> {
    if (!proc.pid || proc.pid < 1) return proc.child.kill("SIGTERM");
    if (process.platform === "win32") {
      return new Promise((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
        killer.on("exit", (code) => resolve(code === 0));
        killer.on("error", () => resolve(false));
      });
    }

    if (!proc.child.kill("SIGTERM")) return false;
    setTimeout(() => {
      if (!proc.child.killed) proc.child.kill("SIGKILL");
    }, 5_000).unref();
    return true;
  }

  private async markRunStopped(name: string, message = "Run stopped from the dashboard.", force = false): Promise<void> {
    try {
      const state = await getProject(name);
      if (!state) return;
      if (state.status === "running" || force) {
        const stopped = { ...state, status: "stopped" as const, updatedAt: new Date().toISOString() };
        await upsertProject(stopped);
        await upsertRun(stopped);
      }
      await insertLogs(name, [{
        id: randomUUID(),
        runId: state.runId || undefined,
        timestamp: new Date().toISOString(),
        level: "warn",
        category: "system",
        message,
      }], state.runId || undefined);
    } catch (err) {
      logError(`Failed to mark "${name}" stopped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private resolveContainerCliInvocation(): { command: string; args: string[] } {
    const compiledEntry = path.join(this.projectRoot, "dist", "index.js");
    if (fs.existsSync(compiledEntry)) {
      return { command: "node", args: [this.containerPath(compiledEntry)] };
    }

    const sourceEntry = path.join(this.projectRoot, "src", "index.ts");
    const tsxCli = path.join(this.projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
    if (fs.existsSync(sourceEntry) && fs.existsSync(tsxCli)) {
      return { command: "node", args: [this.containerPath(tsxCli), this.containerPath(sourceEntry)] };
    }

    return { command: "node", args: [this.containerPath(compiledEntry)] };
  }

  private toContainerCliArgs(args: string[]): string[] {
    return args.map((arg) => {
      const resolved = path.resolve(arg);
      if (this.isInsideProjectRoot(resolved) && fs.existsSync(resolved)) {
        return this.containerPath(resolved);
      }
      return arg;
    });
  }

  private containerPath(hostPath: string): string {
    const rel = path.relative(this.projectRoot, path.resolve(hostPath)).replace(/\\/g, "/");
    return rel ? `/work/${rel}` : "/work";
  }

  private isInsideProjectRoot(target: string): boolean {
    const rel = path.relative(this.projectRoot, target);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  // Report which keys are configured (never returns the secret values).
  private readSettings(): {
    anthropicKeySet: boolean;
    deepseekKeySet: boolean;
    deepseekBaseUrl: string;
    openrouterKeySet: boolean;
    openrouterBaseUrl: string;
    githubTokenSet: boolean;
    swarmWorktrees: string;
    swarmCiRepair: string;
    swarmCiRepairRounds: string;
    swarmCiRepairTimeoutMs: string;
    swarmSandbox: string;
    swarmSandboxImage: string;
    swarmSandboxCpus: string;
    swarmSandboxMemory: string;
    gitProfiles: Array<{ name: string; envName: string; tokenSet: boolean }>;
    deployProfiles: Array<{ provider: string; name: string; envNames: string[]; tokenSet: boolean }>;
  } {
    const env = { ...process.env, ...this.envFromFile() };
    return {
      anthropicKeySet: Boolean(env.ANTHROPIC_API_KEY),
      deepseekKeySet: Boolean(env.DEEPSEEK_API_KEY),
      deepseekBaseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      openrouterKeySet: Boolean(env.OPENROUTER_API_KEY),
      openrouterBaseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      githubTokenSet: Boolean(env.GITHUB_TOKEN || env.GH_TOKEN),
      swarmWorktrees: env.SWARM_WORKTREES === "on" ? "on" : "off",
      swarmCiRepair: env.SWARM_CI_REPAIR === "on" ? "on" : "off",
      swarmCiRepairRounds: env.SWARM_CI_REPAIR_ROUNDS || "3",
      swarmCiRepairTimeoutMs: env.SWARM_CI_REPAIR_TIMEOUT_MS || String(20 * 60_000),
      swarmSandbox: ["off", "exec", "full"].includes(env.SWARM_SANDBOX || "") ? env.SWARM_SANDBOX || "off" : "off",
      swarmSandboxImage: env.SWARM_SANDBOX_IMAGE || "node:22-bookworm",
      swarmSandboxCpus: env.SWARM_SANDBOX_CPUS || "",
      swarmSandboxMemory: env.SWARM_SANDBOX_MEMORY || "",
      gitProfiles: configuredGitProfiles(env),
      deployProfiles: configuredDeployProfiles(env),
    };
  }

  // Persist API keys to .env (and process.env so they apply immediately).
  private saveSettings(payload: Record<string, unknown>, res: http.ServerResponse) {
    const map: Record<string, string> = {
      anthropicKey: "ANTHROPIC_API_KEY",
      deepseekKey: "DEEPSEEK_API_KEY",
      deepseekBaseUrl: "DEEPSEEK_BASE_URL",
      openrouterKey: "OPENROUTER_API_KEY",
      openrouterBaseUrl: "OPENROUTER_BASE_URL",
      githubToken: "GITHUB_TOKEN",
      swarmWorktrees: "SWARM_WORKTREES",
      swarmCiRepair: "SWARM_CI_REPAIR",
      swarmCiRepairRounds: "SWARM_CI_REPAIR_ROUNDS",
      swarmCiRepairTimeoutMs: "SWARM_CI_REPAIR_TIMEOUT_MS",
      swarmSandbox: "SWARM_SANDBOX",
      swarmSandboxImage: "SWARM_SANDBOX_IMAGE",
      swarmSandboxCpus: "SWARM_SANDBOX_CPUS",
      swarmSandboxMemory: "SWARM_SANDBOX_MEMORY",
    };
    const updates: Record<string, string> = {};
    for (const [field, envName] of Object.entries(map)) {
      if (field in payload) {
        const value = String(payload[field] ?? "").trim();
        if (value) updates[envName] = value;
      }
    }
    const githubProfile = normalizeGitProfile(String(payload.githubProfile || "default"));
    const githubProfileToken = String(payload.githubProfileToken || "").trim();
    if (githubProfileToken) updates[gitProfileEnvName(githubProfile)] = githubProfileToken;

    // Deploy provider credentials: write each provided secret/config var under
    // the chosen profile (VERCEL_TOKEN_<PROFILE>, etc.). Secrets go to .env only.
    const deployProviderRaw = String(payload.deployProvider || "").trim();
    if (deployProviderRaw && isDeployProvider(deployProviderRaw) && payload.deploySecrets && typeof payload.deploySecrets === "object") {
      const deployProfile = normalizeDeployProfile(String(payload.deployProfile || "default"));
      const allowed = new Set([...deploySecretBases(deployProviderRaw), ...deployConfigBases(deployProviderRaw)]);
      for (const [base, value] of Object.entries(payload.deploySecrets as Record<string, unknown>)) {
        const v = String(value ?? "").trim();
        if (v && allowed.has(base)) updates[deployEnvName(base, deployProfile)] = v;
      }
    }
    this.writeEnv(updates);
    logSystem(`Settings saved (${Object.keys(updates).join(", ") || "no changes"})`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...this.readSettings() }));
  }

  private saveMcp(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || "").trim();
    const filePath = this.mcpConfigPath(project || undefined);
    const content = String(payload.content ?? "").trim();
    try {
      const normalized = content || "{\n  \"mcpServers\": {}\n}";
      const parsed = JSON.parse(normalized) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("mcp.json must contain a JSON object.");
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      logSystem(`MCP config saved (${project || "global"})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.readMcp(project || undefined)));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private async saveProjectGit(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || "").trim();
    const repoUrl = this.normalizeRepoUrl(String(payload.repoUrl || "").trim());
    const credentialProfile = normalizeGitProfile(String(payload.credentialProfile || "default"));
    const defaultBranch = String(payload.defaultBranch || "main").trim() || "main";
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project is required." }));
      return;
    }
    const existing = await getProject(project);
    if (!existing) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" not found.` }));
      return;
    }
    if (repoUrl) {
      const profile = this.readSettings().gitProfiles.find((p) => p.name === credentialProfile);
      if (!profile?.tokenSet) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Credential profile "${credentialProfile}" is not configured.` }));
        return;
      }
    }
    await updateProjectGitBinding(project, { repoUrl, credentialProfile, defaultBranch });
    logSystem(`Project "${project}" Git binding updated (${repoUrl || "unlinked"}, profile ${credentialProfile})`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, state: await getProject(project) }));
  }

  // Trigger a manual deploy: validate the isolated credential, persist the
  // binding, then spawn `swarm deploy` (its logs stream to the project).
  private async startDeploy(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || "").trim();
    const provider = String(payload.provider || "").trim();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A project is required to deploy." }));
      return;
    }
    if (!isDeployProvider(provider)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Choose a deploy provider (vercel, digitalocean, gcp or aws)." }));
      return;
    }
    if (this.running.has(project)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `A run or deploy for "${project}" is already in progress.` }));
      return;
    }
    const existing = await getProject(project);
    if (!existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" not found.` }));
      return;
    }
    const profile = normalizeDeployProfile(String(payload.profile || existing.deployProfile || "default"));
    const dp = (await this.projectDeployProfiles(project)).find((p) => p.provider === provider && p.name === profile);
    if (!dp?.tokenSet) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Deploy credentials for ${provider} profile "${profile}" aren't configured. Add them on this project's Deploy tab or in Settings.` }));
      return;
    }

    const target = this.cleanDeployTarget(payload.target);
    await updateProjectDeployBinding(project, { provider, profile, target });

    const cliArgs = ["deploy", project, "--provider", provider, "--profile", profile];
    if (payload.prod) cliArgs.push("--prod");
    if (target.region) cliArgs.push("--region", String(target.region));
    if (target.project) cliArgs.push("--gcp-project", String(target.project));
    if (target.service) cliArgs.push("--service", String(target.service));
    if (target.appId) cliArgs.push("--app-id", String(target.appId));
    if (target.image) cliArgs.push("--image", String(target.image));

    const child = this.spawnRun(cliArgs);
    this.running.set(project, { name: project, idea: `[deploy → ${provider}]`, startedAt: new Date().toISOString(), pid: child.pid ?? -1, child });
    logSystem(`UI launched deploy "${project}" → ${provider} (pid ${child.pid}, profile ${profile})`);
    child.on("exit", (code) => { this.running.delete(project); logSystem(`Deploy "${project}" exited with code ${code}`); });
    child.on("error", (err) => { this.running.delete(project); logError(`Deploy "${project}" failed to start: ${err.message}`); });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: project, pid: child.pid }));
  }

  // Save a project's deploy binding (provider + profile + non-secret target).
  private async saveProjectDeploy(payload: Record<string, unknown>, res: http.ServerResponse) {
    const project = String(payload.project || "").trim();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project is required." }));
      return;
    }
    const existing = await getProject(project);
    if (!existing) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Project "${project}" not found.` }));
      return;
    }
    const providerRaw = String(payload.provider || "").trim();
    const provider = providerRaw && isDeployProvider(providerRaw) ? providerRaw : "";
    const profile = normalizeDeployProfile(String(payload.profile || "default"));
    const target = this.cleanDeployTarget(payload.target);
    await updateProjectDeployBinding(project, { provider, profile, target });
    logSystem(`Project "${project}" deploy binding updated (${provider || "unbound"}, profile ${profile})`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, state: await getProject(project) }));
  }

  // Whitelist the non-secret deploy target fields accepted from the UI/API.
  private cleanDeployTarget(input: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (input && typeof input === "object") {
      const allowed = ["region", "project", "service", "appId", "image", "accessRoleArn"];
      for (const key of allowed) {
        const v = (input as Record<string, unknown>)[key];
        if (v != null && String(v).trim()) out[key] = String(v).trim();
      }
    }
    return out;
  }

  private normalizeRepoUrl(input: string): string {
    if (!input) return "";
    const github = input.match(/github\.com[/:]([^/]+)\/([^/.#?]+)(?:\.git)?/i);
    if (github) return `https://github.com/${github[1]}/${github[2]}`;
    const ownerRepo = input.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (ownerRepo) return `https://github.com/${ownerRepo[1]}/${ownerRepo[2]}`;
    return input;
  }

  // Save a prompt override. Global by default; pass `project` to scope it to one
  // project. An empty `content` is still a valid override (an empty prompt).
  private async savePrompt(payload: Record<string, unknown>, res: http.ServerResponse) {
    const key = String(payload.key || "").trim();
    if (!key || !(key in DEFAULT_PROMPTS)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown prompt key "${key}".` }));
      return;
    }
    const project = String(payload.project || "").trim();
    const content = typeof payload.content === "string" ? payload.content : "";
    const scope = project ? "project" : "global";
    await upsertPrompt({ scope, projectName: project || undefined, key, content });
    logSystem(`Prompt override saved [${scope}${project ? ":" + project : ""}] ${key}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  // Remove a prompt override, reverting that key to the next layer / code default.
  private async resetPrompt(payload: Record<string, unknown>, res: http.ServerResponse) {
    const key = String(payload.key || "").trim();
    if (!key) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A prompt key is required." }));
      return;
    }
    const project = String(payload.project || "").trim();
    const scope = project ? "project" : "global";
    await deletePrompt({ scope, projectName: project || undefined, key });
    logSystem(`Prompt override reset [${scope}${project ? ":" + project : ""}] ${key}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  // Generic environment-variable management. Global by default; pass `project`
  // to manage that project's overrides (.swarm/workspaces/<name>/.env).
  private async saveEnv(payload: Record<string, unknown>, res: http.ServerResponse) {
    try {
      const project = payload.project ? String(payload.project) : "";
      const set = (payload.set && typeof payload.set === "object") ? payload.set as Record<string, unknown> : {};
      const remove = Array.isArray(payload.remove) ? payload.remove.map(String) : [];
      const cleanSet: Record<string, string> = {};
      for (const [k, v] of Object.entries(set)) {
        const key = String(k).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid variable name "${key}". Use letters, digits and underscores; it can't start with a digit.` }));
          return;
        }
        cleanSet[key] = String(v ?? "");
      }
      const filePath = project ? await this.projectEnvPath(project) : this.globalEnvPath();
      this.writeEnvFile(filePath, cleanSet, remove, !project); // global writes also hit process.env
      logSystem(`Env updated [${project || "global"}] (set: ${Object.keys(cleanSet).join(", ") || "-"}${remove.length ? "; removed: " + remove.join(", ") : ""})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, scope: project || "global", vars: this.listEnvFile(filePath) }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  // ── Env files: GLOBAL (.env at project root, shared by all projects) and
  // PER-PROJECT (.swarm/workspaces/<name>/.env, overrides global for that project). ──

  private globalEnvPath(): string {
    return path.join(this.projectRoot, ".env");
  }

  private async projectEnvPath(name: string): Promise<string> {
    const st = await getProject(name);
    const dir = st?.workspaceDir && fs.existsSync(path.dirname(st.workspaceDir))
      ? st.workspaceDir
      : path.join(this.workspaceRoot, name);
    return path.join(dir, ".env");
  }

  private async projectDeployProfiles(project: string): Promise<Array<{ provider: string; name: string; envNames: string[]; tokenSet: boolean; scope: "global" | "project" }>> {
    const globalEnv = { ...process.env, ...this.envFromFile() };
    const projectEnv = this.parseEnvFile(await this.projectEnvPath(project));
    const merged = { ...globalEnv, ...projectEnv };
    const projectProfiles = new Set(configuredDeployProfiles(projectEnv).filter((p) => p.tokenSet).map((p) => `${p.provider}:${p.name}`));
    return configuredDeployProfiles(merged).map((p) => ({
      ...p,
      scope: projectProfiles.has(`${p.provider}:${p.name}`) ? "project" : "global",
    }));
  }

  // Add a key to the project's SWARM_SHELL_ENV_ALLOW list (deduped) so the shell
  // env-scrub keeps it for LLM-run build/test commands. Used when the operator
  // opts to let the build read a confirmed project secret.
  private async allowShellEnvKey(project: string, key: string) {
    const filePath = await this.projectEnvPath(project);
    const current = this.parseEnvFile(filePath)["SWARM_SHELL_ENV_ALLOW"] || "";
    const keys = new Set(current.split(",").map((s) => s.trim()).filter(Boolean));
    if (keys.has(key)) return;
    keys.add(key);
    this.writeEnvFile(filePath, { SWARM_SHELL_ENV_ALLOW: [...keys].join(",") });
    logSystem(`Allowed build access to "${key}" for ${project} (SWARM_SHELL_ENV_ALLOW).`);
  }

  // Apply set/remove to an env file (creating its directory if needed).
  // applyToProcess updates this server's process.env too (global only).
  private writeEnvFile(filePath: string, set: Record<string, string>, remove: string[] = [], applyToProcess = false) {
    const merged = { ...this.parseEnvFile(filePath) };
    for (const [k, v] of Object.entries(set)) {
      const key = k.trim();
      if (!key) continue;
      merged[key] = v;
      if (applyToProcess) process.env[key] = v;
    }
    for (const k of remove) {
      delete merged[k];
      if (applyToProcess) delete process.env[k];
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    fs.writeFileSync(filePath, content, "utf-8");
  }

  private listEnvFile(filePath: string): Array<{ key: string; preview: string }> {
    return Object.entries(this.parseEnvFile(filePath)).map(([key, v]) => ({ key, preview: this.maskValue(v) }));
  }

  private mcpConfigPath(project?: string): string {
    if (project) return path.join(this.workspaceRoot, this.slugify(project), "mcp.json");
    return path.join(this.projectRoot, "mcp.json");
  }

  private readMcp(project?: string): { scope: "global" | "project"; path: string; exists: boolean; content: string } {
    const filePath = this.mcpConfigPath(project);
    const exists = fs.existsSync(filePath);
    return {
      scope: project ? "project" : "global",
      path: filePath,
      exists,
      content: exists ? fs.readFileSync(filePath, "utf-8") : "{\n  \"mcpServers\": {}\n}\n",
    };
  }

  private maskValue(v: string): string {
    if (!v) return "(empty)";
    if (v.length <= 8) return "••••";
    return "••••" + v.slice(-4);
  }

  private parseEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key) out[key] = val;
    }
    return out;
  }

  // Global .env helpers (used by settings + run spawning).
  private envFromFile(): Record<string, string> {
    return this.parseEnvFile(this.globalEnvPath());
  }
  private writeEnv(set: Record<string, string>, remove: string[] = []) {
    this.writeEnvFile(this.globalEnvPath(), set, remove, true);
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  }

  // ── Database-backed API GETs ─────────────────────────────────────────────

  private async handleApiGet(url: URL, res: http.ServerResponse): Promise<void> {
    const p = url.pathname;
    // A ?project=<name> param pins single-project views to that project; else
    // we fall back to the live/active project.
    const requested = url.searchParams.get("project");
    const resolveProject = async () => requested || (await this.activeProject());
    try {
      if (p === "/api/config") return this.json(res, this.uiConfig());
      if (p === "/api/settings") return this.json(res, this.readSettings());
      if (p === "/api/deploy-profiles") {
        if (!requested) return this.json(res, this.readSettings().deployProfiles.map((p) => ({ ...p, scope: "global" })));
        return this.json(res, await this.projectDeployProfiles(requested));
      }
      if (p === "/api/mcp") return this.json(res, this.readMcp(requested || undefined));
      if (p === "/api/env") {
        const ep = requested ? await this.projectEnvPath(requested) : this.globalEnvPath();
        return this.json(res, this.listEnvFile(ep));
      }
      if (p === "/api/running") {
        // Runs this dashboard spawned itself (in-memory, with a live child pid)…
        const inMemory = [...this.running.values()].map((x) => ({
          name: x.name, idea: x.idea, startedAt: x.startedAt, pid: x.pid,
        }));
        // …plus any project the DB reports as running that we didn't spawn
        // (e.g. a CLI `swarm run`), so the sidebar reflects ALL active work,
        // not just dashboard-launched runs. pid -1 marks an external process.
        const known = new Set(inMemory.map((x) => x.name));
        let external: typeof inMemory = [];
        try {
          external = (await listProjects())
            .filter((pr) => pr.state.status === "running" && !known.has(pr.name))
            .map((pr) => ({ name: pr.name, idea: pr.state.idea, startedAt: pr.state.startedAt, pid: -1 }));
        } catch { /* DB unavailable — fall back to in-memory only */ }
        return this.json(res, [...inMemory, ...external]);
      }
      if (p === "/api/terminal") {
        const id = url.searchParams.get("id");
        if (id) {
          const session = this.terminals.get(id);
          return this.json(res, session ? this.publicTerminal(session) : { error: "Terminal session not found." });
        }
        return this.json(res, [...this.terminals.values()].map((session) => this.publicTerminal(session)));
      }
      if (p === "/api/projects") return this.json(res, await listProjects());
      if (p === "/api/learnings") {
        return this.json(res, { learnings: await getAllLearnings(), projectHistory: await getAllProjectHistory() });
      }
      if (p === "/api/evals") {
        const proj = requested || (await this.activeProject());
        const runId = url.searchParams.get("runId") || undefined;
        return this.json(res, proj ? await getEvals(proj, runId) : await getAllEvals());
      }
      if (p === "/api/commits") {
        const proj = requested || (await this.activeProject());
        const runId = url.searchParams.get("runId") || undefined;
        return this.json(res, proj ? await getCommits(proj, runId) : []);
      }
      if (p === "/api/deployments") {
        const proj = requested || (await this.activeProject());
        return this.json(res, proj ? await getDeployments(proj) : []);
      }
      if (p === "/api/runs") {
        const proj = requested || (await this.activeProject());
        return this.json(res, proj ? await listRuns(proj) : []);
      }
      if (p === "/api/questions") {
        // Open input-requests. Scoped to ?project=<name> for the project page;
        // omitted returns all open questions (for a global badge/inbox).
        // Secret values are stripped and env-file paths attached on the way out.
        const proj = requested || undefined;
        const all = url.searchParams.get("all") === "1";
        const list = (all && proj) ? await getQuestions(proj) : await getOpenQuestions(proj);
        return this.json(res, await Promise.all(list.map((q) => this.enrichQuestion(q))));
      }
      if (p === "/api/chat") {
        // The interactive project chat thread (user turns + swarm answers/acks),
        // oldest-first. Scoped to ?project=<name>.
        if (!requested) return this.json(res, []);
        return this.json(res, await getChatMessages(requested));
      }
      if (p === "/api/prompts") {
        // Scope is explicit: ?project=<name> edits that project's overrides;
        // omitted edits the global layer. Returns every editable key with its
        // default, the override at this scope, and the effective value.
        const project = url.searchParams.get("project") || "";
        const overrides = await getPromptOverrides(project || undefined);
        const globalMap: Record<string, string> = {};
        const projectMap: Record<string, string> = {};
        for (const o of overrides) {
          if (o.scope === "global") globalMap[o.key] = o.content;
          else if (o.projectName === project) projectMap[o.key] = o.content;
        }
        const items = promptCatalog().map(({ key, kind }) => {
          const def = DEFAULT_PROMPTS[key];
          const g = globalMap[key] ?? null;
          const pv = project ? (projectMap[key] ?? null) : null;
          const effective = (project ? pv : null) ?? g ?? def;
          const scopeOverride = project ? pv : g;
          return { key, kind, default: def, effective, overridden: scopeOverride != null, value: scopeOverride ?? effective };
        });
        return this.json(res, { scope: project ? "project" : "global", project, items });
      }

      if (p === "/api/state") {
        const name = await resolveProject();
        const state = name ? await getProject(name) : null;
        return this.json(res, state || { status: "waiting" });
      }
      if (p === "/api/logs") {
        const name = await resolveProject();
        const runId = url.searchParams.get("runId") || undefined;
        return this.json(res, name ? await getLogs(name, 500, runId) : []);
      }
      if (p === "/api/agent-runs") {
        const name = await resolveProject();
        const runId = url.searchParams.get("runId") || undefined;
        return this.json(res, name ? await getAgentRuns(name, runId) : []);
      }
      if (p === "/api/run-graph") {
        const name = await resolveProject();
        const session = url.searchParams.get("session");
        return this.json(res, name ? await this.buildRunGraph(name, session) : { sessions: [], nodes: [], edges: [], phases: [] });
      }
      if (p === "/api/work-spec") {
        const name = await resolveProject();
        return this.json(res, name ? await this.buildWorkSpecResponse(name) : null);
      }
      if (p === "/api/activity") {
        const name = await resolveProject();
        return this.json(res, name ? await getActivity(name, 30) : []);
      }
      if (p === "/api/artifacts") {
        const dir = await this.projectDir(await resolveProject());
        return this.json(res, dir ? this.listArtifacts(dir) : []);
      }
      if (p.startsWith("/api/artifact/")) {
        const dir = await this.projectDir(await resolveProject());
        const rel = decodeURIComponent(p.replace("/api/artifact/", ""));
        const content = dir ? this.readArtifact(dir, rel) : null;
        if (content !== null) { res.writeHead(200, { "Content-Type": "text/plain" }); res.end(content); return; }
        res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return;
      }

      // Per-project endpoints for cross-project viewing.
      if (p.startsWith("/api/project/")) {
        const rest = p.replace("/api/project/", "");
        const slash = rest.indexOf("/");
        const projectName = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
        const sub = slash === -1 ? "state" : rest.slice(slash + 1);
        if (sub === "state") return this.json(res, (await getProject(projectName)) || { status: "unknown" });
        if (sub === "activity") return this.json(res, await getActivity(projectName, 30));
        if (sub === "evals") return this.json(res, await getEvals(projectName));
        if (sub === "deployments") return this.json(res, await getDeployments(projectName));
        res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private json(res: http.ServerResponse, data: unknown): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private async buildWorkSpecResponse(project: string) {
    const dir = await this.projectDir(project);
    if (!dir) return null;

    const fromDisk = readWorkSpec(dir);
    if (fromDisk) return fromDisk;

    const state = await getProject(project);
    if (!state?.runId) return null;
    const run = await getLatestRun(project);
    const flow = (run?.flow?.length ? run.flow : state.flow) as FlowStep[] | undefined;
    if (!flow?.length) return null;

    return buildWorkSpec({
      state: { ...state, ...(run || {}), projectName: project },
      flow,
      gates: [],
    });
  }

  // Build an animated-timeline graph of a project's agent invocations: nodes
  // (each run, with start/end offsets + a sub-lane so parallel agents stack)
  // and data-flow edges (a producer's artifact appearing in a consumer's
  // prompt). Agent runs are segmented into sessions by time gaps so each run
  // renders as its own clean timeline.
  private async buildRunGraph(project: string, session: string | null) {
    const SESSION_GAP_MS = 30 * 60 * 1000; // a >30min gap starts a new run/session
    const runs = (await getAgentRuns(project)).filter((r) => r.startedAt);
    const all = runs.map((r, i) => {
      const start = new Date(r.startedAt).getTime();
      const end = r.completedAt ? new Date(r.completedAt).getTime() : start + (r.durationMs || 0);
      return {
        id: r.id || `${r.role}-${r.phase}-${i}`,
        role: r.role, phase: r.phase,
        startMs: start, endMs: Math.max(end, start),
        durationMs: r.durationMs || Math.max(0, end - start),
        success: r.success, produced: r.artifactsCreated || [],
        prompt: r.promptSent || "", summary: r.summary || "", tokensSaved: r.tokensSaved || 0,
      };
    }).sort((a, b) => a.startMs - b.startMs);

    // Segment into sessions on large gaps.
    const sessions: (typeof all)[] = [];
    let cur: typeof all = [];
    let prevEnd = 0;
    for (const n of all) {
      if (cur.length && n.startMs - prevEnd > SESSION_GAP_MS) { sessions.push(cur); cur = []; }
      cur.push(n); prevEnd = Math.max(prevEnd, n.endMs);
    }
    if (cur.length) sessions.push(cur);

    const sessionMeta = sessions.map((s, i) => ({
      index: i,
      startedAt: new Date(s[0].startMs).toISOString(),
      phases: [...new Set(s.map((n) => n.phase))],
      agents: s.length,
    }));

    const pick = session != null && sessions[Number(session)] ? Number(session) : sessions.length - 1;
    const nodes = sessions[pick] || [];
    if (!nodes.length) return { project, sessions: sessionMeta, selected: pick, t0: 0, t1: 0, durationMs: 0, phases: [], nodes: [], edges: [] };

    const t0 = Math.min(...nodes.map((n) => n.startMs));
    const t1 = Math.max(...nodes.map((n) => n.endMs));

    // Phase order by earliest start.
    const phaseFirst = new Map<string, number>();
    for (const n of nodes) if (!phaseFirst.has(n.phase) || n.startMs < phaseFirst.get(n.phase)!) phaseFirst.set(n.phase, n.startMs);
    const phases = [...phaseFirst.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);

    // Greedy sub-lane assignment within each phase so overlapping bars stack.
    const laneEnds = new Map<string, number[]>();
    const laneOf = new Map<string, number>();
    for (const n of nodes) {
      const lanes = laneEnds.get(n.phase) || [];
      let placed = lanes.findIndex((end) => end <= n.startMs);
      if (placed === -1) { lanes.push(n.endMs); placed = lanes.length - 1; }
      else lanes[placed] = n.endMs;
      laneEnds.set(n.phase, lanes);
      laneOf.set(n.id, placed);
    }
    const lanesPerPhase: Record<string, number> = {};
    for (const [p, l] of laneEnds) lanesPerPhase[p] = l.length;

    // Data-flow edges: a producer's artifact path appearing in a consumer's prompt.
    const producersByPath = new Map<string, { id: string; endMs: number }[]>();
    for (const n of nodes) for (const path of n.produced) {
      const arr = producersByPath.get(path) || [];
      arr.push({ id: n.id, endMs: n.endMs });
      producersByPath.set(path, arr);
    }
    const edges: Array<{ from: string; to: string; artifacts: string[]; count: number; at: number }> = [];
    const seen = new Set<string>();
    for (const consumer of nodes) {
      if (!consumer.prompt) continue;
      const byFrom = new Map<string, string[]>();
      for (const [path, prods] of producersByPath) {
        if (!consumer.prompt.includes(path)) continue;
        // Only link to a producer that finished before this consumer started, so
        // edges always flow forward in time. The most recent such producer wins.
        const before = prods.filter((p) => p.id !== consumer.id && p.endMs <= consumer.startMs);
        if (!before.length) continue;
        const choice = before[before.length - 1];
        (byFrom.get(choice.id) || byFrom.set(choice.id, []).get(choice.id)!).push(path);
      }
      for (const [fromId, arts] of byFrom) {
        const key = `${fromId}->${consumer.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: fromId, to: consumer.id, artifacts: arts.slice(0, 6), count: arts.length, at: consumer.startMs - t0 });
      }
    }

    const outNodes = nodes.map((n) => ({
      id: n.id, role: n.role, phase: n.phase,
      start: n.startMs - t0, end: n.endMs - t0, durationMs: n.durationMs,
      lane: laneOf.get(n.id) ?? 0, success: n.success,
      produced: n.produced.slice(0, 12), producedCount: n.produced.length,
      summary: n.summary, tokensSaved: n.tokensSaved,
    }));

    return { project, sessions: sessionMeta, selected: pick, t0, t1, durationMs: t1 - t0, phases, lanesPerPhase, nodes: outNodes, edges };
  }

  // Static config the UI needs up front (project types, phase→agents, mode).
  private uiConfig() {
    const projectTypes = Object.values(PROJECT_TYPES).map((t) => ({ key: t.key, label: t.label, phases: t.phases }));
    const phaseAgents: Record<string, string[]> = {};
    for (const ph of Object.values(PHASE_LIBRARY)) phaseAgents[ph.phase] = ph.agents;
    const allPhases = Object.keys(PHASE_LIBRARY);
    const deployProviders = DEPLOY_PROVIDERS.map((key) => ({
      key,
      label: DEPLOY_PROVIDER_LABELS[key],
      secrets: deploySecretBases(key),
      config: deployConfigBases(key),
    }));
    return { controlMode: this.controlMode, projectTypes, phaseAgents, allPhases, deployProviders };
  }

  // Serve a file from the built SPA, falling back to index.html for unknown
  // routes so client-side routing works on direct navigation / refresh.
  private serveSpa(pathname: string, res: http.ServerResponse): void {
    const dist = this.webDist!;
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
    let filePath = path.normalize(path.join(dist, rel));
    // Block path traversal, then fall back to index.html for routes/missing files.
    if (!filePath.startsWith(dist)) filePath = path.join(dist, "index.html");
    if (rel === "" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dist, "index.html");
    }
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  }

  // The project whose single-project views (state/logs/runs) the dashboard shows.
  // A pinned project wins if it has data; otherwise show the most recently
  // active project (a currently-running one preferred).
  private async activeProject(): Promise<string | null> {
    if (this.boundProject) {
      const exists = await getProject(this.boundProject);
      if (exists) return this.boundProject;
    }
    const projects = await listProjects(); // ordered by updatedAt desc
    if (projects.length === 0) return null;
    const running = projects.find((p) => p.state.status === "running");
    return (running || projects[0]).name;
  }

  // Generated build output / dependency / lockfile noise to hide from the grid.
  private static readonly ARTIFACT_SKIP_DIRS = new Set([
    "node_modules", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
    "coverage", ".cache", ".turbo", ".parcel-cache", ".vite", "__pycache__",
  ]);
  private static readonly ARTIFACT_SKIP_FILE = /(\.map$|\.tsbuildinfo$|^package-lock\.json$|^pnpm-lock\.yaml$|^yarn\.lock$)/i;

  // Resolve a project's on-disk workspace directory. Prefers the absolute path
  // stored in the DB (location-independent), falling back to a cwd-relative path.
  private async projectDir(name: string | null): Promise<string | null> {
    if (!name) return null;
    const state = await getProject(name);
    if (state?.workspaceDir && fs.existsSync(state.workspaceDir)) return state.workspaceDir;
    const fallback = path.join(this.workspaceRoot, name);
    return fs.existsSync(fallback) ? fallback : null;
  }

  private listArtifacts(rootDir: string): Array<{ path: string; size: number }> {
    const results: Array<{ path: string; size: number }> = [];
    const scan = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          if (DashboardServer.ARTIFACT_SKIP_DIRS.has(entry.name)) continue;
          scan(path.join(dir, entry.name));
        } else {
          if (DashboardServer.ARTIFACT_SKIP_FILE.test(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          results.push({
            path: path.relative(rootDir, fullPath).replace(/\\/g, "/"),
            size: fs.statSync(fullPath).size,
          });
        }
      }
    };
    scan(rootDir);
    return results;
  }

  private readArtifact(rootDir: string, relativePath: string): string | null {
    const resolved = path.resolve(rootDir, relativePath);
    if (!resolved.startsWith(path.resolve(rootDir))) return null;
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, "utf-8");
  }
}
