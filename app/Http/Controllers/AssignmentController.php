<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReassignRequest;
use App\Http\Requests\StoreAssignmentRequest;
use App\Http\Requests\UpdateAssignmentRequest;
use App\Models\CanonicalPassage;
use App\Models\EditionLemma;
use App\Models\TranscriptionLayer;
use App\Models\Assignment;
use App\Models\Work;
use App\Support\Edition\CanonicalPassageResolver;
use App\Support\Edition\PassageAligner;
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
     * Assigning a passage this layer already assigns is not an error but another
     * *part* of it — the witness's text for the passage is discontinuous, a
     * transposition having split it. `after_part` places the new span in the
     * passage's content order (0 = first; absent = last). When the layer was
     * already collated on the passage, its readings no longer cover its text,
     * so saving re-collates — behind `acknowledge_realignment`, since the
     * editor should get to cancel before her collation is touched.
     */
    public function store(StoreAssignmentRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $this->authorize('update', Work::findOrFail((int) $request->validated('work_id')));

        $passage = $this->resolveAssignment((int) $request->validated('work_id'), $request->validated('label'));
        WorkOwnership::guard($transcription->transcription, $passage->work);

        DB::transaction(function () use ($request, $transcription, $passage) {
            $aligned = $this->guardLatePart($request, $transcription, $passage);

            $group = (string) Str::uuid();

            // Assigned on whole words, whatever the selection took in at its
            // edges — see AssignmentBounds.
            [$start, $end] = AssignmentBounds::wholeWords(
                $transcription->text,
                (int) $request->validated('start_offset'),
                (int) $request->validated('end_offset'),
            );

            $transcription->assignments()->create([
                'canonical_passage_id' => $passage->id,
                'start_offset' => $start,
                'end_offset' => $end,
                'part' => $this->placePart($request, $transcription, $passage),
                'group_id' => $group,
            ]);

            if ($aligned) {
                $this->recollateLayer($transcription, $passage);
            }

            $this->syncSiblingAssignment(
                $request,
                $transcription,
                $passage,
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
     * When the sibling's collation already covers the passage, its readings
     * are kept and its parts flagged rather than silently re-collated —
     * the acknowledgment flow belongs to the layer the editor is acting in.
     */
    private function syncSiblingAssignment(FormRequest $request, TranscriptionLayer $layer, CanonicalPassage $passage, int $start, int $end, string $group): void
    {
        $sibling = SiblingSync::inStepSibling($layer);

        if ($sibling === null) {
            return;
        }

        [$siblingStart, $siblingEnd] = SiblingSync::projectRange($layer, $sibling, $start, $end);

        if ($siblingEnd <= $siblingStart) {
            return;
        }

        // Already assigned there on exactly these words — nothing to add.
        $exists = $sibling->assignments()
            ->where('canonical_passage_id', $passage->id)
            ->where('start_offset', $siblingStart)
            ->where('end_offset', $siblingEnd)
            ->exists();

        if ($exists) {
            return;
        }

        $aligned = PassageAligner::layerReadings($passage, $sibling)->isNotEmpty();

        $sibling->assignments()->create([
            'canonical_passage_id' => $passage->id,
            'start_offset' => $siblingStart,
            'end_offset' => $siblingEnd,
            'part' => $this->placePart($request, $sibling, $passage),
            'group_id' => $group,
        ]);

        if ($aligned) {
            $this->recollateLayer($sibling, $passage);
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

            $assignment->update(['start_offset' => $start, 'end_offset' => $end, 'needs_review' => false]);
            SiblingSync::followAssignment($assignment);
        });

        $this->snapAssignments($assignment->transcriptionLayer);

        return back();
    }

    /**
     * Re-assign this assignment to a different passage within a work. There's no
     * way to clear an assignment's assignment — remove the span instead if it's no
     * longer wanted.
     *
     * Re-assigning to a passage the layer already assigns makes this span another
     * part of it, through the same late-part guard as `store` — see there.
     */
    public function reassign(ReassignRequest $request, Assignment $assignment): RedirectResponse
    {
        $this->authorize('update', Work::findOrFail((int) $request->validated('work_id')));

        $passage = $this->resolveAssignment((int) $request->validated('work_id'), $request->validated('label'));

        if ($assignment->canonical_passage_id === $passage->id) {
            $this->snapAssignments($assignment->transcriptionLayer);

            return back();
        }

        WorkOwnership::guard($assignment->transcriptionLayer->transcription, $passage->work);

        DB::transaction(function () use ($request, $assignment, $passage) {
            $layer = $assignment->transcriptionLayer;
            $aligned = $this->guardLatePart($request, $layer, $passage);
            $counterpart = $this->siblingCounterpart($assignment);

            $assignment->update([
                'canonical_passage_id' => $passage->id,
                'part' => $this->placePart($request, $layer, $passage),
            ]);

            if ($aligned) {
                $this->recollateLayer($layer, $passage);
            }

            if ($counterpart !== null) {
                $sibling = $counterpart->transcriptionLayer;
                $siblingAligned = PassageAligner::layerReadings($passage, $sibling)->isNotEmpty();

                $counterpart->update([
                    'canonical_passage_id' => $passage->id,
                    'part' => $this->placePart($request, $sibling, $passage),
                ]);

                if ($siblingAligned) {
                    $this->recollateLayer($sibling, $passage);
                }
            }
        });

        return back();
    }

    public function destroy(Assignment $assignment): RedirectResponse
    {
        $this->authorize('update', $assignment->transcriptionLayer);

        DB::transaction(function () use ($assignment) {
            $this->siblingCounterpart($assignment)?->delete();
            $assignment->delete();
        });

        return back();
    }

    /**
     * Resolve a work + label into a canonical passage, creating it if it
     * doesn't exist yet. The transcription's witness becomes related to the
     * work through this assignment — that relationship is derived, not stored.
     */
    private function resolveAssignment(int $workId, string $label): CanonicalPassage
    {
        return CanonicalPassageResolver::resolve(Work::findOrFail($workId), $label);
    }

    /**
     * Whether this assignment lands on a passage the layer was already collated
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
            .', so they can\'t be redone automatically — saving keeps them as they are and flags the assignment for review.';
    }

    /**
     * The content-order slot for a span joining a passage's assignment:
     * `after_part` inserts it there (0 = first), shifting later parts down;
     * absent, it reads last.
     */
    private function placePart(FormRequest $request, TranscriptionLayer $layer, CanonicalPassage $passage): int
    {
        $siblings = $layer->assignments()->where('canonical_passage_id', $passage->id);
        $afterPart = $request->validated('after_part');

        if ($afterPart === null) {
            return ((int) $siblings->max('part')) + 1;
        }

        $siblings->clone()->where('part', '>', (int) $afterPart)->increment('part');

        return (int) $afterPart + 1;
    }

    /**
     * Redo a layer's collation on a passage whose assignment just changed —
     * or, where its readings are pinned and must not be deleted, keep them
     * and flag every part for review so the stale alignment is visible.
     */
    private function recollateLayer(TranscriptionLayer $layer, CanonicalPassage $passage): void
    {
        if (! PassageAligner::realignLayer($passage, $layer)) {
            $layer->assignments()
                ->where('canonical_passage_id', $passage->id)
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
