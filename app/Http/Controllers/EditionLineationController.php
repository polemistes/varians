<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateEditionLineBreakRequest;
use App\Http\Requests\UpdateEditionPassageLineationRequest;
use App\Models\Edition;
use App\Models\EditionLineBreak;
use App\Models\EditionPassage;
use App\Models\Lemma;
use Illuminate\Http\RedirectResponse;

/**
 * An edition's own lineation — where its printed text breaks, at both
 * granularities. Between passages, the flags live on EditionPassage; inside
 * a passage, a break is an EditionLineBreak before one collation column
 * (colometry). Both are pure display choices of THIS edition: no manuscript
 * layout, no other edition, and no collation data is touched by any of it.
 */
class EditionLineationController extends Controller
{
    /**
     * Set, change, or clear the break before one column — one idempotent
     * endpoint, since the editor cycles a gap through line → paragraph →
     * none. A null kind clears.
     */
    public function updateBreak(UpdateEditionLineBreakRequest $request, Edition $edition): RedirectResponse
    {
        $lemma = Lemma::findOrFail((int) $request->validated('lemma_id'));
        $kind = $request->validated('kind');

        if ($kind === null) {
            EditionLineBreak::where('edition_id', $edition->id)
                ->where('lemma_id', $lemma->id)
                ->delete();

            return back();
        }

        EditionLineBreak::updateOrCreate(
            ['edition_id' => $edition->id, 'lemma_id' => $lemma->id],
            ['canonical_passage_id' => $lemma->canonical_passage_id, 'kind' => $kind],
        );

        return back();
    }

    /**
     * The passage-boundary flags: whether this passage starts a new printed
     * line, and whether that line opens a new paragraph.
     */
    public function updatePassage(UpdateEditionPassageLineationRequest $request, EditionPassage $editionPassage): RedirectResponse
    {
        $editionPassage->update($request->validated());

        return back();
    }
}
