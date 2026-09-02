<?php

namespace App\Http\Controllers;

use App\Http\Requests\AssignTranscriptionSegmentRequest;
use App\Http\Requests\StoreTranscriptionSegmentRequest;
use App\Http\Requests\UpdateTranscriptionSegmentRequest;
use App\Models\CanonicalPassage;
use App\Models\EditionLemma;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\Work;
use App\Support\Edition\CanonicalPassageResolver;
use App\Support\Edition\PassageAligner;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TranscriptionSegmentController extends Controller
{
    /**
     * Mark a span and cite it in one step — a span with no citation has no
     * use to anyone, so the two never happen separately.
     *
     * Citing a passage this layer already cites is not an error but another
     * *part* of it — the witness's text for the passage is discontinuous, a
     * transposition having split it. `after_part` places the new span in the
     * passage's content order (0 = first; absent = last). When the layer was
     * already collated on the passage, its readings no longer cover its text,
     * so saving re-collates — behind `acknowledge_realignment`, since the
     * editor should get to cancel before her collation is touched.
     */
    public function store(StoreTranscriptionSegmentRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $passage = $this->resolveCitation((int) $request->validated('work_id'), $request->validated('label'));

        DB::transaction(function () use ($request, $transcription, $passage) {
            $aligned = $this->guardLatePart($request, $transcription, $passage);

            $transcription->segments()->create([
                'canonical_passage_id' => $passage->id,
                'start_offset' => $request->validated('start_offset'),
                'end_offset' => $request->validated('end_offset'),
                'part' => $this->placePart($request, $transcription, $passage),
            ]);

            if ($aligned) {
                $this->recollateLayer($transcription, $passage);
            }
        });

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
     *
     * Re-citing to a passage the layer already cites makes this span another
     * part of it, through the same late-part guard as `store` — see there.
     */
    public function assignCitation(AssignTranscriptionSegmentRequest $request, TranscriptionSegment $segment): RedirectResponse
    {
        $passage = $this->resolveCitation((int) $request->validated('work_id'), $request->validated('label'));

        if ($segment->canonical_passage_id === $passage->id) {
            return back();
        }

        DB::transaction(function () use ($request, $segment, $passage) {
            $layer = $segment->transcriptionLayer;
            $aligned = $this->guardLatePart($request, $layer, $passage);

            $segment->update([
                'canonical_passage_id' => $passage->id,
                'part' => $this->placePart($request, $layer, $passage),
            ]);

            if ($aligned) {
                $this->recollateLayer($layer, $passage);
            }
        });

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

    /**
     * Whether this citation lands on a passage the layer was already collated
     * into — in which case its existing readings no longer cover its text,
     * and saving must re-collate (or flag, where re-collation is blocked).
     *
     * That consequence touches collation the editor may not have in view, so
     * it is refused until acknowledged: the response tells her exactly what
     * saving will do, and cancelling leaves everything untouched.
     */
    private function guardLatePart(FormRequest $request, TranscriptionLayer $layer, CanonicalPassage $passage): bool
    {
        $aligned = PassageAligner::layerReadings($passage, $layer)->isNotEmpty();

        if ($aligned && ! $request->boolean('acknowledge_realignment')) {
            throw ValidationException::withMessages([
                'acknowledge_realignment' => $this->realignmentWarning($layer, $passage),
            ]);
        }

        return $aligned;
    }

    private function realignmentWarning(TranscriptionLayer $layer, CanonicalPassage $passage): string
    {
        $pinned = PassageAligner::pinnedReadings($passage, $layer);

        if ($pinned->isEmpty()) {
            return 'This witness was already collated on “'.$passage->label.'” — saving will redo that collation from all its parts.';
        }

        $titles = EditionLemma::whereIn('selected_reading_id', $pinned->pluck('id'))
            ->with('edition:id,title')
            ->get()
            ->map(fn (EditionLemma $selection) => $selection->edition->title)
            ->unique()
            ->values();

        $editions = $titles->isEmpty()
            ? 'editorial decisions'
            : 'the edition'.($titles->count() === 1 ? '' : 's').' '.$titles->map(fn (string $title) => '“'.$title.'”')->join(', ', ' and ');

        return 'This witness\'s collated readings for “'.$passage->label.'” are pinned by '.$editions
            .', so they can\'t be redone automatically — saving keeps them as they are and flags the citation for review.';
    }

    /**
     * The content-order slot for a span joining a passage's citation:
     * `after_part` inserts it there (0 = first), shifting later parts down;
     * absent, it reads last.
     */
    private function placePart(FormRequest $request, TranscriptionLayer $layer, CanonicalPassage $passage): int
    {
        $siblings = $layer->segments()->where('canonical_passage_id', $passage->id);
        $afterPart = $request->validated('after_part');

        if ($afterPart === null) {
            return ((int) $siblings->max('part')) + 1;
        }

        $siblings->clone()->where('part', '>', (int) $afterPart)->increment('part');

        return (int) $afterPart + 1;
    }

    /**
     * Redo a layer's collation on a passage whose citation just changed —
     * or, where its readings are pinned and must not be deleted, keep them
     * and flag every part for review so the stale alignment is visible.
     */
    private function recollateLayer(TranscriptionLayer $layer, CanonicalPassage $passage): void
    {
        if (! PassageAligner::realignLayer($passage, $layer)) {
            $layer->segments()
                ->where('canonical_passage_id', $passage->id)
                ->update(['needs_review' => true]);
        }
    }
}
