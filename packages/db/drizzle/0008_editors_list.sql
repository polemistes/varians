-- The editors of an edition become a list of names. An existing string is kept as one name.
ALTER TABLE "editions" ALTER COLUMN "editors" SET DATA TYPE jsonb USING CASE WHEN "editors" IS NULL OR btrim("editors") = '' THEN '[]'::jsonb ELSE jsonb_build_array(btrim("editors")) END;--> statement-breakpoint
ALTER TABLE "editions" ALTER COLUMN "editors" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "editions" ALTER COLUMN "editors" SET NOT NULL;--> statement-breakpoint
UPDATE "editions" SET "copied_from" = jsonb_set("copied_from", '{editors}', CASE WHEN "copied_from"->>'editors' IS NULL OR btrim("copied_from"->>'editors') = '' THEN '[]'::jsonb ELSE jsonb_build_array(btrim("copied_from"->>'editors')) END) WHERE "copied_from" IS NOT NULL AND jsonb_typeof("copied_from"->'editors') IS DISTINCT FROM 'array';
