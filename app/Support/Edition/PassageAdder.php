<?php

namespace App\Support\Edition;

use App\Enums\TranscriptionLayer;
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
     */
    public static function add(Edition $edition, TranscriptionSegment $segment, float $position): ?EditionPassage
    {
        $passage = $segment->canonicalPassage;

        self::materialize($passage);

        $alreadyAdded = EditionPassage::where('edition_id', $edition->id)
            ->where('canonical_passage_id', $passage->id)
            ->exists();

        if ($alreadyAdded) {
            return null;
        }

        return EditionPassage::create([
            'edition_id' => $edition->id,
            'canonical_passage_id' => $passage->id,
            'transcription_id' => $segment->transcription_id,
            'position' => $position,
        ]);
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
     * Restricted to the normalized layer (see TranscriptionLayer). A witness's
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
                ->whereRelation('transcription', 'layer', TranscriptionLayer::Normalized)
                ->with('transcription.witness:id,siglum')
                ->get(),
        );
    }
}
