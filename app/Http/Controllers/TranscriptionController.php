<?php

namespace App\Http\Controllers;

use App\Enums\Visibility;
use App\Http\Requests\StoreTranscriptionRequest;
use App\Http\Requests\UpdateTranscriptionRequest;
use App\Models\Tag;
use App\Models\Transcription;
use App\Models\Witness;
use App\Models\Work;
use App\Support\DeletionImpact;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class TranscriptionController extends Controller
{
    /**
     * Start a blank transcription of a witness. Text and segmentation both
     * come later — this only records who it belongs to and, optionally, how
     * it's tagged.
     */
    public function store(StoreTranscriptionRequest $request, Witness $witness): RedirectResponse
    {
        $transcription = $witness->transcriptions()->create([
            'user_id' => $request->user()->id,
            'text' => '',
            'visibility' => Visibility::Draft,
        ]);

        $this->syncTags($transcription, $request->validated('tags', []));

        return redirect()->route('transcriptions.show', $transcription);
    }

    public function show(Transcription $transcription): Response
    {
        $this->authorize('view', $transcription);

        $transcription->load([
            'witness.manuscript.images' => fn ($query) => $query->orderBy('position'),
            'witness.manuscript.images.features',
            'segments' => fn ($query) => $query->orderBy('start_offset'),
            'segments.canonicalPassage.work',
            'regions' => fn ($query) => $query->orderBy('position'),
            'tags',
        ]);

        $transcription->setAttribute('deletion_impact', DeletionImpact::forTranscription($transcription));

        return Inertia::render('Transcriptions/Editor', [
            'transcription' => $transcription,
            'works' => Work::with('referenceScheme')->orderBy('title')->get(),
            'existingTags' => Tag::orderBy('name')->pluck('name'),
        ]);
    }

    /**
     * Save the transcription's tags and/or visibility. Text is edited
     * in-place through transcriptions.text.update instead — see
     * TranscriptionTextController.
     */
    public function update(UpdateTranscriptionRequest $request, Transcription $transcription): RedirectResponse
    {
        if ($request->has('tags')) {
            $this->syncTags($transcription, $request->validated('tags', []));
        }

        if ($request->has('visibility')) {
            $transcription->update(['visibility' => $request->validated('visibility')]);
        }

        return back();
    }

    /**
     * Deleting a transcription cascades its segments, regions, tag
     * associations, and — if any of its words feed a published edition —
     * the edition's own LemmaReading selections and base-text choices for
     * that range. See App\Support\DeletionImpact for the preview shown
     * before this is confirmed.
     */
    public function destroy(Transcription $transcription): RedirectResponse
    {
        $witness = $transcription->witness;
        $transcription->delete();

        return redirect()->route('witnesses.show', $witness);
    }

    /**
     * @param  list<string>  $tagNames
     */
    private function syncTags(Transcription $transcription, array $tagNames): void
    {
        $transcription->tags()->sync(Tag::resolveIds($tagNames));
    }
}
