<?php

namespace App\Http\Controllers;

use App\Enums\Visibility;
use App\Http\Requests\StoreTranscriptionForkRequest;
use App\Models\Tag;
use App\Models\Transcription;
use App\Models\Witness;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class TranscriptionForkController extends Controller
{
    public function create(Transcription $transcription): Response
    {
        $transcription->load('witness');

        $witnesses = Witness::where('id', '!=', $transcription->witness_id)
            ->orderBy('siglum')
            ->get(['id', 'siglum', 'label', 'type']);

        return Inertia::render('Transcriptions/Fork', [
            'transcription' => $transcription,
            'witnesses' => $witnesses,
        ]);
    }

    /**
     * Copy this transcription's text and citation spans onto a different
     * witness. Image-alignment regions are not copied — a different witness
     * means different (or no) images, so old alignments wouldn't apply.
     */
    public function store(StoreTranscriptionForkRequest $request, Transcription $transcription): RedirectResponse
    {
        $fork = DB::transaction(function () use ($request, $transcription) {
            $fork = Transcription::create([
                'witness_id' => $request->validated('witness_id'),
                'user_id' => $request->user()->id,
                'forked_from_id' => $transcription->id,
                'text' => $transcription->text,
                'visibility' => Visibility::Draft,
            ]);

            foreach ($transcription->segments as $segment) {
                $fork->segments()->create([
                    'canonical_passage_id' => $segment->canonical_passage_id,
                    'start_offset' => $segment->start_offset,
                    'end_offset' => $segment->end_offset,
                ]);
            }

            $fork->tags()->sync(Tag::resolveIds($request->validated('tags', [])));

            return $fork;
        });

        return redirect()->route('transcriptions.show', $fork);
    }
}
