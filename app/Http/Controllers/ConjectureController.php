<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreConjectureRequest;
use App\Http\Requests\UpdateConjectureRequest;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use Illuminate\Http\RedirectResponse;

class ConjectureController extends Controller
{
    /**
     * Record a standalone conjecture for a passage, before committing to any
     * lemma-splitting — it starts out unattached to any lemma and can be
     * attached (or recorded directly for a lemma) via LemmaReading. A
     * substitution, lacuna, or supplement — see App\Enums\ConjectureType —
     * all get credited the same way. Never a transposition, which is
     * edition-scoped and always authored through edition-transpositions.store
     * instead (see StoreConjectureRequest).
     */
    public function store(StoreConjectureRequest $request, CanonicalPassage $canonicalPassage): RedirectResponse
    {
        $canonicalPassage->conjectures()->create([
            'user_id' => $request->user()->id,
            'type' => $request->validated('type') ?? ConjectureType::Substitution->value,
            'text' => $request->validated('text'),
            'extent' => $request->validated('extent'),
            'extent_characters' => $request->validated('extent_characters'),
            'supplements_conjecture_id' => $request->validated('supplements_conjecture_id'),
            'proposed_by' => $request->validated('proposed_by'),
            'bibliography' => $request->validated('bibliography'),
            'note' => $request->validated('note'),
        ]);

        return back();
    }

    public function update(UpdateConjectureRequest $request, Conjecture $conjecture): RedirectResponse
    {
        $conjecture->update($request->validated());

        return back();
    }

    public function destroy(Conjecture $conjecture): RedirectResponse
    {
        $conjecture->delete();

        return back();
    }
}
