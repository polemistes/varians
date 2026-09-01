<?php

namespace App\Http\Controllers;

use App\Http\Requests\AssignTranscriptionSegmentRequest;
use App\Http\Requests\StoreTranscriptionSegmentRequest;
use App\Http\Requests\UpdateTranscriptionSegmentRequest;
use App\Models\CanonicalPassage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\Work;
use App\Support\Edition\CanonicalPassageResolver;
use Illuminate\Http\RedirectResponse;

class TranscriptionSegmentController extends Controller
{
    /**
     * Mark a span and cite it in one step — a span with no citation has no
     * use to anyone, so the two never happen separately.
     */
    public function store(StoreTranscriptionSegmentRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $passage = $this->resolveCitation((int) $request->validated('work_id'), $request->validated('label'));

        $transcription->segments()->create([
            'canonical_passage_id' => $passage->id,
            'start_offset' => $request->validated('start_offset'),
            'end_offset' => $request->validated('end_offset'),
        ]);

        return back();
    }

    /**
     * Re-draw a span's boundaries — e.g. to resolve a needs-review flag after
     * the underlying text changed. A manual re-selection is a live human
     * confirmation, so it always clears the flag.
     */
    public function update(UpdateTranscriptionSegmentRequest $request, TranscriptionSegment $segment): RedirectResponse
    {
        $segment->update([...$request->validated(), 'needs_review' => false]);

        return back();
    }

    /**
     * Re-cite this segment to a different passage within a work. There's no
     * way to clear a segment's citation — remove the span instead if it's no
     * longer wanted.
     */
    public function assignCitation(AssignTranscriptionSegmentRequest $request, TranscriptionSegment $segment): RedirectResponse
    {
        $passage = $this->resolveCitation((int) $request->validated('work_id'), $request->validated('label'));

        $segment->update(['canonical_passage_id' => $passage->id]);

        return back();
    }

    public function destroy(TranscriptionSegment $segment): RedirectResponse
    {
        $segment->delete();

        return back();
    }

    /**
     * Resolve a work + label into a canonical passage, creating it if it
     * doesn't exist yet. The transcription's witness becomes related to the
     * work through this citation — that relationship is derived, not stored.
     */
    private function resolveCitation(int $workId, string $label): CanonicalPassage
    {
        return CanonicalPassageResolver::resolve(Work::findOrFail($workId), $label);
    }
}
