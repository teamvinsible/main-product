CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"role" text NOT NULL,
	"phase" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"prompt_sent" text,
	"full_output" text,
	"success" boolean,
	"error" text,
	"artifacts_created" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"doubts_raised" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"tokens_saved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overall_score" double precision DEFAULT 0 NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learnings" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"insight" text NOT NULL,
	"context" text,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"source" text,
	"project_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"agent" text,
	"phase" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "project_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"idea" text,
	"success" boolean,
	"phases" integer,
	"artifacts" integer,
	"learnings_extracted" integer,
	"total_duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"name" text PRIMARY KEY NOT NULL,
	"idea" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"current_phase" text,
	"completed_phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_agents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"doubts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_runs_project_idx" ON "agent_runs" USING btree ("project","started_at");--> statement-breakpoint
CREATE INDEX "evals_project_idx" ON "evals" USING btree ("project","created_at");--> statement-breakpoint
CREATE INDEX "learnings_category_idx" ON "learnings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "logs_project_ts_idx" ON "logs" USING btree ("project","ts");--> statement-breakpoint
CREATE INDEX "logs_level_idx" ON "logs" USING btree ("project","level");