CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"project_name" text DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_scope_project_key_idx" ON "prompts" USING btree ("scope","project_name","key");