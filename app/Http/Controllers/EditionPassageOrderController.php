<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionPassageOrderRequest;
use App\Models\Edition;
use App\Models\EditionPassageOrder;
use Illuminate\Http\RedirectResponse;

class EditionPassageOrderController extends Controller
{
    /**
     * Record (or revise) this edition's choice of which source's own
     * internal sequence to follow for a range of passages — a transcription
     * never touches Conjecture, since the manuscript itself is the source,
     * not a scholar's proposal; a Reordering conjecture is only ever
     * involved when the editor explicitly picked one (or authored a new
     * one — see ConjectureOrderingController). Re-choosing the same range
     * updates the existing row rather than piling up a new one each time,
     * which also structurally prevents the flip-flop the pairwise
     * predecessor of this mechanism used to produce.
     */
    public function store(StoreEditionPassageOrderRequest $request, Edition $edition): RedirectResponse
    {
        EditionPassageOrder::updateOrCreate(
            [
                'edition_id' => $edition->id,
                'range_start_canonical_passage_id' => $request->validated('range_start_canonical_passage_id'),
                'range_end_canonical_passage_id' => $request->validated('range_end_canonical_passage_id'),
            ],
            [
                'transcription_id' => $request->validated('transcription_id'),
                'conjecture_id' => $request->validated('conjecture_id'),
                'user_id' => $request->user()->id,
            ],
        );

        return back();
    }

    /**
     * Reverts to whatever order the edition's own passages and any adopted
     * transpositions naturally produce.
     */
    public function destroy(EditionPassageOrder $editionPassageOrder): RedirectResponse
    {
        $editionPassageOrder->delete();

        return back();
    }
}
