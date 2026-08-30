<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateLemmaRequest;
use App\Models\Lemma;
use Illuminate\Http\RedirectResponse;

class LemmaController extends Controller
{
    public function update(UpdateLemmaRequest $request, Lemma $lemma): RedirectResponse
    {
        $lemma->update($request->validated());

        return back();
    }

    /**
     * Delete the lemma and all its readings entirely — structural, affects
     * every edition that had a selection for it (cascades). Distinct from
     * an edition simply removing its own selection; see EditionLemmaController.
     *
     * Action-at-a-distance worth knowing: a reading on a *different* lemma
     * can carry this one as its `range_end_lemma_id` (a multi-word
     * conjecture or witness variant spanning through here — see
     * LemmaReading), which cascades that reading away too, even though this
     * lemma itself has no decision of its own.
     */
    public function destroy(Lemma $lemma): RedirectResponse
    {
        $lemma->delete();

        return back();
    }
}
