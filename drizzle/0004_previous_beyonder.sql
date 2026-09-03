ALTER TABLE "favorite" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "favorite" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;