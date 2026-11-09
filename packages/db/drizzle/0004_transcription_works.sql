CREATE TABLE "transcription_works" (
	"transcription_id" text NOT NULL,
	"work_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "transcription_works_transcription_id_work_id_pk" PRIMARY KEY("transcription_id","work_id")
);
--> statement-breakpoint
ALTER TABLE "transcriptions" DROP CONSTRAINT "transcriptions_work_id_works_id_fk";
--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "copied_from" jsonb;--> statement-breakpoint
ALTER TABLE "transcription_works" ADD CONSTRAINT "transcription_works_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_works" ADD CONSTRAINT "transcription_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcription_works_work_idx" ON "transcription_works" USING btree ("work_id");--> statement-breakpoint
-- Each transcription's work becomes the first of its works.
INSERT INTO "transcription_works" ("transcription_id", "work_id", "position")
  SELECT "id", "work_id", 0 FROM "transcriptions" WHERE "work_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" DROP COLUMN "work_id";