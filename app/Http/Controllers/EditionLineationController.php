<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateEditionLineBreakRequest;
use App\Http\Requests\UpdateEditionSegmentLineationRequest;
use App\Models\Edition;
use App\Models\EditionLineBreak;
use App\Models\EditionSegment;
use App\Models\Lemma;
use Illuminate\Http\RedirectResponse;

/**
 * An edition's own lineation — where its printed text breaks, at both
 * granularities. Between segments, the flags live on EditionSegment; inside
 * a segment, a break is an EditionLineBreak before one collation column
 * (colometry). Both are pure display choices of THIS edition: no manuscript
 * layout, no other edition, and no collation data is touched by any of it.
 */
class EditionLineationController extends Controller
{
    /**
     * Set, change, or clear the break before one column — one idempotent
     * endpoint, since Enter, Backspace and Delete in the edition text raise
     * or lower a gap through none → line → paragraph. A null kind clears.
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
            ['segment_id' => $lemma->segment_id, 'kind' => $kind],
        );

        return back();
    }

    /**
     * The segment-boundary flags: whether this segment starts a new printed
     * line, and whether that line opens a new paragraph.
     */
    public function updateSegment(UpdateEditionSegmentLineationRequest $request, EditionSegment $editionSegment): RedirectResponse
    {
        $editionSegment->update($request->validated());

        return back();
    }
}
