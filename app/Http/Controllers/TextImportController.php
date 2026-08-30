<?php

namespace App\Http\Controllers;

use App\Enums\Visibility;
use App\Http\Requests\StoreTextImportRequest;
use App\Models\Transcription;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Http\RedirectResponse;
use Illuminate\Validation\ValidationException;

class TextImportController extends Controller
{
    /**
     * Save an uploaded file's contents as a new transcription of the chosen
     * witness, verbatim — the file becomes the transcription's raw text,
     * unmodified, exactly as typing it into the transcription editor would.
     * Citation spans and image alignment are added afterward, the same way
     * as for any other transcription; import doesn't decide them.
     */
    public function store(StoreTextImportRequest $request, Work $work): RedirectResponse
    {
        $witness = Witness::findOrFail((int) $request->validated('witness_id'));
        $text = file_get_contents($request->file('file')->getRealPath()) ?: '';

        if (trim($text) === '') {
            throw ValidationException::withMessages(['file' => 'The file has no text to import.']);
        }

        $transcription = $witness->transcriptions()->create([
            'user_id' => $request->user()->id,
            'text' => $text,
            'visibility' => Visibility::Draft,
        ]);

        return redirect()->route('transcriptions.show', $transcription);
    }
}
