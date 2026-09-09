<?php

namespace App\Http\Controllers;

use App\Http\Requests\DestroyEditionPassagesRequest;
use App\Http\Requests\StoreEditionPassageRequest;
use App\Http\Requests\StoreEditionPassagesBulkRequest;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\TranscriptionSegment;
use App\Support\Edition\LineationSeeder;
use App\Support\Edition\PassageAdder;
use App\Support\Edition\PassageOrderRewriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;

class EditionPassageController extends Controller
{
    /**
     * Add the transcription's segments for the named passages — or, given a
     * raw drag-selected span, every already-cited segment fully inside it —
     * to the edition, each landing where the manuscript has it (see
     * PassageAdder::insertionPosition).
     */
    public function store(StoreEditionPassageRequest $request, Edition $edition): RedirectResponse
    {
        // Only this work's passages, whatever the layer also cites — a
        // codex transcription may carry several works, and a passage of
        // another work has no place in this edition.
        $query = TranscriptionSegment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
            ->whereRelation('canonicalPassage', 'work_id', $edition->work_id);

        if ($request->validated('canonical_passage_ids') !== null) {
            $query->whereIn('canonical_passage_id', $request->validated('canonical_passage_ids'));
        } else {
            $query->where('start_offset', '>=', $request->validated('start_offset'))
                ->where('end_offset', '<=', $request->validated('end_offset'));
        }

        $this->addSegments($edition, $query->orderBy('start_offset')->get());

        return back();
    }

    /**
     * "Add lines…" — every already-cited segment for the transcription
     * within a citation range, added in the transcription's own physical
     * order, not citation order — and each lands where the manuscript has
     * it among the passages already in the edition.
     */
    public function storeBulk(StoreEditionPassagesBulkRequest $request, Edition $edition): RedirectResponse
    {
        $from = CanonicalPassage::findOrFail((int) $request->validated('from_canonical_passage_id'));
        $to = CanonicalPassage::findOrFail((int) $request->validated('to_canonical_passage_id'));

        $segments = TranscriptionSegment::where('transcription_layer_id', $request->validated('transcription_layer_id'))
            ->whereHas('canonicalPassage', fn ($query) => $query
                ->where('work_id', $edition->work_id)
                ->where('sort_key', '>=', $from->sort_key)
                ->where('sort_key', '<=', $to->sort_key))
            ->get()
            ->sortBy(fn (TranscriptionSegment $segment) => $segment->start_offset)
            ->values();

        $this->addSegments($edition, $segments);

        return back();
    }

    /**
     * Removing a passage never touches Lemma/LemmaReading/Conjecture (all
     * edition-independent shared collation) or EditionTransposition (an
     * applied proposal's attribution record — the Conjecture is part of a
     * reusable stockpile any edition of the work can draw on, never
     * entangled with any one edition's own passage lifecycle). This
     * edition's own selections for the passage's lemmas are cleared. The
     * passage becomes available again in every transcription citing it,
     * for free.
     */
    public function destroy(DestroyEditionPassagesRequest $request, Edition $edition): RedirectResponse
    {
        $passageIds = array_map('intval', $request->validated('canonical_passage_ids'));

        DB::transaction(function () use ($edition, $passageIds) {
            EditionLemma::where('edition_id', $edition->id)
                ->whereHas('lemma', fn ($query) => $query->whereIn('canonical_passage_id', $passageIds))
                ->delete();

            // A line printed in pieces leaves whole.
            EditionPassage::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $passageIds)
                ->delete();
        });

        return back();
    }

    /**
     * @param  SupportCollection<int, TranscriptionSegment>  $segments
     */
    private function addSegments(Edition $edition, SupportCollection $segments): void
    {
        DB::transaction(function () use ($edition, $segments) {
            $previous = null;

            foreach ($segments as $segment) {
                PassageAdder::add(
                    $edition,
                    $segment,
                    PassageAdder::insertionPosition($edition, $segment),
                    LineationSeeder::interPassageFlags($previous, $segment),
                );

                $previous = $segment;
            }

            PassageOrderRewriter::renumberEdition($edition);
        });
    }
}
