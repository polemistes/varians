<?php

namespace App\Http\Controllers;

use App\Http\Requests\DestroyEditionSegmentsRequest;
use App\Http\Requests\StoreEditionSegmentRequest;
use App\Http\Requests\StoreEditionSegmentsBulkRequest;
use App\Models\Assignment;
use App\Models\Segment;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionSegment;
use App\Support\Edition\LineationSeeder;
use App\Support\Edition\SegmentAdder;
use App\Support\Edition\SegmentOrderRewriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;

class EditionSegmentController extends Controller
{
    /**
     * Add the transcription's assignments for the named segments — or, given a
     * raw drag-selected span, every already-assigned assignment fully inside it —
     * to the edition, each landing where the manuscript has it (see
     * SegmentAdder::insertionPosition).
     */
    public function store(StoreEditionSegmentRequest $request, Edition $edition): RedirectResponse
    {
        // Only this work's segments, whatever the layer also assigns — a
        // codex transcription may carry several works, and a segment of
        // another work has no place in this edition.
        $query = Assignment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
            ->whereRelation('segment', 'work_id', $edition->work_id);

        if ($request->validated('segment_ids') !== null) {
            $query->whereIn('segment_id', $request->validated('segment_ids'));
        } else {
            $query->where('start_offset', '>=', $request->validated('start_offset'))
                ->where('end_offset', '<=', $request->validated('end_offset'));
        }

        $this->addAssignments($edition, $query->orderBy('start_offset')->get());

        return back();
    }

    /**
     * "Add lines…" — every already-assigned assignment for the transcription
     * within an assignment range, added in the transcription's own physical
     * order, not numbering order — and each lands where the manuscript has
     * it among the segments already in the edition.
     */
    public function storeBulk(StoreEditionSegmentsBulkRequest $request, Edition $edition): RedirectResponse
    {
        $from = Segment::findOrFail((int) $request->validated('from_segment_id'));
        $to = Segment::findOrFail((int) $request->validated('to_segment_id'));

        $assignments = Assignment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
            ->whereHas('segment', fn ($query) => $query
                ->where('work_id', $edition->work_id)
                ->where('sort_key', '>=', $from->sort_key)
                ->where('sort_key', '<=', $to->sort_key))
            ->get()
            ->sortBy(fn (Assignment $assignment) => $assignment->start_offset)
            ->values();

        $this->addAssignments($edition, $assignments);

        return back();
    }

    /**
     * Removing a segment never touches Lemma/LemmaReading/Conjecture (all
     * edition-independent shared collation) or EditionTransposition (an
     * applied proposal's attribution record — the Conjecture is part of a
     * reusable stockpile any edition of the work can draw on, never
     * entangled with any one edition's own segment lifecycle). This
     * edition's own selections for the segment's lemmas are cleared. The
     * segment becomes available again in every transcription assigning text to it,
     * for free.
     */
    public function destroy(DestroyEditionSegmentsRequest $request, Edition $edition): RedirectResponse
    {
        $segmentIds = array_map('intval', $request->validated('segment_ids'));

        DB::transaction(function () use ($edition, $segmentIds) {
            EditionLemma::where('edition_id', $edition->id)
                ->whereHas('lemma', fn ($query) => $query->whereIn('segment_id', $segmentIds))
                ->delete();

            // A line printed in pieces leaves whole.
            EditionSegment::where('edition_id', $edition->id)
                ->whereIn('segment_id', $segmentIds)
                ->delete();
        });

        return back();
    }

    /**
     * @param  SupportCollection<int, Assignment>  $assignments
     */
    private function addAssignments(Edition $edition, SupportCollection $assignments): void
    {
        DB::transaction(function () use ($edition, $assignments) {
            $previous = null;

            foreach ($assignments as $assignment) {
                SegmentAdder::add(
                    $edition,
                    $assignment,
                    SegmentAdder::insertionPosition($edition, $assignment),
                    LineationSeeder::interSegmentFlags($previous, $assignment),
                );

                $previous = $assignment;
            }

            SegmentOrderRewriter::renumberEdition($edition);
        });
    }
}
