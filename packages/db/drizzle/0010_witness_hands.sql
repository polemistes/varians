-- Hands become a list of labelled hands; a free text written before is kept in the description.
UPDATE "witnesses" SET "description" = CASE WHEN "description" IS NULL OR btrim("description") = '' THEN 'Hands: ' || btrim("hands") ELSE "description" || E'\n\nHands: ' || btrim("hands") END WHERE "hands" IS NOT NULL AND btrim("hands") <> '';--> statement-breakpoint
ALTER TABLE "witnesses" ALTER COLUMN "hands" SET DATA TYPE jsonb USING '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "witnesses" ALTER COLUMN "hands" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "witnesses" ALTER COLUMN "hands" SET NOT NULL;
