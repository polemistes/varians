<?php

namespace App\Http\Controllers;

use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use Illuminate\Http\RedirectResponse;

class EditionLemmaController extends Controller
{
    /**
     * Remove this edition's selection for a lemma — reverts to undecided
     * for this edition only. The shared Lemma and its LemmaReadings are
     * untouched, and so are every other edition's selections. Choosing a
     * reading in the first place goes through EditionVariantController.
     */
    public function destroy(Edition $edition, Lemma $lemma): RedirectResponse
    {
        $this->authorize('update', $edition);

        EditionLemma::where('edition_id', $edition->id)->where('lemma_id', $lemma->id)->delete();

        return back();
    }
}
