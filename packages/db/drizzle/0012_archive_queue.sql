CREATE TABLE "archive_queue" (
	"kind" text NOT NULL,
	"record_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_queue_kind_record_id_pk" PRIMARY KEY("kind","record_id")
);
--> statement-breakpoint
CREATE INDEX "archive_queue_at_idx" ON "archive_queue" USING btree ("at");--> statement-breakpoint
-- Every change to an archived table marks the record whose archive files it changes (PLAN-2 A3).
CREATE OR REPLACE FUNCTION varians_archive_mark(k text, rid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF rid IS NULL THEN RETURN; END IF;
  INSERT INTO archive_queue (kind, record_id, at) VALUES (k, rid, now())
  ON CONFLICT (kind, record_id) DO UPDATE SET at = excluded.at;
END $$;
--> statement-breakpoint
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
    WHEN 'changesets', 'moments', 'review_state' THEN PERFORM varians_archive_mark(j->>'document_kind', j->>'document_id');
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
CREATE OR REPLACE FUNCTION varians_archive_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM varians_archive_row(TG_TABLE_NAME, to_jsonb(OLD)); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM varians_archive_row(TG_TABLE_NAME, to_jsonb(NEW)); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['works', 'segments', 'reference_schemes', 'work_maintainers', 'transcription_segments', 'conjectures', 'reported_readings',
    'witnesses', 'witness_maintainers', 'pages', 'bibliography_items', 'transcriptions', 'zones', 'transcription_works', 'editions', 'edition_sigla',
    'edition_adoptions', 'edition_site_reviews', 'edition_site_kinds', 'alignment_constraints', 'notes', 'edition_collaborators', 'changesets', 'moments',
    'review_state', 'citations']
  LOOP
    EXECUTE format('CREATE TRIGGER varians_archive AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION varians_archive_trigger()', t);
  END LOOP;
END $$;
