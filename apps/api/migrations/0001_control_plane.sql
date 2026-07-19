-- D1 schema for Cloudflare-native swarm control plane
-- Apply: wrangler d1 migrations apply teamvinsible --local

CREATE TABLE IF NOT EXISTS cf_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  swarm_name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  preview_url TEXT,
  sandbox_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS cf_projects_user_idx ON cf_projects (user_id);
CREATE INDEX IF NOT EXISTS cf_projects_updated_idx ON cf_projects (updated_at DESC);

CREATE TABLE IF NOT EXISTS cf_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idea TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  stage TEXT NOT NULL DEFAULT 'drafting',
  current_phase TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES cf_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cf_runs_project_idx ON cf_runs (project_id);

CREATE TABLE IF NOT EXISTS cf_activity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  message TEXT NOT NULL,
  kind TEXT,
  agent TEXT,
  phase TEXT
);

CREATE INDEX IF NOT EXISTS cf_activity_project_idx ON cf_activity (project_id, at DESC);

CREATE TABLE IF NOT EXISTS cf_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  owner TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'drafting',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, path)
);
