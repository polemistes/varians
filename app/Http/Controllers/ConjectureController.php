<?php

namespace App\Http\Controllers;

use App\Enums\ConjectureType;
use App\Http\Requests\StoreConjectureRequest;
use App\Http\Requests\UpdateConjectureRequest;
use App\Models\Conjecture;
use App\Models\Segment;
use App\Support\Bibliography\ReferenceAttacher;
use App\Support\Edition\ConjectureShape;
use App\Support\Edition\EditionPublisher;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class ConjectureController extends Controller
{
    /**
     * Record a conjecture of any kind for a segment, as a catalogue entry —
     * applied to no edition and attached to no column. A substitution,
     * lacuna or supplement is later placed from an edition's variant panel;
     * a transposition or reordering is offered by the order report and
     * followed from there. A reordering hangs from the first segment of its
     * range by numbering order, whichever segment the form was opened on.
     */
    public function store(StoreConjectureRequest $request, Segment $segment): RedirectResponse
    {
        DB::transaction(function () use ($request, $segment) {
            $type = ConjectureType::from($request->validated('type') ?? ConjectureType::Substitution->value);
            $orderingIds = $type === ConjectureType::Reordering ? $request->validated('segment_ids') : null;
            $segmentId = $orderingIds !== null
                ? ConjectureShape::reorderingAnchor($segment->work, $orderingIds) ?? $segment->id
                : $segment->id;

            $conjecture = Conjecture::create([
                'segment_id' => $segmentId,
                'user_id' => $request->user()->id,
                'visibility' => EditionPublisher::visibilityForConjectureOn($segmentId),
                'type' => $type,
                'text' => $request->validated('text'),
                'extent' => $request->validated('extent'),
                'extent_characters' => $request->validated('extent_characters'),
                'supplements_conjecture_id' => $request->validated('supplements_conjecture_id'),
                'transposition_range_end_segment_id' => $type === ConjectureType::Transposition ? $request->validated('transposition_range_end_segment_id') : null,
                'move_target_segment_id' => $type === ConjectureType::Transposition ? $request->validated('move_target_segment_id') : null,
                'move_position' => $type === ConjectureType::Transposition ? $request->validated('move_position') : null,
                'proposed_by' => $request->validated('proposed_by'),
                'note' => $request->validated('note'),
            ]);

            if ($orderingIds !== null) {
                ConjectureShape::storeOrdering($conjecture, $orderingIds);
            }

            ReferenceAttacher::toConjecture($conjecture, $request->validated('references'));
        });

        return back();
    }

    /**
     * Change any of a conjecture's fields. A reordering's new sequence
     * replaces the old; a kind that no longer needs a field clears it.
     */
    public function update(UpdateConjectureRequest $request, Conjecture $conjecture): RedirectResponse
    {
        DB::transaction(function () use ($request, $conjecture) {
            $values = $request->validated();
            $orderingIds = $values['segment_ids'] ?? null;
            unset($values['segment_ids']);

            $conjecture->fill($values);
            $type = $conjecture->type;

            if ($type !== ConjectureType::Transposition) {
                $conjecture->transposition_range_end_segment_id = null;
                $conjecture->move_target_segment_id = null;
                $conjecture->move_position = null;
            }

            if ($type !== ConjectureType::Supplement) {
                $conjecture->supplements_conjecture_id = null;
            }

            if (! in_array($type, [ConjectureType::Substitution, ConjectureType::Supplement], true)) {
                $conjecture->text = null;
            }

            if ($type !== ConjectureType::Lacuna) {
                $conjecture->extent = null;
                $conjecture->extent_characters = null;
            }

            if ($type === ConjectureType::Reordering && $orderingIds !== null) {
                $conjecture->segment_id = ConjectureShape::reorderingAnchor($conjecture->segment->work, $orderingIds) ?? $conjecture->segment_id;
            }

            $conjecture->save();

            // Only a changed sequence is rewritten: editing the attribution
            // of an arrangement that divides lines must not flatten it.
            if ($type === ConjectureType::Reordering && $orderingIds !== null
                && array_map('intval', array_values($orderingIds)) !== ConjectureShape::orderedSegmentIds($conjecture)) {
                ConjectureShape::storeOrdering($conjecture, $orderingIds);
            } elseif ($type !== ConjectureType::Reordering) {
                $conjecture->orderingEntries()->delete();
            }
        });

        return back();
    }

    /**
     * Deleting cascades the conjecture's readings (and any edition's
     * selection of them), its adoptions and its bibliography citations — see
     * DeletionImpact::forConjecture for the preview shown first.
     */
    public function destroy(Conjecture $conjecture): RedirectResponse
    {
        $this->authorize('delete', $conjecture);

        $conjecture->delete();

        return back();
    }
}
