<?php

namespace App\Support\Edition;

use App\Enums\Layer;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\TranscriptionSegment;

/**
 * Adds one witness segment's passage to an edition — materializing it if
 * needed and recording its place in this edition's own order. Shared by
 * EditionPassageController's single and bulk add actions; the only
 * difference between them is which segments get looped through and in what
 * order.
 *
 * Deliberately never selects anything (no EditionLemma rows) — the base
 * transcription's own wording already renders by default for an undecided
 * column (see EditionController::materializedSingleRun's fallback), and a
 * lemma with genuine disagreement among the witnesses aligned here must stay
 * undecided so it's still flagged for editorial review (see
 * EditionController::hasVariation/runClasses) — auto-selecting would
 * silently mark every word "decided" the instant it's added, suppressing
 * that flag even where witnesses actually disagree.
 */
class PassageAdder
{
    /**
     * Always aligns the segment's own transcription into the passage's
     * shared collation, even if this specific edition already has the
     * passage from a different transcription — a bulk "base a range" add
     * can legitimately re-encounter a passage another transcription already
     * claimed for this edition, and that transcription's own reading still
     * belongs in the apparatus as a candidate, even though it won't be this
     * edition's default there. Only the EditionPassage part — this
     * edition's own scope and order — is skipped (returns null) once the
     * passage is already in this edition, from any source.
     *
     * A freshly added passage also gets its lineation seeded from the
     * segment's layer (`$lineation` carries the between-passage flags the
     * caller derived from the previous segment in its batch; within-passage
     * breaks come from the layer's own newlines) — a one-time copy the
     * edition owns from then on, see LineationSeeder.
     *
     * @param  array{starts_new_line?: bool, starts_new_paragraph?: bool}  $lineation
     */
    public static function add(Edition $edition, TranscriptionSegment $segment, float $position, array $lineation = []): ?EditionPassage
    {
        $passage = $segment->canonicalPassage;

        self::materialize($passage);

        $alreadyAdded = EditionPassage::where('edition_id', $edition->id)
            ->where('canonical_passage_id', $passage->id)
            ->exists();

        if ($alreadyAdded) {
            return null;
        }

        $editionPassage = EditionPassage::create([
            'edition_id' => $edition->id,
            'canonical_passage_id' => $passage->id,
            'transcription_layer_id' => $segment->transcription_layer_id,
            'position' => $position,
            ...$lineation,
        ]);

        LineationSeeder::seedWithinPassage($editionPassage, $segment->transcriptionLayer);

        return $editionPassage;
    }

    /**
     * Where a newly added segment lands in the printed order: after the
     * last passage already in the edition that precedes it in its own
     * witness's physical order — so a line added late still stands where
     * the manuscript has it, and adding never creates an arrangement that
     * needs a transposition conjecture (user decision, replacing "append
     * at the end"). A witness sharing no passage with the edition yet goes
     * by citation order. The position returned is fractional; the caller
     * renumbers the edition once its batch is in
     * (PassageOrderRewriter::renumberEdition).
     */
    public static function insertionPosition(Edition $edition, TranscriptionSegment $segment): float
    {
        $rows = EditionPassage::where('edition_id', $edition->id)
            ->with('canonicalPassage:id,sort_key')
            ->orderBy('position')
            ->get();

        if ($rows->isEmpty()) {
            return 1.0;
        }

        $lastPositionOf = fn (int $passageId): float => (float) $rows
            ->where('canonical_passage_id', $passageId)
            ->max(fn (EditionPassage $row) => (float) $row->position);
        $firstPositionOf = fn (int $passageId): float => (float) $rows
            ->where('canonical_passage_id', $passageId)
            ->min(fn (EditionPassage $row) => (float) $row->position);

        $offsets = TranscriptionSegment::where('transcription_layer_id', $segment->transcription_layer_id)
            ->whereIn('canonical_passage_id', $rows->pluck('canonical_passage_id')->unique())
            ->get()
            ->groupBy('canonical_passage_id')
            ->map(fn ($group) => (int) $group->min('start_offset'));

        $preceding = $offsets->filter(fn (int $offset) => $offset < $segment->start_offset);

        if ($preceding->isNotEmpty()) {
            return $lastPositionOf((int) $preceding->sortDesc()->keys()->first()) + 0.5;
        }

        $following = $offsets->filter(fn (int $offset) => $offset > $segment->start_offset);

        if ($following->isNotEmpty()) {
            return $firstPositionOf((int) $following->sort()->keys()->first()) - 0.5;
        }

        $sortKey = $segment->canonicalPassage->sort_key;
        $before = $rows
            ->filter(fn (EditionPassage $row) => $row->canonicalPassage->sort_key < $sortKey)
            ->sortByDesc(fn (EditionPassage $row) => $row->canonicalPassage->sort_key)
            ->first();

        if ($before !== null) {
            return $lastPositionOf((int) $before->canonical_passage_id) + 0.5;
        }

        return (float) $rows->first()->position - 0.5;
    }

    /**
     * Hand every witness currently citing this passage to the collator — not
     * just the one being added, and not only on first touch, so a witness
     * whose segment was cited *after* this passage was first materialized
     * (by this edition or another) still gets picked up. PassageAligner
     * decides from there whether to rebuild the columns or append to them;
     * the added segment gets no special standing, since letting it seed the
     * structure was itself a source of order-dependence.
     *
     * Restricted to the normalized layer (see Layer). A witness's
     * diplomatic and normalized transcriptions cite the same passages — fork
     * copies the citation segments verbatim — so without this filter both
     * would align as if they were independent witnesses, and a manuscript
     * would appear in its own apparatus disagreeing with itself over exactly
     * the orthography the normalized layer regularized.
     */
    private static function materialize(CanonicalPassage $passage): void
    {
        PassageAligner::collate(
            $passage,
            TranscriptionSegment::where('canonical_passage_id', $passage->id)
                ->whereRelation('transcriptionLayer', 'layer', Layer::Normalized)
                ->with('transcriptionLayer.transcription.witness:id,siglum')
                ->get(),
        );
    }
}
