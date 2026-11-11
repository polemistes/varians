ALTER TABLE "works" DROP COLUMN "visibility";--> statement-breakpoint
-- Every work is public now. Each work's archive is written again, so that its work.json no longer says a work was private.
INSERT INTO "archive_queue" ("kind", "record_id") SELECT 'work-all', "id" FROM "works" ON CONFLICT DO NOTHING;
