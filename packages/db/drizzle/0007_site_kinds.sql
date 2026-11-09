CREATE TABLE "edition_site_kinds" (
	"edition_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"site_key" text NOT NULL,
	"kind" text NOT NULL,
	"set_by" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_site_kinds_edition_id_segment_id_site_key_pk" PRIMARY KEY("edition_id","segment_id","site_key")
);
--> statement-breakpoint
ALTER TABLE "edition_site_kinds" ADD CONSTRAINT "edition_site_kinds_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_site_kinds" ADD CONSTRAINT "edition_site_kinds_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_site_kinds" ADD CONSTRAINT "edition_site_kinds_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;