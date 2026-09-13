<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionParatextRequest;
use App\Http\Requests\UpdateEditionParatextRequest;
use App\Models\Edition;
use App\Models\EditionParatext;
use Illuminate\Http\RedirectResponse;

/**
 * An edition's paratexts — see App\Models\EditionParatext. Whoever may
 * edit the edition may add, reword or remove one; how speaker indications
 * are laid out is edition-wide and lives on the edition itself
 * (EditionController::update, `speaker_display`).
 */
class EditionParatextController extends Controller
{
    public function store(StoreEditionParatextRequest $request, Edition $edition): RedirectResponse
    {
        $lemmaId = (int) $request->validated('lemma_id');
        $placement = $request->validated('placement');

        $edition->paratexts()->create([
            'segment_id' => (int) $request->validated('segment_id'),
            'lemma_id' => $lemmaId,
            'placement' => $placement,
            'kind' => $request->validated('kind'),
            'text' => $request->validated('text'),
            // Several paratexts at one point read in the order they were
            // added.
            'position' => ((int) $edition->paratexts()
                ->where('lemma_id', $lemmaId)
                ->where('placement', $placement)
                ->max('position')) + 1,
        ]);

        return back();
    }

    public function update(UpdateEditionParatextRequest $request, EditionParatext $paratext): RedirectResponse
    {
        $paratext->update($request->validated());

        return back();
    }

    public function destroy(EditionParatext $paratext): RedirectResponse
    {
        $this->authorize('update', $paratext->edition);

        $paratext->delete();

        return back();
    }
}
