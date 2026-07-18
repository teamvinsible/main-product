import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SwarmLogger } from "../utils/logger.js";
import { ARTIFACT_BASE, ARTIFACT_DOC_DIRS } from "../utils/artifacts.js";

export interface RepoInfo {
  owner: string;
  repo: string;
  htmlUrl: string;   // https://github.com/owner/repo  (safe to display/store)
  defaultBranch: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  files: number;
  htmlUrl: string;   // link to the commit on GitHub
}

export interface MergeResult {
  ok: boolean;
  conflictedFiles: string[];
}

export interface RemoteCheckFailure {
  name: string;
  conclusion: string;
  status: string;
  detailsUrl?: string;
  runId?: number;
  summary?: string;
  text?: string;
  logExcerpt?: string;
}

export interface RemoteCheckSummary {
  complete: boolean;
  failures: RemoteCheckFailure[];
  pending: string[];
}

export interface ReviewComment {
  path: string;
  line?: number;
  body: string;
}

const GITIGNORE = `# Agent Swarm — generated
node_modules/
dist/
build/
out/
.next/
coverage/
*.log
# real env files stay local; the committed templates document what's needed
.env
.env.*
!.env.example
!.env.template
!.env.sample
# swarm internals
.summary-*
.doubts-*
.prompt-*
.swarm-*
.swarm/
.wt/
.doubt-resolutions.json
# generated support documents (artifacts) — kept local, never pushed
${ARTIFACT_BASE}/
# legacy top-level support-doc folders (pre-${ARTIFACT_BASE}/ layout)
${ARTIFACT_DOC_DIRS.map((d) => `${d}/`).join("\n")}
`;

// Manages a per-project GitHub repository: creates it if missing (via the REST
// API using a PAT), and commits/pushes the workspace after each phase.
export class GitManager {
  private token: string;
  private workspaceDir: string;
  private logger?: SwarmLogger;
  private branch = "main";
  private baseBranch = "main"; // the branch a work-order branch forks from / PRs into
  private info: RepoInfo | null = null;
  private remoteUrl = ""; // contains the token — never logged

  constructor(workspaceDir: string, private repoSpec: string, token: string, logger?: SwarmLogger) {
    this.workspaceDir = workspaceDir;
    this.token = token;
    this.logger = logger;
  }

  getInfo(): RepoInfo | null {
    return this.info;
  }

  // Resolve/create the repo and prepare the local git repository. Returns null
  // on any failure (the pipeline continues without git).
  async init(): Promise<RepoInfo | null> {
    try {
      const { owner, repo } = await this.resolveOwnerRepo();
      const defaultBranch = await this.ensureRemoteRepo(owner, repo);
      this.baseBranch = defaultBranch || "main";
      this.branch = this.baseBranch;
      this.info = { owner, repo, htmlUrl: `https://github.com/${owner}/${repo}`, defaultBranch: this.baseBranch };
      this.remoteUrl = `https://x-access-token:${this.token}@github.com/${owner}/${repo}.git`;

      await this.ensureLocalRepo();
      this.log("info", `Git: tracking ${this.info.htmlUrl}`);
      return this.info;
    } catch (err) {
      this.log("warn", `Git init failed (${this.errMsg(err)}); continuing without GitHub.`);
      this.info = null;
      return null;
    }
  }

  // Create or switch to a work-order branch at the current HEAD, and push
  // subsequent commits there instead of the default branch. Returns the branch
  // and the base commit it forked from (the eventual PR base). Idempotent: on
  // resume, re-checking out the same branch is a no-op.
  async startBranch(branchName: string): Promise<{ branch: string; baseCommit: string } | null> {
    if (!this.info) return null;
    try {
      const base = (await this.git(["rev-parse", "HEAD"], true)).stdout.trim();
      this.baseBranch = this.branch; // remember where we forked from (PR base)
      await this.git(["checkout", "-B", branchName]);
      this.branch = branchName;
      this.log("info", `Git: working on branch ${branchName}${base ? ` (from ${base.slice(0, 7)})` : ""}`);
      return { branch: branchName, baseCommit: base };
    } catch (err) {
      this.log("warn", `Git: failed to start branch ${branchName} (${this.errMsg(err)}); staying on ${this.branch}`);
      return null;
    }
  }

  // The current HEAD sha (empty string if unavailable / no commits yet).
  async currentSha(): Promise<string> {
    if (!this.info) return "";
    try { return (await this.git(["rev-parse", "HEAD"], true)).stdout.trim(); } catch { return ""; }
  }

  // Open a pull request from the work-order branch into the base branch. Returns
  // the PR html url. If one already exists for this head (e.g. on resume), the
  // existing PR's url is returned instead of failing.
  async openPullRequest(title: string, body: string, base?: string): Promise<string | null> {
    if (!this.info || this.branch === this.baseBranch) return null;
    const baseBranch = base || this.baseBranch;
    const head = this.branch;
    try {
      const res = await this.api("POST", `/repos/${this.info.owner}/${this.info.repo}/pulls`, {
        title, head, base: baseBranch, body,
      });
      const url = res.html_url as string | undefined;
      if (url) this.log("info", `Git: opened PR ${url}`);
      return url || null;
    } catch (err) {
      // A PR may already exist for this branch (resume) — return it if so.
      const existing = await this.findOpenPullRequest(head).catch(() => null);
      if (existing) { this.log("info", `Git: PR already open ${existing}`); return existing; }
      this.log("warn", `Git: failed to open PR (${this.errMsg(err)})`);
      return null;
    }
  }

  async getCombinedStatus(sha: string): Promise<RemoteCheckSummary> {
    if (!this.info || !sha) return { complete: true, failures: [], pending: [] };
    const res = await this.api("GET", `/repos/${this.info.owner}/${this.info.repo}/commits/${sha}/status`, undefined, true);
    const state = String(res.state || "");
    const statuses = Array.isArray(res.statuses) ? res.statuses as Array<Record<string, unknown>> : [];
    const failures = statuses
      .filter((s) => !["success", "pending"].includes(String(s.state || "")))
      .map((s) => ({
        name: String(s.context || "status"),
        conclusion: String(s.state || "failure"),
        status: "completed",
        detailsUrl: typeof s.target_url === "string" ? s.target_url : undefined,
        summary: typeof s.description === "string" ? s.description : undefined,
      }));
    const pending = statuses
      .filter((s) => String(s.state || "") === "pending")
      .map((s) => String(s.context || "status"));
    return { complete: state !== "pending", failures, pending };
  }

  async getCheckRuns(sha: string): Promise<RemoteCheckSummary> {
    if (!this.info || !sha) return { complete: true, failures: [], pending: [] };
    const res = await this.api("GET", `/repos/${this.info.owner}/${this.info.repo}/commits/${sha}/check-runs`, undefined, true);
    const runs = Array.isArray(res.check_runs) ? res.check_runs as Array<Record<string, unknown>> : [];
    const pending = runs
      .filter((r) => String(r.status || "") !== "completed")
      .map((r) => String(r.name || "check"));
    const failures = runs
      .filter((r) => String(r.status || "") === "completed" && !["success", "neutral", "skipped"].includes(String(r.conclusion || "")))
      .map((r) => {
        const output = (r.output || {}) as Record<string, unknown>;
        const detailsUrl = typeof r.details_url === "string" ? r.details_url : undefined;
        return {
          name: String(r.name || "check"),
          conclusion: String(r.conclusion || "failure"),
          status: String(r.status || "completed"),
          detailsUrl,
          runId: this.actionsRunIdFromUrl(detailsUrl),
          summary: typeof output.summary === "string" ? output.summary : undefined,
          text: typeof output.text === "string" ? output.text : undefined,
        };
      });
    return { complete: pending.length === 0, failures, pending };
  }

  async getFailedJobLogs(runId: number): Promise<string> {
    if (!this.info || !runId) return "";
    try {
      const jobsRes = await this.api("GET", `/repos/${this.info.owner}/${this.info.repo}/actions/runs/${runId}/jobs`, undefined, true);
      const jobs = Array.isArray(jobsRes.jobs) ? jobsRes.jobs as Array<Record<string, unknown>> : [];
      const failed = jobs.filter((j) => String(j.status || "") === "completed" && !["success", "neutral", "skipped"].includes(String(j.conclusion || "")));
      const excerpts: string[] = [];
      for (const job of failed.slice(0, 3)) {
        const id = Number(job.id || 0);
        if (!id) continue;
        const text = await this.apiText("GET", `/repos/${this.info.owner}/${this.info.repo}/actions/jobs/${id}/logs`, true);
        if (text) excerpts.push(`--- ${String(job.name || "failed job")} ---\n${this.trimLog(text)}`);
      }
      return excerpts.join("\n\n");
    } catch (err) {
      this.log("warn", `Git: failed to fetch Actions logs (${this.errMsg(err)})`);
      return "";
    }
  }

  async getReviewComments(prNumber: number): Promise<ReviewComment[]> {
    if (!this.info || !prNumber) return [];
    const res = await this.api("GET", `/repos/${this.info.owner}/${this.info.repo}/pulls/${prNumber}/comments`, undefined, true);
    const list = Array.isArray(res) ? res as Array<Record<string, unknown>> : [];
    return list.map((c) => ({
      path: String(c.path || ""),
      line: typeof c.line === "number" ? c.line : typeof c.original_line === "number" ? c.original_line : undefined,
      body: String(c.body || ""),
    })).filter((c) => c.path && c.body);
  }

  private async findOpenPullRequest(head: string): Promise<string | null> {
    if (!this.info) return null;
    const q = `head=${encodeURIComponent(`${this.info.owner}:${head}`)}&state=open`;
    const res = await this.api("GET", `/repos/${this.info.owner}/${this.info.repo}/pulls?${q}`, undefined, true);
    const list = Array.isArray(res) ? res : (res as { length?: number });
    const first = Array.isArray(list) ? list[0] : undefined;
    return first?.html_url ?? null;
  }

  // Stage everything, commit, and push. Returns the commit, or null if there was
  // nothing to commit / git is not configured.
  async commitPhase(label: string, message: string): Promise<CommitInfo | null> {
    if (!this.info) return null;
    try {
      await this.git(["add", "-A"]);
      const status = await this.git(["status", "--porcelain"]);
      if (!status.stdout.trim()) {
        await this.pushCurrent(label);
        return null; // nothing changed
      }

      await this.git(["commit", "-m", message, "--author", "Agent Swarm <swarm@agent-swarm.local>"]);
      const sha = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
      const filesOut = await this.git(["show", "--pretty=format:", "--name-only", "HEAD"]);
      const files = filesOut.stdout.split("\n").filter((l) => l.trim()).length;

      const push = await this.git(["push", "origin", `HEAD:${this.branch}`], true);
      if (push.code !== 0) {
        this.log("warn", `Git push failed for "${label}": ${this.scrub(push.stderr).slice(0, 200)}`);
      } else {
        this.log("info", `Git: pushed "${label}" (${sha.slice(0, 7)}, ${files} files)`);
      }
      return { sha, message, files, htmlUrl: `${this.info.htmlUrl}/commit/${sha}` };
    } catch (err) {
      this.log("warn", `Git commit failed for "${label}": ${this.errMsg(err)}`);
      return null;
    }
  }

  async addWorktree(dir: string, branch: string): Promise<boolean> {
    if (!this.info) return false;
    const worktreeDir = path.resolve(dir);
    if (!this.isInsideWorkspace(worktreeDir)) {
      this.log("warn", `Git: refusing worktree outside workspace: ${worktreeDir}`);
      return false;
    }
    try {
      await this.removeWorktree(worktreeDir);
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
      await this.git(["worktree", "add", "-B", branch, worktreeDir, "HEAD"]);
      await this.gitIn(worktreeDir, ["config", "user.email", "swarm@agent-swarm.local"], true);
      await this.gitIn(worktreeDir, ["config", "user.name", "Agent Swarm"], true);
      this.log("info", `Git: added isolated worktree ${branch}`);
      return true;
    } catch (err) {
      this.log("warn", `Git: failed to add worktree ${branch} (${this.errMsg(err)})`);
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      return false;
    }
  }

  async commitWorktree(dir: string, branch: string, message: string): Promise<boolean> {
    if (!this.info) return false;
    try {
      await this.gitIn(dir, ["add", "-A"]);
      const status = await this.gitIn(dir, ["status", "--porcelain"]);
      if (!status.stdout.trim()) {
        this.log("info", `Git: worktree ${branch} had no changes`);
        return false;
      }
      await this.gitIn(dir, ["commit", "-m", message, "--author", "Agent Swarm <swarm@agent-swarm.local>"]);
      this.log("info", `Git: committed isolated branch ${branch}`);
      return true;
    } catch (err) {
      this.log("warn", `Git: failed to commit worktree ${branch} (${this.errMsg(err)})`);
      return false;
    }
  }

  async mergeBranch(branch: string): Promise<MergeResult> {
    if (!this.info) return { ok: false, conflictedFiles: [] };
    try {
      const res = await this.git(["merge", "--no-ff", branch, "-m", `Merge ${branch}`], true);
      if (res.code === 0) {
        this.log("info", `Git: merged ${branch}`);
        return { ok: true, conflictedFiles: [] };
      }
      const conflicted = await this.conflictedFiles();
      this.log("warn", `Git: merge conflict in ${branch}${conflicted.length ? ` (${conflicted.join(", ")})` : ""}`);
      return { ok: false, conflictedFiles: conflicted };
    } catch (err) {
      this.log("warn", `Git: failed to merge ${branch} (${this.errMsg(err)})`);
      return { ok: false, conflictedFiles: await this.conflictedFiles().catch(() => []) };
    }
  }

  async commitMerge(message: string): Promise<boolean> {
    if (!this.info) return false;
    try {
      await this.git(["add", "-A"]);
      const unresolved = await this.conflictedFiles();
      if (unresolved.length > 0) return false;
      const res = await this.git(["commit", "-m", message, "--author", "Agent Swarm <swarm@agent-swarm.local>"], true);
      return res.code === 0;
    } catch (err) {
      this.log("warn", `Git: failed to commit resolved merge (${this.errMsg(err)})`);
      return false;
    }
  }

  async abortMerge(): Promise<void> {
    if (!this.info) return;
    await this.git(["merge", "--abort"], true).catch(() => undefined);
  }

  async removeWorktree(dir: string): Promise<void> {
    if (!this.info) return;
    const worktreeDir = path.resolve(dir);
    if (!this.isInsideWorkspace(worktreeDir)) return;
    await this.git(["worktree", "remove", "--force", worktreeDir], true).catch(() => undefined);
    await this.git(["worktree", "prune"], true).catch(() => undefined);
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }

  async pushCurrent(label: string): Promise<void> {
    if (!this.info) return;
    const push = await this.git(["push", "origin", `HEAD:${this.branch}`], true);
    if (push.code !== 0) {
      this.log("warn", `Git push failed for "${label}": ${this.scrub(push.stderr).slice(0, 200)}`);
    } else {
      this.log("info", `Git: pushed "${label}"`);
    }
  }

  // ── repo resolution / creation ───────────────────────────────────────────

  private async resolveOwnerRepo(): Promise<{ owner: string; repo: string }> {
    let spec = this.repoSpec.trim();
    // Full URL form
    const m = spec.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (m) return { owner: m[1], repo: m[2] };
    // owner/repo
    if (spec.includes("/")) {
      const [owner, repo] = spec.split("/");
      return { owner, repo: repo.replace(/\.git$/, "") };
    }
    // bare name → authenticated user is the owner
    const user = await this.api("GET", "/user");
    return { owner: String(user.login), repo: this.sanitizeRepoName(spec) };
  }

  private async ensureRemoteRepo(owner: string, repo: string): Promise<string> {
    const existing = await this.api("GET", `/repos/${owner}/${repo}`, undefined, true);
    if (existing && existing.id) return String(existing.default_branch || "main"); // already exists

    // Create under the user, or under an org if owner differs from the user.
    const me = await this.api("GET", "/user");
    const body = { name: repo, private: true, auto_init: false, description: "Built by Agent Swarm" };
    if (String(me.login).toLowerCase() === owner.toLowerCase()) {
      await this.api("POST", "/user/repos", body);
    } else {
      await this.api("POST", `/orgs/${owner}/repos`, body);
    }
    this.log("info", `Git: created repo ${owner}/${repo} (private)`);
    return "main";
  }

  private async ensureLocalRepo(): Promise<void> {
    const gitDir = path.join(this.workspaceDir, ".git");
    if (!fs.existsSync(gitDir)) {
      await this.git(["init", "-b", this.branch]);
    }
    await this.git(["config", "user.email", "swarm@agent-swarm.local"]);
    await this.git(["config", "user.name", "Agent Swarm"]);

    const gi = path.join(this.workspaceDir, ".gitignore");
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, GITIGNORE, "utf-8");
    else {
      this.ensureGitignoreEntry(gi, ".swarm/");
      this.ensureGitignoreEntry(gi, ".wt/");
      this.ensureGitignoreEntry(gi, `${ARTIFACT_BASE}/`);
      // Legacy top-level doc folders from the pre-`_artifacts/` layout.
      for (const dir of ARTIFACT_DOC_DIRS) this.ensureGitignoreEntry(gi, `${dir}/`);
    }

    // Drop any support-document folders that a prior run had committed, so they
    // stop being pushed. Index-only removal; the files stay on disk locally.
    await this.untrackArtifactDocs();

    // Point origin at the token-authenticated URL (idempotent).
    const remotes = await this.git(["remote"]);
    if (remotes.stdout.split("\n").map((s) => s.trim()).includes("origin")) {
      await this.git(["remote", "set-url", "origin", this.remoteUrl], true);
    } else {
      await this.git(["remote", "add", "origin", this.remoteUrl], true);
    }
  }

  // Remove already-tracked support-document folders from the git index so they
  // are no longer committed/pushed (they remain on disk to support later
  // phases). No-op when nothing matches.
  private async untrackArtifactDocs(): Promise<void> {
    // The current layout groups every support doc under the artifact base; older
    // repos may still track the top-level doc folders. Untrack both.
    for (const dir of [ARTIFACT_BASE, ...ARTIFACT_DOC_DIRS]) {
      await this.git(["rm", "-r", "--cached", "--ignore-unmatch", "--", dir], true).catch(() => undefined);
    }
  }

  // ── low-level helpers ─────────────────────────────────────────────────────

  private async api(method: string, p: string, body?: unknown, allow404 = false): Promise<Record<string, unknown>> {
    const res = await fetch(`https://api.github.com${p}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agent-swarm",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && allow404) return {};
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${method} ${p} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  private async apiText(method: string, p: string, allow404 = false): Promise<string> {
    const res = await fetch(`https://api.github.com${p}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agent-swarm",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
    });
    if (res.status === 404 && allow404) return "";
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${method} ${p} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return this.scrub(await res.text());
  }

  private git(args: string[], allowFail = false): Promise<{ code: number; stdout: string; stderr: string }> {
    return this.gitIn(this.workspaceDir, args, allowFail);
  }

  private gitIn(cwd: string, args: string[], allowFail = false): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0 || allowFail) resolve({ code: code ?? 0, stdout, stderr });
        else reject(new Error(`git ${args[0]} failed: ${this.scrub(stderr).slice(0, 200)}`));
      });
      proc.on("error", (err) => reject(new Error(`git not available: ${err.message}`)));
    });
  }

  private async conflictedFiles(): Promise<string[]> {
    const out = await this.git(["diff", "--name-only", "--diff-filter=U"], true);
    return out.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  private isInsideWorkspace(target: string): boolean {
    const root = path.resolve(this.workspaceDir);
    const rel = path.relative(root, target);
    return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  private ensureGitignoreEntry(filePath: string, entry: string): void {
    try {
      const current = fs.readFileSync(filePath, "utf-8");
      if (current.split(/\r?\n/).some((line) => line.trim() === entry)) return;
      fs.appendFileSync(filePath, `${current.endsWith("\n") ? "" : "\n"}${entry}\n`, "utf-8");
    } catch {
      // Ignore best-effort gitignore maintenance.
    }
  }

  private sanitizeRepoName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "agent-swarm-project";
  }

  private scrub(text: string): string {
    return this.token ? text.split(this.token).join("***") : text;
  }

  private errMsg(err: unknown): string {
    return this.scrub(err instanceof Error ? err.message : String(err));
  }

  private trimLog(text: string): string {
    const lines = this.scrub(text).split(/\r?\n/);
    const failing = lines.filter((line) => /error|failed|failure|exception|fatal|not found|cannot|timeout/i.test(line));
    const selected = failing.length ? failing.slice(-120) : lines.slice(-120);
    return selected.join("\n").slice(-12_000);
  }

  private actionsRunIdFromUrl(url?: string): number | undefined {
    if (!url) return undefined;
    const match = url.match(/\/actions\/runs\/(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  private log(level: "info" | "warn", message: string) {
    this.logger?.log(level, "system", message);
  }
}
