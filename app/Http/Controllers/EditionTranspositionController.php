<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreEditionTranspositionRequest;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionTransposition;
use Illuminate\Http\RedirectResponse;

class EditionTranspositionController extends Controller
{
    /**
     * Record a transposition proposal and adopt it for this edition in one
     * step — an edition-ordering decision, not a word-level one, so it
     * never touches Lemma/LemmaReading (see EditionTransposition).
     */
    public function store(StoreEditionTranspositionRequest $request, Edition $edition): RedirectResponse
    {
        $conjecture = Conjecture::create([
            'canonical_passage_id' => $request->validated('canonical_passage_id'),
            'user_id' => $request->user()->id,
            'type' => ConjectureType::Transposition,
            'transposition_range_end_canonical_passage_id' => $request->validated('transposition_range_end_canonical_passage_id'),
            'move_target_canonical_passage_id' => $request->validated('move_target_canonical_passage_id'),
            'move_position' => $request->validated('move_position'),
            'proposed_by' => $request->validated('proposed_by'),
            'bibliography' => $request->validated('bibliography'),
            'note' => $request->validated('note'),
        ]);

        $edition->transpositions()->create(['conjecture_id' => $conjecture->id]);

        return back();
    }

    /**
     * Un-adopt a transposition for this edition — its rendering order
     * reverts to natural citation order for this range. The underlying
     * Conjecture (and any other edition's adoption of it) is untouched.
     */
    public function destroy(EditionTransposition $transposition): RedirectResponse
    {
        $transposition->delete();

        return back();
    }
}
