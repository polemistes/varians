CREATE TABLE "greek_forms" (
	"form_key" text PRIMARY KEY NOT NULL,
	"analyses" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lexicon_entries" (
	"id" integer PRIMARY KEY NOT NULL,
	"lexicon_id" text NOT NULL,
	"headword" text NOT NULL,
	"homograph" integer DEFAULT 0 NOT NULL,
	"lemma_key" text NOT NULL,
	"loose_key" text NOT NULL,
	"html" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lexicons" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"licence" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lexicon_entries" ADD CONSTRAINT "lexicon_entries_lexicon_id_lexicons_id_fk" FOREIGN KEY ("lexicon_id") REFERENCES "public"."lexicons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lexicon_entries_lemma_idx" ON "lexicon_entries" USING btree ("lemma_key");--> statement-breakpoint
CREATE INDEX "lexicon_entries_loose_idx" ON "lexicon_entries" USING btree ("loose_key");