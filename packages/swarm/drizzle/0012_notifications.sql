CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"run_id" uuid,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_project_created_idx" ON "notifications" USING btree ("project","created_at");
--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("read_at","created_at");
