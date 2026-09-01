<?php

namespace App\Http\Controllers;

use App\Http\Requests\AssignTranscriptionSegmentRequest;
use App\Http\Requests\MoveTranscriptionSegmentRequest;
use App\Http\Requests\StoreTranscriptionSegmentRequest;
use App\Http\Requests\UpdateTranscriptionSegmentRequest;
use App\Models\CanonicalPassage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\Work;
use App\Support\Edition\CanonicalPassageResolver;
use App\Support\Transcription\SpanTransformer;
use App\Support\Transcription\TextOpApplier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

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
     * Move a cited passage, text and citation together, to another place in
     * the same layer.
     *
     * Done by hand this loses the citation: a deletion covering a cited span
     * destroys it, so cutting the words and pasting them elsewhere leaves the
     * assignment behind. Since assigning text to passages is most of the work
     * of a collation, that is worth an operation of its own.
     *
     * What travels with the words is what is anchored *to those words* — the
     * citation itself, any image alignment on them, any collated reading of
     * them — because none of that is changed by the words sitting somewhere
     * else in the document. Everything outside simply shifts, through the same
     * SpanTransformer that handles an ordinary edit.
     *
     * Page divisions are the exception, and deliberately: a page is a leaf of
     * a manuscript, and reordering a transcription does not move it. They go
     * through the ordinary transform like any other edit — see
     * TranscriptionTextController::applyPageBreaks.
     */
    public function move(MoveTranscriptionSegmentRequest $request, TranscriptionSegment $segment): RedirectResponse
    {
        DB::transaction(function () use ($request, $segment) {
            $layer = $segment->transcriptionLayer;
            $start = (int) $segment->start_offset;
            $end = (int) $segment->end_offset;

            // A cited passage is usually a whole line, and the line break is
            // part of what makes it one. Moving the words without it fuses
            // them with whatever they land against — προΐαψενμῆνιν — which
            // changes what the text says, not merely its order, and turns two
            // words into one for collation.
            $atLineStart = $start === 0 || mb_substr($layer->text, $start - 1, 1) === "\n";
            $atLineEnd = mb_substr($layer->text, $end, 1) === "\n";
            $sliceEnd = $atLineStart && $atLineEnd ? $end + 1 : $end;

            ['ops' => $ops, 'destination' => $destination] = SpanTransformer::relocation(
                $layer->text, $start, $sliceEnd, (int) $request->validated('target_offset'),
            );

            $delta = $destination - $start;

            foreach ([$layer->segments()->get(), $layer->regions()->get(), $layer->lemmaReadings()->whereNotNull('start_offset')->get()] as $anchored) {
                foreach ($anchored as $span) {
                    if ($span->start_offset >= $start && $span->end_offset <= $sliceEnd) {
                        $span->update([
                            'start_offset' => $span->start_offset + $delta,
                            'end_offset' => $span->end_offset + $delta,
                        ]);

                        continue;
                    }

                    $result = SpanTransformer::transform([[
                        'start' => (int) $span->start_offset,
                        'end' => (int) $span->end_offset,
                        'needsReview' => (bool) $span->needs_review,
                    ]], $ops)[0];

                    if ($result['deleted']) {
                        $span->delete();

                        continue;
                    }

                    $span->update([
                        'start_offset' => $result['start'],
                        'end_offset' => $result['end'],
                        'needs_review' => $result['needsReview'],
                    ]);
                }
            }

            $layer->update(['text' => TextOpApplier::applyAll($layer->text, $ops)]);
        });

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
