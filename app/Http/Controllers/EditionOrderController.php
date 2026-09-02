<?php

namespace App\Http\Controllers;

use App\Http\Requests\ApplyEditionOrderCandidateRequest;
use App\Http\Requests\MoveEditionPassagesRequest;
use App\Models\CanonicalPassage;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\TranscriptionSegment;
use App\Support\Edition\PassageOrderRewriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Direct manipulation of an edition's stored passage order. Since the
 * materialized-order redesign the positions ARE the printed order, and
 * these two actions are how they change: a cut-and-paste of a contiguous
 * range, and applying another source's order (a witness's own sequence, a
 * catalogued Reordering conjecture, or plain citation order) to a range the
 * order report flagged.
 */
class EditionOrderController extends Controller
{
    /**
     * Cut a contiguous range of passages and paste it before/after another
     * passage. The editor's own act — no conjecture, no attribution; the
     * derived order report always shows how the result relates to the
     * witnesses and to citation order.
     */
    public function move(MoveEditionPassagesRequest $request, Edition $edition): RedirectResponse
    {
        $moved = DB::transaction(fn () => PassageOrderRewriter::moveRange(
            $edition,
            (int) $request->validated('range_start_canonical_passage_id'),
            $request->validated('range_end_canonical_passage_id') !== null
                ? (int) $request->validated('range_end_canonical_passage_id')
                : null,
            (int) $request->validated('target_canonical_passage_id'),
            $request->validated('move_position'),
        ));

        if (! $moved) {
            throw ValidationException::withMessages([
                'target_canonical_passage_id' => 'That move could not be resolved against the edition\'s current order.',
            ]);
        }

        return back();
    }

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

        DB::transaction(function () use ($request, $edition, $sequence) {
            PassageOrderRewriter::applySequence($edition, $sequence);

            if ($request->validated('conjecture_id') !== null) {
                EditionTransposition::firstOrCreate([
                    'edition_id' => $edition->id,
                    'conjecture_id' => (int) $request->validated('conjecture_id'),
                ]);
            }
        });

        return back();
    }

    /**
     * The canonical passage ids currently occupying the range, in stored
     * order — located by position exactly like the report located them.
     *
     * @return list<int>
     */
    private function rangePassageIds(Edition $edition, int $startId, int $endId): array
    {
        $ids = EditionPassage::where('edition_id', $edition->id)
            ->orderBy('position')
            ->pluck('canonical_passage_id')
            ->map(fn ($id) => (int) $id)
            ->values();

        $startIndex = $ids->search($startId);
        $endIndex = $ids->search($endId);

        if (! is_int($startIndex) || ! is_int($endIndex) || $endIndex < $startIndex) {
            return [];
        }

        return array_values($ids->slice($startIndex, $endIndex - $startIndex + 1)->all());
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
            $sequence = ConjectureOrderingEntry::where('conjecture_id', $request->validated('conjecture_id'))
                ->orderBy('sequence')
                ->pluck('canonical_passage_id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();
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
