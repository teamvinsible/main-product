import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { createInterface } from "node:readline";
import { Agent } from "./agent.js";
import { PromptStore } from "./prompts/prompt-store.js";
import { TEMPLATE_KEYS } from "./prompts/templates.js";
import { FileManager } from "./utils/file-manager.js";
import { SwarmLogger, logPhase, logAgent, logDoubt, logSystem, logError } from "./utils/logger.js";
import { Learner } from "./learning/learner.js";
import { Evaluator, type EvalReport } from "./evals/evaluator.js";
import { Lead, type DoubtResolution, type InterventionAction } from "./agents/lead.js";
import { upsertProject, upsertRun, getProject, getLatestRun, listRuns, insertEval, insertQuestion, getQuestion } from "./db/store.js";
import { planProject, buildChangeRoute } from "./pipeline/classifier.js";
import { classifyIntent } from "./pipeline/intent-classifier.js";
import { GitManager, type RemoteCheckFailure, type ReviewComment } from "./git/git-manager.js";
import { normalizeGitProfile, resolveGitCredential } from "./git/credentials.js";
import { insertCommit } from "./db/store.js";
import { ARTIFACT_BASE, isArtifactPathAllowed, isProjectCodePath, shouldSkipArtifactEntry } from "./utils/artifacts.js";
import {
  copySourceTree,
  detectCodeRoots,
  ensureWorkspaceLayout,
  hasImportedSource,
  resolveImportTarget,
  resolvePrimaryCodeRoot,
} from "./utils/workspace-layout.js";
import { redactDeep } from "./utils/env-scope.js";
import { buildProjectIndex, formatProjectIndex, selectContextFiles } from "./utils/project-index.js";
import { buildWorkSpec, writeWorkSpec, type WorkGate } from "./harness/work-spec.js";
import { applyPendingProposals } from "./routing/proposals.js";
import { notifyRunStatus } from "./notifications/status.js";
import { runPreflight } from "./harness/preflight.js";
import { loadPolicy } from "./harness/policy.js";
import { maybeAutoDeploy } from "./harness/auto-deploy.js";
import { validateLearningOutcomes } from "./harness/learning-validator.js";
import type { AgentRole, Phase, PhaseMode, ChangePlan, SwarmState, PhaseConfig, FlowStep, AgentResult, Doubt, SwarmMetrics, SwarmConfig } from "./types.js";
import { createDefaultConfig, resolveFlow, stepToPhaseConfig, pruneFlow, INTENTS, PROJECT_TYPES, DEFAULT_PROJECT_TYPE } from "./types.js";

type MigrationProvider = "supabase" | "postgres" | "prisma" | "unknown";

interface MigrationPolicy {
  provider: MigrationProvider;
  migrations: string[];
  appDir: string;
  readinessJson: string;
  readinessMarkdown: string;
}

interface MigrationReadiness {
  provider: MigrationProvider;
  migrations: string[];
  policyVersion: 1;
  localValidated: boolean;
  localValidationCommand?: string;
  localValidationStatus: "passed" | "failed" | "skipped";
  remoteApplied: boolean;
  remoteApplyMode: "ci" | "manual" | "executor" | "none";
  remoteEnvironment?: "local" | "staging" | "production";
  blocked: boolean;
  blockedReason?: string | null;
  unsafePatterns: string[];
  generatedCi: string[];
  generatedAt: string;
}

export class Orchestrator {
  private fileManager: FileManager;
  private state: SwarmState;
  private workspaceDir: string;
  private logger: SwarmLogger;
  private learner: Learner;
  private lead: Lead;
  private prompts: PromptStore;
  private config: SwarmConfig;
  private flow: FlowStep[] = [];
  private pipeline: PhaseConfig[] = [];
  private git: GitManager | null = null;
  private pipelineStartTime: number = 0;
  private resumeMode = false;
  private lastPhaseFailureFeedback = new Map<AgentRole, string>();
  private workGates: WorkGate[] = [];
  private appliedLearningIds: string[] = [];
  private deliveryMode: "pr" | "deploy" | "local" = "local";
  private deliveryUrl?: string;
  private lastNotifiedStatus = "";

  constructor(workspaceDir: string, config?: Partial<SwarmConfig>) {
    this.workspaceDir = this.canonicalPath(workspaceDir);
    this.config = createDefaultConfig(config);
    this.fileManager = new FileManager(workspaceDir);
    this.logger = new SwarmLogger(workspaceDir);
    this.learner = new Learner(workspaceDir);
    this.prompts = new PromptStore();
    this.lead = new Lead(workspaceDir, this.config.models["tech-lead"], this.logger, this.prompts);
    // State is loaded from the DB in run() (async); start from a clean slate.
    this.state = this.createInitialState();
  }

  private canonicalPath(dir: string): string {
    try {
      return fs.realpathSync.native(dir);
    } catch {
      return path.resolve(dir);
    }
  }

  private createInitialState(): SwarmState {
    return {
      projectName: "",
      runId: "",
      kind: "new-build",
      request: "",
      idea: "",
      projectType: DEFAULT_PROJECT_TYPE,
      workspaceDir: this.workspaceDir,
      currentPhase: "research",
      completedPhases: [],
      completedAgents: {},
      artifacts: [],
      doubts: [],
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metrics: {
        totalDurationMs: 0,
        phaseDurations: {},
        agentDurations: {},
        agentRetries: {},
        totalAgentRuns: 0,
        totalErrors: 0,
        totalTokensSaved: 0,
      },
    };
  }

  // New-build entry: build a project from an idea (greenfield). Resumes the
  // project's latest run if one is in progress.
  async run(idea: string, projectName?: string) {
    this.resumeMode = false;
    this.pipelineStartTime = Date.now();
    const name = projectName || this.slugify(idea);

    // A fresh `run` is a new attempt for this project. It inherits only durable
    // project identity; progress is resumed only through `resume`.
    const loaded = await getProject(name);
    if (loaded) {
      this.state = this.createInitialState();
      this.state.projectType = loaded.projectType;
      this.state.repoUrl = loaded.repoUrl;
      this.state.repoOwner = loaded.repoOwner;
      this.state.repoName = loaded.repoName;
      this.state.defaultBranch = loaded.defaultBranch;
      this.state.credentialProfile = loaded.credentialProfile;
    }
    this.state.idea = idea;
    this.state.projectName = name;
    this.state.workspaceDir = this.workspaceDir;
    this.state.status = "running";

    // A `run` is always a fresh new-build work order.
    this.state.kind = "new-build";
    this.state.runId = crypto.randomUUID();
    this.state.request = idea;
    this.state.credentialProfile = normalizeGitProfile(this.config.repoProfile || this.state.credentialProfile);

    this.loadProjectEnv();
    this.applyWorkspaceLayout();
    await this.importSourceProjectIfProvided(idea);
    await this.prompts.load(name);

    // Plan the route before any phase runs. Explicit override wins; otherwise
    // the planner chooses the concrete phase/agent path for this request and workspace.
    const override = this.config.projectType;
    if (override && PROJECT_TYPES[override]) {
      this.state.projectType = override;
      this.state.flow = resolveFlow(override, this.state.kind);
      this.state.plannerRationale = "Explicit project type override.";
    } else {
      const plan = await planProject(idea, this.config.models["tech-lead"], this.workspaceDir, this.logger, this.prompts);
      this.state.projectType = plan.projectType;
      this.state.flow = plan.steps;
      this.state.plannerRationale = plan.rationale;
      this.logger.log("info", "system", `Planner route: ${plan.steps.map((s) => `${s.phase}${s.agents?.length ? `[${s.agents.join("+")}]` : ""}`).join(" -> ")}`, {
        metadata: { rationale: plan.rationale, projectType: plan.projectType, steps: plan.steps },
      });
    }

    await this.executeRun();
  }

  // Change-request entry: apply a feature/bugfix/etc. to an EXISTING project as
  // a fresh work order (its own run, branch and PR). Classifies the intent
  // unless one is supplied.
  async change(projectName: string, request: string, intentOverride?: string) {
    this.resumeMode = false;
    this.pipelineStartTime = Date.now();
    const loaded = await getProject(projectName);
    if (!loaded) {
      throw new Error(`Project "${projectName}" not found. Build it first with: swarm run "<idea>" --name ${projectName}`);
    }

    // A change is a NEW work order — start from a clean run that inherits only
    // the project's identity (type, repo, workspace, original idea).
    this.state = this.createInitialState();
    this.state.projectName = projectName;
    this.state.workspaceDir = this.workspaceDir;
    this.state.idea = loaded.idea;
    this.state.repoUrl = loaded.repoUrl;
    this.state.repoOwner = loaded.repoOwner;
    this.state.repoName = loaded.repoName;
    this.state.defaultBranch = loaded.defaultBranch;
    this.state.credentialProfile = normalizeGitProfile(this.config.repoProfile || loaded.credentialProfile);
    this.state.projectType = loaded.projectType;
    this.state.runId = crypto.randomUUID();
    this.state.request = request;
    this.state.status = "running";

    // Commit the change to the project's existing repo unless one was forced.
    if (!this.config.repo && loaded.repoUrl) this.config.repo = loaded.repoUrl;
    if (!this.config.repo && !this.config.localOnly) {
      throw new Error(`Project "${projectName}" is not linked to a GitHub repo. Link a repo/profile first, pass --repo, or use --local-only.`);
    }

    this.loadProjectEnv();
    this.applyWorkspaceLayout();
    await this.prompts.load(projectName);

    // Intent: explicit override, else classify the request against the project.
    this.state.kind = (intentOverride && INTENTS[intentOverride])
      ? intentOverride
      : await classifyIntent(request, loaded, this.config.models["tech-lead"], this.workspaceDir, this.logger, this.prompts);

    // Change harness: intent flow template → scoping → prune (in executeRun).
    // The planner may only refine agent assignments, not replace the route.
    const route = await buildChangeRoute(
      loaded.projectType,
      this.state.kind,
      request,
      this.config.models["tech-lead"],
      this.workspaceDir,
      this.logger,
      this.prompts,
    );
    this.state.flow = route.steps;
    this.state.plannerRationale = route.rationale;
    this.logger.log("info", "system", `Change route: ${route.steps.map((s) => `${s.phase}${s.agents?.length ? `[${s.agents.join("+")}]` : ""}${s.optional ? "?" : ""}`).join(" -> ")}`, {
      metadata: { rationale: route.rationale, projectType: loaded.projectType, steps: route.steps, kind: this.state.kind },
    });

    await this.executeRun();
  }

  // Resume the latest saved work order for this workspace. Unlike run(), this
  // preserves failed/running change runs as well as new-builds.
  async resumeLatest(projectName?: string) {
    this.resumeMode = true;
    this.pipelineStartTime = Date.now();
    const name = projectName || path.basename(this.workspaceDir);
    const project = await getProject(name);
    if (!project) {
      throw new Error(`No saved state found for project "${name}". Cannot resume.`);
    }

    const latest = project.runId ? await getLatestRun(name) : null;
    this.state = {
      ...(latest || project),
      projectName: name,
      projectType: project.projectType || DEFAULT_PROJECT_TYPE,
      workspaceDir: this.workspaceDir,
      idea: project.idea,
      repoUrl: project.repoUrl,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      defaultBranch: project.defaultBranch,
      credentialProfile: normalizeGitProfile(this.config.repoProfile || project.credentialProfile),
      completedAgents: (latest || project).completedAgents || {},
      status: "running",
    };
    if (!this.state.runId) this.state.runId = project.runId || crypto.randomUUID();
    if (!this.state.request) this.state.request = this.state.kind === "new-build" ? this.state.idea : project.request;

    if (!this.config.repo && project.repoUrl) this.config.repo = project.repoUrl;

    this.loadProjectEnv();
    this.applyWorkspaceLayout();
    await this.prompts.load(name);
    await this.executeRun();
  }

  private applyWorkspaceLayout() {
    const report = ensureWorkspaceLayout(this.workspaceDir);
    if (report.migratedArtifactDirs.length) {
      logSystem(`Migrated legacy support-doc folders into ${ARTIFACT_BASE}/: ${report.migratedArtifactDirs.join(", ")}`);
    }
    if (report.removedEmptyCodeRoots.length) {
      logSystem(`Removed empty code-root placeholders: ${report.removedEmptyCodeRoots.join(", ")}`);
    }
  }

  // Layer per-project env vars (.swarm/workspaces/<name>/.env) over the global ones.
  private loadProjectEnv() {
    const projEnvPath = path.join(this.workspaceDir, ".env");
    if (fs.existsSync(projEnvPath)) {
      dotenv.config({ path: projEnvPath, override: true });
      logSystem("Loaded per-project environment variables (override global)");
    }
  }

  private async importSourceProjectIfProvided(request: string): Promise<void> {
    if (hasImportedSource(this.workspaceDir)) return;
    const importDir = resolveImportTarget(this.workspaceDir);

    const localSource = this.findLocalSourcePath(request);
    if (localSource) {
      copySourceTree(localSource, importDir);
      const rel = path.relative(this.workspaceDir, importDir).replace(/\\/g, "/") || ".";
      logSystem(`Imported existing source into ${rel === "." ? "./" : `${rel}/`} from ${localSource}`);
      return;
    }

    if (this.config.repo) {
      const imported = await this.cloneRepoSource(this.config.repo, importDir);
      if (imported) {
        const rel = path.relative(this.workspaceDir, importDir).replace(/\\/g, "/") || ".";
        logSystem(`Imported existing source into ${rel === "." ? "./" : `${rel}/`} from Git repo ${this.safeRepoLabel(this.config.repo)}`);
      }
    }
  }

  private findLocalSourcePath(text: string): string | null {
    const candidates = new Set<string>();
    const quoted = text.matchAll(/["']([^"']+)["']/g);
    for (const match of quoted) candidates.add(match[1]);
    const windowsPaths = text.match(/[A-Za-z]:\\[^\s"'<>|]+(?:\\[^\s"'<>|]+)*/g) || [];
    for (const p of windowsPaths) candidates.add(p);

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate.trim());
      if (resolved === path.resolve(this.workspaceDir)) continue;
      if (!fs.existsSync(resolved)) continue;
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) return resolved;
      if (stat.isFile()) return path.dirname(resolved);
    }
    return null;
  }

  private async cloneRepoSource(repoSpec: string, appDir: string): Promise<boolean> {
    const tmp = path.join(this.workspaceDir, ".source-clone");
    fs.rmSync(tmp, { recursive: true, force: true });
    const cloneUrl = this.cloneUrl(repoSpec);
    if (!cloneUrl) return false;

    const result = await this.runGit(["clone", "--depth", "1", cloneUrl.url, tmp], cloneUrl.extraEnv);
    if (result.code !== 0) {
      logError(`Source clone failed for ${this.safeRepoLabel(repoSpec)}: ${result.stderr.slice(0, 300)}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      return false;
    }

    copySourceTree(tmp, appDir);
    fs.rmSync(tmp, { recursive: true, force: true });
    return true;
  }

  private cloneUrl(repoSpec: string): { url: string; extraEnv: Record<string, string> } | null {
    const spec = repoSpec.trim();
    const credential = resolveGitCredential(this.config.repoProfile || this.state.credentialProfile);
    const token = credential?.token || "";
    const github = spec.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i);
    const ownerRepo = !github && /^[^/\s]+\/[^/\s]+$/.test(spec) ? spec : "";
    if (github || ownerRepo) {
      const owner = github ? github[1] : ownerRepo.split("/")[0];
      const repo = github ? github[2] : ownerRepo.split("/")[1].replace(/\.git$/, "");
      if (token) {
        return {
          url: `https://github.com/${owner}/${repo}.git`,
          extraEnv: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${token}` },
        };
      }
      return { url: `https://github.com/${owner}/${repo}.git`, extraEnv: {} };
    }
    if (/^https?:\/\//i.test(spec) || /^git@/i.test(spec)) return { url: spec, extraEnv: {} };
    return null;
  }

  private runGit(args: string[], extraEnv: Record<string, string>): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn("git", args, {
        cwd: this.workspaceDir,
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => { if (stderr.length < 20_000) stderr += d.toString(); });
      proc.on("close", (code) => resolve({ code: code ?? 1, stderr }));
      proc.on("error", (err) => resolve({ code: 1, stderr: err.message }));
    });
  }

  private resolveArtifactPatterns(patterns: string[]): string[] {
    const roots = detectCodeRoots(this.workspaceDir);
    const resolved: string[] = [];
    for (const pattern of patterns) {
      const normalized = pattern.replace(/\\/g, "/");
      if (normalized === "app/" || normalized === "app") {
        resolved.push(...(roots.length > 0 ? roots : ["app/"]));
      } else {
        resolved.push(normalized);
      }
    }
    return Array.from(new Set(resolved));
  }

  private safeRepoLabel(repoSpec: string): string {
    return repoSpec.replace(/https?:\/\/[^@\s]+@/i, "https://***@");
  }

  // Execute the resolved flow for the current run: triage (if any), each phase,
  // then completion (PR/evals/learnings). Shared by run() and change().
  private async executeRun() {
    const idea = this.state.idea;
    this.workGates = [];
    this.appliedLearningIds = [];
    this.deliveryMode = "local";
    this.deliveryUrl = undefined;
    this.logger.setRunId(this.state.runId);

    // Use the planner's route when one has already been computed; otherwise
    // ask the planner now. This keeps resumed/legacy runs from falling back to
    // broad static flows without looking at the request and workspace first.
    const projectType = this.state.projectType;
    if (!this.state.flow?.length) {
      const mode: PhaseMode = this.state.kind === "new-build" ? "greenfield" : "incremental";
      if (mode === "incremental") {
        const route = await buildChangeRoute(
          projectType,
          this.state.kind,
          this.state.request || idea,
          this.config.models["tech-lead"],
          this.workspaceDir,
          this.logger,
          this.prompts,
        );
        this.state.flow = route.steps;
        this.state.plannerRationale = route.rationale;
        this.logger.log("info", "system", `Change route: ${route.steps.map((s) => `${s.phase}${s.agents?.length ? `[${s.agents.join("+")}]` : ""}${s.optional ? "?" : ""}`).join(" -> ")}`, {
          metadata: { rationale: route.rationale, projectType, steps: route.steps, kind: this.state.kind },
        });
      } else {
        const plan = await planProject(this.planningRequestText(this.state.request || idea), this.config.models["tech-lead"], this.workspaceDir, this.logger, this.prompts, mode);
        this.state.projectType = plan.projectType || projectType;
        this.state.flow = plan.steps;
        this.state.plannerRationale = plan.rationale;
        this.logger.log("info", "system", `Planner route: ${plan.steps.map((s) => `${s.phase}${s.agents?.length ? `[${s.agents.join("+")}]` : ""}`).join(" -> ")}`, {
          metadata: { rationale: plan.rationale, projectType: plan.projectType, steps: plan.steps, kind: this.state.kind },
        });
      }
    }
    this.flow = this.state.flow?.length ? this.state.flow : resolveFlow(projectType, this.state.kind);
    this.state.flow = this.flow;
    this.pipeline = this.flow.map(stepToPhaseConfig);

    // Git strategy for this run is decided by its intent: change intents work on
    // a dedicated branch and open a PR; new-build commits to the default branch.
    const gitStrategy = INTENTS[this.state.kind]?.git ?? "commit-main";

    // Set up the GitHub repo (create if missing) when a repo + token are given.
    const profile = normalizeGitProfile(this.config.repoProfile || this.state.credentialProfile);
    this.state.credentialProfile = profile;
    const credential = resolveGitCredential(profile);
    if (this.config.repo && credential && gitStrategy !== "none") {
      this.git = new GitManager(this.workspaceDir, this.config.repo, credential.token, this.logger);
      const info = await this.git.init();
      if (info) {
        this.state.repoUrl = info.htmlUrl;
        this.state.repoOwner = info.owner;
        this.state.repoName = info.repo;
        this.state.defaultBranch = info.defaultBranch;
        this.state.credentialProfile = credential.profile;
        // For change runs, fork a work-order branch off the default branch.
        if (gitStrategy === "branch-pr") {
          const branch = this.state.branch
            || `swarm/${this.state.kind}-${this.slugify(this.state.request || this.state.kind)}-${this.state.runId.slice(0, 8)}`;
          const res = await this.git.startBranch(branch);
          if (res) {
            this.state.branch = res.branch;
            if (!this.state.baseCommit) this.state.baseCommit = res.baseCommit;
          }
        }
      } else {
        this.git = null;
      }
    } else if (this.config.repo && !credential) {
      const msg = `A repo was requested but GitHub credential profile "${profile}" is not configured.`;
      if (!this.config.localOnly && this.state.kind !== "new-build") throw new Error(`${msg} Set ${profile === "default" ? "GITHUB_TOKEN" : `GITHUB_TOKEN_${profile.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`} or use --local-only.`);
      logSystem(`${msg} Skipping GitHub integration.`);
    }

    // Load the cross-project knowledge base from the DB.
    await this.learner.init();

    this.saveState();

    const typeLabel = PROJECT_TYPES[projectType]?.label || projectType;
    this.logger.log("info", "system", `Pipeline started for project: ${this.state.projectName} [${typeLabel}]`, {
      metadata: { idea, projectName: this.state.projectName, projectType, workspaceDir: this.workspaceDir },
    });

    // Inject learnings from previous projects
    const learningContext = this.learner.getKnowledgeBase().getLearningsContext();
    this.appliedLearningIds = this.learner.getKnowledgeBase().learningsForInjection().map((l) => l.id);
    if (learningContext) {
      this.logger.log("info", "learning", `Injecting ${this.learner.getKnowledgeBase().getStats().totalLearnings} learnings from previous projects`);
    }
    await this.writeRunHandoff("started");

    logSystem(`Project: ${this.state.projectName}`);
    logSystem(`Idea: ${idea}`);
    logSystem(`Type: ${typeLabel}`);
    logSystem(`Workspace: ${this.workspaceDir}`);

    const preflight = runPreflight({
      request: this.state.request || idea,
      workspaceDir: this.workspaceDir,
      deployProvider: this.state.deployProvider,
      deployProfile: this.state.deployProfile,
      env: process.env,
    });
    this.workGates.push({
      id: "gate:preflight",
      kind: "gate",
      name: "preflight",
      status: preflight.ready ? "passed" : "failed",
      detail: preflight.summary,
    });
    logSystem(preflight.summary);
    for (const w of preflight.warnings) logSystem(w);
    if (preflight.missing.length > 0) {
      for (const k of preflight.missing) {
        logSystem(`  · set ${k.envKey} in .env (${k.reason}) — value never goes in chat/logs`);
      }
      if (loadPolicy().preflight.blockOnMissingSecrets) {
        this.state.status = "failed";
        this.state.metrics.totalDurationMs = Date.now() - this.pipelineStartTime;
        this.saveState();
        this.logger.log("error", "system", "Pre-flight blocked: required env keys missing.");
        await this.finalizeRun();
        return;
      }
    }

    // For change requests, triage first (scoping) and prune the flow from the
    // resulting plan. This is a no-op for new-build (no scoping step).
    const scoped = await this.runScopingAndPrune(learningContext);
    if (!scoped) {
      this.state.status = "failed";
      this.state.metrics.totalDurationMs = Date.now() - this.pipelineStartTime;
      this.saveState();
      this.logger.log("error", "system", "Run failed during scoping/triage");
      await this.learner.extractLearnings(this.state);
      await this.finalizeRun();
      return;
    }

    logSystem(`Pipeline: ${this.pipeline.map((p) => p.phase).join(" -> ") || "(no phases needed)"}`);

    const kbStats = this.learner.getKnowledgeBase().getStats();
    if (kbStats.totalProjects > 0) {
      logSystem(`Knowledge base: ${kbStats.totalLearnings} learnings from ${kbStats.totalProjects} previous projects`);
    }
    console.log("");

    // Find where to resume if restarting
    const firstIncomplete = this.pipeline.findIndex((p) => !this.state.completedPhases.includes(p.phase));
    const startIndex = this.state.completedPhases.length > 0
      ? (firstIncomplete === -1 ? this.pipeline.length : firstIncomplete)
      : 0;

    if (startIndex > 0 && startIndex < this.pipeline.length) {
      logSystem(`Resuming from phase: ${this.pipeline[startIndex].phase}`);
    }

    for (let i = startIndex; i < this.pipeline.length; i++) {
      const phaseConfig = this.pipeline[i];
      const mode = this.flow[i]?.mode ?? "greenfield";
      this.state.currentPhase = phaseConfig.phase;
      this.saveState();

      if (phaseConfig.phase === "qa") {
        const ready = await this.ensureMigrationReadiness(learningContext, mode);
        if (!ready) {
          this.state.status = "failed";
          this.state.metrics.totalDurationMs = Date.now() - this.pipelineStartTime;
          this.saveState();
          this.logger.log("error", "system", "Pipeline failed before QA: migration readiness could not be established.");
          await this.finalizeRun();
          return;
        }
      }

      if (this.resumeMode && this.phaseOutputsExist(phaseConfig)) {
        this.recordExistingPhaseArtifacts(phaseConfig);
        const done = (this.state.completedAgents[phaseConfig.phase] ||= []);
        for (const role of phaseConfig.agents) if (!done.includes(role)) done.push(role);
        if (!this.state.completedPhases.includes(phaseConfig.phase)) {
          this.state.completedPhases.push(phaseConfig.phase);
        }
        this.saveState();
        logSystem(`Resume: skipping ${phaseConfig.phase}; expected artifacts already exist.`);
        await this.commitPhase(phaseConfig);
        continue;
      }

      const phaseStart = Date.now();
      const success = await this.executePhase(phaseConfig, learningContext, mode);
      this.state.metrics.phaseDurations[phaseConfig.phase] = Date.now() - phaseStart;

      if (!success) {
        const recovered = await this.recoverFailedPhase(phaseConfig, learningContext, mode);
        if (recovered) {
          this.markPhaseCompleted(phaseConfig.phase);
          this.saveState();
          await this.commitPhase(phaseConfig);
          continue;
        }

        this.state.status = "failed";
        this.state.metrics.totalDurationMs = Date.now() - this.pipelineStartTime;
        this.saveState();

        this.logger.log("error", "system", `Pipeline failed at phase: ${phaseConfig.phase}`);

        // Still extract learnings + evaluate the partial output, then flush.
        await this.learner.extractLearnings(this.state);
        await this.runEvals();
        await this.finalizeRun();
        return;
      }

      this.markPhaseCompleted(phaseConfig.phase);
      this.saveState();

      // Commit & push this phase's work to GitHub.
      await this.commitPhase(phaseConfig);
    }

    // Auto-learn from this project
    await this.learner.extractLearnings(this.state);

    const finalReport = await this.runEvalsWithRepairs(learningContext);

    // Only BLOCKING eval failures (the app won't install/compile/run) fail the
    // run. If evals couldn't run at all, treat that as blocking too.
    if (!finalReport || finalReport.blockingFailures.length > 0) {
      this.state.status = "failed";
      this.state.metrics.totalDurationMs = Date.now() - this.pipelineStartTime;
      this.saveState();
      this.logger.log("error", "system",
        finalReport
          ? `Pipeline failed: ${finalReport.blockingFailures.length} blocking eval check(s) still failing after repair attempts.`
          : "Pipeline failed: evals could not be run.");
      await this.finalizeRun();
      return;
    }

    // Shippable. Any remaining advisory failures (tests, lint, docs) ride along
    // as a known-issues note instead of sinking the run.
    const advisoryRemain = finalReport.advisoryFailures.length > 0;
    if (advisoryRemain) this.writeKnownIssues(finalReport);
    this.state.status = advisoryRemain ? "completed_with_issues" : "completed";
    this.state.metrics.totalDurationMs = Date.now() - this.pipelineStartTime;
    this.saveState();

    this.logger.log(advisoryRemain ? "warn" : "info", "system",
      advisoryRemain
        ? `Pipeline completed with ${finalReport.advisoryFailures.length} known issue(s) — see KNOWN-ISSUES.md.`
        : "Pipeline completed successfully!",
      { metadata: { totalDurationMs: this.state.metrics.totalDurationMs, advisoryFailures: finalReport.advisoryFailures.length } });

    // For change runs, open a PR from the work-order branch into the base branch.
    if (this.git && gitStrategy === "branch-pr" && this.state.branch) {
      const prUrl = await this.git.openPullRequest(this.prTitle(), this.prBody());
      if (prUrl) {
        this.state.prUrl = prUrl;
        this.deliveryMode = "pr";
        this.deliveryUrl = prUrl;
        this.workGates.push({
          id: "gate:pr-delivery",
          kind: "gate",
          name: "pr-delivery",
          status: "passed",
          detail: prUrl,
        });
        this.saveState();
        logSystem(`PR opened for review: ${prUrl}`);
        const prNumber = this.prNumberFromUrl(prUrl);
        const sha = await this.git.currentSha();
        if (prNumber && sha) await this.runRemoteRepairs(prNumber, sha, learningContext);
      }
    }

    const deployOutcome = await maybeAutoDeploy({
      workspaceDir: this.workspaceDir,
      state: this.state,
      request: this.state.request || this.state.idea,
      logger: this.logger,
    });
    this.workGates.push(deployOutcome.gate);
    if (deployOutcome.deployed && deployOutcome.url) {
      this.deliveryMode = "deploy";
      this.deliveryUrl = deployOutcome.url;
      logSystem(`Auto-deployed: ${deployOutcome.url}`);
    }

    await this.finalizeRun();
    this.printSummary();
  }

  // Commit & push a completed phase's work to GitHub, recording the commit.
  private async commitPhase(config: PhaseConfig): Promise<void> {
    if (!this.git) return;
    const message = `${config.phase}: ${config.description}`;
    const commit = await this.git.commitPhase(config.phase, message);
    if (!commit) return;
    this.state.headCommit = commit.sha;
    this.saveState();
    try {
      await insertCommit({
        project: this.state.projectName,
        runId: this.state.runId,
        phase: config.phase,
        sha: commit.sha,
        message: commit.message,
        files: commit.files,
        htmlUrl: commit.htmlUrl,
      });
    } catch (err) {
      logError(`Failed to record commit: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Run deterministic evals on the generated app and persist the result.
  private async runEvals(): Promise<EvalReport | null> {
    try {
      this.logger.log("info", "system", "Evaluating generated app (install/build/typecheck/test/lint)...");
      const report = await new Evaluator(this.workspaceDir).evaluate();
      await insertEval({
        id: crypto.randomUUID(),
        project: this.state.projectName,
        runId: this.state.runId,
        createdAt: new Date().toISOString(),
        overallScore: report.overallScore,
        passed: report.passed,
        checks: redactDeep(report.checks), // eval check details carry raw command output
      });
      const pct = (report.overallScore * 100).toFixed(0);
      const failedChecks = report.checks.filter((c) => !c.passed).length;
      if (failedChecks > 0) {
        this.state.metrics.evalFailures = (this.state.metrics.evalFailures ?? 0) + failedChecks;
        this.state.metrics.totalErrors += failedChecks;
        this.saveState();
      }
      this.logger.log(report.passed ? "info" : "warn", "system",
        `Eval ${report.passed ? "PASSED" : "did not pass"} — score ${pct}% (${report.checks.filter(c => c.passed).length}/${report.checks.length} checks)`,
        { metadata: { overallScore: report.overallScore, passed: report.passed, checks: report.checks } });
      this.syncEvalGates(report);
      return report;
    } catch (err) {
      this.state.metrics.evalFailures = (this.state.metrics.evalFailures ?? 0) + 1;
      this.state.metrics.totalErrors++;
      this.saveState();
      logError(`Eval run failed: ${err instanceof Error ? err.message : err}`);
      this.syncEvalGates(null);
      return null;
    }
  }

  // Repair the app until it is shippable. Only BLOCKING failures (install /
  // compile / entrypoint) keep the loop going; once nothing blocking remains we
  // return the latest report and let the caller ship it (advisory failures
  // become a known-issues note). Returns null only if evals could not run.
  private async runEvalsWithRepairs(learningContext: string): Promise<EvalReport | null> {
    const MAX_EVAL_REPAIR_ROUNDS = 3;
    let report = await this.runEvals();
    for (let round = 0; round < MAX_EVAL_REPAIR_ROUNDS; round++) {
      if (!report) return null;
      if (report.blockingFailures.length === 0) return report; // shippable

      const repairConfig = this.evalRepairPhase(report);
      if (!repairConfig) return report;

      const failedChecks = report.checks.filter((c) => !c.passed);
      const details = failedChecks.map((c) =>
        `- [${c.tier}] ${c.name} (weight ${c.weight}): ${c.detail || "No detail"}`,
      ).join("\n\n");
      const feedback = new Map<AgentRole, string>();
      const instructions =
        `Deterministic evals failed. Fix the concrete issues below — blocking issues first (the app must install, compile and run) — update the application files, and do not rewrite unrelated working areas.\n\n${details}`;
      for (const role of repairConfig.agents) feedback.set(role, instructions);

      logSystem(`Eval repair round ${round + 1}: re-running ${repairConfig.agents.join(", ")} (${report.blockingFailures.length} blocking, ${report.advisoryFailures.length} advisory).`);
      const context = `${this.gatherContext(repairConfig.inputArtifacts)}\n\n--- EVAL FAILURES ---\n${details}`;
      const taskPrompt = this.buildTaskPrompt(repairConfig, context, learningContext, "incremental");
      const results = await this.runPhaseAgents(repairConfig, repairConfig.agents, taskPrompt, feedback);
      if (results === null) return report; // unrecoverable agent failure — ship/fail on the last known report
      this.recordArtifacts(results, repairConfig.phase);
      this.saveState();
      await this.commitPhase(repairConfig);

      report = await this.runEvals();
    }
    return report;
  }

  // Deliver-with-caveats: record non-blocking eval failures so a run can ship as
  // `completed_with_issues` instead of failing outright.
  private writeKnownIssues(report: EvalReport): void {
    const lines = [
      "# Known Issues",
      "",
      `Generated ${new Date().toISOString()} for project **${this.state.projectName}** (run \`${this.state.runId}\`).`,
      "",
      "The app installs, compiles and has a runnable entrypoint, so it ships. The",
      "following non-blocking checks did not pass and should be addressed:",
      "",
    ];
    for (const c of report.advisoryFailures) {
      lines.push(`## ${c.name} (weight ${c.weight})`, "", "```", (c.detail || "(no detail)").slice(0, 2000), "```", "");
    }
    try {
      fs.writeFileSync(path.join(this.workspaceDir, "KNOWN-ISSUES.md"), lines.join("\n"), "utf-8");
      logSystem(`Wrote KNOWN-ISSUES.md (${report.advisoryFailures.length} advisory issue(s)).`);
    } catch (err) {
      logError(`Failed to write KNOWN-ISSUES.md: ${err instanceof Error ? err.message : err}`);
    }
  }

  private phaseRepairRounds(): number {
    const raw = Number(process.env.SWARM_PHASE_REPAIR_ROUNDS || "");
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2;
  }

  private async recoverFailedPhase(config: PhaseConfig, learningContext: string, mode: PhaseMode): Promise<boolean> {
    const maxRounds = this.phaseRepairRounds();
    if (maxRounds === 0) return false;

    for (let round = 1; round <= maxRounds; round++) {
      const report = await this.runEvals();
      const repairConfig = report ? (this.evalRepairPhase(report) || config) : config;
      const failedChecks = report?.checks.filter((c) => !c.passed) || [];
      const evalDetails = failedChecks.map((c) =>
        `- ${c.name} (weight ${c.weight}): ${c.detail || "No detail"}`,
      ).join("\n\n");

      const roles = Array.from(new Set([
        ...repairConfig.agents,
        ...Array.from(this.lastPhaseFailureFeedback.keys()).filter((role) => repairConfig.agents.includes(role)),
      ]));
      const feedback = new Map<AgentRole, string>();
      for (const role of roles) {
        const leadFeedback = this.lastPhaseFailureFeedback.get(role);
        const parts = [
          leadFeedback ? `Unresolved lead-review comments:\n${leadFeedback}` : "",
          evalDetails ? `Deterministic eval failures:\n${evalDetails}` : "",
        ].filter(Boolean);
        feedback.set(role, parts.join("\n\n") || "Re-check the failed phase and make the minimal fixes needed for lead approval.");
      }

      logSystem(`Phase recovery round ${round}/${maxRounds}: re-running ${roles.join(", ")} after failed lead review.`);
      const context = [
        this.gatherContext(repairConfig.inputArtifacts),
        this.gatherRunHandoffContext(),
        mode === "incremental" ? this.gatherChangeContext() : "",
        evalDetails ? `\n\n--- EVAL FAILURES ---\n${evalDetails}` : "",
      ].join("");
      const taskPrompt = this.buildTaskPrompt(repairConfig, context, learningContext, mode === "greenfield" ? "incremental" : mode);
      const results = await this.runPhaseAgents(repairConfig, roles, taskPrompt, feedback);
      if (results === null) return false;
      this.recordArtifacts(results, repairConfig.phase);
      this.saveState();
      await this.commitPhase(repairConfig);

      this.lastPhaseFailureFeedback = new Map();
      const approved = await this.executePhase(config, learningContext, mode);
      if (approved) return true;
    }

    return false;
  }

  private async ensureMigrationReadiness(learningContext: string, mode: PhaseMode): Promise<boolean> {
    const migrations = this.findProjectMigrations();
    if (migrations.length === 0) return true;

    const policy = this.buildMigrationPolicy(migrations);
    this.scaffoldMigrationPolicyFiles(policy);

    const existing = this.readMigrationReadiness(policy.readinessJson);
    if (this.resumeMode && existing && !existing.blocked && existing.unsafePatterns.length === 0) {
      logSystem("Migration readiness already verified; continuing to QA.");
      return true;
    }

    const unsafePatterns = this.findUnsafeMigrationPatterns(policy);
    if (unsafePatterns.length > 0) {
      this.writeMigrationReadiness(policy, {
        provider: policy.provider,
        migrations,
        policyVersion: 1,
        localValidated: false,
        localValidationCommand: "not run",
        localValidationStatus: "skipped",
        remoteApplied: false,
        remoteApplyMode: "none",
        blocked: true,
        blockedReason: `Unsafe Supabase migration pattern detected: ${unsafePatterns.join(", ")}`,
        unsafePatterns,
        generatedCi: this.expectedMigrationPolicyFiles(policy),
        generatedAt: new Date().toISOString(),
      });
      this.logger.log("error", "system", "Migration readiness blocked by unsafe migration policy.", {
        metadata: { provider: policy.provider, unsafePatterns },
      });
      return false;
    }

    const missing = this.missingMigrationEnvKeys();
    if (missing.length > 0) {
      const answer = await this.awaitHumanInput({
        agent: "backend-dev",
        phase: "development",
        question: `Database migration environment is incomplete. Set these env vars in the project .env: ${missing.join(", ")}`,
        context: `Migration files exist (${migrations.join(", ")}), but backend/devops cannot verify or apply them without the required Supabase/Postgres connection settings.`,
        timestamp: new Date().toISOString(),
      }, {
        resolution: "Use local/offline fallback only, document the unapplied migration as a blocker, and do not claim DB-backed features are verified.",
        resolvedBy: "tech-lead",
        needsHuman: true,
        inputKind: "secret",
        envKey: missing[0],
      });
      if (answer.startsWith("[SKIPPED")) {
        this.logger.log("warn", "system", "Migration readiness skipped by operator; QA must treat DB-backed behavior as blocked.", {
          metadata: { missing },
        });
        return true;
      }
      this.reloadProjectEnv();
      const stillMissing = this.missingMigrationEnvKeys();
      if (stillMissing.length > 0) {
        this.logger.log("error", "system", `Migration readiness still missing env vars after confirmation: ${stillMissing.join(", ")}`, {
          metadata: { stillMissing },
        });
        this.writeMigrationReadiness(policy, this.defaultMigrationReadiness(policy, {
          blocked: true,
          blockedReason: `Missing required migration env vars: ${stillMissing.join(", ")}`,
        }));
        return false;
      }
    }

    const localValidation = await this.validateMigrationsLocally(policy);
    const remoteExecution = await this.applyRemoteMigrationsIfConfigured(policy);
    if (remoteExecution.blocked) {
      this.writeMigrationReadiness(policy, this.defaultMigrationReadiness(policy, {
        localValidation,
        remoteApplied: false,
        remoteApplyMode: "executor",
        remoteEnvironment: remoteExecution.environment,
        blocked: true,
        blockedReason: remoteExecution.detail,
      }));
      return false;
    }

    const backendConfig = this.pipeline.find((p) => p.phase === "development") || {
      phase: "development" as const,
      agents: ["backend-dev" as const],
      parallel: false,
      inputArtifacts: ["_artifacts/product/", "_artifacts/architecture/", "app/"],
      outputArtifacts: ["app/", "_artifacts/backend/migration-readiness.md", "_artifacts/backend/migration-readiness.json"],
      description: "Verify database migrations and backend readiness before QA",
    };

    const prompt = this.buildMigrationReadinessPrompt(policy, mode, learningContext, localValidation);
    const feedback = new Map<AgentRole, string>([
      ["backend-dev", "Own database readiness. Apply or verify migrations when credentials permit; otherwise raise a precise secret/config doubt. Do not pass unresolved schema errors to QA."],
    ]);
    const results = await this.runPhaseAgents(
      {
        ...backendConfig,
        agents: ["backend-dev"],
        parallel: false,
        outputArtifacts: [...backendConfig.outputArtifacts, "_artifacts/backend/migration-readiness.md", "_artifacts/backend/migration-readiness.json"],
      },
      ["backend-dev"],
      prompt,
      feedback,
    );
    if (results === null || results.some((r) => !r.success)) return false;
    this.recordArtifacts(results, "development");
    this.saveState();

    const latestUnsafePatterns = this.findUnsafeMigrationPatterns(policy);
    if (latestUnsafePatterns.length > 0) {
      this.writeMigrationReadiness(policy, this.defaultMigrationReadiness(policy, {
        localValidation,
        unsafePatterns: latestUnsafePatterns,
        blocked: true,
        blockedReason: `Unsafe Supabase migration pattern detected: ${latestUnsafePatterns.join(", ")}`,
      }));
      return false;
    }

    let readiness = this.readMigrationReadiness(policy.readinessJson);
    if (!readiness) {
      readiness = this.defaultMigrationReadiness(policy, {
        localValidation,
        remoteApplied: remoteExecution.applied,
        remoteApplyMode: remoteExecution.attempted ? "executor" : "ci",
        remoteEnvironment: remoteExecution.environment,
        blocked: localValidation.status === "failed",
        blockedReason: localValidation.status === "failed" ? "Local migration validation failed." : null,
      });
      this.writeMigrationReadiness(policy, readiness);
    }

    const checked = this.normalizeMigrationReadiness(policy, readiness, localValidation, latestUnsafePatterns);
    if (remoteExecution.attempted) {
      checked.remoteApplied = remoteExecution.applied;
      checked.remoteApplyMode = "executor";
      checked.remoteEnvironment = remoteExecution.environment;
      checked.blocked = checked.blocked || remoteExecution.blocked;
      checked.blockedReason = remoteExecution.blocked ? remoteExecution.detail : checked.blockedReason;
    }
    this.writeMigrationReadiness(policy, checked);
    if (checked.blocked || checked.unsafePatterns.length > 0) {
      this.logger.log("error", "system", checked.blockedReason || "Migration readiness blocked before QA.", {
        metadata: { readiness: checked },
      });
      return false;
    }
    return true;
  }

  private findProjectMigrations(): string[] {
    const codeRoot = resolvePrimaryCodeRoot(this.workspaceDir);
    const candidates = [
      path.join(codeRoot, "supabase", "migrations"),
      path.join(this.workspaceDir, "supabase", "migrations"),
      path.join(codeRoot, "migrations"),
      path.join(this.workspaceDir, "migrations"),
      path.join(codeRoot, "db", "migrations"),
      path.join(this.workspaceDir, "db", "migrations"),
      path.join(codeRoot, "prisma", "migrations"),
      path.join(this.workspaceDir, "prisma", "migrations"),
    ];
    const root = path.resolve(this.workspaceDir);
    const out: string[] = [];
    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      for (const file of this.listFilesRecursive(dir)) {
        if (!/\.(sql|ts|js|prisma)$/i.test(file)) continue;
        const rel = path.relative(root, file).replace(/\\/g, "/");
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) out.push(rel);
      }
    }
    return [...new Set(out)].sort();
  }

  private listFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...this.listFilesRecursive(p));
      else out.push(p);
    }
    return out;
  }

  private buildMigrationPolicy(migrations: string[]): MigrationPolicy {
    const provider = this.detectMigrationProvider(migrations);
    return {
      provider,
      migrations,
      appDir: resolvePrimaryCodeRoot(this.workspaceDir),
      readinessJson: path.join(this.workspaceDir, ARTIFACT_BASE, "backend", "migration-readiness.json"),
      readinessMarkdown: path.join(this.workspaceDir, ARTIFACT_BASE, "backend", "migration-readiness.md"),
    };
  }

  private detectMigrationProvider(migrations: string[]): MigrationProvider {
    const codeRoot = resolvePrimaryCodeRoot(this.workspaceDir);
    if (migrations.some((m) => m.includes("supabase/"))) return "supabase";
    if (migrations.some((m) => m.includes("prisma/") || m.endsWith(".prisma"))) return "prisma";
    if (migrations.some((m) => m.includes("db/") || m.includes("migrations/"))) return "postgres";
    const pkg = this.readJsonIfExists(path.join(codeRoot, "package.json"));
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) } as Record<string, unknown>;
    if (deps["@supabase/supabase-js"] || fs.existsSync(path.join(codeRoot, "supabase"))) return "supabase";
    return "unknown";
  }

  private readJsonIfExists(file: string): Record<string, unknown> | null {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private scaffoldMigrationPolicyFiles(policy: MigrationPolicy): void {
    if (policy.provider !== "supabase") return;
    const files = new Map<string, string>([
      [path.join(policy.appDir, ".github", "workflows", "ci.yml"), this.supabaseCiWorkflow()],
      [path.join(policy.appDir, ".github", "workflows", "staging-db.yml"), this.supabaseStagingWorkflow()],
      [path.join(policy.appDir, ".github", "workflows", "production-db.yml"), this.supabaseProductionWorkflow()],
      [path.join(policy.appDir, "docs", "database-workflow.md"), this.supabaseDatabaseWorkflowDoc()],
    ]);
    for (const [file, content] of files) this.writeFileIfMissing(file, content);
    this.ensureSupabasePackageScripts(policy.appDir);
  }

  private writeFileIfMissing(file: string, content: string): void {
    if (fs.existsSync(file)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf-8");
    logSystem(`Created ${path.relative(this.workspaceDir, file).replace(/\\/g, "/")}`);
  }

  private ensureSupabasePackageScripts(appDir: string): void {
    const pkgPath = path.join(appDir, "package.json");
    const pkg = this.readJsonIfExists(pkgPath);
    if (!pkg) return;
    const scripts = { ...((pkg.scripts || {}) as Record<string, string>) };
    let changed = false;
    const set = (key: string, value: string) => {
      if (!scripts[key]) {
        scripts[key] = value;
        changed = true;
      }
    };
    set("db:reset", "supabase db reset --local");
    set("db:push:dry-run", "supabase db push --dry-run");
    set("db:push", "supabase db push");
    if (!changed) return;
    pkg.scripts = scripts;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
    logSystem(`Updated ${path.relative(this.workspaceDir, pkgPath).replace(/\\/g, "/")} with Supabase DB scripts.`);
  }

  private expectedMigrationPolicyFiles(policy: MigrationPolicy): string[] {
    if (policy.provider !== "supabase") return [];
    return [
      path.relative(this.workspaceDir, path.join(policy.appDir, ".github", "workflows", "ci.yml")).replace(/\\/g, "/"),
      path.relative(this.workspaceDir, path.join(policy.appDir, ".github", "workflows", "staging-db.yml")).replace(/\\/g, "/"),
      path.relative(this.workspaceDir, path.join(policy.appDir, ".github", "workflows", "production-db.yml")).replace(/\\/g, "/"),
      path.relative(this.workspaceDir, path.join(policy.appDir, "docs", "database-workflow.md")).replace(/\\/g, "/"),
    ];
  }

  private findUnsafeMigrationPatterns(policy: MigrationPolicy): string[] {
    if (policy.provider !== "supabase") return [];
    const root = path.resolve(policy.appDir);
    if (!fs.existsSync(root)) return [];
    const hits: string[] = [];
    for (const file of this.listFilesRecursive(root)) {
      const rel = path.relative(this.workspaceDir, file).replace(/\\/g, "/");
      if (rel.includes("/node_modules/") || rel.includes("/.next/") || rel.includes("/dist/")) continue;
      if (!/\.(ts|tsx|js|jsx|sql|md|mjs|cjs)$/i.test(file)) continue;
      let content = "";
      try { content = fs.readFileSync(file, "utf-8"); } catch { continue; }
      if (/\.rpc\s*\(\s*['"`]exec_sql['"`]/.test(content)) hits.push(`${rel}: rpc exec_sql`);
      if (/create\s+(or\s+replace\s+)?function\s+.*\bexec_sql\b/is.test(content)) hits.push(`${rel}: creates exec_sql`);
      if (/SUPABASE_SERVICE_ROLE_KEY/.test(content) && /migration|schema|exec_sql|apply/i.test(content) && /supabase\.rpc/i.test(content)) {
        hits.push(`${rel}: service role migration script`);
      }
    }
    return hits.sort();
  }

  private readMigrationReadiness(file: string): MigrationReadiness | null {
    try {
      if (!fs.existsSync(file)) return null;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<MigrationReadiness>;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as MigrationReadiness;
    } catch {
      return null;
    }
  }

  private defaultMigrationReadiness(
    policy: MigrationPolicy,
    opts: Partial<MigrationReadiness> & { localValidation?: { command: string; status: "passed" | "failed" | "skipped"; detail: string } } = {},
  ): MigrationReadiness {
    const local = opts.localValidation;
    return {
      provider: policy.provider,
      migrations: policy.migrations,
      policyVersion: 1,
      localValidated: local?.status === "passed",
      localValidationCommand: local?.command || opts.localValidationCommand || "",
      localValidationStatus: local?.status || opts.localValidationStatus || "skipped",
      remoteApplied: opts.remoteApplied ?? false,
      remoteApplyMode: opts.remoteApplyMode || (policy.provider === "supabase" ? "ci" : "manual"),
      remoteEnvironment: opts.remoteEnvironment,
      blocked: opts.blocked ?? false,
      blockedReason: opts.blockedReason ?? null,
      unsafePatterns: opts.unsafePatterns || [],
      generatedCi: opts.generatedCi || this.expectedMigrationPolicyFiles(policy),
      generatedAt: new Date().toISOString(),
    };
  }

  private normalizeMigrationReadiness(
    policy: MigrationPolicy,
    readiness: MigrationReadiness,
    localValidation: { command: string; status: "passed" | "failed" | "skipped"; detail: string },
    unsafePatterns: string[],
  ): MigrationReadiness {
    const normalized = this.defaultMigrationReadiness(policy, {
      ...readiness,
      localValidation,
      unsafePatterns,
    });
    normalized.localValidated = readiness.localValidated || localValidation.status === "passed";
    normalized.localValidationStatus = localValidation.status === "skipped"
      ? readiness.localValidationStatus || "skipped"
      : localValidation.status;
    normalized.localValidationCommand = localValidation.command || readiness.localValidationCommand;
    normalized.remoteApplyMode = readiness.remoteApplyMode || (policy.provider === "supabase" ? "ci" : "manual");
    normalized.blocked = Boolean(readiness.blocked || unsafePatterns.length > 0 || localValidation.status === "failed");
    normalized.blockedReason = unsafePatterns.length > 0
      ? `Unsafe migration pattern detected: ${unsafePatterns.join(", ")}`
      : localValidation.status === "failed"
        ? `Local migration validation failed: ${localValidation.detail.slice(0, 500)}`
        : readiness.blockedReason ?? null;
    return normalized;
  }

  private writeMigrationReadiness(policy: MigrationPolicy, readiness: MigrationReadiness): void {
    fs.mkdirSync(path.dirname(policy.readinessJson), { recursive: true });
    fs.writeFileSync(policy.readinessJson, `${JSON.stringify(readiness, null, 2)}\n`, "utf-8");
    fs.writeFileSync(policy.readinessMarkdown, this.formatMigrationReadiness(readiness), "utf-8");
  }

  private formatMigrationReadiness(readiness: MigrationReadiness): string {
    return [
      "# Migration Readiness",
      "",
      `Provider: ${readiness.provider}`,
      `Policy version: ${readiness.policyVersion}`,
      `Local validation: ${readiness.localValidationStatus}${readiness.localValidationCommand ? ` (${readiness.localValidationCommand})` : ""}`,
      `Remote applied: ${readiness.remoteApplied ? "yes" : "no"}`,
      `Remote apply mode: ${readiness.remoteApplyMode}`,
      `Blocked: ${readiness.blocked ? "yes" : "no"}`,
      readiness.blockedReason ? `Blocked reason: ${readiness.blockedReason}` : "",
      "",
      "## Migrations",
      ...readiness.migrations.map((m) => `- ${m}`),
      "",
      "## Unsafe Patterns",
      ...(readiness.unsafePatterns.length ? readiness.unsafePatterns.map((p) => `- ${p}`) : ["None detected."]),
      "",
      "## Generated CI / Docs",
      ...(readiness.generatedCi.length ? readiness.generatedCi.map((p) => `- ${p}`) : ["None."]),
      "",
      "Remote production schema changes must be applied by CI or the privileged migration executor, not by a general agent shell.",
    ].filter((line) => line !== "").join("\n");
  }

  private async validateMigrationsLocally(policy: MigrationPolicy): Promise<{ command: string; status: "passed" | "failed" | "skipped"; detail: string }> {
    if (policy.provider !== "supabase") {
      return { command: "", status: "skipped", detail: "No provider-specific local validator configured." };
    }
    const version = await this.runPolicyCommand("supabase --version", policy.appDir, 15_000);
    if (version.code !== 0) {
      return { command: "supabase --version", status: "skipped", detail: "Supabase CLI is not available." };
    }
    const command = "supabase db reset --local";
    const result = await this.runPolicyCommand(command, policy.appDir, 180_000);
    return {
      command,
      status: result.code === 0 ? "passed" : "failed",
      detail: result.output.slice(0, 4000),
    };
  }

  private async applyRemoteMigrationsIfConfigured(policy: MigrationPolicy): Promise<{
    attempted: boolean;
    applied: boolean;
    blocked: boolean;
    environment?: "staging" | "production";
    detail: string;
  }> {
    if (policy.provider !== "supabase" || process.env.SWARM_MIGRATION_APPLY_REMOTE !== "true") {
      return { attempted: false, applied: false, blocked: false, detail: "Remote migration apply is delegated to CI." };
    }
    const environment = (process.env.SWARM_MIGRATION_ENVIRONMENT === "production" ? "production" : "staging") as "staging" | "production";
    if (environment === "production" && process.env.SWARM_MIGRATION_PRODUCTION_APPROVED !== "true") {
      return {
        attempted: true,
        applied: false,
        blocked: true,
        environment,
        detail: "Production migration requested but SWARM_MIGRATION_PRODUCTION_APPROVED is not true.",
      };
    }
    const required = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"];
    const missing = required.filter((key) => !String(process.env[key] || "").trim());
    if (missing.length > 0) {
      return {
        attempted: true,
        applied: false,
        blocked: true,
        environment,
        detail: `Remote migration executor missing env vars: ${missing.join(", ")}`,
      };
    }

    const projectId = String(process.env.SUPABASE_PROJECT_ID);
    const link = await this.runPrivilegedSupabaseCli(policy.appDir, ["link", "--project-ref", projectId]);
    if (link.code !== 0) {
      return { attempted: true, applied: false, blocked: true, environment, detail: `supabase link failed: ${link.output}` };
    }
    const dryRun = await this.runPrivilegedSupabaseCli(policy.appDir, ["db", "push", "--dry-run"]);
    if (dryRun.code !== 0) {
      return { attempted: true, applied: false, blocked: true, environment, detail: `supabase db push --dry-run failed: ${dryRun.output}` };
    }
    const apply = await this.runPrivilegedSupabaseCli(policy.appDir, ["db", "push"]);
    return {
      attempted: true,
      applied: apply.code === 0,
      blocked: apply.code !== 0,
      environment,
      detail: apply.code === 0 ? "Remote migrations applied by privileged Supabase executor." : `supabase db push failed: ${apply.output}`,
    };
  }

  private runPrivilegedSupabaseCli(cwd: string, args: string[]): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve) => {
      const secrets = [
        process.env.SUPABASE_ACCESS_TOKEN,
        process.env.SUPABASE_DB_PASSWORD,
        process.env.SUPABASE_PROJECT_ID,
      ].filter((v): v is string => Boolean(v));
      const proc = spawn("supabase", args, {
        cwd,
        shell: process.platform === "win32",
        env: {
          ...process.env,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const max = 20_000;
      const append = (data: Buffer) => {
        if (output.length < max) output += data.toString();
      };
      proc.stdout.on("data", append);
      proc.stderr.on("data", append);
      const timer = setTimeout(() => {
        try { proc.kill("SIGTERM"); } catch { /* ignore */ }
        resolve({ code: null, output: this.redactKnownSecrets(`${output}\nTimed out after 180000ms.`, secrets) });
      }, 180_000).unref();
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output: this.redactKnownSecrets(output, secrets) });
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: -1, output: err.message });
      });
    });
  }

  private redactKnownSecrets(text: string, secrets: string[]): string {
    let out = text;
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join("[REDACTED]");
    }
    return out;
  }

  private runPolicyCommand(command: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, [], {
        cwd,
        shell: true,
        env: {
          ...process.env,
          SUPABASE_ACCESS_TOKEN: undefined,
          SUPABASE_DB_PASSWORD: undefined,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const max = 20_000;
      proc.stdout.on("data", (data: Buffer) => { if (output.length < max) output += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { if (output.length < max) output += data.toString(); });
      const timer = setTimeout(() => {
        try { proc.kill("SIGTERM"); } catch { /* ignore */ }
        resolve({ code: null, output: `${output}\nTimed out after ${timeoutMs}ms.` });
      }, timeoutMs).unref();
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: -1, output: err.message });
      });
    });
  }

  private supabaseCiWorkflow(): string {
    return `name: CI

on:
  pull_request:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      - name: Start local Supabase database
        run: supabase db start

      - name: Validate migrations locally
        run: supabase db reset --local

      - run: pnpm type-check
      - run: pnpm test
      - run: pnpm build
`;
  }

  private supabaseStagingWorkflow(): string {
    return `name: Deploy DB to Staging

on:
  push:
    branches: [develop]
    paths:
      - "supabase/migrations/**"
      - "supabase/seed.sql"
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest

    env:
      SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: \${{ secrets.STAGING_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: \${{ secrets.STAGING_PROJECT_ID }}

    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - run: supabase link --project-ref "$SUPABASE_PROJECT_ID"
      - run: supabase db push
`;
  }

  private supabaseProductionWorkflow(): string {
    return `name: Deploy DB to Production

on:
  push:
    branches: [main]
    paths:
      - "supabase/migrations/**"
      - "supabase/seed.sql"
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest
    environment: production

    env:
      SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: \${{ secrets.PRODUCTION_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: \${{ secrets.PRODUCTION_PROJECT_ID }}

    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - run: supabase link --project-ref "$SUPABASE_PROJECT_ID"
      - run: supabase db push --dry-run
      - run: supabase db push
`;
  }

  private supabaseDatabaseWorkflowDoc(): string {
    return `# Database Workflow

This project uses Supabase CLI migrations as the source of truth for schema changes.

## Local development

\`\`\`bash
supabase start
supabase migration new describe_change
supabase db reset --local
pnpm type-check
pnpm test
pnpm build
\`\`\`

Use local Supabase credentials from \`supabase status\` in \`.env.local\`. Do not commit real credentials.

## Remote environments

Remote migrations are applied by CI, not by a general-purpose agent shell.

- Staging: merge migration files to \`develop\`.
- Production: merge migration files to \`main\`; the \`production\` GitHub environment should require human approval.

Required CI secrets:

- \`SUPABASE_ACCESS_TOKEN\`
- \`STAGING_PROJECT_ID\`
- \`STAGING_DB_PASSWORD\`
- \`PRODUCTION_PROJECT_ID\`
- \`PRODUCTION_DB_PASSWORD\`

Do not use custom \`exec_sql\` RPC scripts for migrations. Keep schema changes in \`supabase/migrations/*.sql\` and deploy with \`supabase db push\`.
`;
  }

  private missingMigrationEnvKeys(): string[] {
    const required = this.requiredMigrationEnvKeys();
    return required.filter((key) => !String(process.env[key] || "").trim());
  }

  private requiredMigrationEnvKeys(): string[] {
    const keys = new Set<string>();
    const migrations = this.findProjectMigrations();
    const provider = this.detectMigrationProvider(migrations);
    if (provider === "supabase" && process.env.SWARM_MIGRATION_APPLY_REMOTE !== "true") {
      return [];
    }
    if (provider === "supabase") {
      return ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID"];
    }
    const codeRoot = resolvePrimaryCodeRoot(this.workspaceDir);
    const envExamplePaths = [
      path.join(codeRoot, ".env.example"),
      path.join(this.workspaceDir, ".env.example"),
    ];
    for (const file of envExamplePaths) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf-8");
      for (const match of content.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
        const key = match[1];
        if (/SUPABASE|DATABASE|POSTGRES|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PGPORT/i.test(key)) keys.add(key);
      }
    }
    return [...keys].sort();
  }

  private buildMigrationReadinessPrompt(
    policy: MigrationPolicy,
    mode: PhaseMode,
    learningContext: string,
    localValidation: { command: string; status: "passed" | "failed" | "skipped"; detail: string },
  ): string {
    const codeRoot = resolvePrimaryCodeRoot(this.workspaceDir);
    const manifest = this.readIfExists(path.join(codeRoot, "PROJECT-MANIFEST.md"));
    const envExample = this.readIfExists(path.join(codeRoot, ".env.example"));
    return [
      "Before QA can run, own database/schema readiness for this project.",
      "",
      `Mode: ${mode}`,
      `Provider detected: ${policy.provider}`,
      `Migration files detected:\n${policy.migrations.map((m) => `- ${m}`).join("\n")}`,
      `Local validation pre-check: ${localValidation.status}${localValidation.command ? ` (${localValidation.command})` : ""}`,
      localValidation.detail ? `Local validation output:\n${localValidation.detail.slice(0, 4000)}` : "",
      "",
      "Required behavior:",
      "1. Inspect the migration files and app env template.",
      "2. For Supabase, schema changes must live in supabase/migrations/*.sql and remote deploy must use Supabase CLI db push through CI or the privileged executor.",
      "3. Do not create or use exec_sql RPC migration scripts. Do not pass service-role keys to a general agent shell.",
      "4. If local validation failed, fix the migration or mark readiness blocked with the exact reason.",
      "5. If local validation was skipped because tooling is unavailable, document that remote apply is CI/manual and QA must not claim remote DB-backed behavior is verified.",
      "6. Seed data locally if the project provides a seed command and credentials permit.",
      "7. Write BOTH _artifacts/backend/migration-readiness.md and _artifacts/backend/migration-readiness.json.",
      "",
      "The JSON must match this shape:",
      JSON.stringify({
        provider: policy.provider,
        migrations: policy.migrations,
        policyVersion: 1,
        localValidated: localValidation.status === "passed",
        localValidationCommand: localValidation.command,
        localValidationStatus: localValidation.status,
        remoteApplied: false,
        remoteApplyMode: policy.provider === "supabase" ? "ci" : "manual",
        remoteEnvironment: "staging",
        blocked: localValidation.status === "failed",
        blockedReason: localValidation.status === "failed" ? "Local migration validation failed." : null,
        unsafePatterns: [],
        generatedCi: this.expectedMigrationPolicyFiles(policy),
        generatedAt: new Date().toISOString(),
      }, null, 2),
      "",
      "Do not pass PGRST205 / missing-table / schema-cache errors to QA as a frontend issue.",
      "",
      manifest ? `PROJECT MANIFEST:\n${manifest.slice(0, 12_000)}` : "",
      envExample ? `ENV TEMPLATE:\n${envExample.slice(0, 8_000)}` : "",
      learningContext ? `LEARNINGS:\n${learningContext.slice(0, 8_000)}` : "",
    ].filter(Boolean).join("\n\n");
  }

  private readIfExists(file: string): string {
    try { return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : ""; }
    catch { return ""; }
  }

  private async runRemoteRepairs(prNumber: number, initialSha: string, learningContext: string): Promise<boolean> {
    if (!this.git || process.env.SWARM_CI_REPAIR !== "on") return true;

    const repairConfig = this.pipeline.find((p) => p.phase === "development");
    if (!repairConfig) {
      logSystem("CI repair is enabled, but this flow has no development phase; skipping remote repairs.");
      return true;
    }

    const maxRounds = this.remoteRepairRounds();
    let sha = initialSha;
    for (let round = 0; round <= maxRounds; round++) {
      const findings = await this.pollRemoteFindings(prNumber, sha);
      if (findings.failures.length === 0 && findings.comments.length === 0) {
        logSystem("Remote CI/review repair: no failing checks or PR review comments found.");
        return true;
      }
      if (round >= maxRounds) {
        logSystem(`Remote CI/review repair stopped after ${maxRounds} round(s); unresolved feedback remains.`);
        return false;
      }

      const details = this.remoteFeedbackDetails(findings.failures, findings.comments);
      const feedback = this.remoteFeedbackByRole(repairConfig.agents, findings.failures, findings.comments);
      logSystem(`Remote repair round ${round + 1}: re-running ${Array.from(feedback.keys()).join(", ")}.`);

      const context = `${this.gatherContext(repairConfig.inputArtifacts)}\n\n--- REMOTE CI / PR REVIEW FEEDBACK ---\n${details}`;
      const taskPrompt = this.buildTaskPrompt(repairConfig, context, learningContext, "incremental");
      const results = await this.runPhaseAgents(repairConfig, Array.from(feedback.keys()), taskPrompt, feedback);
      if (results === null) return false;

      this.recordArtifacts(results, repairConfig.phase);
      this.saveState();
      await this.commitPhase(repairConfig);
      const nextSha = await this.git.currentSha();
      if (!nextSha || nextSha === sha) {
        logSystem("Remote repair produced no new commit; stopping to avoid repeating the same feedback.");
        return false;
      }
      sha = nextSha;
    }
    return false;
  }

  private async pollRemoteFindings(prNumber: number, sha: string): Promise<{ failures: RemoteCheckFailure[]; comments: ReviewComment[] }> {
    if (!this.git) return { failures: [], comments: [] };

    const deadline = Date.now() + this.remoteRepairTimeoutMs();
    let attempt = 0;
    let lastFailures: RemoteCheckFailure[] = [];
    let lastPending: string[] = [];

    while (Date.now() < deadline) {
      attempt++;
      try {
        const [statuses, checks, comments] = await Promise.all([
          this.git.getCombinedStatus(sha),
          this.git.getCheckRuns(sha),
          this.git.getReviewComments(prNumber),
        ]);

        lastFailures = [...statuses.failures, ...checks.failures];
        lastPending = [...statuses.pending, ...checks.pending];
        if (checks.complete && statuses.complete) {
          const failures = await this.withFailureLogs(lastFailures);
          return { failures, comments };
        }

        logSystem(`Waiting for remote checks (${lastPending.length || "some"} pending): ${lastPending.slice(0, 4).join(", ") || "pending"}`);
      } catch (err) {
        logSystem(`Remote CI/review poll failed (${err instanceof Error ? err.message : err}); retrying.`);
      }

      const delay = Math.min(5_000 * Math.pow(2, attempt - 1), 60_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (lastPending.length) {
      lastFailures.push({
        name: "remote-check-timeout",
        conclusion: "timed_out",
        status: "in_progress",
        summary: `Timed out waiting for: ${lastPending.join(", ")}`,
      });
    }
    return { failures: await this.withFailureLogs(lastFailures), comments: await this.git.getReviewComments(prNumber).catch(() => []) };
  }

  private async withFailureLogs(failures: RemoteCheckFailure[]): Promise<RemoteCheckFailure[]> {
    if (!this.git) return failures;
    const seen = new Set<number>();
    const enriched: RemoteCheckFailure[] = [];
    for (const failure of failures) {
      if (!failure.runId || seen.has(failure.runId)) {
        enriched.push(failure);
        continue;
      }
      seen.add(failure.runId);
      const logExcerpt = await this.git.getFailedJobLogs(failure.runId);
      enriched.push({ ...failure, logExcerpt });
    }
    return enriched;
  }

  private remoteFeedbackDetails(failures: RemoteCheckFailure[], comments: ReviewComment[]): string {
    const checkText = failures.map((f) => [
      `Check: ${f.name}`,
      `Conclusion: ${f.conclusion}`,
      f.summary ? `Summary: ${f.summary}` : "",
      f.text ? `Output: ${f.text}` : "",
      f.detailsUrl ? `Details: ${f.detailsUrl}` : "",
      f.logExcerpt ? `Logs:\n${f.logExcerpt}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");

    const commentText = comments.map((c) =>
      `Review comment: ${c.path}${c.line ? `:${c.line}` : ""}\n${c.body}`).join("\n\n");

    return [checkText, commentText].filter(Boolean).join("\n\n") || "(no details)";
  }

  private remoteFeedbackByRole(
    agents: AgentRole[],
    failures: RemoteCheckFailure[],
    comments: ReviewComment[],
  ): Map<AgentRole, string> {
    const feedback = new Map<AgentRole, string>();
    const general = failures.length
      ? `Remote CI checks failed. Fix the failures below, update only relevant files, and keep the change scoped.\n\n${this.remoteFeedbackDetails(failures, [])}`
      : "";
    for (const role of agents) if (general) feedback.set(role, general);

    for (const comment of comments) {
      const roles = this.rolesForPath(comment.path, agents);
      const text = `Address this PR review comment in ${comment.path}${comment.line ? `:${comment.line}` : ""}:\n${comment.body}`;
      for (const role of roles) {
        const prev = feedback.get(role);
        feedback.set(role, prev ? `${prev}\n\n${text}` : text);
      }
    }

    if (feedback.size === 0) {
      for (const role of agents) feedback.set(role, "Review the remote CI and PR feedback and make the minimal required fixes.");
    }
    return feedback;
  }

  private rolesForPath(filePath: string, agents: AgentRole[]): AgentRole[] {
    const lower = filePath.toLowerCase();
    const frontend = agents.includes("frontend-dev") && /(web|frontend|client|ui|component|style|css|html|tsx|jsx)/.test(lower);
    const backend = agents.includes("backend-dev") && /(server|api|backend|db|schema|migration|auth|route|controller|model)/.test(lower);
    if (frontend && !backend) return ["frontend-dev"];
    if (backend && !frontend) return ["backend-dev"];
    return agents;
  }

  private remoteRepairRounds(): number {
    const raw = Number(process.env.SWARM_CI_REPAIR_ROUNDS || "");
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 3;
  }

  private remoteRepairTimeoutMs(): number {
    const raw = Number(process.env.SWARM_CI_REPAIR_TIMEOUT_MS || "");
    return Number.isFinite(raw) && raw > 0 ? raw : 20 * 60_000;
  }

  private prNumberFromUrl(url: string): number | null {
    const match = url.match(/\/pull\/(\d+)(?:$|[/?#])/);
    return match ? Number(match[1]) : null;
  }

  private evalRepairPhase(report: EvalReport): PhaseConfig | null {
    const failedNames = report.checks.filter((c) => !c.passed).map((c) => c.name);
    const wantsDevelopment = failedNames.some((name) =>
      /install|build|typecheck|test|lint|app-present/i.test(name),
    );
    if (wantsDevelopment) {
      return this.pipeline.find((p) => p.phase === "development") || null;
    }
    if (failedNames.some((name) => name === "artifact-completeness")) {
      return this.pipeline.find((p) => !this.phaseOutputsExist(p)) || null;
    }
    return this.pipeline.find((p) => p.phase === "development") || null;
  }

  private markPhaseCompleted(phase: Phase): void {
    if (!this.state.completedPhases.includes(phase)) {
      this.state.completedPhases.push(phase);
    }
  }

  private async executePhase(config: PhaseConfig, learningContext: string, mode: PhaseMode = "greenfield"): Promise<boolean> {
    logPhase(config.phase, "start");
    logSystem(config.description);
    this.lastPhaseFailureFeedback = new Map();

    let context = this.gatherContext(config.inputArtifacts);
    context += this.gatherRunHandoffContext();
    context += this.gatherChatCommentContext();
    if (mode === "incremental") context += this.gatherChangeContext();
    const baseTaskPrompt = this.buildTaskPrompt(config, context, learningContext, mode);

    const MAX_REVIEW_ROUNDS = this.maxReviewRounds();
    // role -> revision instructions the team must address before the phase passes
    let revisionFeedback = new Map<AgentRole, string>();
    const phaseParticipants = new Set<AgentRole>(config.agents);

    for (let round = 0; round <= MAX_REVIEW_ROUNDS; round++) {
      // Which agents run this round?
      let agentsToRun: AgentRole[];
      if (round === 0) {
        const alreadyCompleted = this.state.completedAgents[config.phase] || [];
        agentsToRun = config.agents.filter((r) => !alreadyCompleted.includes(r));
        const skipped = config.agents.filter((r) => alreadyCompleted.includes(r));
        if (skipped.length) logSystem(`Skipping already-completed agents: ${skipped.join(", ")}`);
      } else {
        agentsToRun = [...revisionFeedback.keys()];
        logSystem(`Revision round ${round}: re-running ${agentsToRun.join(", ")} per lead feedback`);
      }

      // Doubt-driven revisions accumulate for the NEXT round.
      let nextFeedback = new Map<AgentRole, string>();

      if (agentsToRun.length > 0) {
        const results = await this.runPhaseAgents(config, agentsToRun, baseTaskPrompt, revisionFeedback);
        if (results === null) return false; // unrecoverable failure

        // Record successes (resume) + artifacts.
        for (const s of results.filter((r) => r.success)) {
          phaseParticipants.add(s.role);
          const list = (this.state.completedAgents[config.phase] ||= []);
          if (!list.includes(s.role)) list.push(s.role);
        }
        this.saveState();
        this.recordArtifacts(results, config.phase);
        this.applyRouteProposals();

        // Resolve doubts (teammate -> lead -> human last resort) -> revisions.
        const allDoubts = results.flatMap((r) => r.doubts);
        nextFeedback = await this.resolveDoubts(allDoubts, config, context);
      }

      // The lead reviews the phase's output and may request more revisions.
      const artifacts = this.gatherPhaseArtifacts(config.outputArtifacts);
      const review = await this.lead.reviewPhase(config.phase, config.description, [...phaseParticipants], artifacts);
      this.logReview(config.phase, review, round);

      // Merge lead revisions with any doubt-driven ones.
      revisionFeedback = nextFeedback;
      for (const rev of review.revisions) {
        const prev = revisionFeedback.get(rev.role);
        revisionFeedback.set(rev.role, prev ? `${prev}\n\nAlso: ${rev.instructions}` : rev.instructions);
      }

      if (review.approved && revisionFeedback.size === 0) {
        logPhase(config.phase, "complete");
        return true;
      }
      if (round >= MAX_REVIEW_ROUNDS) {
        this.lastPhaseFailureFeedback = new Map(revisionFeedback);
        logError(`Lead still has open items after ${MAX_REVIEW_ROUNDS} revision round(s); failing ${config.phase} for resume.`);
        logPhase(config.phase, "error");
        return false;
      }
    }

    logPhase(config.phase, "complete");
    return true;
  }

  // Run a set of agents (parallel or sequential) with per-role revision feedback,
  // retrying hard failures with backoff. Returns null if a failure is unrecoverable.
  private async runPhaseAgents(
    config: PhaseConfig,
    roles: AgentRole[],
    baseTaskPrompt: string,
    feedback: Map<AgentRole, string>,
  ): Promise<AgentResult[] | null> {
    if (this.shouldUseWorktrees(config, roles)) {
      const isolated = await this.runAgentsIsolated(config, roles, baseTaskPrompt, feedback);
      if (isolated) return isolated;
      logSystem("Worktree isolation unavailable; falling back to the standard agent runner.");
    }

    const runOne = (role: AgentRole) => this.runAgent(role, config.phase, baseTaskPrompt, feedback.get(role));

    let results: AgentResult[];
    if (config.parallel && roles.length > 1) {
      logSystem(`Running ${roles.length} agents in parallel: ${roles.join(", ")}`);
      results = await Promise.all(roles.map(runOne));
    } else {
      results = [];
      for (const role of roles) results.push(await runOne(role));
    }

    const failures = results.filter((r) => !r.success);
    if (failures.length === 0) return results;

    for (const f of failures) {
      logError(`Agent ${f.role} failed: ${f.error}`);
      this.state.metrics.totalErrors++;
    }

    const interventionResults = await this.runLeadIntervention(config, failures, baseTaskPrompt);
    if (interventionResults.length > 0) {
      results.push(...interventionResults);
      for (const s of interventionResults.filter((r) => r.success)) {
        const list = (this.state.completedAgents[config.phase] ||= []);
        if (!list.includes(s.role)) list.push(s.role);
      }
      this.saveState();
    }

    const failuresToRetry = failures.filter((f) => !results.some((r) => r.role === f.role && r.success));
    if (failuresToRetry.length === 0) return results;

    const MAX_RETRIES = 3;
    for (const f of failuresToRetry) {
      let succeeded = false;
      const seenErrors = new Set<string>([this.failureFingerprint(f.error || "")]);
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const delaySec = Math.min(30 * Math.pow(2, attempt - 1), 120); // 30s, 60s, 120s
        const isRateLimit = f.error?.includes("rate_limit") || f.error?.includes("rate limit") || f.error?.includes("Usage credits");
        logSystem(isRateLimit
          ? `Rate limit detected. Waiting ${delaySec}s before retry ${attempt}/${MAX_RETRIES}...`
          : `Retrying agent ${f.role} (attempt ${attempt}/${MAX_RETRIES}) after ${delaySec}s...`);
        await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));

        this.state.metrics.agentRetries[f.role] = (this.state.metrics.agentRetries[f.role] || 0) + 1;
        const retry = await this.runAgent(f.role, config.phase, baseTaskPrompt, feedback.get(f.role));
        if (retry.success) {
          logSystem(`Agent ${f.role} succeeded on retry ${attempt}`);
          succeeded = true;
          const list = (this.state.completedAgents[config.phase] ||= []);
          if (!list.includes(f.role)) list.push(f.role);
          this.saveState();
          const idx = results.indexOf(f);
          if (idx !== -1) results[idx] = retry;
          break;
        }
        logError(`Agent ${f.role} retry ${attempt} failed: ${retry.error}`);
        this.state.metrics.totalErrors++;
        const fingerprint = this.failureFingerprint(retry.error || "");
        if (fingerprint && seenErrors.has(fingerprint)) {
          this.logger.log("warn", "system", `Stopping retries for ${f.role}: same failure repeated after retry ${attempt}.`, {
            agent: f.role,
            phase: config.phase,
            metadata: { fingerprint },
          });
          break;
        }
        seenErrors.add(fingerprint);
        f.error = retry.error;
      }
      if (!succeeded) {
        logError(`Agent ${f.role} failed after ${MAX_RETRIES} retries`);
        return null;
      }
    }
    return results;
  }

  private failureFingerprint(error: string): string {
    return error
      .toLowerCase()
      .replace(/[a-f0-9]{24,}/g, "<hash>")
      .replace(/\b\d{2,}\b/g, "<n>")
      .replace(/["'`].{80,}?["'`]/g, "<quoted>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }

  private async runLeadIntervention(
    config: PhaseConfig,
    failures: AgentResult[],
    baseTaskPrompt: string,
  ): Promise<AgentResult[]> {
    const actions = await this.lead.planIntervention({
      phase: config.phase,
      goal: config.description,
      plannedAgents: config.agents,
      failures: failures.map((f) => ({ role: f.role, error: f.error, summary: f.summary })),
      projectContext: this.interventionContext(config, baseTaskPrompt),
    });
    if (actions.length === 0) return [];

    logSystem(`Lead intervention: activating ${actions.map((a) => a.role).join(", ")} for ${config.phase}.`);
    for (const action of actions) {
      logSystem(`  ↳ ${action.role}: ${action.instructions}`);
    }

    return Promise.all(actions.map((action) => this.runAgent(
      action.role,
      config.phase,
      baseTaskPrompt,
      this.interventionInstructions(action, failures),
    )));
  }

  private interventionInstructions(action: InterventionAction, failures: AgentResult[]): string {
    const failureSummary = failures
      .map((f) => `- ${f.role}: ${f.error || f.summary || "failed without details"}`)
      .join("\n");
    return `Lead intervention for a blocked/stalled phase.

Failure signals:
${failureSummary}

Your recovery assignment:
${action.instructions}

Work directly on the root cause. Coordinate implicitly through the workspace artifacts and code. Produce or update concrete evidence so QA/lead review can verify the fix.`;
  }

  private interventionContext(config: PhaseConfig, baseTaskPrompt: string): string {
    return [
      this.gatherRunHandoffContext(),
      this.gatherChangeContext(),
      `Current phase: ${config.phase}`,
      `Current planned agents: ${config.agents.join(", ")}`,
      `Task prompt excerpt:\n${baseTaskPrompt.slice(0, 12_000)}`,
    ].filter(Boolean).join("\n\n");
  }

  private shouldUseWorktrees(config: PhaseConfig, roles: AgentRole[]): boolean {
    return process.env.SWARM_WORKTREES === "on"
      && Boolean(this.git)
      && Boolean(config.isolate)
      && config.parallel
      && roles.length >= 2;
  }

  private async runAgentsIsolated(
    config: PhaseConfig,
    roles: AgentRole[],
    baseTaskPrompt: string,
    feedback: Map<AgentRole, string>,
  ): Promise<AgentResult[] | null> {
    if (!this.git) return null;

    const worktrees = roles.map((role) => {
      const safeRole = this.slugify(role);
      return {
        role,
        dir: path.join(this.workspaceDir, ".wt", safeRole),
        branch: `swarm/${config.phase}/${safeRole}-${this.state.runId.slice(0, 8)}`,
      };
    });

    try {
      for (const wt of worktrees) {
        const ok = await this.git.addWorktree(wt.dir, wt.branch);
        if (!ok) return null;
      }

      logSystem(`Running ${roles.length} agents in isolated worktrees: ${roles.join(", ")}`);
      const results = await Promise.all(worktrees.map((wt) =>
        this.runAgent(wt.role, config.phase, baseTaskPrompt, feedback.get(wt.role), wt.dir)));

      if (results.some((r) => !r.success)) return null;

      for (const wt of worktrees) {
        const result = results.find((r) => r.role === wt.role);
        if (!result?.success) continue;
        await this.git.commitWorktree(wt.dir, wt.branch, `${config.phase}/${wt.role}: isolated agent output`);
      }

      for (const wt of worktrees) {
        const result = results.find((r) => r.role === wt.role);
        if (!result?.success) continue;

        const merge = await this.git.mergeBranch(wt.branch);
        if (merge.ok) continue;

        const resolved = await this.resolveWorktreeMergeConflict(wt.branch, merge.conflictedFiles);
        if (!resolved) {
          await this.git.abortMerge();
          logSystem(`Skipped isolated branch ${wt.branch}; conflicts remain after resolver attempt.`);
        }
      }

      return results;
    } catch (err) {
      logError(`Worktree isolation failed: ${err instanceof Error ? err.message : err}`);
      await this.git.abortMerge();
      return null;
    } finally {
      await Promise.all(worktrees.map((wt) => this.git?.removeWorktree(wt.dir)));
    }
  }

  private async resolveWorktreeMergeConflict(branch: string, files: string[]): Promise<boolean> {
    if (!this.git || files.length === 0) return false;

    const conflictText = files.map((file) => {
      const abs = path.join(this.workspaceDir, file);
      let content = "";
      try { content = fs.readFileSync(abs, "utf-8"); } catch { /* ignore unreadable files */ }
      return `--- ${file} ---\n${content.slice(0, 20_000)}`;
    }).join("\n\n");

    const prompt = [
      "Resolve these git merge conflicts. Return only JSON:",
      "{ \"files\": { \"path/to/file\": \"complete resolved file content\" } }",
      "Keep the combined intent of both branches. Do not include markdown fences.",
      "",
      `Branch being merged: ${branch}`,
      conflictText,
    ].join("\n");

    try {
      const resolver = new Agent(
        "tech-lead",
        this.state.currentPhase,
        this.workspaceDir,
        this.prompts.role("tech-lead") || "Resolve code merge conflicts carefully.",
        this.config.models["tech-lead"],
        this.logger,
        this.prompts,
      );
      const raw = await resolver.oneShot(prompt, 12_000);
      const resolved = this.parseResolvedFiles(raw);
      for (const [rel, content] of Object.entries(resolved)) {
        if (!files.includes(rel)) continue;
        const abs = path.resolve(this.workspaceDir, rel);
        const fromRoot = path.relative(path.resolve(this.workspaceDir), abs);
        if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) continue;
        fs.writeFileSync(abs, content, "utf-8");
      }
      const unresolved = files.filter((file) => {
        const abs = path.join(this.workspaceDir, file);
        try { return fs.readFileSync(abs, "utf-8").includes("<<<<<<<"); } catch { return true; }
      });
      if (unresolved.length > 0) return false;
      return await this.git.commitMerge(`Resolve merge conflicts for ${branch}`);
    } catch (err) {
      logError(`Conflict resolver failed for ${branch}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  private parseResolvedFiles(raw: string): Record<string, string> {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return {};
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { files?: Record<string, string> };
    return parsed.files && typeof parsed.files === "object" ? parsed.files : {};
  }

  private maxReviewRounds(): number {
    const raw = Number(process.env.SWARM_MAX_REVIEW_ROUNDS || "");
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 5;
  }

  // Resolve doubts via the lead. Returns revision instructions keyed by the
  // agent that raised each doubt, so they redo their work with the answer.
  private async resolveDoubts(
    doubts: Doubt[],
    config: PhaseConfig,
    context: string,
  ): Promise<Map<AgentRole, string>> {
    const revisions = new Map<AgentRole, string>();
    if (doubts.length === 0) return revisions;

    this.logger.log("warn", "doubt", `${doubts.length} doubt(s) raised — resolving with the team`, {
      phase: config.phase, metadata: { doubts },
    });

    const projectContext = `Idea: ${this.state.idea}\n${context}`.slice(0, 12_000);

    for (const doubt of doubts) {
      logDoubt(doubt.agent, doubt.question);
      const res = await this.lead.resolveDoubt(doubt, projectContext);

      if (res.needsHuman) {
        doubt.resolution = await this.awaitHumanInput(doubt, res);
        doubt.resolvedBy = "human";
      } else {
        doubt.resolution = res.resolution;
        doubt.resolvedBy = res.resolvedBy;
      }
      this.state.doubts.push(doubt);
      this.logger.log("info", "doubt", `Resolved by ${doubt.resolvedBy}: ${doubt.question} -> ${doubt.resolution}`, {
        agent: doubt.agent, phase: doubt.phase,
      });

      // Feed the answer back so the raising agent corrects its assumption.
      const instruction = `You earlier raised: "${doubt.question}". The team's decision (from ${doubt.resolvedBy}): ${doubt.resolution}. Update your deliverables to reflect this.`;
      const prev = revisions.get(doubt.agent);
      revisions.set(doubt.agent, prev ? `${prev}\n\n${instruction}` : instruction);
    }

    this.saveState();
    return revisions;
  }

  // Block until the human resolves a needs-input doubt. In a real terminal we
  // prompt on the console; headless (dashboard-spawned) runs raise a question
  // row, flip the run to 'awaiting_input', and poll the DB until the human
  // answers or skips it. A skip applies the lead's safe fallback but records the
  // question as skipped so it surfaces for review — never a silent fabrication.
  private async awaitHumanInput(doubt: Doubt, res: DoubtResolution): Promise<string> {
    const fallback = res.resolution || "Use your best judgment.";
    const isSecret = res.inputKind === "secret";
    // For secrets we NEVER take a value; the operator sets the env var themselves.
    // The agent is told to read it from process.env — the value never enters the
    // chat, DB, logs, or the model prompt.
    const envKey = (res.envKey || "").trim();
    const envPath = path.join(this.workspaceDir, ".env");
    const secretReference = () =>
      `The operator has set the secret in the environment as \`${envKey || "the required env var"}\` (${envPath}). `
      + `Read it via process.env at runtime; NEVER hardcode, log, echo, or write the literal value into code, output, or reports. `
      + `If it is absent at build time, degrade gracefully rather than failing.`;

    if (process.stdin.isTTY) {
      logSystem(`Input needed from you — ${doubt.agent} (${doubt.phase}): ${doubt.question}`);
      if (doubt.context) console.log(`  Context: ${doubt.context}`);
      if (isSecret) {
        logSystem(`This is a SECRET. Do NOT type it here. Add \`${envKey || "the key"}\` to ${envPath}, then press Enter to confirm (or type 'skip').`);
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = await new Promise<string>((resolve) => {
          rl.question("Press Enter once set in the env file (or 'skip'): ", (x) => { rl.close(); resolve(x.trim()); });
        });
        if (a.toLowerCase() === "skip") return `[SKIPPED by human — using fallback] ${fallback}`;
        return secretReference();
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question("Your answer (or 'skip' to use the team's fallback): ", (a) => { rl.close(); resolve(a.trim()); });
      });
      if (!answer || answer.toLowerCase() === "skip") return `[SKIPPED by human — using fallback] ${fallback}`;
      return answer;
    }

    // Headless: persist the question and pause the run for the dashboard.
    const questionId = crypto.randomUUID();
    await insertQuestion({
      id: questionId,
      project: this.state.projectName,
      runId: this.state.runId,
      agent: doubt.agent,
      phase: doubt.phase,
      kind: res.inputKind || "input",
      question: doubt.question,
      context: doubt.context || "",
      envKey,
      suggestion: fallback,
    }).catch((err) => logError(`Could not persist question: ${err instanceof Error ? err.message : err}`));

    const prevStatus = this.state.status;
    this.state.status = "awaiting_input";
    this.saveState();
    await this.drainPersist();
    logSystem(`Waiting for your input in the dashboard — ${doubt.agent} (${doubt.phase}): ${doubt.question}`);

    const pollMs = 5000;
    for (;;) {
      await new Promise((r) => setTimeout(r, pollMs));
      let q;
      try { q = await getQuestion(questionId); }
      catch (err) { logError(`Question poll failed: ${err instanceof Error ? err.message : err}`); continue; }
      if (!q || q.status === "open") continue;

      this.state.status = prevStatus === "awaiting_input" ? "running" : prevStatus;
      this.saveState();
      if (q.status === "answered") {
        // Secret confirmations never carry a value — resolve to an env reference.
        // Log without the answer text as a defensive measure.
        logSystem(`Human resolved "${doubt.question}".`);
        if (isSecret) {
          // The operator just added the value (and possibly an allow-list entry)
          // to the project .env AFTER this run loaded its env at startup. Reload
          // it so the secret + SWARM_SHELL_ENV_ALLOW reach the rest of the run.
          this.reloadProjectEnv();
          return secretReference();
        }
        return q.answer || fallback;
      }
      logSystem(`Human skipped "${doubt.question}" — applying the team's fallback (recorded for review).`);
      return `[SKIPPED by human — using fallback] ${fallback}`;
    }
  }

  // Re-layer the per-project .env over process.env (override), matching how the
  // run loaded it at startup. Called after the operator confirms a secret so the
  // freshly-set value and any SWARM_SHELL_ENV_ALLOW entry take effect this run.
  private reloadProjectEnv() {
    const projEnvPath = path.join(this.workspaceDir, ".env");
    try {
      if (fs.existsSync(projEnvPath)) dotenv.config({ path: projEnvPath, override: true });
    } catch (err) {
      logError(`Could not reload project .env: ${err instanceof Error ? err.message : err}`);
    }
  }

  private recordArtifacts(results: AgentResult[], phase: Phase) {
    for (const result of results) {
      for (const artifactPath of result.artifacts) {
        if (!isArtifactPathAllowed(artifactPath)) continue;
        // Artifacts are the generated support documents; project code files live
        // in code roots (app/, web/, …) and are tracked via git, not here.
        if (isProjectCodePath(artifactPath)) continue;
        // Avoid duplicate artifact rows across revision rounds.
        if (this.state.artifacts.some((a) => a.path === artifactPath)) continue;
        this.state.artifacts.push({
          name: path.basename(artifactPath),
          path: artifactPath,
          createdBy: result.role,
          phase,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private phaseOutputsExist(config: PhaseConfig): boolean {
    const outputArtifacts = this.resolveArtifactPatterns(config.outputArtifacts);
    return outputArtifacts.length > 0
      && outputArtifacts.every((artifactPath) => this.outputArtifactExists(artifactPath));
  }

  private outputArtifactExists(artifactPath: string): boolean {
    const resolved = path.resolve(this.workspaceDir, artifactPath);
    if (!resolved.startsWith(path.resolve(this.workspaceDir))) return false;
    if (!fs.existsSync(resolved)) return false;
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return stat.size > 0;
    if (!stat.isDirectory()) return false;
    return this.fileManager.listFiles(artifactPath).length > 0;
  }

  private recordExistingPhaseArtifacts(config: PhaseConfig) {
    for (const artifactPath of this.resolveArtifactPatterns(config.outputArtifacts)) {
      const resolved = path.resolve(this.workspaceDir, artifactPath);
      if (!resolved.startsWith(path.resolve(this.workspaceDir)) || !fs.existsSync(resolved)) continue;

      const paths = fs.statSync(resolved).isDirectory()
        ? this.fileManager.listFiles(artifactPath)
        : [artifactPath.replace(/\\/g, "/")];

      for (const filePath of paths) {
        if (!isArtifactPathAllowed(filePath)) continue;
        if (isProjectCodePath(filePath)) continue;
        if (this.state.artifacts.some((a) => a.path === filePath)) continue;
        this.state.artifacts.push({
          name: path.basename(filePath),
          path: filePath,
          createdBy: config.agents[0],
          phase: config.phase,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Read all of a phase's output artifacts (across its patterns) for lead review.
  private gatherPhaseArtifacts(patterns: string[]): Record<string, string> {
    const all: Record<string, string> = {};
    for (const pattern of this.resolveArtifactPatterns(patterns)) {
      Object.assign(all, this.fileManager.readArtifactsByPattern(pattern));
    }
    return all;
  }

  private logReview(phase: Phase, review: { approved: boolean; score: number; summary: string; revisions: { role: AgentRole; instructions: string }[] }, round: number) {
    const verdict = review.approved ? "approved" : `requested ${review.revisions.length} revision(s)`;
    this.logger.log(review.approved ? "info" : "warn", "phase",
      `Lead review of ${phase} (round ${round}): ${verdict} — score ${(review.score * 100).toFixed(0)}%. ${review.summary}`,
      { agent: "tech-lead", phase, metadata: { review } });
    for (const rev of review.revisions) {
      logSystem(`  ↳ ${rev.role}: ${rev.instructions}`);
    }
  }

  private async runAgent(
    role: AgentRole,
    phase: Phase,
    taskPrompt: string,
    revisionInstructions?: string,
    workspaceDir = this.workspaceDir,
  ): Promise<AgentResult> {
    const systemPrompt = this.prompts.role(role);
    if (!systemPrompt) {
      return {
        role, phase, success: false, artifacts: [], doubts: [], summary: "",
        error: `No prompt defined for agent: ${role}`,
      };
    }

    // Append the lead's revision feedback (or a teammate's answer) when present.
    const prompt = revisionInstructions
      ? `${taskPrompt}\n\n--- REVISION REQUEST FROM THE ENGINEERING LEAD ---\nYour previous work needs changes. Address this specifically and update your deliverables:\n${revisionInstructions}`
      : taskPrompt;

    this.state.metrics.totalAgentRuns++;
    const agentStart = Date.now();

    const modelConfig = this.config.models[role];
    const agent = new Agent(role, phase, workspaceDir, systemPrompt, modelConfig, this.logger, this.prompts);
    const heartbeat = setInterval(() => {
      this.saveState();
      this.logger.log("debug", "system", `Agent heartbeat: ${role} still running in ${phase}.`, { agent: role, phase });
    }, this.agentHeartbeatMs());
    heartbeat.unref();

    let result: AgentResult;
    try {
      result = await agent.run(prompt);
    } finally {
      clearInterval(heartbeat);
    }

    this.state.metrics.agentDurations[`${phase}-${role}`] = Date.now() - agentStart;
    this.state.metrics.totalTokensSaved = (this.state.metrics.totalTokensSaved ?? 0) + (result.tokensSaved ?? 0);
    if (result.commandTimeouts) {
      this.state.metrics.commandTimeouts = (this.state.metrics.commandTimeouts ?? 0) + result.commandTimeouts;
      this.state.metrics.totalErrors += result.commandTimeouts;
      this.logger.log("warn", "system", `Agent ${role} had ${result.commandTimeouts} command timeout(s).`, { agent: role, phase });
    }
    if (result.stallCount) {
      this.state.metrics.agentStalls = (this.state.metrics.agentStalls ?? 0) + result.stallCount;
      this.state.metrics.totalErrors += result.stallCount;
      this.logger.log("warn", "system", `Agent ${role} hit ${result.stallCount} stall detector(s).`, { agent: role, phase });
    }
    this.saveState();

    return result;
  }

  private agentHeartbeatMs(): number {
    const raw = Number(process.env.SWARM_AGENT_HEARTBEAT_MS || "");
    return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
  }

  private gatherContext(inputPatterns: string[]): string {
    if (inputPatterns.length === 0) return "";

    const MAX_CONTEXT_CHARS = 50_000; // Keep total context tight; agents can read full files locally.
    const MAX_FILE_CHARS = 16_000;    // Max selected file excerpt before truncation.

    const patterns = this.resolveArtifactPatterns(inputPatterns);
    const index = buildProjectIndex(this.workspaceDir);
    const selectedFiles = selectContextFiles(index, patterns);
    const sections: string[] = [];
    const indexSection = `LOCAL PROJECT INDEX (use this map before reading files):\n${formatProjectIndex(index)}\n\nRequested context patterns: ${patterns.join(", ") || "(none)"}`;
    sections.push(indexSection);
    let totalChars = indexSection.length;

    for (const filePath of selectedFiles) {
      const content = this.fileManager.readFile(filePath);
      if (content === null) continue;
      if (content.length > 120_000) {
        sections.push(`--- FILE: ${filePath} (${(content.length / 1024).toFixed(0)}KB, too large for prompt; read locally if needed) ---`);
        continue;
      }

      let included: string;
      if (content.length > MAX_FILE_CHARS) {
        const head = content.slice(0, Math.floor(MAX_FILE_CHARS * 0.7));
        const tail = content.slice(-Math.floor(MAX_FILE_CHARS * 0.2));
        included = `${head}\n\n... [CONTEXT EXCERPT TRUNCATED ${((content.length - MAX_FILE_CHARS) / 1024).toFixed(0)}KB; full file is available at ${filePath}] ...\n\n${tail}`;
      } else {
        included = content;
      }

      if (totalChars + included.length > MAX_CONTEXT_CHARS) {
        sections.push(`--- FILE: ${filePath} (${(content.length / 1024).toFixed(0)}KB, selected but omitted from prompt budget; read locally if needed) ---`);
        continue;
      }

      sections.push(`--- SELECTED FILE: ${filePath} ---\n${included}\n`);
      totalChars += included.length;
    }

    return `\n\nLOCAL CONTEXT PACK:\n${sections.join("\n\n")}\n\nNOTE: This is an index plus selected excerpts, not the whole project. If a required file is omitted or excerpted, read the full file from the workspace path shown above.`;

    for (const pattern of this.resolveArtifactPatterns(inputPatterns)) {
      const files = this.fileManager.readArtifactsByPattern(pattern);
      for (const [filePath, content] of Object.entries(files)) {
        // Skip non-text artifacts (binary, very large generated code)
        if (content.length > 100_000) {
          sections.push(`--- FILE: ${filePath} (${(content.length / 1024).toFixed(0)}KB — too large, skipped) ---`);
          continue;
        }

        let included: string;
        if (content.length > MAX_FILE_CHARS) {
          // Truncate with head + tail strategy to preserve structure
          const head = content.slice(0, Math.floor(MAX_FILE_CHARS * 0.7));
          const tail = content.slice(-Math.floor(MAX_FILE_CHARS * 0.2));
          included = `${head}\n\n... [TRUNCATED ${((content.length - MAX_FILE_CHARS) / 1024).toFixed(0)}KB — read full file from workspace] ...\n\n${tail}`;
        } else {
          included = content;
        }

        // Stop adding files if we'd exceed the total budget
        if (totalChars + included.length > MAX_CONTEXT_CHARS) {
          sections.push(`--- FILE: ${filePath} (${(content.length / 1024).toFixed(0)}KB — context budget exceeded, read from workspace) ---`);
          continue;
        }

        sections.push(`--- FILE: ${filePath} ---\n${included}\n`);
        totalChars += included.length;
      }
    }

    if (sections.length === 0) return "";
    return `\n\nINPUT ARTIFACTS (from previous phases):\n${sections.join("\n")}\n\nNOTE: Some artifacts may be truncated. Read the full files from the workspace if you need complete details.`;
  }

  private gatherRunHandoffContext(): string {
    if (!this.state.runId) return "";
    const handoffPath = path.join(this.workspaceDir, ".swarm", "runs", this.state.runId, "handoff.md");
    if (!fs.existsSync(handoffPath)) return "";
    try {
      const content = fs.readFileSync(handoffPath, "utf-8").slice(0, 20_000);
      return `\n\nRUN HANDOFF CONTEXT:\n${content}\n`;
    } catch {
      return "";
    }
  }

  private gatherChatCommentContext(): string {
    const file = path.join(this.workspaceDir, ARTIFACT_BASE, "chat", "requests.md");
    if (!fs.existsSync(file)) return "";
    try {
      const content = fs.readFileSync(file, "utf-8");
      const comments = content
        .split(/\n## /)
        .filter((block) => /user \(run-comment\)/i.test(block))
        .slice(-8)
        .map((block) => `## ${block.trim()}`)
        .join("\n\n");
      return comments ? `\n\nLATEST USER COMMENTS DURING THIS RUN:\n${comments.slice(-12_000)}\n` : "";
    } catch {
      return "";
    }
  }

  private gatherProjectBriefContext(config?: PhaseConfig, mode: PhaseMode = "greenfield"): string {
    const route = (this.state.flow?.length ? this.state.flow : this.flow)
      .map((s, i) => `${i + 1}. ${s.phase}${s.agents?.length ? ` [${s.agents.join(", ")}]` : ""}`)
      .join("\n") || "(route not planned)";
    const completed = this.state.completedPhases.join(", ") || "none";
    const currentAgents = config?.agents?.join(", ") || "(unknown)";
    const roots = detectCodeRoots(this.workspaceDir);
    const sourceRoots = roots.length ? roots.join(", ") : "(none detected yet)";
    const completedAgents = Object.entries(this.state.completedAgents || {})
      .map(([phase, agents]) => `${phase}: ${agents.join(", ")}`)
      .join("; ") || "none";
    const workspaceFiles = this.topLevelWorkspaceSummary();
    const appShape = this.projectShapeSummary();
    const localIndex = formatProjectIndex(buildProjectIndex(this.workspaceDir), 80);

    return `\n\nPROJECT BRIEF (read this first; do not rediscover what is already stated)
Project: ${this.state.projectName}
Request: ${this.state.request || this.state.idea}
Project type: ${PROJECT_TYPES[this.state.projectType]?.label || this.state.projectType}
Run kind: ${this.state.kind}
Planner rationale: ${this.state.plannerRationale || "(not recorded)"}
Current phase: ${config?.phase || this.state.currentPhase}
Current phase agents: ${currentAgents}
Mode: ${mode}

Planned route:
${route}

Progress:
- Completed phases: ${completed}
- Completed agents: ${completedAgents}
- Source/code roots: ${sourceRoots}
- App shape: ${appShape}
- Top-level workspace: ${workspaceFiles}

Local deterministic facts:
${localIndex}

Operating guidance:
- Follow the planned route. Do not add product/brand/SEO/marketing/deploy work unless this phase explicitly asks for it.
- Do not repeat completed phases or rewrite prior deliverables unless this phase/revision specifically requires it.
- If source/code roots are listed, inspect those directly instead of scanning the whole workspace.
- If you only need to verify a runnable app, prefer the runbook/manifests and deterministic commands over exploratory analysis.
- Treat local deterministic facts and cached command results as the starting point; only call the model/tooling for new evidence or judgment.
`;
  }

  private topLevelWorkspaceSummary(): string {
    try {
      return fs.readdirSync(this.workspaceDir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith(".") && !shouldSkipArtifactEntry(entry.name))
        .slice(0, 30)
        .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name)
        .join(", ") || "(empty)";
    } catch {
      return "(unavailable)";
    }
  }

  private projectShapeSummary(): string {
    const markers = [
      ["package.json", "node-package"],
      ["pnpm-workspace.yaml", "pnpm-workspace"],
      ["index.html", "static-html"],
      ["pyproject.toml", "python-package"],
      ["requirements.txt", "python-requirements"],
      ["Cargo.toml", "rust-crate"],
      ["go.mod", "go-module"],
      ["pubspec.yaml", "flutter-app"],
      ["build.gradle", "gradle-project"],
      ["settings.gradle", "gradle-settings"],
    ]
      .filter(([file]) => fs.existsSync(path.join(this.workspaceDir, file)))
      .map(([, label]) => label);

    const nestedMarkers = detectCodeRoots(this.workspaceDir)
      .flatMap((root) => {
        const dir = root.replace(/\/$/, "");
        const files = ["package.json", "index.html", "pyproject.toml", "Cargo.toml", "go.mod", "pubspec.yaml"]
          .filter((file) => fs.existsSync(path.join(this.workspaceDir, dir, file)))
          .map((file) => `${root}${file}`);
        return files;
      })
      .slice(0, 12);

    const parts = [
      markers.length ? `root markers: ${markers.join(", ")}` : "",
      nestedMarkers.length ? `nested markers: ${nestedMarkers.join(", ")}` : "",
    ].filter(Boolean);
    return parts.join("; ") || "(no common app markers detected yet)";
  }

  private planningRequestText(request: string): string {
    const lines = [
      `Project: ${this.state.projectName}`,
      `Run kind: ${this.state.kind}`,
      `Original idea: ${this.state.idea || "(unknown)"}`,
      `Current request: ${request}`,
      `Known project type: ${PROJECT_TYPES[this.state.projectType]?.label || this.state.projectType}`,
      `Known source roots: ${detectCodeRoots(this.workspaceDir).join(", ") || "(none detected yet)"}`,
      `Top-level workspace: ${this.topLevelWorkspaceSummary()}`,
      `App shape: ${this.projectShapeSummary()}`,
      "",
      "Plan the smallest route and agent set needed to complete and verify this request. Do not add unrelated launch, SEO, branding, analytics, or deployment phases.",
    ];
    return lines.join("\n");
  }

  private async previousRunSummaries(): Promise<string> {
    try {
      const runs = (await listRuns(this.state.projectName))
        .filter((r) => r.runId !== this.state.runId)
        .slice(0, 8);
      if (runs.length === 0) return "No prior attempts recorded for this project.";
      return runs.map((r, i) => {
        const phases = r.completedPhases?.join(", ") || "none";
        const errors = r.metrics?.totalErrors ?? 0;
        return [
          `${i + 1}. ${r.kind} ${r.runId ? `(${r.runId.slice(0, 8)})` : ""}`,
          `   Status: ${r.status}; request: ${r.request || "(none)"}`,
          `   Updated: ${r.updatedAt || "(unknown)"}`,
          `   Completed phases: ${phases}`,
          `   Errors: ${errors}; artifacts: ${r.artifacts?.length ?? 0}; doubts: ${r.doubts?.length ?? 0}`,
          r.prUrl ? `   PR: ${r.prUrl}` : "",
        ].filter(Boolean).join("\n");
      }).join("\n\n");
    } catch (err) {
      return `Could not load prior attempts: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async writeRunHandoff(stage: string): Promise<void> {
    if (!this.state.projectName || !this.state.runId) return;
    try {
      const previous = await this.previousRunSummaries();
      const artifactPaths = this.state.artifacts
        .map((a) => a.path)
        .filter(isArtifactPathAllowed);
      const artifactPreview = artifactPaths.slice(0, 200).join(", ") || "none";
      const artifactLine = artifactPaths.length > 200
        ? `${artifactPreview}, ... (${artifactPaths.length - 200} more)`
        : artifactPreview;
      const routeLine = (this.state.flow || [])
        .map((s) => `${s.phase}${s.agents?.length ? `[${s.agents.join("+")}]` : ""}`)
        .join(" -> ") || "(not planned)";
      const dir = path.join(this.workspaceDir, ".swarm", "runs", this.state.runId);
      fs.mkdirSync(dir, { recursive: true });
      const content = [
        `# Run Handoff`,
        "",
        `Project: ${this.state.projectName}`,
        `Run ID: ${this.state.runId}`,
        `Stage: ${stage}`,
        `Status: ${this.state.status}`,
        `Kind: ${this.state.kind}`,
        `Request: ${this.state.request || "(none)"}`,
        `Current phase: ${this.state.currentPhase}`,
        `Planned route: ${routeLine}`,
        `Planner rationale: ${this.state.plannerRationale || "(not recorded)"}`,
        `Source/code roots: ${detectCodeRoots(this.workspaceDir).join(", ") || "(none detected yet)"}`,
        `App shape: ${this.projectShapeSummary()}`,
        `Started: ${this.state.startedAt}`,
        `Updated: ${this.state.updatedAt}`,
        "",
        `## Current Attempt`,
        "",
        `Completed phases: ${this.state.completedPhases.join(", ") || "none"}`,
        `Completed agents: ${JSON.stringify(this.state.completedAgents)}`,
        `Artifacts: ${artifactLine}`,
        `Doubts: ${this.state.doubts.length}`,
        `Errors: ${this.state.metrics.totalErrors ?? 0}`,
        this.state.branch ? `Branch: ${this.state.branch}` : "",
        this.state.prUrl ? `PR: ${this.state.prUrl}` : "",
        "",
        `## Prior Attempts`,
        "",
        previous,
        "",
        `## Guidance For Next Agent`,
        "",
        "Treat this run ID as the source of truth for the current attempt. Do not mix logs, agent runs, or conclusions from prior attempts unless they are explicitly relevant as background.",
      ].filter((line) => line !== "").join("\n");
      const handoff = path.join(dir, "handoff.md");
      fs.writeFileSync(handoff, content + "\n", "utf-8");
      fs.writeFileSync(path.join(this.workspaceDir, ".swarm", "latest-handoff.md"), content + "\n", "utf-8");
    } catch (err) {
      logError(`Failed to write run handoff: ${err instanceof Error ? err.message : err}`);
    }
  }

  private buildTaskPrompt(config: PhaseConfig, context: string, learningContext: string, mode: PhaseMode = "greenfield"): string {
    const outputArtifacts = this.resolveArtifactPatterns(config.outputArtifacts).join(", ");
    const scopedContext = this.gatherProjectBriefContext(config, mode) + context;
    if (mode === "incremental") {
      return this.prompts.render(TEMPLATE_KEYS.taskIncremental, {
        projectName: this.state.projectName,
        request: this.state.request,
        phase: config.phase,
        incrementalDirective: this.prompts.resolve(TEMPLATE_KEYS.incrementalDirective),
        changePlan: this.changePlanText(),
        context: scopedContext,
        learningContext,
        description: config.description,
        outputArtifacts,
      });
    }
    return this.prompts.render(TEMPLATE_KEYS.task, {
      projectName: this.state.projectName,
      idea: this.state.idea,
      phase: config.phase,
      context: scopedContext,
      learningContext,
      description: config.description,
      outputArtifacts,
    });
  }

  // ── Change-request scoping & incremental context ───────────────────────────

  // Run the scoping/triage phase (if the flow has one) and prune the remaining
  // flow from its plan. No-op for new-build. Returns false on unrecoverable
  // scoping failure.
  private async runScopingAndPrune(learningContext: string): Promise<boolean> {
    const scopingStep = this.flow.find((s) => s.phase === "scoping");
    if (!scopingStep) return true; // new-build / no triage

    if (!this.state.completedPhases.includes("scoping")) {
      logPhase("scoping", "start");
      const config = stepToPhaseConfig(scopingStep);
      logSystem(config.description);
      this.state.currentPhase = "scoping";
      this.saveState();

      const context = this.gatherContext(config.inputArtifacts);
      const handoffContext = this.gatherRunHandoffContext();
      const taskPrompt = this.buildTaskPrompt(config, context + handoffContext, learningContext, "incremental");
      const results = await this.runPhaseAgents(config, config.agents, taskPrompt, new Map());
      if (results === null) { logPhase("scoping", "error"); return false; }

      this.recordArtifacts(results, "scoping");
      this.state.completedPhases.push("scoping");
      const done = (this.state.completedAgents["scoping"] ||= []);
      for (const r of config.agents) if (!done.includes(r)) done.push(r);
      this.saveState();
      await this.commitPhase(config);
      logPhase("scoping", "complete");
    }

    // Prune the rest of the flow from the change plan.
    const plan = this.readChangePlan();
    this.flow = pruneFlow(this.flow, plan);
    this.pipeline = this.flow.map(stepToPhaseConfig);
    this.state.flow = this.flow;
    this.saveState();
    logSystem(`Scoping complete — change plan needs: ${this.flow.map((s) => s.phase).join(", ") || "(no further phases)"}`);
    return true;
  }

  // Read and parse the scoping agent's _artifacts/change/plan.json (null if missing/invalid).
  private readChangePlan(): ChangePlan | null {
    const planPath = path.join(this.workspaceDir, ARTIFACT_BASE, "change", "plan.json");
    if (!fs.existsSync(planPath)) return null;
    try {
      const raw = fs.readFileSync(planPath, "utf-8");
      // Tolerate stray code fences / prose around the JSON object.
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end === -1 || end < start) return null;
      return JSON.parse(raw.slice(start, end + 1)) as ChangePlan;
    } catch {
      return null;
    }
  }

  // A compact, human-readable rendering of the change plan for agent prompts.
  private changePlanText(): string {
    const plan = this.readChangePlan();
    if (!plan) return "(no scoping plan available — use your judgment and keep the change minimal)";
    const lines: string[] = [];
    if (plan.summary) lines.push(`Summary: ${plan.summary}`);
    if (plan.affectedAreas?.length) lines.push(`Affected areas: ${plan.affectedAreas.join(", ")}`);
    if (plan.affectedFiles?.length) lines.push(`Affected files: ${plan.affectedFiles.join(", ")}`);
    if (plan.tags?.length) lines.push(`Tags: ${plan.tags.join(", ")}`);
    if (plan.acceptanceCriteria?.length) lines.push(`Acceptance criteria:\n- ${plan.acceptanceCriteria.join("\n- ")}`);
    return lines.join("\n") || "(scoping plan present but empty)";
  }

  // For incremental phases: inject the contents of the change plan's affected
  // files so the agent sees the exact code it must modify (within a budget).
  private gatherChangeContext(): string {
    const plan = this.readChangePlan();
    const files = plan?.affectedFiles || [];
    if (files.length === 0) return "";

    const MAX_FILES = 12;
    const MAX_TOTAL = 40_000;
    const sections: string[] = [];
    let total = 0;
    for (const rel of files.slice(0, MAX_FILES)) {
      const abs = path.join(this.workspaceDir, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      let content: string;
      try { content = fs.readFileSync(abs, "utf-8"); } catch { continue; }
      if (total + content.length > MAX_TOTAL) {
        sections.push(`--- AFFECTED FILE: ${rel} (omitted — context budget reached; read it from the workspace) ---`);
        continue;
      }
      sections.push(`--- AFFECTED FILE: ${rel} ---\n${content}`);
      total += content.length;
    }
    if (sections.length === 0) return "";
    return `\n\nAFFECTED SOURCE (from the change plan — modify only what the change requires):\n${sections.join("\n\n")}\n`;
  }

  // Pull-request title/body for a change run's branch.
  private prTitle(): string {
    const label = INTENTS[this.state.kind]?.label || this.state.kind;
    const req = (this.state.request || "").replace(/\s+/g, " ").trim();
    const title = req ? `${label}: ${req}` : label;
    return title.length > 72 ? `${title.slice(0, 69)}...` : title;
  }

  private prBody(): string {
    const phases = this.state.completedPhases.filter((p) => p !== "scoping").join(", ") || "(none)";
    return [
      `**Intent:** ${this.state.kind}`,
      `**Request:** ${this.state.request || "(none)"}`,
      "",
      "**Change plan:**",
      this.changePlanText(),
      "",
      `**Phases run:** ${phases}`,
      "",
      "🤖 Generated by Agent Swarm.",
    ].join("\n");
  }

  private printSummary() {
    const duration = this.state.metrics.totalDurationMs;
    const mins = Math.floor(duration / 60000);
    const secs = Math.floor((duration % 60000) / 1000);

    console.log("\n" + "=".repeat(60));
    console.log(this.state.status === "completed_with_issues" ? "  PROJECT COMPLETE (with known issues)" : "  PROJECT COMPLETE");
    console.log("=".repeat(60));
    console.log(`  Project:    ${this.state.projectName}`);
    console.log(`  Status:     ${this.state.status}${this.state.status === "completed_with_issues" ? " — see KNOWN-ISSUES.md" : ""}`);
    console.log(`  Type:       ${PROJECT_TYPES[this.state.projectType]?.label || this.state.projectType}`);
    console.log(`  Duration:   ${mins}m ${secs}s`);
    console.log(`  Phases:     ${this.state.completedPhases.length}/${this.pipeline.length}`);
    console.log(`  Artifacts:  ${this.state.artifacts.length}`);
    console.log(`  Agent runs: ${this.state.metrics.totalAgentRuns}`);
    console.log(`  Errors:     ${this.state.metrics.totalErrors}`);
    console.log(`  Doubts:     ${this.state.doubts.length}`);
    console.log(`  Workspace:  ${this.workspaceDir}`);
    if (this.state.prUrl) {
      console.log(`  Delivery:   PR ${this.state.prUrl}`);
    } else if (this.deliveryUrl && this.deliveryMode === "deploy") {
      console.log(`  Delivery:   deployed ${this.deliveryUrl}`);
    }
    console.log("");
    console.log("  Phase durations:");
    for (const [phase, ms] of Object.entries(this.state.metrics.phaseDurations)) {
      console.log(`    ${phase}: ${(ms / 1000).toFixed(1)}s`);
    }
    console.log("");
    const kbStats = this.learner.getKnowledgeBase().getStats();
    console.log(`  Knowledge base: ${kbStats.totalLearnings} learnings, ${kbStats.totalProjects} projects`);
    console.log("=".repeat(60) + "\n");
  }

  // Serialized write-behind: each saveState chains a full-state upsert so writes
  // land in order without blocking the pipeline. Drain via drainPersist().
  private persistQueue: Promise<unknown> = Promise.resolve();

  private saveState() {
    this.state.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(this.state);
    snapshot.artifacts = snapshot.artifacts.filter((artifact) => isArtifactPathAllowed(artifact.path));
    this.persistQueue = this.persistQueue
      .then(() => upsertProject(snapshot))
      .then(() => upsertRun(snapshot))
      .catch((err) => {
        this.state.metrics.statePersistFailures = (this.state.metrics.statePersistFailures ?? 0) + 1;
        this.state.metrics.totalErrors++;
        logError(`State persist failed: ${this.describePersistError(err)}`);
      });
    this.persistWorkSpec();
    this.maybeNotifyStatus();
  }

  private maybeNotifyStatus(): void {
    const notifyStatuses = new Set(["completed", "completed_with_issues", "failed", "stopped", "awaiting_input"]);
    if (!notifyStatuses.has(this.state.status)) return;
    const key = `${this.state.projectName}:${this.state.status}:${this.state.currentPhase || ""}`;
    if (this.lastNotifiedStatus === key) return;
    this.lastNotifiedStatus = key;
    void notifyRunStatus({
      project: this.state.projectName,
      runId: this.state.runId,
      status: this.state.status,
      phase: this.state.currentPhase,
    });
  }

  private applyRouteProposals(): void {
    const { flow, applied, rejected } = applyPendingProposals(this.workspaceDir, this.flow);
    if (!applied.length && !rejected.length) return;
    this.flow = flow;
    this.state.flow = flow;
    this.pipeline = this.flow.map(stepToPhaseConfig);
    for (const p of applied) {
      this.logger.log("info", "system", `Applied route proposal: ${p.action} ${p.phase} — ${p.reason}`, {
        metadata: { proposal: p },
      });
    }
    for (const p of rejected) {
      this.logger.log("warn", "system", `Rejected route proposal: ${p.phase} — ${p.rejectReason}`, {
        metadata: { proposal: p },
      });
    }
    this.persistWorkSpec();
  }

  private persistWorkSpec(): void {
    if (!this.state.runId || !this.state.projectName || !this.flow.length) return;
    try {
      writeWorkSpec(this.workspaceDir, buildWorkSpec({
        state: this.state,
        flow: this.flow,
        scope: this.readChangePlan(),
        gates: this.workGates,
        appliedLearningIds: this.appliedLearningIds.length ? this.appliedLearningIds : undefined,
        delivery: this.deliveryUrl
          ? { mode: this.deliveryMode, prUrl: this.deliveryMode === "pr" ? this.deliveryUrl : undefined, deployUrl: this.deliveryMode === "deploy" ? this.deliveryUrl : undefined }
          : undefined,
      }));
    } catch (err) {
      logError(`Work spec persist failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private syncEvalGates(report: EvalReport | null): void {
    this.workGates = this.workGates.filter((g) => !g.id.startsWith("gate:eval"));
    if (!report) {
      this.workGates.push({
        id: "gate:eval-blocking",
        kind: "gate",
        name: "eval-blocking",
        status: "failed",
        detail: "Eval runner could not execute",
      });
      return;
    }
    this.workGates.push({
      id: "gate:eval-blocking",
      kind: "gate",
      name: "eval-blocking",
      status: report.blockingFailures.length === 0 ? "passed" : "failed",
      detail: report.blockingFailures.map((c) => c.name).join(", ") || undefined,
    });
    if (report.advisoryFailures.length > 0) {
      this.workGates.push({
        id: "gate:eval-advisory",
        kind: "gate",
        name: "eval-advisory",
        status: "failed",
        detail: report.advisoryFailures.map((c) => c.name).join(", "),
      });
    }
  }

  private describePersistError(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const parts = [err.message];
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) parts.push(`cause: ${cause.message}`);
    else if (cause) parts.push(`cause: ${String(cause)}`);
    const code = (err as Error & { code?: unknown }).code;
    if (code) parts.push(`code: ${String(code)}`);
    return parts.join(" | ");
  }

  private async drainPersist(): Promise<void> {
    await this.persistQueue;
  }

  // Flush all pending DB writes (state + logs + agent runs) before exit.
  private async finalizeRun(): Promise<void> {
    if (this.appliedLearningIds.length > 0) {
      const success = this.state.status === "completed" || this.state.status === "completed_with_issues";
      const result = validateLearningOutcomes({
        kb: this.learner.getKnowledgeBase(),
        appliedIds: this.appliedLearningIds,
        success,
        metrics: this.state.metrics,
      });
      if (result.boosted || result.decayed) {
        logSystem(`Learning validation: ${result.boosted} boosted, ${result.decayed} decayed`);
        await this.learner.getKnowledgeBase().flush();
      }
    }
    await this.writeRunHandoff(this.state.status);
    await this.drainPersist();
    await this.logger.shutdown();
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }
}
