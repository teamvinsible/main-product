ALTER TABLE "project_history" ADD COLUMN "tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_history" ADD COLUMN "doubts" integer;--> statement-breakpoint
ALTER TABLE "project_history" ADD COLUMN "errors" integer;--> statement-breakpoint
ALTER TABLE "project_history" ADD COLUMN "completed_at" timestamp with time zone;