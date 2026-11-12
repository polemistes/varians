DROP TABLE "transcription_works" CASCADE;--> statement-breakpoint
-- A transcription's works are those its text is assigned to, and no longer those its owner chose it for. Each work's archive is written again, so that no transcription.json goes on giving workIds and a transcription only chosen for a work leaves that work's archive.
INSERT INTO "archive_queue" ("kind", "record_id") SELECT 'work-all', "id" FROM "works" ON CONFLICT DO NOTHING;
