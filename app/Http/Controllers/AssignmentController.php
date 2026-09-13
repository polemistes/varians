<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReassignRequest;
use App\Http\Requests\StoreAssignmentRequest;
use App\Http\Requests\UpdateAssignmentRequest;
use App\Models\Assignment;
use App\Models\EditionLemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\Work;
use App\Support\Edition\SegmentAligner;
use App\Support\Edition\SegmentResolver;
use App\Support\Transcription\AssignmentBounds;
use App\Support\Transcription\AssignmentIntegrity;
use App\Support\Transcription\SiblingSync;
use App\Support\Transcription\WorkOwnership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AssignmentController extends Controller
{
    /**
     * Mark a span and assign it in one step — a span with no assignment has no
     * use to anyone, so the two never happen separately.
     *
     * Assigning a segment this layer already assigns is not an error but another
     * *part* of it — the witness's text for the segment is discontinuous, a
     * transposition having split it. `after_part` places the new span in the
     * segment's content order (0 = first; absent = last). When the layer was
     * already collated on the segment, its readings no longer cover its text,
     * so saving re-collates — behind `acknowledge_realignment`, since the
     * editor should get to cancel before her collation is touched.
     */
    public function store(StoreAssignmentRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $this->authorize('update', Work::findOrFail((int) $request->validated('work_id')));

        $segment = $this->resolveAssignment((int) $request->validated('work_id'), $request->validated('label'));
        WorkOwnership::guard($transcription->transcription, $segment->work);

        DB::transaction(function () use ($request, $transcription, $segment) {
            $aligned = $this->guardLatePart($request, $transcription, $segment);

            $group = (string) Str::uuid();

            // Assigned on whole words, whatever the selection took in at its
            // edges — see AssignmentBounds.
            [$start, $end] = AssignmentBounds::wholeWords(
                $transcription->text,
                (int) $request->validated('start_offset'),
                (int) $request->validated('end_offset'),
            );
            $this->guardAssignable($transcription, $start, $end);

            $transcription->assignments()->create([
                'segment_id' => $segment->id,
                'start_offset' => $start,
                'end_offset' => $end,
                'part' => $this->placePart($request, $transcription, $segment),
                'group_id' => $group,
            ]);

            if ($aligned) {
                $this->recollateLayer($transcription, $segment);
            }

            $this->syncSiblingAssignment(
                $request,
                $transcription,
                $segment,
                (int) $request->validated('start_offset'),
                (int) $request->validated('end_offset'),
                $group,
            );
        });

        $this->snapAssignments($transcription);

        return back();
    }

    /**
     * An assignment is DONE ONCE: the in-step sibling layer receives the
     * same assignment on the same words, projected into its own spelling.
     * When the sibling's collation already covers the segment, its readings
     * are kept and its parts flagged rather than silently re-collated —
     * the acknowledgment flow belongs to the layer the editor is acting in.
     */
    private function syncSiblingAssignment(FormRequest $request, TranscriptionLayer $layer, Segment $segment, int $start, int $end, string $group): void
    {
        $sibling = SiblingSync::inStepSibling($layer);

        if ($sibling === null) {
            return;
        }

        [$siblingStart, $siblingEnd] = SiblingSync::projectRange($layer, $sibling, $start, $end);

        if ($siblingEnd <= $siblingStart) {
            return;
        }

        // Text is assigned once: where the sibling already assigns any of
        // these words — to this segment or another — nothing is added.
        $taken = $sibling->assignments()
            ->where('start_offset', '<', $siblingEnd)
            ->where('end_offset', '>', $siblingStart)
            ->exists();

        if ($taken) {
            return;
        }

        $aligned = SegmentAligner::layerReadings($segment, $sibling)->isNotEmpty();

        $sibling->assignments()->create([
            'segment_id' => $segment->id,
            'start_offset' => $siblingStart,
            'end_offset' => $siblingEnd,
            'part' => $this->placePart($request, $sibling, $segment),
            'group_id' => $group,
        ]);

        if ($aligned) {
            $this->recollateLayer($sibling, $segment);
        }
    }

    /**
     * The other layer's half of this span — one identity, linked by the
     * shared group, immune to the layers drifting apart.
     */
    private function siblingCounterpart(Assignment $assignment): ?Assignment
    {
        return SiblingSync::counterpartAssignment($assignment);
    }

    /**
     * Re-draw a span's boundaries — e.g. to resolve a needs-review flag after
     * the underlying text changed. A manual re-selection is a live human
     * confirmation, so it always clears the flag.
     */
    public function update(UpdateAssignmentRequest $request, Assignment $assignment): RedirectResponse
    {
        DB::transaction(function () use ($request, $assignment) {
            // An editor's own bounds are snapped out to whole words: half
            // a word is no assignment, and the aligner reads words.
            [$start, $end] = AssignmentBounds::wholeWords(
                $assignment->transcriptionLayer->text,
                (int) $request->validated('start_offset'),
                (int) $request->validated('end_offset'),
            );
            $this->guardAssignable($assignment->transcriptionLayer, $start, $end, $assignment);

            $assignment->update(['start_offset' => $start, 'end_offset' => $end, 'needs_review' => false]);
            SiblingSync::followAssignment($assignment);
        });

        $this->snapAssignments($assignment->transcriptionLayer);

        return back();
    }

    /**
     * Re-assign this assignment to a different segment within a work. There's no
     * way to clear an assignment's assignment — remove the span instead if it's no
     * longer wanted.
     *
     * Re-assigning to a segment the layer already assigns makes this span another
     * part of it, through the same late-part guard as `store` — see there.
     */
    public function reassign(ReassignRequest $request, Assignment $assignment): RedirectResponse
    {
        $this->authorize('update', Work::findOrFail((int) $request->validated('work_id')));

        $segment = $this->resolveAssignment((int) $request->validated('work_id'), $request->validated('label'));

        if ($assignment->segment_id === $segment->id) {
            $this->snapAssignments($assignment->transcriptionLayer);

            return back();
        }

        WorkOwnership::guard($assignment->transcriptionLayer->transcription, $segment->work);

        DB::transaction(function () use ($request, $assignment, $segment) {
            $layer = $assignment->transcriptionLayer;
            $former = $assignment->segment;
            $aligned = $this->guardLatePart($request, $layer, $segment);
            $counterpart = $this->siblingCounterpart($assignment);

            $assignment->update([
                'segment_id' => $segment->id,
                'part' => $this->placePart($request, $layer, $segment),
            ]);

            if ($aligned) {
                $this->recollateLayer($layer, $segment);
            }

            // The words left the segment they were collated into.
            $this->recollateAfterRemoval($layer, $former);

            if ($counterpart !== null) {
                $sibling = $counterpart->transcriptionLayer;
                $siblingAligned = SegmentAligner::layerReadings($segment, $sibling)->isNotEmpty();

                $counterpart->update([
                    'segment_id' => $segment->id,
                    'part' => $this->placePart($request, $sibling, $segment),
                ]);

                if ($siblingAligned) {
                    $this->recollateLayer($sibling, $segment);
                }

                $this->recollateAfterRemoval($sibling, $former);
            }
        });

        return back();
    }

    public function destroy(Assignment $assignment): RedirectResponse
    {
        $this->authorize('update', $assignment->transcriptionLayer);

        DB::transaction(function () use ($assignment) {
            $segment = $assignment->segment;
            $layer = $assignment->transcriptionLayer;
            $counterpart = $this->siblingCounterpart($assignment);
            $sibling = $counterpart?->transcriptionLayer;

            $counterpart?->delete();
            $assignment->delete();

            // The segment's collation of this layer read these words; it
            // must not go on reporting them (real bug: a removed span left
            // its readings behind, and the witness stayed in the apparatus).
            $this->recollateAfterRemoval($layer, $segment);

            if ($sibling !== null) {
                $this->recollateAfterRemoval($sibling, $segment);
            }
        });

        return back();
    }

    /**
     * Text is assigned ONCE (user decision): a span must hold words, and may
     * not overlap another assignment of the layer — to any segment of any
     * work. Refused here, where the span is made, rather than tolerated and
     * flagged afterwards; AssignmentIntegrity's overlap check stays only as
     * a report on data that predates this rule.
     */
    private function guardAssignable(TranscriptionLayer $layer, int $start, int $end, ?Assignment $except = null): void
    {
        if ($end <= $start) {
            throw ValidationException::withMessages([
                'start_offset' => 'Select some words to assign — a span of nothing but whitespace is no assignment.',
            ]);
        }

        $overlapping = $layer->assignments()
            ->where('start_offset', '<', $end)
            ->where('end_offset', '>', $start)
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except->id))
            ->with('segment:id,label')
            ->orderBy('start_offset')
            ->first();

        if ($overlapping !== null) {
            throw ValidationException::withMessages([
                'start_offset' => 'Some of these words are already assigned to '
                    .($overlapping->segment->label ?? 'a segment')
                    .' — text is assigned once. Remove or shrink that span first.',
            ]);
        }
    }

    /**
     * A layer that stops assigning (some of) a segment's text still has its
     * readings on the segment's columns, collated from words it no longer
     * claims. Re-derive from the parts that remain — none left, and the
     * layer's readings go with them, so the witness drops out of that
     * segment's apparatus. Where an edition pins the readings they are kept
     * (selections cascade) and what remains is flagged for review: the
     * surviving parts, or the readings themselves when no part is left to
     * carry the flag.
     */
    private function recollateAfterRemoval(TranscriptionLayer $layer, Segment $segment): void
    {
        $readings = SegmentAligner::layerReadings($segment, $layer);

        if ($readings->isEmpty() || SegmentAligner::realignLayer($segment, $layer)) {
            return;
        }

        $parts = $layer->assignments()->where('segment_id', $segment->id);

        if ($parts->exists()) {
            $parts->update(['needs_review' => true]);

            return;
        }

        LemmaReading::whereIn('id', $readings->pluck('id'))->update(['needs_review' => true]);
    }

    /**
     * Resolve a work + label into a segment, creating it if it
     * doesn't exist yet. The transcription's witness becomes related to the
     * work through this assignment — that relationship is derived, not stored.
     */
    private function resolveAssignment(int $workId, string $label): Segment
    {
        return SegmentResolver::resolve(Work::findOrFail($workId), $label);
    }

    /**
     * Whether this assignment lands on a segment the layer was already collated
     * into — in which case its existing readings no longer cover its text,
     * and saving must re-collate (or flag, where re-collation is blocked).
     *
     * That consequence touches collation the editor may not have in view, so
     * it is refused until acknowledged: the response tells her exactly what
     * saving will do, and cancelling leaves everything untouched.
     */
    private function guardLatePart(FormRequest $request, TranscriptionLayer $layer, Segment $segment): bool
    {
        $aligned = SegmentAligner::layerReadings($segment, $layer)->isNotEmpty();

        if ($aligned && ! $request->boolean('acknowledge_realignment')) {
            throw ValidationException::withMessages([
                'acknowledge_realignment' => $this->realignmentWarning($layer, $segment),
            ]);
        }

        return $aligned;
    }

    private function realignmentWarning(TranscriptionLayer $layer, Segment $segment): string
    {
        $pinned = SegmentAligner::pinnedReadings($segment, $layer);

        if ($pinned->isEmpty()) {
            return 'This witness was already collated on “'.$segment->label.'” — saving will redo that collation from all its parts.';
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

        return 'This witness\'s collated readings for “'.$segment->label.'” are pinned by '.$editions
            .', so they can\'t be redone automatically — saving keeps them as they are and flags the assignment for review.';
    }

    /**
     * The content-order slot for a span joining a segment's assignment:
     * `after_part` inserts it there (0 = first), shifting later parts down;
     * absent, it reads last.
     */
    private function placePart(FormRequest $request, TranscriptionLayer $layer, Segment $segment): int
    {
        $siblings = $layer->assignments()->where('segment_id', $segment->id);
        $afterPart = $request->validated('after_part');

        if ($afterPart === null) {
            return ((int) $siblings->max('part')) + 1;
        }

        $siblings->clone()->where('part', '>', (int) $afterPart)->increment('part');

        return (int) $afterPart + 1;
    }

    /**
     * Redo a layer's collation on a segment whose assignment just changed —
     * or, where its readings are pinned and must not be deleted, keep them
     * and flag every part for review so the stale alignment is visible.
     */
    private function recollateLayer(TranscriptionLayer $layer, Segment $segment): void
    {
        if (! SegmentAligner::realignLayer($segment, $layer)) {
            $layer->assignments()
                ->where('segment_id', $segment->id)
                ->update(['needs_review' => true]);
        }
    }

    /**
     * After any assignment change, both layers' spans are held to their
     * words (AssignmentIntegrity::snap) — the sibling receives projected
     * bounds, and a projection of a drifted span drifts further.
     */
    private function snapAssignments(TranscriptionLayer $layer): void
    {
        foreach ($layer->transcription->layers as $sibling) {
            AssignmentIntegrity::snap($sibling);
        }
    }
}
