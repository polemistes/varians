<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\ApplyEditionOrderCandidateRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\TranscriptionSegment;
use App\Support\Edition\ArrangementAdopter;
use App\Support\Edition\PassageOrderRewriter;
use App\Support\Edition\TranspositionProjection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Applying another source's order to an edition's stored passage order.
 * Since the materialized-order redesign the positions ARE the printed
 * order; they change here, by following a candidate the order report
 * offers (a witness's own sequence, a catalogued conjecture, or plain
 * citation order), or through ConjectureOrderingController, where the
 * editor's own rearrangement is registered as a conjecture and followed.
 */
class EditionOrderController extends Controller
{
    /**
     * Apply one of the order report's candidates to its range: the named
     * source's own sequence replaces the range's current order. Applying a
     * catalogued conjecture also records the application as attribution
     * (EditionTransposition); a witness's or citation order needs none —
     * "matches witness B" is derivable and shown by the report itself.
     */
    public function applyCandidate(ApplyEditionOrderCandidateRequest $request, Edition $edition): RedirectResponse
    {
        $rangeIds = $this->rangePassageIds(
            $edition,
            (int) $request->validated('range_start_canonical_passage_id'),
            (int) $request->validated('range_end_canonical_passage_id'),
        );

        $sequence = $this->candidateSequence($request, $rangeIds);

        if ($sequence === null) {
            throw ValidationException::withMessages([
                'range_start_canonical_passage_id' => 'That source no longer orders exactly this range.',
            ]);
        }

        // A conjecture is adopted whole — pieces, divided lines and the
        // attribution record — by the adopter; a witness's or citation
        // order is a plain resequencing that needs no record.
        if ($request->validated('conjecture_id') !== null) {
            ArrangementAdopter::adopt($edition, Conjecture::findOrFail((int) $request->validated('conjecture_id')));

            return back();
        }

        DB::transaction(function () use ($edition, $sequence) {
            PassageOrderRewriter::applySequence($edition, $sequence);
        });

        return back();
    }

    /**
     * The block's member passages in stored (printed) order — membership
     * derived exactly like the report derives it: every passage of this
     * edition whose citation sort_key falls between the two endpoints,
     * inclusive. The block is contiguous in CITATION order (its endpoints
     * are citation-order first and last, see EditionController::orderRanges),
     * but its members may be scattered in the printed order, so locating a
     * printed slice between the endpoints would grab the wrong passages.
     *
     * @return list<int>
     */
    private function rangePassageIds(Edition $edition, int $startId, int $endId): array
    {
        $passages = EditionPassage::where('edition_id', $edition->id)
            ->with('canonicalPassage:id,sort_key')
            ->orderBy('position')
            ->get();

        $start = $passages->firstWhere('canonical_passage_id', $startId);
        $end = $passages->firstWhere('canonical_passage_id', $endId);

        if ($start === null || $end === null) {
            return [];
        }

        $from = min($start->canonicalPassage->sort_key, $end->canonicalPassage->sort_key);
        $to = max($start->canonicalPassage->sort_key, $end->canonicalPassage->sort_key);

        return array_values($passages
            ->filter(fn (EditionPassage $passage) => $passage->canonicalPassage->sort_key >= $from
                && $passage->canonicalPassage->sort_key <= $to)
            ->pluck('canonical_passage_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->all());
    }

    /**
     * @param  list<int>  $rangeIds
     * @return list<int>|null null when the source doesn't order exactly this range
     */
    private function candidateSequence(ApplyEditionOrderCandidateRequest $request, array $rangeIds): ?array
    {
        if ($rangeIds === []) {
            return null;
        }

        if ($request->validated('conjecture_id') !== null) {
            $conjecture = Conjecture::findOrFail((int) $request->validated('conjecture_id'));

            if ($conjecture->type === ConjectureType::Transposition) {
                // A transposition is a statement, not stored entries —
                // project it onto the block's citation order to get the
                // sequence it proposes (see TranspositionProjection).
                $citationOrdered = array_values(CanonicalPassage::whereIn('id', $rangeIds)
                    ->orderBy('sort_key')
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->all());

                $sequence = TranspositionProjection::sequence($conjecture, $citationOrdered) ?? [];
            } else {
                // A divided line stands where its first part stands.
                $sequence = ConjectureOrderingEntry::where('conjecture_id', $conjecture->id)
                    ->orderBy('sequence')
                    ->pluck('canonical_passage_id')
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values()
                    ->all();
            }
        } elseif ($request->validated('transcription_layer_id') !== null) {
            $sequence = TranscriptionSegment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
                ->whereIn('canonical_passage_id', $rangeIds)
                ->orderBy('start_offset')
                ->pluck('canonical_passage_id')
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();
        } else {
            // Citation order — the vulgate numbering.
            $sequence = CanonicalPassage::whereIn('id', $rangeIds)
                ->orderBy('sort_key')
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();
        }

        $sequence = array_values($sequence);

        $sortedSequence = $sequence;
        sort($sortedSequence);
        $sortedExpected = $rangeIds;
        sort($sortedExpected);

        return $sortedSequence === $sortedExpected ? $sequence : null;
    }
}
