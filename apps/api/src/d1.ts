import type { Env } from "./env";

export type CfProjectRow = {
  id: string;
  user_id: string;
  swarm_name: string;
  title: string;
  brief: string;
  status: string;
  preview_url: string | null;
  sandbox_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CfRunRow = {
  id: string;
  project_id: string;
  user_id: string;
  idea: string;
  status: string;
  stage: string;
  current_phase: string | null;
  created_at: string;
  updated_at: string;
};

export type CfNotificationRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  run_id: string | null;
  kind: string;
  severity: string;
  title: string;
  message: string;
  metadata: string;
  read_at: string | null;
  created_at: string;
};

export function hasD1(env: Env): boolean {
  return Boolean(env.DB);
}

export async function d1ListProjects(env: Env, userId: string): Promise<CfProjectRow[]> {
  const { results } = await env.DB!.prepare(
    `SELECT * FROM cf_projects WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all<CfProjectRow>();
  return results || [];
}

export async function d1GetProject(
  env: Env,
  userId: string,
  key: string,
): Promise<CfProjectRow | null> {
  const byId = await env
    .DB!.prepare(`SELECT * FROM cf_projects WHERE user_id = ? AND id = ?`)
    .bind(userId, key)
    .first<CfProjectRow>();
  if (byId) return byId;
  return env
    .DB!.prepare(`SELECT * FROM cf_projects WHERE user_id = ? AND swarm_name = ?`)
    .bind(userId, key)
    .first<CfProjectRow>();
}

export async function d1CreateProject(
  env: Env,
  row: Omit<CfProjectRow, "created_at" | "updated_at" | "preview_url" | "sandbox_id"> & {
    preview_url?: string | null;
    sandbox_id?: string | null;
  },
): Promise<CfProjectRow> {
  const now = new Date().toISOString();
  await env
    .DB!.prepare(
      `INSERT INTO cf_projects (id, user_id, swarm_name, title, brief, status, preview_url, sandbox_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.user_id,
      row.swarm_name,
      row.title,
      row.brief,
      row.status,
      row.preview_url ?? null,
      row.sandbox_id ?? null,
      now,
      now,
    )
    .run();
  return { ...row, preview_url: row.preview_url ?? null, sandbox_id: row.sandbox_id ?? null, created_at: now, updated_at: now };
}

// Single-statement patch semantics: null/undefined fields are left unchanged
// (COALESCE), which avoids the read-modify-write race between the Workflow and
// the Mediator. No caller needs to clear a column to NULL.
export async function d1UpdateProject(
  env: Env,
  projectId: string,
  patch: Partial<Pick<CfProjectRow, "status" | "preview_url" | "sandbox_id" | "title" | "brief">>,
): Promise<void> {
  await env
    .DB!.prepare(
      `UPDATE cf_projects SET
         status = COALESCE(?, status),
         preview_url = COALESCE(?, preview_url),
         sandbox_id = COALESCE(?, sandbox_id),
         title = COALESCE(?, title),
         brief = COALESCE(?, brief),
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? null,
      patch.preview_url ?? null,
      patch.sandbox_id ?? null,
      patch.title ?? null,
      patch.brief ?? null,
      new Date().toISOString(),
      projectId,
    )
    .run();
}

export async function d1CreateRun(
  env: Env,
  row: Omit<CfRunRow, "created_at" | "updated_at">,
): Promise<CfRunRow> {
  const now = new Date().toISOString();
  await env
    .DB!.prepare(
      `INSERT INTO cf_runs (id, project_id, user_id, idea, status, stage, current_phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.project_id, row.user_id, row.idea, row.status, row.stage, row.current_phase, now, now)
    .run();
  return { ...row, created_at: now, updated_at: now };
}

export async function d1CountActiveRuns(env: Env, userId: string): Promise<number> {
  const row = await env.DB!.prepare(
    `SELECT COUNT(*) AS count FROM cf_runs WHERE user_id = ? AND status IN ('queued', 'running')`,
  )
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function d1LatestRun(env: Env, projectId: string): Promise<CfRunRow | null> {
  return env
    .DB!.prepare(`SELECT * FROM cf_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(projectId)
    .first<CfRunRow>();
}

export async function d1UpdateRun(
  env: Env,
  runId: string,
  patch: Partial<Pick<CfRunRow, "status" | "stage" | "current_phase">>,
): Promise<void> {
  await env
    .DB!.prepare(
      `UPDATE cf_runs SET
         status = COALESCE(?, status),
         stage = COALESCE(?, stage),
         current_phase = COALESCE(?, current_phase),
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? null,
      patch.stage ?? null,
      patch.current_phase ?? null,
      new Date().toISOString(),
      runId,
    )
    .run();
}

export async function d1AddActivity(
  env: Env,
  row: {
    id: string;
    project_id: string;
    run_id?: string | null;
    message: string;
    kind?: string;
    agent?: string;
    phase?: string;
  },
): Promise<void> {
  await env
    .DB!.prepare(
      `INSERT INTO cf_activity (id, project_id, run_id, at, message, kind, agent, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.project_id,
      row.run_id ?? null,
      new Date().toISOString(),
      row.message,
      row.kind ?? "info",
      row.agent ?? null,
      row.phase ?? null,
    )
    .run();
}

export async function d1ListActivity(env: Env, projectId: string, limit = 40) {
  const { results } = await env
    .DB!.prepare(
      `SELECT * FROM cf_activity WHERE project_id = ? ORDER BY at DESC LIMIT ?`,
    )
    .bind(projectId, limit)
    .all<{
      id: string;
      at: string;
      message: string;
      kind: string | null;
      agent: string | null;
      phase: string | null;
    }>();
  return results || [];
}

export async function d1UpsertArtifact(
  env: Env,
  row: {
    id: string;
    project_id: string;
    path: string;
    title: string;
    owner: string;
    summary: string;
    status: string;
  },
): Promise<void> {
  await env
    .DB!.prepare(
      `INSERT INTO cf_artifacts (id, project_id, path, title, owner, summary, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, path) DO UPDATE SET
         title = excluded.title,
         owner = excluded.owner,
         summary = excluded.summary,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .bind(
      row.id,
      row.project_id,
      row.path,
      row.title,
      row.owner,
      row.summary,
      row.status,
      new Date().toISOString(),
    )
    .run();
}

export async function d1ListArtifacts(env: Env, projectId: string) {
  const { results } = await env
    .DB!.prepare(`SELECT * FROM cf_artifacts WHERE project_id = ? ORDER BY updated_at DESC`)
    .bind(projectId)
    .all<{
      id: string;
      path: string;
      title: string | null;
      owner: string | null;
      summary: string | null;
      status: string;
      updated_at: string;
    }>();
  return results || [];
}


// Pass a deterministic `id` from retryable contexts (Workflow steps, queue
// consumers): INSERT OR IGNORE then makes redelivery a no-op.
export async function d1CreateNotification(
  env: Env,
  row: {
    id?: string;
    userId: string;
    projectId?: string | null;
    runId?: string | null;
    kind: string;
    severity?: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB!.prepare(
    `INSERT OR IGNORE INTO cf_notifications
      (id, user_id, project_id, run_id, kind, severity, title, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id || crypto.randomUUID(),
      row.userId,
      row.projectId ?? null,
      row.runId ?? null,
      row.kind,
      row.severity ?? "info",
      row.title,
      row.message,
      JSON.stringify(row.metadata || {}),
      new Date().toISOString(),
    )
    .run();
}

export async function d1ListNotifications(
  env: Env,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<CfNotificationRow[]> {
  const limit = Math.min(Math.max(options.limit || 50, 1), 100);
  const unread = options.unreadOnly ? " AND read_at IS NULL" : "";
  const { results } = await env.DB!.prepare(
    `SELECT * FROM cf_notifications WHERE user_id = ?${unread} ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(userId, limit)
    .all<CfNotificationRow>();
  return results || [];
}

export async function d1MarkNotificationsRead(
  env: Env,
  userId: string,
  ids?: string[],
): Promise<number> {
  const now = new Date().toISOString();
  if (!ids?.length) {
    const result = await env.DB!.prepare(
      `UPDATE cf_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(now, userId)
      .run();
    return result.meta.changes || 0;
  }
  const safeIds = ids.slice(0, 100);
  const placeholders = safeIds.map(() => "?").join(",");
  const result = await env.DB!.prepare(
    `UPDATE cf_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
  )
    .bind(now, userId, ...safeIds)
    .run();
  return result.meta.changes || 0;
}
