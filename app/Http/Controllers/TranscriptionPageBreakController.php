<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionPageBreakRequest;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use Illuminate\Http\RedirectResponse;

class TranscriptionPageBreakController extends Controller
{
    /**
     * Say where a page begins, or move it if it was already placed — a page
     * begins in one place, so placing it again is moving it rather than
     * adding a second break.
     *
     * The division belongs to the transcription and applies to both layers,
     * so placing it from either one places it for both.
     */
    public function store(StoreTranscriptionPageBreakRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        // Given as an offset into the layer the editor is looking at, stored
        // as the line it falls on — the coordinate both layers share.
        $transcription->transcription->pageBreaks()->updateOrCreate(
            ['manuscript_page_id' => $request->validated('manuscript_page_id')],
            ['start_line' => $transcription->lineOfOffset((int) $request->validated('start_offset'))],
        );

        return back();
    }

    /**
     * Unplace a page in this layer. The page and the text both remain; the
     * text simply stops being divided there, and what followed the break
     * joins the page before it.
     */
    public function destroy(TranscriptionPageBreak $pageBreak): RedirectResponse
    {
        $pageBreak->delete();

        return back();
    }
}
