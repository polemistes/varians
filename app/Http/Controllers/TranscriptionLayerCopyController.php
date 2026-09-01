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
    /**
     * The source's own witness is deliberately included: forking onto it is
     * how a normalized layer is made from a diplomatic transcription (see
     * App\Enums\TranscriptionLayer), which is the more common reason to fork
     * now than copying wording onto a different witness.
     */
    public function create(Transcription $transcription): Response
    {
        $transcription->load('witness');

        $witnesses = Witness::orderBy('siglum')->get(['id', 'siglum', 'label', 'type']);

        return Inertia::render('Transcriptions/Fork', [
            'transcription' => $transcription,
            'witnesses' => $witnesses,
        ]);
    }

    /**
     * Copy this transcription's text and citation spans onto another witness
     * — or onto the same one, to start a normalized layer from a diplomatic
     * transcription (see App\Enums\TranscriptionLayer). Image-alignment
     * regions are never copied: for a different witness they'd point at
     * different (or no) images, and for a normalized layer they'd be
     * meaningless, since only the diplomatic text corresponds to marks on
     * parchment.
     */
    public function store(StoreTranscriptionForkRequest $request, Transcription $transcription): RedirectResponse
    {
        $fork = DB::transaction(function () use ($request, $transcription) {
            $fork = Transcription::create([
                'witness_id' => $request->validated('witness_id'),
                'user_id' => $request->user()->id,
                'forked_from_id' => $transcription->id,
                'layer' => $request->validated('layer') ?? $transcription->layer,
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
