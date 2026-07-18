CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"run_id" uuid,
	"role" text NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"text" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_project_idx" ON "chat_messages" USING btree ("project","created_at");