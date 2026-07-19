-- Published apps (Workers for Platforms / R2 edge)

CREATE TABLE IF NOT EXISTS cf_publishes (
  slug TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  swarm_name TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS cf_publishes_project_idx ON cf_publishes (project_id);
