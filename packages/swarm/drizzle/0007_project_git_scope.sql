ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "repo_owner" text NOT NULL DEFAULT '';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "repo_name" text NOT NULL DEFAULT '';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "default_branch" text NOT NULL DEFAULT 'main';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "credential_profile" text NOT NULL DEFAULT 'default';
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "head_commit" text;
