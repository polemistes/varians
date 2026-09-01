<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTextImportRequest;
use App\Models\TranscriptionLayer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Validation\ValidationException;

class TextImportController extends Controller
{
    /**
     * Load a file into one layer of a transcription.
     *
     * Importing is not a way of starting a transcription; it is something one
     * does to a layer of one that already exists. Which layer is the editor's
     * choice — a file may as easily be a diplomatic transcript someone else
     * typed as a normalized edition of the work — and it is the layer she has
     * open, so nothing is asked.
     *
     * Refused when the layer already holds text: replacing it would leave
     * every citation span, image region and page division measured against
     * words that are no longer there. Clear it deliberately if that is meant.
     */
    public function store(StoreTextImportRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        if ($transcription->text !== '') {
            throw ValidationException::withMessages([
                'file' => 'This layer already has text. Clear it first if you mean to replace it.',
            ]);
        }

        $text = file_get_contents($request->file('file')->getRealPath()) ?: '';

        if (trim($text) === '') {
            throw ValidationException::withMessages(['file' => 'The file has no text to import.']);
        }

        $transcription->update(['text' => $text]);

        return back();
    }
}
