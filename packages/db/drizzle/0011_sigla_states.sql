-- The state before correction becomes one of several states a siglum may collate.
ALTER TABLE "edition_sigla" ADD COLUMN "states" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "edition_sigla" SET "states" = jsonb_build_array(jsonb_build_object('kind', 'original', 'siglum', "original_siglum")) WHERE "original_siglum" IS NOT NULL AND btrim("original_siglum") <> '';--> statement-breakpoint
ALTER TABLE "edition_sigla" DROP COLUMN "original_siglum";
