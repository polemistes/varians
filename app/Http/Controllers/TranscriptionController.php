<?php

namespace App\Http\Controllers;

use App\Enums\Layer;
use App\Http\Requests\StoreTranscriptionRequest;
use App\Http\Requests\UpdateTranscriptionRequest;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use Illuminate\Http\RedirectResponse;

class TranscriptionController extends Controller
{
    /**
     * Start a blank transcription of a witness. Text and segmentation both
     * come later — this only records who it belongs to and what it is
     * called.
     *
     * Both layers are created at once and stay empty: a transcription always
     * consists of the two, and which one the editor starts in is a matter of
     * how she works — typing from the manuscript begins in the diplomatic
     * layer, importing a text begins in the normalized one.
     */
    public function store(StoreTranscriptionRequest $request, Witness $witness): RedirectResponse
    {
        $transcription = $witness->transcriptions()->create([
            'name' => $request->validated('name') ?? 'Transcription',
            'position' => ($witness->transcriptions()->max('position') ?? 0) + 1,
        ]);

        $normalized = $this->createLayers($transcription, $request->user()->id);

        return redirect()->route('transcriptions.show', $normalized);
    }

    /**
     * Both layers of a new transcription, empty. Returns the normalized one,
     * since that is where an edition reaches the witness — but which layer
     * the editor writes first is hers to choose.
     */
    private function createLayers(Transcription $transcription, int $userId, string $normalizedText = ''): TranscriptionLayer
    {
        $transcription->layers()->create([
            'user_id' => $userId,
            'layer' => Layer::Diplomatic,
            'text' => '',
        ]);

        return $transcription->layers()->create([
            'user_id' => $userId,
            'layer' => Layer::Normalized,
            'text' => $normalizedText,
        ]);
    }

    /**
     * A layer is worked on at its witness, where the manuscript stands beside
     * it — see WitnessController::show. Kept so that existing links and
     * bookmarks land in the right place rather than 404.
     */
    public function show(TranscriptionLayer $transcription): RedirectResponse
    {
        $this->authorize('view', $transcription);

        return redirect()->route('witnesses.show', [
            'witness' => $transcription->transcription->witness_id,
            'transcription' => $transcription->transcription_id,
            'layer' => $transcription->layer->value,
        ]);
    }

    /**
     * Save the transcription's visibility. A transcription is public or it
     * is not, and if it is, both of its layers are — so publishing from
     * either layer publishes the transcription. Text is edited in-place
     * through transcriptions.text.update instead — see
     * TranscriptionTextController.
     */
    public function update(UpdateTranscriptionRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        if ($request->has('visibility')) {
            $transcription->transcription->update(['visibility' => $request->validated('visibility')]);
        }

        return back();
    }

    /**
     * Deleting a transcription cascades its segments, regions, and — if
     * any of its words feed a published edition —
     * the edition's own LemmaReading selections and base-text choices for
     * that range. See App\Support\DeletionImpact for the preview shown
     * before this is confirmed.
     */
    public function destroy(TranscriptionLayer $transcription): RedirectResponse
    {
        $witness = $transcription->witness;
        $transcription->delete();

        return redirect()->route('witnesses.show', $witness);
    }
}
