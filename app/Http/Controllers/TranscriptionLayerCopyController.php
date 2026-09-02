<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionLayerCopyRequest;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class TranscriptionLayerCopyController extends Controller
{
    /**
     * Choose where to copy this layer's text: into the other layer of its own
     * transcription, or into the corresponding layer of another
     * transcription, of this witness or any other.
     */
    public function create(TranscriptionLayer $transcription): Response
    {
        $this->authorize('view', $transcription);

        $transcription->load('transcription.witness');

        return Inertia::render('Transcriptions/Copy', [
            'layer' => $transcription,
            'transcriptions' => Transcription::with('witness:id,siglum,label')
                ->get(['id', 'witness_id', 'name'])
                ->sortBy(fn (Transcription $candidate) => [$candidate->witness->siglum, $candidate->name])
                ->values(),
        ]);
    }

    /**
     * Copy this layer's text into another layer.
     *
     * What travels with the text depends on whether the copy stays inside the
     * same transcription — that is, whether it still describes the same
     * physical document:
     *
     * - Within the transcription, everything comes: the citation segments,
     *   and the image-alignment regions, because the other layer is the same
     *   manuscript text regularized, standing on the same pages and the same
     *   marks on parchment. It is a starting point the editor then adjusts;
     *   later edits move the offsets through SpanTransformer as usual.
     * - Into another transcription, only the citation segments come. Which
     *   passage of a work a stretch of text is remains true wherever the text
     *   goes; where it sits on a manuscript page does not, because it is a
     *   different manuscript with different pages and different images.
     *
     * Both layers already exist, so a copy fills one rather than creating it.
     */
    public function store(StoreTranscriptionLayerCopyRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $target = Transcription::whereKey($request->validated('transcription_id'))->firstOrFail();
        $withinSameTranscription = $target->is($transcription->transcription);

        $destination = DB::transaction(function () use ($request, $transcription, $target, $withinSameTranscription) {
            $destination = $target->layers()->firstOrNew([
                'layer' => $transcription->destinationLayerIn($target),
            ]);
            $destination->fill([
                'user_id' => $request->user()->id,
                'copied_from_id' => $transcription->id,
                'text' => $transcription->text,
            ])->save();

            // The destination's text was empty (validation refuses anything
            // else), so any spans still on it are tombstones left by clearing
            // it in the editor — emptying a layer collapses its citations
            // rather than deleting them. The copy replaces that citation work
            // wholesale; keeping the tombstones would double every badge.
            $destination->segments()->delete();
            $destination->regions()->delete();

            foreach ($transcription->segments as $segment) {
                // A tombstone (zero-width span whose text an edit destroyed)
                // marks work to do in the SOURCE layer; a copy of the text
                // has nothing for it to mark, so it stays behind.
                if ($segment->start_offset === $segment->end_offset) {
                    continue;
                }

                $destination->segments()->create([
                    'canonical_passage_id' => $segment->canonical_passage_id,
                    'start_offset' => $segment->start_offset,
                    'end_offset' => $segment->end_offset,
                    'part' => $segment->part,
                    'needs_review' => $segment->needs_review,
                ]);
            }

            if ($withinSameTranscription) {
                foreach ($transcription->regions as $region) {
                    $destination->regions()->create([
                        'manuscript_image_id' => $region->manuscript_image_id,
                        'text' => $region->text,
                        'start_offset' => $region->start_offset,
                        'end_offset' => $region->end_offset,
                        'position' => $region->position,
                        'x' => $region->x,
                        'y' => $region->y,
                        'width' => $region->width,
                        'height' => $region->height,
                    ]);
                }
            }

            return $destination;
        });

        return redirect()->route('transcriptions.show', $destination);
    }
}
