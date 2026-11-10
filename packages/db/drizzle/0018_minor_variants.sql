ALTER TABLE "edition_site_kinds" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edition_site_kinds" ADD COLUMN "minor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A place left out of the apparatus (kind 'unreported') is a minor variant now, and has no kind of its own.
UPDATE "edition_site_kinds" SET "minor" = true, "kind" = NULL WHERE "kind" = 'unreported';
