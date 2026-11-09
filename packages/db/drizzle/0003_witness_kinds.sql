ALTER TABLE "edition_sigla" ADD COLUMN "variant_siglum" text;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "fragmentary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "source_author" text;--> statement-breakpoint
ALTER TABLE "witnesses" ADD COLUMN "source_work" text;--> statement-breakpoint
-- A papyrus is a manuscript whose material is papyrus.
UPDATE "witnesses" SET "category" = 'manuscript', "material" = COALESCE(NULLIF("material", ''), 'papyrus') WHERE "category" = 'papyrus';
