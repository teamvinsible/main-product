ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deploy_provider" text NOT NULL DEFAULT '';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deploy_profile" text NOT NULL DEFAULT 'default';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deploy_target" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"run_id" uuid,
	"provider" text NOT NULL,
	"profile" text NOT NULL DEFAULT 'default',
	"status" text NOT NULL DEFAULT 'success',
	"url" text,
	"logs_url" text,
	"detail" text,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "deployments_project_idx" ON "deployments" ("project","created_at");
