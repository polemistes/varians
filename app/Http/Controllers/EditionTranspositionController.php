<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreEditionTranspositionRequest;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionTransposition;
use App\Support\Edition\PassageOrderRewriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class EditionTranspositionController extends Controller
{
    /**
     * Record a transposition proposal, APPLY it to this edition's stored
     * passage order, and keep the adoption row as attribution — an
     * edition-ordering decision, not a word-level one, so it never touches
     * Lemma/LemmaReading (see EditionTransposition). The order is
     * materialized: applying rewrites positions once, rather than being
     * re-applied at every render.
     */
    public function store(StoreEditionTranspositionRequest $request, Edition $edition): RedirectResponse
    {
        DB::transaction(function () use ($request, $edition) {
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

            PassageOrderRewriter::moveRange(
                $edition,
                (int) $request->validated('canonical_passage_id'),
                $request->validated('transposition_range_end_canonical_passage_id') !== null
                    ? (int) $request->validated('transposition_range_end_canonical_passage_id')
                    : null,
                (int) $request->validated('move_target_canonical_passage_id'),
                $request->validated('move_position'),
            );

            $edition->transpositions()->create(['conjecture_id' => $conjecture->id]);
        });

        return back();
    }

    /**
     * Remove the attribution record only — the passage order STAYS as it
     * is (one-way apply, a deliberate decision): once positions are the
     * stored truth, an automatic revert would be unreliable the moment the
     * editor rearranged anything else on top. Moving the passages back is
     * an ordinary rearrangement. The underlying Conjecture (and any other
     * edition's application of it) is untouched.
     */
    public function destroy(EditionTransposition $transposition): RedirectResponse
    {
        $transposition->delete();

        return back();
    }
}
