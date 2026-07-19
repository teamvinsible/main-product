import type { PlatformProject } from "@teamvinsible/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

type ProjectRow = {
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

function mapProject(row: ProjectRow): PlatformProject {
  return {
    id: row.id,
    swarmName: row.swarm_name,
    title: row.title,
    brief: row.brief,
    status: row.status,
    previewUrl: row.preview_url,
    sandboxId: row.sandbox_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listUserProjects(
  db: SupabaseClient,
  userId: string,
): Promise<PlatformProject[]> {
  const { data, error } = await db
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data || []) as ProjectRow[]).map(mapProject);
}

export async function getProjectForUser(
  db: SupabaseClient,
  userId: string,
  projectKey: string,
): Promise<PlatformProject | null> {
  // Accept UUID id or swarm_name
  const byId = await db
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .eq("id", projectKey)
    .maybeSingle();
  if (byId.data) return mapProject(byId.data as ProjectRow);

  const byName = await db
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .eq("swarm_name", projectKey)
    .maybeSingle();
  if (byName.data) return mapProject(byName.data as ProjectRow);
  return null;
}

export async function createProject(
  db: SupabaseClient,
  input: {
    userId: string;
    swarmName: string;
    title: string;
    brief: string;
    status?: string;
  },
): Promise<PlatformProject> {
  const { data, error } = await db
    .from("projects")
    .insert({
      user_id: input.userId,
      swarm_name: input.swarmName,
      title: input.title,
      brief: input.brief,
      status: input.status || "queued",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapProject(data as ProjectRow);
}

export async function updateProjectPreview(
  db: SupabaseClient,
  projectId: string,
  patch: { previewUrl?: string | null; sandboxId?: string | null; status?: string },
): Promise<PlatformProject> {
  const { data, error } = await db
    .from("projects")
    .update({
      preview_url: patch.previewUrl,
      sandbox_id: patch.sandboxId,
      status: patch.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapProject(data as ProjectRow);
}

export async function getProfile(
  db: SupabaseClient,
  userId: string,
): Promise<{ display_name: string | null; avatar_url: string | null; email: string | null } | null> {
  const { data } = await db.from("profiles").select("display_name, avatar_url, email").eq("id", userId).maybeSingle();
  return data;
}

/** In-memory project store for DEV_AUTH_BYPASS without Supabase. */
export class MemoryProjectStore {
  private rows = new Map<string, ProjectRow>();

  list(userId: string): PlatformProject[] {
    return [...this.rows.values()]
      .filter((r) => r.user_id === userId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(mapProject);
  }

  get(userId: string, key: string): PlatformProject | null {
    for (const row of this.rows.values()) {
      if (row.user_id !== userId) continue;
      if (row.id === key || row.swarm_name === key) return mapProject(row);
    }
    return null;
  }

  create(input: {
    userId: string;
    swarmName: string;
    title: string;
    brief: string;
    status?: string;
    id?: string;
  }): PlatformProject {
    const now = new Date().toISOString();
    const row: ProjectRow = {
      id: input.id || crypto.randomUUID(),
      user_id: input.userId,
      swarm_name: input.swarmName,
      title: input.title,
      brief: input.brief,
      status: input.status || "queued",
      preview_url: null,
      sandbox_id: null,
      created_at: now,
      updated_at: now,
    };
    this.rows.set(row.id, row);
    return mapProject(row);
  }

  updatePreview(
    projectId: string,
    patch: { previewUrl?: string | null; sandboxId?: string | null; status?: string },
  ): PlatformProject {
    const row = this.rows.get(projectId);
    if (!row) throw new Error("Project not found");
    if (patch.previewUrl !== undefined) row.preview_url = patch.previewUrl;
    if (patch.sandboxId !== undefined) row.sandbox_id = patch.sandboxId;
    if (patch.status !== undefined) row.status = patch.status;
    row.updated_at = new Date().toISOString();
    return mapProject(row);
  }
}

export const memoryStore = new MemoryProjectStore();
