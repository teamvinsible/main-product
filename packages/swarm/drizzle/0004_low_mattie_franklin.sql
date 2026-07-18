CREATE TABLE "commits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"phase" text,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"html_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "commits_project_idx" ON "commits" USING btree ("project","created_at");