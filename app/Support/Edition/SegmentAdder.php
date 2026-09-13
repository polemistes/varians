<?php

namespace App\Support\Edition;

use App\Enums\Layer;
use App\Models\Assignment;
use App\Models\Segment;
use App\Models\Edition;
use App\Models\EditionSegment;

/**
 * Adds one witness assignment's segment to an edition — materializing it if
 * needed and recording its place in this edition's own order. Shared by
 * EditionSegmentController's single and bulk add actions; the only
 * difference between them is which assignments get looped through and in what
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
class SegmentAdder
{
    /**
     * Always aligns the assignment's own transcription into the segment's
     * shared collation, even if this specific edition already has the
     * segment from a different transcription — a bulk "base a range" add
     * can legitimately re-encounter a segment another transcription already
     * claimed for this edition, and that transcription's own reading still
     * belongs in the apparatus as a candidate, even though it won't be this
     * edition's default there. Only the EditionSegment part — this
     * edition's own scope and order — is skipped (returns null) once the
     * segment is already in this edition, from any source.
     *
     * A freshly added segment also gets its lineation seeded from the
     * assignment's layer (`$lineation` carries the between-segment flags the
     * caller derived from the previous assignment in its batch; within-segment
     * breaks come from the layer's own newlines) — a one-time copy the
     * edition owns from then on, see LineationSeeder.
     *
     * @param  array{starts_new_line?: bool, starts_new_paragraph?: bool}  $lineation
     */
    public static function add(Edition $edition, Assignment $assignment, float $position, array $lineation = []): ?EditionSegment
    {
        $segment = $assignment->segment;

        self::materialize($segment);

        $alreadyAdded = EditionSegment::where('edition_id', $edition->id)
            ->where('segment_id', $segment->id)
            ->exists();

        if ($alreadyAdded) {
            return null;
        }

        $editionSegment = EditionSegment::create([
            'edition_id' => $edition->id,
            'segment_id' => $segment->id,
            'transcription_layer_id' => $assignment->transcription_layer_id,
            'position' => $position,
            ...$lineation,
        ]);

        LineationSeeder::seedWithinSegment($editionSegment, $assignment->transcriptionLayer);

        return $editionSegment;
    }

    /**
     * Where a newly added assignment lands in the printed order: after the
     * last segment already in the edition that precedes it in its own
     * witness's physical order — so a line added late still stands where
     * the manuscript has it, and adding never creates an arrangement that
     * needs a transposition conjecture (user decision, replacing "append
     * at the end"). A witness sharing no segment with the edition yet goes
     * by numbering order. The position returned is fractional; the caller
     * renumbers the edition once its batch is in
     * (SegmentOrderRewriter::renumberEdition).
     */
    public static function insertionPosition(Edition $edition, Assignment $assignment): float
    {
        $rows = EditionSegment::where('edition_id', $edition->id)
            ->with('segment:id,sort_key')
            ->orderBy('position')
            ->get();

        if ($rows->isEmpty()) {
            return 1.0;
        }

        $lastPositionOf = fn (int $segmentId): float => (float) $rows
            ->where('segment_id', $segmentId)
            ->max(fn (EditionSegment $row) => (float) $row->position);
        $firstPositionOf = fn (int $segmentId): float => (float) $rows
            ->where('segment_id', $segmentId)
            ->min(fn (EditionSegment $row) => (float) $row->position);

        $offsets = Assignment::where('transcription_layer_id', $assignment->transcription_layer_id)
            ->whereIn('segment_id', $rows->pluck('segment_id')->unique())
            ->get()
            ->groupBy('segment_id')
            ->map(fn ($group) => (int) $group->min('start_offset'));

        $preceding = $offsets->filter(fn (int $offset) => $offset < $assignment->start_offset);

        if ($preceding->isNotEmpty()) {
            return $lastPositionOf((int) $preceding->sortDesc()->keys()->first()) + 0.5;
        }

        $following = $offsets->filter(fn (int $offset) => $offset > $assignment->start_offset);

        if ($following->isNotEmpty()) {
            return $firstPositionOf((int) $following->sort()->keys()->first()) - 0.5;
        }

        $sortKey = $assignment->segment->sort_key;
        $before = $rows
            ->filter(fn (EditionSegment $row) => $row->segment->sort_key < $sortKey)
            ->sortByDesc(fn (EditionSegment $row) => $row->segment->sort_key)
            ->first();

        if ($before !== null) {
            return $lastPositionOf((int) $before->segment_id) + 0.5;
        }

        return (float) $rows->first()->position - 0.5;
    }

    /**
     * Hand every witness currently assigning text to this segment to the collator — not
     * just the one being added, and not only on first touch, so a witness
     * whose assignment was assigned *after* this segment was first materialized
     * (by this edition or another) still gets picked up. SegmentAligner
     * decides from there whether to rebuild the columns or append to them;
     * the added assignment gets no special standing, since letting it seed the
     * structure was itself a source of order-dependence.
     *
     * Restricted to the normalized layer (see Layer). A witness's
     * diplomatic and normalized transcriptions assign the same segments — fork
     * copies the assignment assignments verbatim — so without this filter both
     * would align as if they were independent witnesses, and a manuscript
     * would appear in its own apparatus disagreeing with itself over exactly
     * the orthography the normalized layer regularized.
     */
    private static function materialize(Segment $segment): void
    {
        SegmentAligner::collate(
            $segment,
            Assignment::where('segment_id', $segment->id)
                ->whereRelation('transcriptionLayer', 'layer', Layer::Normalized)
                ->with('transcriptionLayer.transcription.witness:id,siglum')
                ->get(),
        );
    }
}
