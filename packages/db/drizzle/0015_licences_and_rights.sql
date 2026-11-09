ALTER TABLE "editions" ADD COLUMN "licence_id" text;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "rights_note" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "rights" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "attribution" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "image_source" text;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "licence_id" text;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "rights_note" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "image_rights" text;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "image_attribution" text;--> statement-breakpoint
-- The free-text licence becomes a note on rights; the licence proper is fixed at the next publication (PLAN-2 D3).
UPDATE "transcriptions" SET "rights_note" = "licence" WHERE "licence" IS NOT NULL AND btrim("licence") <> '';
--> statement-breakpoint
UPDATE "editions" SET "rights_note" = "licence" WHERE "licence" IS NOT NULL AND btrim("licence") <> '';
