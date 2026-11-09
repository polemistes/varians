-- The fragments flag goes; the material becomes a list of keys, with a free text for other materials.
ALTER TABLE "witnesses" DROP COLUMN "fragmentary";--> statement-breakpoint
UPDATE "witnesses" SET "material" = lower(btrim("material")) WHERE lower(btrim("material")) IN ('papyrus','parchment','paper','leather','wood','ostracon','clay','stone','metal','textile','plaster');--> statement-breakpoint
UPDATE "witnesses" SET "material" = 'parchment' WHERE lower(btrim("material")) = 'vellum';--> statement-breakpoint
UPDATE "witnesses" SET "material" = 'palm-leaf' WHERE lower(btrim("material")) IN ('palm leaf','palm-leaf','palmleaf');--> statement-breakpoint
UPDATE "witnesses" SET "material" = 'birch-bark' WHERE lower(btrim("material")) IN ('birch bark','birch-bark','birchbark');--> statement-breakpoint
UPDATE "witnesses" SET "material" = 'wax-tablet' WHERE lower(btrim("material")) IN ('wax tablet','wax-tablet','wax');--> statement-breakpoint
UPDATE "witnesses" SET "material" = 'bone' WHERE lower(btrim("material")) IN ('bone','ivory','bone or ivory');
