CREATE TABLE "alignment_constraints" (
	"id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"base_token_ids" jsonb NOT NULL,
	"transcription_id" text NOT NULL,
	"witness_token_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"commit_hash" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bibliography_items" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_type" text NOT NULL,
	"citation_key" text NOT NULL,
	"fields" jsonb NOT NULL,
	"label" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changesets" (
	"id" text PRIMARY KEY NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"user_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ops" jsonb NOT NULL,
	"reverse" jsonb NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"document_kind" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_document_kind_document_id_version_pk" PRIMARY KEY("document_kind","document_id","version")
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"conjecture_id" text,
	"reported_reading_id" text,
	"note_id" text,
	"edition_id" text,
	"segment_id" text,
	"prenote" text,
	"postnote" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collation_cache" (
	"edition_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collation_cache_edition_id_segment_id_pk" PRIMARY KEY("edition_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "conjectures" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"kind" text DEFAULT 'substitution' NOT NULL,
	"lemma" text DEFAULT '' NOT NULL,
	"reading" text DEFAULT '' NOT NULL,
	"extent" text,
	"proposer" text,
	"note" text,
	"sequence" jsonb,
	"supplements_id" text,
	"anchor" jsonb,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_adoptions" (
	"edition_id" text NOT NULL,
	"conjecture_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_adoptions_edition_id_conjecture_id_pk" PRIMARY KEY("edition_id","conjecture_id")
);
--> statement-breakpoint
CREATE TABLE "edition_collaborators" (
	"edition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_collaborators_edition_id_user_id_pk" PRIMARY KEY("edition_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "edition_sigla" (
	"edition_id" text NOT NULL,
	"witness_id" text NOT NULL,
	"transcription_id" text,
	"siglum" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"original_siglum" text,
	CONSTRAINT "edition_sigla_edition_id_witness_id_pk" PRIMARY KEY("edition_id","witness_id")
);
--> statement-breakpoint
CREATE TABLE "edition_site_reviews" (
	"edition_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"site_key" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_site_reviews_edition_id_segment_id_site_key_pk" PRIMARY KEY("edition_id","segment_id","site_key")
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"editors" text,
	"preface" text,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"content" jsonb DEFAULT '{"items":[]}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"published_version" integer,
	"conventions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moments" (
	"id" text PRIMARY KEY NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'named' NOT NULL,
	"number" integer,
	"created_by" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"token_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"record_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"witness_id" text NOT NULL,
	"label" text NOT NULL,
	"position" double precision NOT NULL,
	"image_kind" text,
	"image_path" text,
	"image_iiif" text,
	"image_width" integer,
	"image_height" integer,
	"tiles_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_schemes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"levels" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reported_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"witness_id" text NOT NULL,
	"lemma" text DEFAULT '' NOT NULL,
	"reading" text DEFAULT '' NOT NULL,
	"source" text,
	"note" text,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_state" (
	"document_kind" text NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"from_version" integer DEFAULT 0 NOT NULL,
	"accepted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_state_document_kind_document_id_user_id_pk" PRIMARY KEY("document_kind","document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"address" jsonb NOT NULL,
	"label" text NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_segments" (
	"transcription_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"work_id" text NOT NULL,
	"part" integer DEFAULT 1 NOT NULL,
	"first_item_id" text NOT NULL,
	"unit_count" integer NOT NULL,
	"fold_text" text NOT NULL,
	CONSTRAINT "transcription_segments_transcription_id_segment_id_part_pk" PRIMARY KEY("transcription_id","segment_id","part")
);
--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"witness_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"content" jsonb DEFAULT '{"items":[]}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"keeps_written_form" boolean DEFAULT false NOT NULL,
	"display_as_written" boolean DEFAULT false NOT NULL,
	"profile" jsonb,
	"memory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "witness_maintainers" (
	"witness_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "witness_maintainers_witness_id_user_id_pk" PRIMARY KEY("witness_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "witnesses" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"siglum" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'manuscript' NOT NULL,
	"repository" text,
	"settlement" text,
	"shelfmark" text,
	"identifier" text,
	"date_text" text,
	"material" text,
	"extent" text,
	"hands" text,
	"provenance" text,
	"description" text,
	"iiif_manifest" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_maintainers" (
	"work_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_maintainers_work_id_user_id_pk" PRIMARY KEY("work_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"language" text DEFAULT 'grc' NOT NULL,
	"identifier" text,
	"description" text,
	"scheme_id" text NOT NULL,
	"profile" jsonb NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" text PRIMARY KEY NOT NULL,
	"transcription_id" text NOT NULL,
	"page_id" text NOT NULL,
	"token_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"geometry" jsonb NOT NULL,
	"feature" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alignment_constraints" ADD CONSTRAINT "alignment_constraints_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alignment_constraints" ADD CONSTRAINT "alignment_constraints_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alignment_constraints" ADD CONSTRAINT "alignment_constraints_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_commits" ADD CONSTRAINT "archive_commits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bibliography_items" ADD CONSTRAINT "bibliography_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_item_id_bibliography_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bibliography_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_conjecture_id_conjectures_id_fk" FOREIGN KEY ("conjecture_id") REFERENCES "public"."conjectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_reported_reading_id_reported_readings_id_fk" FOREIGN KEY ("reported_reading_id") REFERENCES "public"."reported_readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collation_cache" ADD CONSTRAINT "collation_cache_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collation_cache" ADD CONSTRAINT "collation_cache_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conjectures" ADD CONSTRAINT "conjectures_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conjectures" ADD CONSTRAINT "conjectures_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conjectures" ADD CONSTRAINT "conjectures_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_adoptions" ADD CONSTRAINT "edition_adoptions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_adoptions" ADD CONSTRAINT "edition_adoptions_conjecture_id_conjectures_id_fk" FOREIGN KEY ("conjecture_id") REFERENCES "public"."conjectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_collaborators" ADD CONSTRAINT "edition_collaborators_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_collaborators" ADD CONSTRAINT "edition_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_collaborators" ADD CONSTRAINT "edition_collaborators_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_sigla" ADD CONSTRAINT "edition_sigla_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_sigla" ADD CONSTRAINT "edition_sigla_witness_id_witnesses_id_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."witnesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_sigla" ADD CONSTRAINT "edition_sigla_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_site_reviews" ADD CONSTRAINT "edition_site_reviews_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_site_reviews" ADD CONSTRAINT "edition_site_reviews_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_site_reviews" ADD CONSTRAINT "edition_site_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_offers" ADD CONSTRAINT "ownership_offers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_offers" ADD CONSTRAINT "ownership_offers_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_witness_id_witnesses_id_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."witnesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_schemes" ADD CONSTRAINT "reference_schemes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_readings" ADD CONSTRAINT "reported_readings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_readings" ADD CONSTRAINT "reported_readings_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_readings" ADD CONSTRAINT "reported_readings_witness_id_witnesses_id_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."witnesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_readings" ADD CONSTRAINT "reported_readings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_state" ADD CONSTRAINT "review_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD CONSTRAINT "transcription_segments_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD CONSTRAINT "transcription_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD CONSTRAINT "transcription_segments_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_witness_id_witnesses_id_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."witnesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "witness_maintainers" ADD CONSTRAINT "witness_maintainers_witness_id_witnesses_id_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."witnesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "witness_maintainers" ADD CONSTRAINT "witness_maintainers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "witnesses" ADD CONSTRAINT "witnesses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_maintainers" ADD CONSTRAINT "work_maintainers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_maintainers" ADD CONSTRAINT "work_maintainers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_scheme_id_reference_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."reference_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alignment_constraints_edition_segment_idx" ON "alignment_constraints" USING btree ("edition_id","segment_id");--> statement-breakpoint
CREATE INDEX "archive_commits_work_idx" ON "archive_commits" USING btree ("work_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "bibliography_key_idx" ON "bibliography_items" USING btree ("citation_key");--> statement-breakpoint
CREATE INDEX "bibliography_label_idx" ON "bibliography_items" USING btree ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "changesets_document_version_idx" ON "changesets" USING btree ("document_kind","document_id","version");--> statement-breakpoint
CREATE INDEX "citations_item_idx" ON "citations" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "citations_conjecture_idx" ON "citations" USING btree ("conjecture_id");--> statement-breakpoint
CREATE INDEX "conjectures_segment_idx" ON "conjectures" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "conjectures_work_idx" ON "conjectures" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_slug_idx" ON "editions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "editions_work_idx" ON "editions" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "editions_owner_idx" ON "editions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "moments_document_idx" ON "moments" USING btree ("document_kind","document_id","version");--> statement-breakpoint
CREATE INDEX "notes_edition_segment_idx" ON "notes" USING btree ("edition_id","segment_id");--> statement-breakpoint
CREATE INDEX "ownership_offers_to_idx" ON "ownership_offers" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "pages_witness_idx" ON "pages" USING btree ("witness_id","position");--> statement-breakpoint
CREATE INDEX "reported_readings_segment_idx" ON "reported_readings" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "reported_readings_witness_idx" ON "reported_readings" USING btree ("witness_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_work_label_idx" ON "segments" USING btree ("work_id","label");--> statement-breakpoint
CREATE INDEX "segments_work_sort_idx" ON "segments" USING btree ("work_id","sort_key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transcription_segments_segment_idx" ON "transcription_segments" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "transcription_segments_work_idx" ON "transcription_segments" USING btree ("work_id","transcription_id");--> statement-breakpoint
CREATE INDEX "transcriptions_witness_idx" ON "transcriptions" USING btree ("witness_id");--> statement-breakpoint
CREATE INDEX "transcriptions_owner_idx" ON "transcriptions" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "witnesses_slug_idx" ON "witnesses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "witnesses_name_idx" ON "witnesses" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "works_slug_idx" ON "works" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "works_title_idx" ON "works" USING btree ("title");--> statement-breakpoint
CREATE INDEX "zones_transcription_page_idx" ON "zones" USING btree ("transcription_id","page_id");