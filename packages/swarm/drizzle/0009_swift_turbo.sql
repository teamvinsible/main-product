CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"run_id" uuid,
	"agent" text NOT NULL,
	"phase" text NOT NULL,
	"kind" text DEFAULT 'input' NOT NULL,
	"question" text NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"suggestion" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "questions_project_status_idx" ON "questions" USING btree ("project","status");--> statement-breakpoint
CREATE INDEX "questions_run_idx" ON "questions" USING btree ("run_id");
