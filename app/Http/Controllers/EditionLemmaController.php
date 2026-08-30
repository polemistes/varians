<?php

namespace App\Http\Controllers;

use App\Http\Requests\SelectEditionLemmaRequest;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use Illuminate\Http\RedirectResponse;

class EditionLemmaController extends Controller
{
    /**
     * Choose which of a lemma's candidate readings this edition prints —
     * upserts the (edition, lemma) selection. The shared lemma/reading
     * collation itself is untouched; other editions are unaffected.
     */
    public function select(SelectEditionLemmaRequest $request, Edition $edition, Lemma $lemma): RedirectResponse
    {
        EditionLemma::updateOrCreate(
            ['edition_id' => $edition->id, 'lemma_id' => $lemma->id],
            ['selected_reading_id' => $request->validated('reading_id')],
        );

        return back();
    }

    /**
     * Remove this edition's selection for a lemma — reverts to undecided
     * for this edition only. The shared Lemma and its LemmaReadings are
     * untouched, and so are every other edition's selections.
     */
    public function destroy(Edition $edition, Lemma $lemma): RedirectResponse
    {
        EditionLemma::where('edition_id', $edition->id)->where('lemma_id', $lemma->id)->delete();

        return back();
    }
}
