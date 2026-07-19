-- Ownership and durable in-app notifications.

ALTER TABLE cf_publishes ADD COLUMN user_id TEXT;
UPDATE cf_publishes
SET user_id = (SELECT user_id FROM cf_projects WHERE cf_projects.id = cf_publishes.project_id)
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS cf_publishes_user_idx ON cf_publishes (user_id);

CREATE TABLE IF NOT EXISTS cf_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES cf_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES cf_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cf_notifications_user_created_idx
  ON cf_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cf_notifications_unread_idx
  ON cf_notifications (user_id, read_at, created_at DESC);
