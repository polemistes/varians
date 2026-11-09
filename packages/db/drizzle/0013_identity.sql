CREATE TABLE "persons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"orcid" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_merges" (
	"old_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"survivor_id" text NOT NULL,
	"label" text NOT NULL,
	"merged_by" text,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changesets" ALTER COLUMN "version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "changesets" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "changesets" ADD COLUMN "merged" jsonb;--> statement-breakpoint
ALTER TABLE "changesets" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_merges" ADD CONSTRAINT "registry_merges_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persons_orcid_idx" ON "persons" USING btree ("orcid") WHERE "persons"."orcid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "persons_user_idx" ON "persons" USING btree ("user_id") WHERE "persons"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "registry_merges_survivor_idx" ON "registry_merges" USING btree ("survivor_id");--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changesets_parent_idx" ON "changesets" USING btree ("parent_id");--> statement-breakpoint
-- Every account is a person, under the account's id (PLAN-2 C1).
INSERT INTO "persons" ("id", "name", "user_id", "created_at") SELECT "id", "name", "id", "created_at" FROM "users" ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Authorship points at persons (C2): the authors so far are the accounts' persons.
UPDATE "changesets" SET "person_id" = "user_id" WHERE "user_id" IS NOT NULL AND "person_id" IS NULL;
--> statement-breakpoint
UPDATE "moments" SET "person_id" = "created_by" WHERE "created_by" IS NOT NULL AND "person_id" IS NULL;
--> statement-breakpoint
UPDATE "notes" SET "person_id" = "author_id" WHERE "author_id" IS NOT NULL AND "person_id" IS NULL;
--> statement-breakpoint
-- Each changeset names its parent (C5): the one before it in the document's order.
UPDATE "changesets" AS c SET "parent_id" = p."prev"
FROM (SELECT "id", lag("id") OVER (PARTITION BY "document_kind", "document_id" ORDER BY "version") AS "prev" FROM "changesets") AS p
WHERE c."id" = p."id" AND p."prev" IS NOT NULL AND c."parent_id" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION varians_person_of_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO persons (id, name, user_id) VALUES (NEW.id, NEW.name, NEW.id)
    ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id WHERE persons.user_id IS NULL;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE persons SET name = NEW.name WHERE user_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER varians_person AFTER INSERT OR UPDATE OF name ON users FOR EACH ROW EXECUTE FUNCTION varians_person_of_account();
--> statement-breakpoint
-- Writes that name an account and no person get the account's person; a changeset with a version and no parent gets the one before it.
CREATE OR REPLACE FUNCTION varians_fill_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account text;
BEGIN
  account := to_jsonb(NEW) ->> (CASE TG_TABLE_NAME WHEN 'changesets' THEN 'user_id' WHEN 'moments' THEN 'created_by' ELSE 'author_id' END);
  IF NEW.person_id IS NULL AND account IS NOT NULL THEN
    NEW.person_id := (SELECT id FROM persons WHERE user_id = account);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER varians_fill_person BEFORE INSERT ON changesets FOR EACH ROW EXECUTE FUNCTION varians_fill_person();
--> statement-breakpoint
CREATE TRIGGER varians_fill_person BEFORE INSERT ON moments FOR EACH ROW EXECUTE FUNCTION varians_fill_person();
--> statement-breakpoint
CREATE TRIGGER varians_fill_person BEFORE INSERT ON notes FOR EACH ROW EXECUTE FUNCTION varians_fill_person();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION varians_fill_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL AND NEW.version IS NOT NULL AND NEW.version > 1 THEN
    NEW.parent_id := (SELECT id FROM changesets WHERE document_kind = NEW.document_kind AND document_id = NEW.document_id AND version = NEW.version - 1);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER varians_fill_parent BEFORE INSERT ON changesets FOR EACH ROW EXECUTE FUNCTION varians_fill_parent();
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
    WHEN 'persons' THEN PERFORM varians_archive_mark('person', j->>'id');
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
CREATE TRIGGER varians_archive AFTER INSERT OR UPDATE OR DELETE ON persons FOR EACH ROW EXECUTE FUNCTION varians_archive_trigger();
