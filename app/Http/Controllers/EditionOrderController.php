<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\ApplyEditionOrderCandidateRequest;
use App\Models\Assignment;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionSegment;
use App\Models\Segment;
use App\Support\Edition\ArrangementAdopter;
use App\Support\Edition\SegmentOrderRewriter;
use App\Support\Edition\TranspositionProjection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Applying another source's order to an edition's stored segment order.
 * Since the materialized-order redesign the positions ARE the printed
 * order; they change here, by following a candidate the order report
 * offers (a witness's own sequence, a catalogued conjecture, or plain
 * numbering order), or through ConjectureOrderingController, where the
 * editor's own rearrangement is registered as a conjecture and followed.
 */
class EditionOrderController extends Controller
{
    /**
     * Apply one of the order report's candidates to its range: the named
     * source's own sequence replaces the range's current order. Applying a
     * catalogued conjecture also records the application as attribution
     * (EditionTransposition); a witness's or numbering order needs none —
     * "matches witness B" is derivable and shown by the report itself.
     */
    public function applyCandidate(ApplyEditionOrderCandidateRequest $request, Edition $edition): RedirectResponse
    {
        $rangeIds = $this->rangeSegmentIds(
            $edition,
            (int) $request->validated('range_start_segment_id'),
            (int) $request->validated('range_end_segment_id'),
        );

        $sequence = $this->candidateSequence($request, $rangeIds);

        if ($sequence === null) {
            throw ValidationException::withMessages([
                'range_start_segment_id' => 'That source no longer orders exactly this range.',
            ]);
        }

        // A conjecture is adopted whole — pieces, divided lines and the
        // attribution record — by the adopter; a witness's or assignment
        // order is a plain resequencing that needs no record.
        if ($request->validated('conjecture_id') !== null) {
            ArrangementAdopter::adopt($edition, Conjecture::findOrFail((int) $request->validated('conjecture_id')));

            return back();
        }

        DB::transaction(function () use ($edition, $sequence) {
            SegmentOrderRewriter::applySequence($edition, $sequence);
        });

        return back();
    }

    /**
     * The block's member segments in stored (printed) order — membership
     * derived exactly like the report derives it: every segment of this
     * edition whose assignment sort_key falls between the two endpoints,
     * inclusive. The block is contiguous in NUMBERING order (its endpoints
     * are assignment-order first and last, see EditionController::orderRanges),
     * but its members may be scattered in the printed order, so locating a
     * printed slice between the endpoints would grab the wrong segments.
     *
     * @return list<int>
     */
    private function rangeSegmentIds(Edition $edition, int $startId, int $endId): array
    {
        $segments = EditionSegment::where('edition_id', $edition->id)
            ->with('segment:id,sort_key')
            ->orderBy('position')
            ->get();

        $start = $segments->firstWhere('segment_id', $startId);
        $end = $segments->firstWhere('segment_id', $endId);

        if ($start === null || $end === null) {
            return [];
        }

        $from = min($start->segment->sort_key, $end->segment->sort_key);
        $to = max($start->segment->sort_key, $end->segment->sort_key);

        return array_values($segments
            ->filter(fn (EditionSegment $segment) => $segment->segment->sort_key >= $from
                && $segment->segment->sort_key <= $to)
            ->pluck('segment_id')
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
                // project it onto the block's numbering order to get the
                // sequence it proposes (see TranspositionProjection).
                $numberingOrdered = array_values(Segment::whereIn('id', $rangeIds)
                    ->orderBy('sort_key')
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->all());

                $sequence = TranspositionProjection::sequence($conjecture, $numberingOrdered) ?? [];
            } else {
                // A divided line stands where its first part stands.
                $sequence = ConjectureOrderingEntry::where('conjecture_id', $conjecture->id)
                    ->orderBy('sequence')
                    ->pluck('segment_id')
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values()
                    ->all();
            }
        } elseif ($request->validated('transcription_layer_id') !== null) {
            $sequence = Assignment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
                ->whereIn('segment_id', $rangeIds)
                ->orderBy('start_offset')
                ->pluck('segment_id')
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();
        } else {
            // Numbering order — the vulgate numbering.
            $sequence = Segment::whereIn('id', $rangeIds)
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
