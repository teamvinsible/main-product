#!/usr/bin/env node

import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { Orchestrator } from "./orchestrator.js";
import { DashboardServer } from "./dashboard/server.js";
import { Deployer } from "./deploy/deployer.js";
import { isDeployProvider } from "./deploy/credentials.js";
import { SwarmLogger, logSystem, logError } from "./utils/logger.js";
import { migrate } from "./db/migrate.js";
import { getProject, addChatMessage, getChatMessages, listProjects } from "./db/store.js";
import { scrubHistoricalSecrets } from "./db/scrub.js";
import { classifyChatIntent, answerProjectQuestion, recordChatArtifact } from "./pipeline/chat.js";
import { analyzeIntake } from "./pipeline/intake.js";
import { runPreflight } from "./harness/preflight.js";
import { loadPolicy } from "./harness/policy.js";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { projectWorkspace, workspaceRoot } from "./utils/workspace-paths.js";
import type { SwarmConfig, Provider, ModelConfig } from "./types.js";
import { DEFAULT_MODEL_MAP } from "./types.js";

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
  Agent Swarm - Autonomous App Development Agency
  ================================================

  Usage:
    swarm run "<idea>" [--name <project-name>] [--no-ui] [--provider <claude|codex>]
    swarm do "<idea or change>"              One-shot: classify, pre-flight, then run
    swarm change <project> "<request>" [--intent <feature|bugfix|refactor|seo|marketing>]
    swarm feature <project> "<request>"    Add a feature to an existing project
    swarm fix <project> "<request>"        Fix a bug in an existing project
    swarm chat <project> "<message>"       Ask about a project (read-only) or request a change; both are logged
    swarm deploy <project> [--provider <vercel|digitalocean|gcp|aws>] [--profile <name>] [--prod]
    swarm serve [--port <port>]      Launch & monitor runs entirely from the web UI
    swarm resume <workspace-path>
    swarm dashboard [--port <port>]
    swarm status <workspace-path>
    swarm scrub-logs                 Redact secrets from already-stored logs/agent-runs/evals

  Options:
    --type <project-type>            Force a project type (else auto-classified). See: swarm types
    --repo <owner/repo|url|name>     Commit & push to this GitHub repo
    --repo-profile <name>            GitHub credential profile (default uses GITHUB_TOKEN/GH_TOKEN; custom uses GITHUB_TOKEN_<NAME>)
    --local-only                     Allow an existing-project change without a linked repo
    --provider <provider>            Default provider for all agents (claude|anthropic|codex|deepseek)
                                     claude = Agent SDK (subscription auth); anthropic = raw Messages API (ANTHROPIC_API_KEY)
    --high-provider <provider>       Provider for planning agents (overrides --provider)
    --low-provider <provider>        Provider for coding agents (overrides --provider)
    --high-model <model-id>          Model for planning agents (PM, designer, architect)
    --low-model <model-id>           Model for execution agents (devs, QA, devops)
    --no-ui                          Skip launching the dashboard
    --port <port>                    Dashboard port (default: 3456)

  Examples:
    swarm run "A task management app with AI-powered prioritization"
    swarm run "Social fitness app" --name fitbuddy
    swarm run "Chat app" --low-provider deepseek --low-model deepseek-coder
    swarm run "Chat app" --provider codex --low-model o4-mini
    swarm feature fitbuddy "Add a weekly leaderboard with friends"
    swarm fix fitbuddy "Login button does nothing on Safari"
    swarm change fitbuddy "Tighten up the onboarding copy"
    swarm serve                      # then open the dashboard and click "New Run"
    swarm dashboard --port 3333
    swarm resume ./.swarm/workspaces/fitbuddy
  `);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  // All commands below need the database; ensure schema is applied.
  if (command !== "types") await migrate();

  switch (command) {
    case "run": {
      const idea = args[1];
      if (!idea) {
        logError("Please provide an idea. Usage: swarm run \"<idea>\"");
        process.exit(1);
      }

      const nameIdx = args.indexOf("--name");
      const projectName = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
      const noUi = args.includes("--no-ui");
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;

      // Model configuration
      const providerIdx = args.indexOf("--provider");
      const provider: Provider = providerIdx !== -1 ? args[providerIdx + 1] as Provider : "claude";
      const highProviderIdx = args.indexOf("--high-provider");
      const highProvider: Provider | undefined = highProviderIdx !== -1 ? args[highProviderIdx + 1] as Provider : undefined;
      const lowProviderIdx = args.indexOf("--low-provider");
      const lowProvider: Provider | undefined = lowProviderIdx !== -1 ? args[lowProviderIdx + 1] as Provider : undefined;
      const highModelIdx = args.indexOf("--high-model");
      const highModel = highModelIdx !== -1 ? args[highModelIdx + 1] : undefined;
      const lowModelIdx = args.indexOf("--low-model");
      const lowModel = lowModelIdx !== -1 ? args[lowModelIdx + 1] : undefined;

      const configOverride = buildModelConfig(provider, highModel, lowModel, highProvider, lowProvider);
      const typeIdx = args.indexOf("--type");
      if (typeIdx !== -1 && args[typeIdx + 1]) configOverride.projectType = args[typeIdx + 1];
      const repoIdx = args.indexOf("--repo");
      if (repoIdx !== -1 && args[repoIdx + 1]) configOverride.repo = args[repoIdx + 1];
      const repoProfileIdx = args.indexOf("--repo-profile");
      if (repoProfileIdx !== -1 && args[repoProfileIdx + 1]) configOverride.repoProfile = args[repoProfileIdx + 1];

      const workspaceDir = projectWorkspace(projectName || slugify(idea));

      // Start dashboard unless --no-ui
      let dashboard: DashboardServer | undefined;
      if (!noUi) {
        dashboard = new DashboardServer(workspaceDir, port);
        await dashboard.start();
        logSystem(`Dashboard: http://localhost:${port}`);
      }

      const orchestrator = new Orchestrator(workspaceDir, configOverride);
      await orchestrator.run(idea, projectName);

      if (dashboard) {
        logSystem("Dashboard still running. Press Ctrl+C to stop.");
      } else {
        process.exit(0);
      }
      break;
    }

    case "do": {
      const message = args[1];
      if (!message) {
        logError('Usage: swarm do "<idea or change request>" [--name <project>] [--no-ui]');
        process.exit(1);
      }

      const nameIdx = args.indexOf("--name");
      const projectNameFlag = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
      const noUi = args.includes("--no-ui");
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;

      const providerIdx = args.indexOf("--provider");
      const provider: Provider = providerIdx !== -1 ? args[providerIdx + 1] as Provider : "claude";
      const highProviderIdx = args.indexOf("--high-provider");
      const highProvider: Provider | undefined = highProviderIdx !== -1 ? args[highProviderIdx + 1] as Provider : undefined;
      const lowProviderIdx = args.indexOf("--low-provider");
      const lowProvider: Provider | undefined = lowProviderIdx !== -1 ? args[lowProviderIdx + 1] as Provider : undefined;
      const highModelIdx = args.indexOf("--high-model");
      const highModel = highModelIdx !== -1 ? args[highModelIdx + 1] : undefined;
      const lowModelIdx = args.indexOf("--low-model");
      const lowModel = lowModelIdx !== -1 ? args[lowModelIdx + 1] : undefined;
      const configOverride = buildModelConfig(provider, highModel, lowModel, highProvider, lowProvider);
      const typeIdx = args.indexOf("--type");
      if (typeIdx !== -1 && args[typeIdx + 1]) configOverride.projectType = args[typeIdx + 1];
      const repoIdx = args.indexOf("--repo");
      if (repoIdx !== -1 && args[repoIdx + 1]) configOverride.repo = args[repoIdx + 1];
      const repoProfileIdx = args.indexOf("--repo-profile");
      if (repoProfileIdx !== -1 && args[repoProfileIdx + 1]) configOverride.repoProfile = args[repoProfileIdx + 1];
      if (args.includes("--local-only")) configOverride.localOnly = true;

      const chatModel: ModelConfig = { provider, model: highModel || DEFAULT_MODELS[provider].high, tier: "high" };
      const projectNames = (await listProjects()).map((p) => p.name);
      const intake = await analyzeIntake(message, projectNames, chatModel, workspaceRoot());

      if (intake.mode === "change") {
        const existing = await getProject(intake.project);
        if (!existing) {
          logError(`Project "${intake.project}" not found.`);
          process.exit(1);
        }
        const workspaceDir = existing.workspaceDir && fs.existsSync(existing.workspaceDir)
          ? existing.workspaceDir
          : projectWorkspace(intake.project);
        const projEnvPath = path.join(workspaceDir, ".env");
        if (fs.existsSync(projEnvPath)) {
          (await import("dotenv")).config({ path: projEnvPath, override: true });
        }
        const preflight = runPreflight({
          request: message,
          workspaceDir,
          deployProvider: existing.deployProvider,
          deployProfile: existing.deployProfile,
        });
        logSystem(preflight.summary);
        for (const w of preflight.warnings) logSystem(w);
        if (!await confirmPreflight(preflight, {
          request: message,
          workspaceDir,
          deployProvider: existing.deployProvider,
          deployProfile: existing.deployProfile,
        })) process.exit(1);

        let dashboard: DashboardServer | undefined;
        if (!noUi) {
          dashboard = new DashboardServer(workspaceDir, port);
          await dashboard.start();
          logSystem(`Dashboard: http://localhost:${port}`);
        }
        const orchestrator = new Orchestrator(workspaceDir, configOverride);
        await orchestrator.change(intake.project, message, intake.intent || undefined);
        if (dashboard) logSystem("Dashboard still running. Press Ctrl+C to stop.");
        else process.exit(0);
        break;
      }

      const projectName = projectNameFlag || intake.suggestedName || slugify(intake.idea || message);
      const workspaceDir = projectWorkspace(projectName);
      const projEnvPath = path.join(workspaceDir, ".env");
      if (fs.existsSync(projEnvPath)) {
        (await import("dotenv")).config({ path: projEnvPath, override: true });
      }
      const preflight = runPreflight({ request: message, workspaceDir });
      logSystem(preflight.summary);
      if (intake.summary) logSystem(`Plan: ${intake.summary}`);
      for (const w of preflight.warnings) logSystem(w);
      if (!await confirmPreflight(preflight, { request: message, workspaceDir })) process.exit(1);

      let dashboard: DashboardServer | undefined;
      if (!noUi) {
        dashboard = new DashboardServer(workspaceDir, port);
        await dashboard.start();
        logSystem(`Dashboard: http://localhost:${port}`);
      }
      const orchestrator = new Orchestrator(workspaceDir, configOverride);
      await orchestrator.run(intake.idea || message, projectName);
      if (dashboard) logSystem("Dashboard still running. Press Ctrl+C to stop.");
      else process.exit(0);
      break;
    }

    case "change":
    case "feature":
    case "fix": {
      const project = args[1];
      const request = args[2];
      if (!project || !request) {
        logError(`Usage: swarm ${command} <project> "<request>" [--intent <feature|bugfix|refactor|seo|marketing>]`);
        process.exit(1);
      }

      // feature/fix are sugar for a fixed intent; `change` classifies (or --intent).
      const intentIdx = args.indexOf("--intent");
      const intent = command === "feature" ? "feature"
        : command === "fix" ? "bugfix"
        : (intentIdx !== -1 ? args[intentIdx + 1] : undefined);

      const noUi = args.includes("--no-ui");
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;

      // Model configuration (same flags as `run`).
      const providerIdx = args.indexOf("--provider");
      const provider: Provider = providerIdx !== -1 ? args[providerIdx + 1] as Provider : "claude";
      const highProviderIdx = args.indexOf("--high-provider");
      const highProvider: Provider | undefined = highProviderIdx !== -1 ? args[highProviderIdx + 1] as Provider : undefined;
      const lowProviderIdx = args.indexOf("--low-provider");
      const lowProvider: Provider | undefined = lowProviderIdx !== -1 ? args[lowProviderIdx + 1] as Provider : undefined;
      const highModelIdx = args.indexOf("--high-model");
      const highModel = highModelIdx !== -1 ? args[highModelIdx + 1] : undefined;
      const lowModelIdx = args.indexOf("--low-model");
      const lowModel = lowModelIdx !== -1 ? args[lowModelIdx + 1] : undefined;
      const configOverride = buildModelConfig(provider, highModel, lowModel, highProvider, lowProvider);
      const repoIdx = args.indexOf("--repo");
      if (repoIdx !== -1 && args[repoIdx + 1]) configOverride.repo = args[repoIdx + 1];
      const repoProfileIdx = args.indexOf("--repo-profile");
      if (repoProfileIdx !== -1 && args[repoProfileIdx + 1]) configOverride.repoProfile = args[repoProfileIdx + 1];
      if (args.includes("--local-only")) configOverride.localOnly = true;

      // Resolve the existing project's workspace.
      const existing = await getProject(project);
      if (!existing) {
        logError(`Project "${project}" not found. Build it first with: swarm run "<idea>" --name ${project}`);
        process.exit(1);
      }
      const workspaceDir = existing.workspaceDir && fs.existsSync(existing.workspaceDir)
        ? existing.workspaceDir
        : projectWorkspace(project);

      let dashboard: DashboardServer | undefined;
      if (!noUi) {
        dashboard = new DashboardServer(workspaceDir, port);
        await dashboard.start();
        logSystem(`Dashboard: http://localhost:${port}`);
      }

      const orchestrator = new Orchestrator(workspaceDir, configOverride);
      await orchestrator.change(project, request, intent);

      if (dashboard) {
        logSystem("Dashboard still running. Press Ctrl+C to stop.");
      } else {
        process.exit(0);
      }
      break;
    }

    // Interactive per-project chat. Classifies one message as a QUESTION
    // (answered read-only) or a CHANGE (launches a change run). Every request is
    // recorded to the project's chat thread AND its local artifact trail.
    case "chat": {
      const project = args[1];
      const message = args[2];
      if (!project || !message) {
        logError('Usage: swarm chat <project> "<message>"');
        process.exit(1);
      }
      const existing = await getProject(project);
      if (!existing) {
        logError(`Project "${project}" not found. Build it first with: swarm run "<idea>" --name ${project}`);
        process.exit(1);
      }
      const workspaceDir = existing.workspaceDir && fs.existsSync(existing.workspaceDir)
        ? existing.workspaceDir
        : projectWorkspace(project);

      // Same model flags as run/change.
      const providerIdx = args.indexOf("--provider");
      const provider: Provider = providerIdx !== -1 ? args[providerIdx + 1] as Provider : "claude";
      const highProviderIdx = args.indexOf("--high-provider");
      const highProvider: Provider | undefined = highProviderIdx !== -1 ? args[highProviderIdx + 1] as Provider : undefined;
      const lowProviderIdx = args.indexOf("--low-provider");
      const lowProvider: Provider | undefined = lowProviderIdx !== -1 ? args[lowProviderIdx + 1] as Provider : undefined;
      const highModelIdx = args.indexOf("--high-model");
      const highModel = highModelIdx !== -1 ? args[highModelIdx + 1] : undefined;
      const lowModelIdx = args.indexOf("--low-model");
      const lowModel = lowModelIdx !== -1 ? args[lowModelIdx + 1] : undefined;
      const configOverride = buildModelConfig(provider, highModel, lowModel, highProvider, lowProvider);
      // A single planning-grade model config for classification + answering.
      const chatModel: ModelConfig = { provider, model: highModel || DEFAULT_MODELS[provider].high, tier: "high" };

      // Record the user's request (thread + artifact trail). `--echoed` means the
      // dashboard already stored the user turn, so we don't duplicate it.
      if (!args.includes("--echoed")) {
        await addChatMessage({ id: randomUUID(), project, role: "user", kind: "message", text: message });
      }
      recordChatArtifact(workspaceDir, { role: "user", kind: "request", text: message });

      const history = await getChatMessages(project);
      const intent = await classifyChatIntent(message, chatModel, workspaceDir, undefined, undefined, history);

      if (intent.intent === "change") {
        const ack = `Starting a ${intent.changeIntent} change${intent.summary ? `: ${intent.summary}` : ""}.`;
        await addChatMessage({ id: randomUUID(), project, role: "swarm", kind: "note", text: ack, meta: { changeIntent: intent.changeIntent } });
        recordChatArtifact(workspaceDir, { role: "swarm", kind: "change", text: message, intent: intent.changeIntent, summary: intent.summary });

        // Route git the same way `change` does: use the linked repo if any,
        // else fall back to a local-only run so a chat change never dead-ends.
        const repoIdx = args.indexOf("--repo");
        const repo = (repoIdx !== -1 ? args[repoIdx + 1] : existing.repoUrl || "").trim();
        if (repo) {
          configOverride.repo = repo;
          const repoProfileIdx = args.indexOf("--repo-profile");
          configOverride.repoProfile = repoProfileIdx !== -1 ? args[repoProfileIdx + 1] : (existing.credentialProfile || "default");
        } else {
          configOverride.localOnly = true;
        }

        const orchestrator = new Orchestrator(workspaceDir, configOverride);
        await orchestrator.change(project, message, intent.changeIntent);
      } else {
        const answer = await answerProjectQuestion(message, chatModel, workspaceDir, undefined, undefined, history);
        await addChatMessage({ id: randomUUID(), project, role: "swarm", kind: "answer", text: answer });
        recordChatArtifact(workspaceDir, { role: "swarm", kind: "answer", text: answer, summary: intent.summary });
      }
      process.exit(0);
      break;
    }

    case "deploy": {
      const project = args[1];
      if (!project) {
        logError('Usage: swarm deploy <project> [--provider <vercel|digitalocean|gcp|aws>] [--profile <name>] [--prod]');
        process.exit(1);
      }
      const existing = await getProject(project);
      if (!existing) {
        logError(`Project "${project}" not found. Build it first with: swarm run "<idea>" --name ${project}`);
        process.exit(1);
      }
      const workspaceDir = existing.workspaceDir && fs.existsSync(existing.workspaceDir)
        ? existing.workspaceDir
        : projectWorkspace(project);

      // Layer per-project env (.swarm/workspaces/<name>/.env) so this project's isolated
      // deploy credentials override the global ones.
      const projEnvPath = path.join(workspaceDir, ".env");
      if (fs.existsSync(projEnvPath)) {
        (await import("dotenv")).config({ path: projEnvPath, override: true });
      }

      const flag = (name: string): string | undefined => {
        const i = args.indexOf(name);
        return i !== -1 ? args[i + 1] : undefined;
      };
      const provider = (flag("--provider") || existing.deployProvider || "").trim();
      if (!isDeployProvider(provider)) {
        logError("Set a deploy provider: --provider <vercel|digitalocean|gcp|aws> (or bind one in the dashboard Deploy tab).");
        process.exit(1);
      }
      const profile = (flag("--profile") || existing.deployProfile || "default").trim();
      const target: Record<string, unknown> = { ...(existing.deployTarget || {}) };
      const setTarget = (key: string, argName: string) => { const v = flag(argName); if (v) target[key] = v; };
      setTarget("region", "--region");
      setTarget("project", "--gcp-project");
      setTarget("service", "--service");
      setTarget("appId", "--app-id");
      setTarget("image", "--image");

      const logger = new SwarmLogger(workspaceDir);
      const deployer = new Deployer(workspaceDir, logger);
      const result = await deployer.deploy({
        provider, profile, prod: args.includes("--prod"), target,
        repoUrl: existing.repoUrl, defaultBranch: existing.defaultBranch,
      });
      await logger.shutdown();
      if (result.ok) {
        logSystem(`Deployed: ${result.url || "(URL pending)"}`);
        process.exit(0);
      }
      logError(`Deploy failed: ${result.detail}`);
      process.exit(1);
      break;
    }

    case "resume": {
      const workspacePath = args[1];
      if (!workspacePath) {
        logError("Please provide workspace path. Usage: swarm resume <workspace-path>");
        process.exit(1);
      }

      const noUi = args.includes("--no-ui");
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;

      let dashboard: DashboardServer | undefined;
      if (!noUi) {
        dashboard = new DashboardServer(path.resolve(workspacePath), port);
        await dashboard.start();
        logSystem(`Dashboard: http://localhost:${port}`);
      }

      const orchestrator = new Orchestrator(path.resolve(workspacePath));
      const projectName = path.basename(path.resolve(workspacePath));
      await orchestrator.resumeLatest(projectName);
      break;
    }

    case "dashboard": {
      // Alias for `serve`: full control dashboard (Launch + Settings) unless
      // --read-only is passed. A specific workspace path is still honored.
      const workspacePath = args[1] && !args[1].startsWith("--") ? args[1] : workspaceRoot();
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;
      const readOnly = args.includes("--read-only");
      const dashboard = new DashboardServer(path.resolve(workspacePath), port, { controlMode: !readOnly });
      await dashboard.start();
      logSystem(`Dashboard running at http://localhost:${port}${readOnly ? " (read-only)" : ""}`);
      logSystem("Press Ctrl+C to stop.");
      break;
    }

    case "types": {
      const { PROJECT_TYPES } = await import("./types.js");
      console.log("\n  Available project types (use --type <key>, or omit to auto-classify):\n");
      for (const t of Object.values(PROJECT_TYPES)) {
        console.log(`  ${t.key.padEnd(14)} ${t.label}`);
        console.log(`  ${" ".repeat(14)} ${t.phases.join(" → ")}\n`);
      }
      break;
    }

    case "serve": {
      // Control-mode dashboard: launch and monitor runs entirely from the UI.
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;
      const root = workspaceRoot();
      const dashboard = new DashboardServer(root, port, { controlMode: true });
      await dashboard.start();
      logSystem(`Control dashboard running at http://localhost:${port}`);
      logSystem("Launch and monitor runs from the Launch tab. Press Ctrl+C to stop.");
      break;
    }

    case "status": {
      const workspacePath = args[1];
      if (!workspacePath) {
        logError("Please provide workspace path.");
        process.exit(1);
      }
      const projectName = path.basename(path.resolve(workspacePath));
      const state = await getProject(projectName);
      if (!state) {
        logError(`No saved state found for project "${projectName}".`);
        process.exit(1);
      }
      console.log(JSON.stringify(state, null, 2));
      break;
    }

    case "scrub-logs": {
      logSystem("Redacting secrets from existing logs, agent runs and evals...");
      const stats = await scrubHistoricalSecrets();
      logSystem(`Scrub complete: ${stats.logs} log(s), ${stats.agentRuns} agent run(s), ${stats.evals} eval(s) rewritten.`);
      logSystem("Note: exact-value redaction uses the currently loaded .env; rotated/per-project secrets are caught by shape only.");
      break;
    }

    default:
      logError(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

const DEFAULT_MODELS: Record<Provider, { high: string; low: string }> = {
  claude:     { high: "claude-opus-4-6",              low: "claude-sonnet-4-6" },
  anthropic:  { high: "claude-opus-4-8",              low: "claude-sonnet-4-6" },
  codex:      { high: "o4-mini",                      low: "o4-mini" },
  deepseek:   { high: "deepseek-coder",               low: "deepseek-coder" },
  // OpenRouter models are provider-prefixed slugs; override with --high-model/--low-model.
  openrouter: { high: "anthropic/claude-opus-4.8",    low: "deepseek/deepseek-chat" },
  custom:     { high: "custom",                       low: "custom" },
};

function buildModelConfig(
  provider: Provider,
  highModel?: string,
  lowModel?: string,
  highProvider?: Provider,
  lowProvider?: Provider,
): Partial<SwarmConfig> {
  const effectiveHighProvider = highProvider || provider;
  const effectiveLowProvider = lowProvider || provider;

  // If everything is default, use DEFAULT_MODEL_MAP as-is
  if (effectiveHighProvider === "claude" && effectiveLowProvider === "deepseek" && !highModel && !lowModel) {
    return {}; // DEFAULT_MODEL_MAP already has this split
  }

  const models = { ...DEFAULT_MODEL_MAP };

  const HIGH_TIER_ROLES = ["orchestrator", "tech-lead", "change-analyst", "product-manager", "brand-strategist", "designer", "principal-engineer"] as const;
  const LOW_TIER_ROLES = ["researcher", "frontend-dev", "backend-dev", "qa-engineer", "seo-specialist", "devops", "content-strategist", "social-media-manager", "analytics-specialist"] as const;

  for (const role of HIGH_TIER_ROLES) {
    models[role] = {
      provider: effectiveHighProvider,
      model: highModel || DEFAULT_MODELS[effectiveHighProvider].high,
      tier: "high",
    };
  }

  for (const role of LOW_TIER_ROLES) {
    models[role] = {
      provider: effectiveLowProvider,
      model: lowModel || DEFAULT_MODELS[effectiveLowProvider].low,
      tier: "low",
    };
  }

  return { models, defaultProvider: provider };
}

async function confirmPreflight(
  preflight: ReturnType<typeof runPreflight>,
  opts: { request: string; workspaceDir: string; deployProvider?: string; deployProfile?: string },
): Promise<boolean> {
  if (preflight.ready) return true;
  const policy = loadPolicy();
  if (!policy.preflight.blockOnMissingSecrets) return true;
  if (!process.stdin.isTTY) {
    logError("Pre-flight failed: required env keys missing (set swarm.policy.json blockOnMissingSecrets=false to warn only).");
    return false;
  }
  logSystem("Required env keys are missing. Add them to .env (never paste values here), then press Enter to continue or type 'abort'.");
  for (const k of preflight.missing) {
    logSystem(`  ${k.envKey} — ${k.reason}`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("> ", (a) => { rl.close(); resolve(a.trim()); });
  });
  if (answer.toLowerCase() === "abort") return false;
  (await import("dotenv")).config();
  const projEnv = path.join(opts.workspaceDir, ".env");
  if (fs.existsSync(projEnv)) {
    (await import("dotenv")).config({ path: projEnv, override: true });
  }
  const recheck = runPreflight({
    request: opts.request,
    workspaceDir: opts.workspaceDir,
    deployProvider: opts.deployProvider,
    deployProfile: opts.deployProfile,
    env: process.env,
  });
  if (!recheck.ready) {
    logError("Pre-flight still failing after reload. Keys missing: " + recheck.missing.map((k) => k.envKey).join(", "));
    return false;
  }
  return true;
}

main().catch((err) => {
  logError(err.message || err);
  process.exit(1);
});
