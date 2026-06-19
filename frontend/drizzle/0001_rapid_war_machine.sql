ALTER TABLE "settings" ADD COLUMN "cache_time" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "pipeline_frequency" integer DEFAULT 30 NOT NULL;