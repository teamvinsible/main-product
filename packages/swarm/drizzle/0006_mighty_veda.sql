CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"kind" text DEFAULT 'new-build' NOT NULL,
	"request" text DEFAULT '' NOT NULL,
	"flow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"current_phase" text,
	"completed_phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_agents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"doubts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branch" text,
	"base_commit" text,
	"pr_url" text,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "commits" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "evals" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "latest_run_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'new-build' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "request" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_project_idx" ON "runs" USING btree ("project","updated_at");