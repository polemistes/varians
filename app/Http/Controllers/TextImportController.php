<?php

namespace App\Http\Controllers;

use App\Enums\Layer;
use App\Http\Requests\StoreTextImportRequest;
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
            'name' => $request->file('file')->getClientOriginalName(),
            'position' => ($witness->transcriptions()->max('position') ?? 0) + 1,
        ]);

        // Which layer an imported text belongs in is the editor's call: a file
        // may be a diplomatic transcript someone else typed just as easily as
        // a normalized edition of the work. Both layers are created either
        // way; the other one starts empty.
        $chosen = Layer::from($request->validated('layer'));
        $imported = null;

        foreach (Layer::cases() as $layer) {
            $created = $transcription->layers()->create([
                'user_id' => $request->user()->id,
                'layer' => $layer,
                'text' => $layer === $chosen ? $text : '',
            ]);

            if ($layer === $chosen) {
                $imported = $created;
            }
        }

        return redirect()->route('transcriptions.show', $imported);
    }
}
