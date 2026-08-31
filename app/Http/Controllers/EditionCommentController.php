<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreEditionCommentRequest;
use App\Http\Requests\UpdateEditionCommentRequest;
use App\Models\Edition;
use App\Models\EditionComment;
use Illuminate\Http\RedirectResponse;

/**
 * An editor's own notes on her edition — see App\Models\EditionComment for
 * what they carry and why they are free text.
 *
 * Collaborative like everything else here: any editor may write, reword or
 * remove a note, and `user_id` records who wrote it rather than who owns it.
 */
class EditionCommentController extends Controller
{
    public function store(StoreEditionCommentRequest $request, Edition $edition): RedirectResponse
    {
        $rangeEnd = $request->validated('range_end_lemma_id');
        $lemmaId = $request->validated('lemma_id');

        $edition->comments()->create([
            'canonical_passage_id' => $request->validated('canonical_passage_id'),
            'lemma_id' => $lemmaId,
            // Null unless more than one column is genuinely covered — the
            // convention LemmaReading already uses.
            'range_end_lemma_id' => $rangeEnd !== null && (int) $rangeEnd !== (int) $lemmaId ? $rangeEnd : null,
            'user_id' => $request->user()->id,
            'note' => $request->validated('note'),
        ]);

        return back();
    }

    public function update(UpdateEditionCommentRequest $request, EditionComment $comment): RedirectResponse
    {
        $comment->update($request->validated());

        return back();
    }

    public function destroy(EditionComment $comment): RedirectResponse
    {
        $comment->delete();

        return back();
    }
}
