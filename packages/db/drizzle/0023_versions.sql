-- A transcription and an edition have versions, a table of their own, and no status: a record is public where it has a version that is not withdrawn. The publications made before are not carried over: every record starts with no version, its published moments staying in its history as moments.
CREATE TABLE "versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" text NOT NULL,
	"number" integer NOT NULL,
	"version" integer NOT NULL,
	"moment_id" text,
	"note" text,
	"created_by" text,
	"person_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"withdrawal_note" text,
	"snapshot" jsonb NOT NULL,
	"changes" jsonb NOT NULL
);
--> statement-breakpoint
-- The collation cache keeps the rows of each version apart from the draft's (0), so that the two never share rows.
ALTER TABLE "collation_cache" ADD COLUMN "version_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collation_cache" DROP CONSTRAINT "collation_cache_edition_id_segment_id_pk";--> statement-breakpoint
ALTER TABLE "collation_cache" ADD CONSTRAINT "collation_cache_edition_id_version_number_segment_id_pk" PRIMARY KEY("edition_id","version_number","segment_id");--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_withdrawn_by_persons_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "versions_document_number_idx" ON "versions" USING btree ("document_kind","document_id","number");--> statement-breakpoint
ALTER TABLE "editions" DROP COLUMN "visibility";--> statement-breakpoint
ALTER TABLE "editions" DROP COLUMN "published_version";--> statement-breakpoint
ALTER TABLE "moments" DROP COLUMN "number";--> statement-breakpoint
ALTER TABLE "moments" DROP COLUMN "basis";--> statement-breakpoint
ALTER TABLE "transcriptions" DROP COLUMN "visibility";--> statement-breakpoint
-- A version names its account and gets the account's person, as a moment does.
CREATE OR REPLACE FUNCTION varians_fill_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account text;
BEGIN
  account := to_jsonb(NEW) ->> (CASE TG_TABLE_NAME WHEN 'changesets' THEN 'user_id' WHEN 'moments' THEN 'created_by' WHEN 'versions' THEN 'created_by' ELSE 'author_id' END);
  IF NEW.person_id IS NULL AND account IS NOT NULL THEN
    NEW.person_id := (SELECT id FROM persons WHERE user_id = account);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER varians_fill_person BEFORE INSERT ON versions FOR EACH ROW EXECUTE FUNCTION varians_fill_person();
--> statement-breakpoint
-- A version, made or withdrawn, marks its document's archive files, as a moment does.
CREATE OR REPLACE FUNCTION varians_archive_row(tbl text, j jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF j IS NULL THEN RETURN; END IF;
  CASE tbl
    WHEN 'works' THEN PERFORM varians_archive_mark('work-all', j->>'id');
    WHEN 'segments' THEN PERFORM varians_archive_mark('work-all', j->>'work_id');
    WHEN 'reference_schemes' THEN PERFORM varians_archive_mark('scheme', j->>'id');
    WHEN 'work_maintainers', 'transcription_segments' THEN PERFORM varians_archive_mark('work', j->>'work_id');
    WHEN 'conjectures', 'reported_readings' THEN PERFORM varians_archive_mark('work-editions', j->>'work_id');
    WHEN 'witnesses' THEN PERFORM varians_archive_mark('witness', j->>'id');
    WHEN 'witness_maintainers', 'pages' THEN PERFORM varians_archive_mark('witness', j->>'witness_id');
    WHEN 'bibliography_items' THEN PERFORM varians_archive_mark('bibliography', j->>'id');
    WHEN 'transcriptions' THEN PERFORM varians_archive_mark('transcription', j->>'id');
    WHEN 'zones' THEN PERFORM varians_archive_mark('transcription', j->>'transcription_id');
    WHEN 'transcription_works' THEN
      PERFORM varians_archive_mark('transcription', j->>'transcription_id');
      PERFORM varians_archive_mark('work', j->>'work_id');
    WHEN 'editions' THEN PERFORM varians_archive_mark('edition', j->>'id');
    WHEN 'edition_sigla', 'edition_adoptions', 'edition_site_reviews', 'edition_site_kinds', 'alignment_constraints', 'notes', 'edition_collaborators' THEN
      PERFORM varians_archive_mark('edition', j->>'edition_id');
    WHEN 'persons' THEN PERFORM varians_archive_mark('person', j->>'id');
    WHEN 'changesets', 'moments', 'review_state', 'versions' THEN PERFORM varians_archive_mark(j->>'document_kind', j->>'document_id');
    WHEN 'citations' THEN
      PERFORM varians_archive_mark('edition', j->>'edition_id');
      PERFORM varians_archive_mark('edition', (SELECT edition_id FROM notes WHERE id = j->>'note_id'));
      PERFORM varians_archive_mark('work-editions', (SELECT work_id FROM conjectures WHERE id = j->>'conjecture_id'));
      PERFORM varians_archive_mark('work-editions', (SELECT work_id FROM reported_readings WHERE id = j->>'reported_reading_id'));
      PERFORM varians_archive_mark('work', (SELECT work_id FROM segments WHERE id = j->>'segment_id'));
    ELSE NULL;
  END CASE;
END $$;
--> statement-breakpoint
CREATE TRIGGER varians_archive AFTER INSERT OR UPDATE OR DELETE ON versions FOR EACH ROW EXECUTE FUNCTION varians_archive_trigger();
--> statement-breakpoint
-- Every work's archive is written again: transcription.json and edition.json without visibility or publishedVersion, moments without number or basis, and versions.json for the versions made from now on.
INSERT INTO "archive_queue" ("kind", "record_id") SELECT 'work-all', "id" FROM "works" ON CONFLICT DO NOTHING;
