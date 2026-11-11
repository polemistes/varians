ALTER TABLE "conjectures" DROP COLUMN "visibility";--> statement-breakpoint
ALTER TABLE "reported_readings" DROP COLUMN "visibility";--> statement-breakpoint
-- Every conjecture and reported reading is public now, drafts included. The files of each work that holds one are written again, so that no conjectures.json or reported-readings.json goes on saying a record was a draft.
INSERT INTO "archive_queue" ("kind", "record_id") SELECT 'work', "work_id" FROM "conjectures" UNION SELECT 'work', "work_id" FROM "reported_readings" ON CONFLICT DO NOTHING;
