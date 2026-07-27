/**
 * GitHub OAuth integration — connect accounts, push workspace files as a repo.
 * Uses GitHub's Git Tree API for atomic multi-file commits.
 */
import type { Env } from "./env";

const GH_API = "https://api.github.com";
const GH_ACCEPT = "application/vnd.github+json";
const GH_VERSION = "2022-11-28";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GitHubAccount = {
  userId: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  connectedAt: string;
};

export type GitHubRepo = {
  projectId: string;
  repoFullName: string;
  htmlUrl: string;
  lastPushedAt: string | null;
};

// ─── D1 helpers ───────────────────────────────────────────────────────────────

export async function dbGetGitHubAccount(env: Env, userId: string): Promise<GitHubAccount | null> {
  const row = await env.DB!.prepare(
    `SELECT user_id, github_id, login, name, avatar_url, connected_at FROM cf_github_accounts WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ user_id: string; github_id: number; login: string; name: string | null; avatar_url: string | null; connected_at: string }>();
  if (!row) return null;
  return {
    userId: row.user_id,
    githubId: row.github_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
    connectedAt: row.connected_at,
  };
}

async function dbUpsertGitHubAccount(
  env: Env,
  data: { userId: string; githubId: number; login: string; name: string | null; avatarUrl: string | null; accessToken: string; scope: string },
) {
  await env.DB!.prepare(
    `INSERT INTO cf_github_accounts (user_id, github_id, login, name, avatar_url, access_token, scope, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET
       github_id = excluded.github_id, login = excluded.login, name = excluded.name,
       avatar_url = excluded.avatar_url, access_token = excluded.access_token,
       scope = excluded.scope, connected_at = excluded.connected_at`,
  )
    .bind(data.userId, data.githubId, data.login, data.name, data.avatarUrl, data.accessToken, data.scope)
    .run();
}

export async function dbDeleteGitHubAccount(env: Env, userId: string) {
  await env.DB!.prepare(`DELETE FROM cf_github_accounts WHERE user_id = ?`).bind(userId).run();
}

async function dbGetToken(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB!.prepare(`SELECT access_token FROM cf_github_accounts WHERE user_id = ?`)
    .bind(userId)
    .first<{ access_token: string }>();
  return row?.access_token ?? null;
}

export async function dbGetGitHubRepo(env: Env, projectId: string): Promise<GitHubRepo | null> {
  const row = await env.DB!.prepare(
    `SELECT project_id, repo_full_name, html_url, last_pushed_at FROM cf_github_repos WHERE project_id = ?`,
  )
    .bind(projectId)
    .first<{ project_id: string; repo_full_name: string; html_url: string; last_pushed_at: string | null }>();
  if (!row) return null;
  return { projectId: row.project_id, repoFullName: row.repo_full_name, htmlUrl: row.html_url, lastPushedAt: row.last_pushed_at };
}

async function dbUpsertGitHubRepo(
  env: Env,
  data: { userId: string; projectId: string; repoFullName: string; repoId: number; htmlUrl: string; defaultBranch: string },
) {
  const id = crypto.randomUUID();
  await env.DB!.prepare(
    `INSERT INTO cf_github_repos (id, user_id, project_id, repo_full_name, repo_id, html_url, default_branch, last_pushed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (project_id) DO UPDATE SET
       repo_full_name = excluded.repo_full_name, repo_id = excluded.repo_id,
       html_url = excluded.html_url, default_branch = excluded.default_branch,
       last_pushed_at = excluded.last_pushed_at`,
  )
    .bind(id, data.userId, data.projectId, data.repoFullName, data.repoId, data.htmlUrl, data.defaultBranch)
    .run();
}

// ─── OAuth state ──────────────────────────────────────────────────────────────

async function dbCreateOAuthState(env: Env, userId: string, projectId: string | null): Promise<string> {
  const state = crypto.randomUUID();
  await env.DB!.prepare(
    `INSERT INTO cf_oauth_states (state, user_id, project_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
  )
    .bind(state, userId, projectId)
    .run();
  // Clean up states older than 15 minutes opportunistically
  await env.DB!.prepare(
    `DELETE FROM cf_oauth_states WHERE created_at < datetime('now', '-15 minutes')`,
  ).run().catch(() => {});
  return state;
}

async function dbConsumeOAuthState(
  env: Env,
  state: string,
): Promise<{ userId: string; projectId: string | null } | null> {
  const row = await env.DB!.prepare(
    `SELECT user_id, project_id FROM cf_oauth_states WHERE state = ? AND created_at > datetime('now', '-10 minutes')`,
  )
    .bind(state)
    .first<{ user_id: string; project_id: string | null }>();
  if (!row) return null;
  await env.DB!.prepare(`DELETE FROM cf_oauth_states WHERE state = ?`).bind(state).run();
  return { userId: row.user_id, projectId: row.project_id };
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GH_ACCEPT,
    "X-GitHub-Api-Version": GH_VERSION,
    "User-Agent": "Teamvinsible/1.0",
    "Content-Type": "application/json",
  };
}

async function ghFetch<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: ghHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function ghFetchUser(token: string) {
  return ghFetch<{ id: number; login: string; name: string | null; avatar_url: string }>(token, "GET", "/user");
}

// ─── OAuth flow ───────────────────────────────────────────────────────────────

export async function startGitHubOAuth(
  env: Env,
  userId: string,
  projectId: string | null,
): Promise<{ url: string }> {
  if (!env.GITHUB_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID not configured");
  if (!env.DB) throw new Error("DB not available");
  const state = await dbCreateOAuthState(env, userId, projectId);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    scope: "repo read:user",
    state,
  });
  return { url: `https://github.com/login/oauth/authorize?${params}` };
}

export async function handleGitHubCallback(
  env: Env,
  code: string,
  state: string,
): Promise<{ redirectTo: string; error?: string }> {
  const platformHost = `https://${env.PLATFORM_HOST}`;
  if (!env.DB) return { redirectTo: platformHost, error: "DB unavailable" };
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
    return { redirectTo: platformHost, error: "GitHub OAuth not configured" };

  const stateRow = await dbConsumeOAuthState(env, state);
  if (!stateRow) return { redirectTo: platformHost, error: "Invalid or expired OAuth state" };

  const { userId, projectId } = stateRow;
  const spineBase = projectId ? `${platformHost}/spine/${projectId}` : platformHost;

  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Teamvinsible/1.0" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    signal: AbortSignal.timeout(20_000),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; scope?: string; error?: string };
  if (!tokenData.access_token) {
    console.error("GitHub token exchange failed", tokenData.error);
    return { redirectTo: `${spineBase}?github=error`, error: tokenData.error };
  }

  const ghUser = await ghFetchUser(tokenData.access_token).catch(() => null);
  if (!ghUser) return { redirectTo: `${spineBase}?github=error`, error: "Failed to fetch GitHub user" };

  await dbUpsertGitHubAccount(env, {
    userId,
    githubId: ghUser.id,
    login: ghUser.login,
    name: ghUser.name,
    avatarUrl: ghUser.avatar_url,
    accessToken: tokenData.access_token,
    scope: tokenData.scope || "repo",
  });

  return { redirectTo: `${spineBase}?github=connected` };
}

// ─── Push workspace to GitHub ─────────────────────────────────────────────────

function slugToRepoName(swarmName: string): string {
  return swarmName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "teamvinsible-app";
}

export async function pushWorkspaceToGitHub(
  env: Env,
  opts: { userId: string; projectId: string; title: string; swarmName: string },
): Promise<{ ok: true; htmlUrl: string } | { ok: false; error: string }> {
  if (!env.WORKSPACES) return { ok: false, error: "Workspace storage unavailable" };
  if (!env.DB) return { ok: false, error: "DB unavailable" };

  const token = await dbGetToken(env, opts.userId);
  if (!token) return { ok: false, error: "GitHub not connected" };

  // Read all workspace files
  const listed = await env.WORKSPACES.list({ prefix: `workspaces/${opts.projectId}/`, limit: 200 });
  const files: { path: string; content: string }[] = [];
  for (const obj of listed.objects) {
    const rel = obj.key.replace(`workspaces/${opts.projectId}/`, "");
    if (!rel || rel.startsWith("artifacts/")) continue;
    const body = await env.WORKSPACES.get(obj.key);
    if (!body) continue;
    files.push({ path: rel, content: await body.text() });
  }
  if (files.length === 0) return { ok: false, error: "No workspace files to push" };

  const ghUser = await ghFetchUser(token).catch(() => null);
  if (!ghUser) return { ok: false, error: "Failed to fetch GitHub user — token may be expired. Reconnect GitHub." };

  const repoName = slugToRepoName(opts.swarmName);
  const owner = ghUser.login;

  // Create repo if it doesn't exist
  let repoData: { id: number; full_name: string; html_url: string; default_branch: string };
  try {
    repoData = await ghFetch(token, "GET", `/repos/${owner}/${repoName}`);
  } catch {
    repoData = await ghFetch(token, "POST", "/user/repos", {
      name: repoName,
      description: opts.title,
      private: true,
      auto_init: true,
    });
  }

  const branch = repoData.default_branch || "main";

  // Get current HEAD commit SHA
  let baseTree: string | undefined;
  let parentSha: string | undefined;
  try {
    const ref = await ghFetch<{ object: { sha: string } }>(token, "GET", `/repos/${owner}/${repoName}/git/ref/heads/${branch}`);
    parentSha = ref.object.sha;
    const commit = await ghFetch<{ tree: { sha: string } }>(token, "GET", `/repos/${owner}/${repoName}/git/commits/${parentSha}`);
    baseTree = commit.tree.sha;
  } catch {
    // New repo with auto_init may need a moment; skip base tree on first push
  }

  // Create blobs for all files
  const treeItems = await Promise.all(
    files.map(async (f) => {
      const blob = await ghFetch<{ sha: string }>(token, "POST", `/repos/${owner}/${repoName}/git/blobs`, {
        content: f.content,
        encoding: "utf-8",
      });
      return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
    }),
  );

  // Create tree
  const tree = await ghFetch<{ sha: string }>(token, "POST", `/repos/${owner}/${repoName}/git/trees`, {
    tree: treeItems,
    ...(baseTree ? { base_tree: baseTree } : {}),
  });

  // Create commit
  const commitMsg = `Deploy from Teamvinsible\n\nGenerated by the ${opts.title} crew on Teamvinsible.`;
  const commit = await ghFetch<{ sha: string }>(token, "POST", `/repos/${owner}/${repoName}/git/commits`, {
    message: commitMsg,
    tree: tree.sha,
    ...(parentSha ? { parents: [parentSha] } : { parents: [] }),
  });

  // Update branch ref
  await ghFetch(token, "PATCH", `/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    sha: commit.sha,
    force: true,
  });

  await dbUpsertGitHubRepo(env, {
    userId: opts.userId,
    projectId: opts.projectId,
    repoFullName: repoData.full_name,
    repoId: repoData.id,
    htmlUrl: repoData.html_url,
    defaultBranch: branch,
  });

  return { ok: true, htmlUrl: repoData.html_url };
}
