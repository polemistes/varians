-- Every word now carries its own language, `lang` on each token, and a work has none. Before the work's language goes, the words already stored are given it: an edition's words that of its work, a transcription's words that of the work of the first segment its text names, else Ancient Greek, which every work had unless set otherwise. A word that has a language keeps it; a word with a `foreign` mark takes the mark's language, and the mark goes, a stretch in another language being words of their own language. The order of the items is kept. The history (changesets, checkpoints) is not touched.
UPDATE "editions" AS e SET "content" = jsonb_set(e."content", '{items}', (
  SELECT coalesce(jsonb_agg(
    CASE WHEN t."item"->>'kind' IS DISTINCT FROM 'token' THEN t."item"
    ELSE (CASE WHEN m."foreign" IS NULL THEN t."item"
               WHEN m."rest" = '[]'::jsonb THEN t."item" - 'marks'
               ELSE jsonb_set(t."item", '{marks}', m."rest") END)
         || jsonb_build_object('lang', coalesce(t."item"->>'lang', m."foreign", w."language"))
    END ORDER BY t."ord"), '[]'::jsonb)
  FROM jsonb_array_elements(e."content"->'items') WITH ORDINALITY AS t("item", "ord")
  CROSS JOIN LATERAL (
    SELECT
      (SELECT mk->'attrs'->>'lang'
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."item"->'marks') = 'array' THEN t."item"->'marks' ELSE '[]'::jsonb END) AS mk
         WHERE mk->>'kind' = 'foreign' AND jsonb_typeof(mk->'attrs'->'lang') = 'string'
         LIMIT 1) AS "foreign",
      (SELECT coalesce(jsonb_agg(mk ORDER BY o), '[]'::jsonb)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."item"->'marks') = 'array' THEN t."item"->'marks' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(mk, o)
         WHERE mk->>'kind' IS DISTINCT FROM 'foreign') AS "rest"
  ) AS m
))
FROM "works" AS w
WHERE w."id" = e."work_id" AND jsonb_typeof(e."content"->'items') = 'array';
--> statement-breakpoint
UPDATE "transcriptions" AS tr SET "content" = jsonb_set(tr."content", '{items}', (
  SELECT coalesce(jsonb_agg(
    CASE WHEN t."item"->>'kind' IS DISTINCT FROM 'token' THEN t."item"
    ELSE (CASE WHEN m."foreign" IS NULL THEN t."item"
               WHEN m."rest" = '[]'::jsonb THEN t."item" - 'marks'
               ELSE jsonb_set(t."item", '{marks}', m."rest") END)
         || jsonb_build_object('lang', coalesce(t."item"->>'lang', m."foreign", fb."lang"))
    END ORDER BY t."ord"), '[]'::jsonb)
  FROM jsonb_array_elements(tr."content"->'items') WITH ORDINALITY AS t("item", "ord")
  CROSS JOIN LATERAL (
    SELECT
      (SELECT mk->'attrs'->>'lang'
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."item"->'marks') = 'array' THEN t."item"->'marks' ELSE '[]'::jsonb END) AS mk
         WHERE mk->>'kind' = 'foreign' AND jsonb_typeof(mk->'attrs'->'lang') = 'string'
         LIMIT 1) AS "foreign",
      (SELECT coalesce(jsonb_agg(mk ORDER BY o), '[]'::jsonb)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."item"->'marks') = 'array' THEN t."item"->'marks' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(mk, o)
         WHERE mk->>'kind' IS DISTINCT FROM 'foreign') AS "rest"
  ) AS m
))
FROM (
  SELECT tr2."id", coalesce((
    SELECT w."language"
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(tr2."content"->'items') = 'array' THEN tr2."content"->'items' ELSE '[]'::jsonb END) WITH ORDINALITY AS s("item", "ord")
      JOIN "segments" AS sg ON sg."id" = s."item"->'segment'->>'segmentId'
      JOIN "works" AS w ON w."id" = sg."work_id"
      ORDER BY s."ord"
      LIMIT 1
  ), 'grc') AS "lang"
  FROM "transcriptions" AS tr2
) AS fb
WHERE fb."id" = tr."id" AND jsonb_typeof(tr."content"->'items') = 'array';
--> statement-breakpoint
ALTER TABLE "transcriptions" DROP COLUMN "profile";--> statement-breakpoint
ALTER TABLE "works" DROP COLUMN "language";--> statement-breakpoint
ALTER TABLE "works" DROP COLUMN "profile";--> statement-breakpoint
-- Every work's archive is written again: work.json without a language or spelling rules, transcription.json without its adjustments to them, every token with its language, and the TEI with the language of each word.
INSERT INTO "archive_queue" ("kind", "record_id") SELECT 'work-all', "id" FROM "works" ON CONFLICT DO NOTHING;
