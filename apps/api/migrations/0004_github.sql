-- GitHub OAuth account linking and repo tracking

CREATE TABLE IF NOT EXISTS cf_github_accounts (
  user_id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  access_token TEXT NOT NULL,
  scope TEXT,
  connected_at TEXT DEFAULT (datetime('now')),
  UNIQUE (github_id)
);

CREATE TABLE IF NOT EXISTS cf_github_repos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL UNIQUE,
  repo_full_name TEXT NOT NULL,
  repo_id INTEGER,
  html_url TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  last_pushed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Short-lived OAuth state tokens (10-min TTL enforced in code)
CREATE TABLE IF NOT EXISTS cf_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
