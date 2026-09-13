<?php

namespace App\Support\Edition;

use App\Models\Conjecture;
use App\Models\EditionLemma;
use App\Models\EditionTransposition;
use App\Models\User;
use App\Models\Work;

/**
 * A work's whole stockpile of conjectures as the pages present and edit
 * it — the Work page's list, and the edition page's notice, where pressing
 * a conjecture's name opens the same edit form (editors) or its
 * bibliography (readers). One builder, so the two never disagree about
 * what a conjecture looks like.
 */
class ConjectureCatalogue
{
    /**
     * Every conjecture recorded against a segment of the work, with what
     * the list needs to show and edit it: its segments by label, its
     * sequence (a reordering), its bibliography citations, and where it is in use.
     *
     * @return list<array<string, mixed>>
     */
    public static function forWork(Work $work, ?User $viewer = null): array
    {
        $conjectures = Conjecture::query()
            ->whereHas('segment', fn ($query) => $query->where('work_id', $work->id))
            ->visibleTo($viewer)
            ->with([
                'segment:id,label,sort_key',
                'transpositionRangeEnd:id,label',
                'moveTarget:id,label',
                'supplements.segment:id,label',
                'supplements.user:id,name',
                'orderingEntries.segment:id,label',
                'references.item',
                'user:id,name',
            ])
            // The counts the delete confirmation shows, taken in the same
            // query rather than five per conjecture (real incident: a page
            // running over a thousand queries).
            ->withCount(['lemmaReadings', 'suppliedBy', 'references'])
            ->get()
            ->sortBy(fn (Conjecture $conjecture) => [$conjecture->segment->sort_key, $conjecture->id])
            ->values();

        $adoptedBy = EditionTransposition::query()
            ->whereIn('conjecture_id', $conjectures->pluck('id'))
            ->with('edition:id,title')
            ->get()
            ->groupBy('conjecture_id');

        $selectedBy = EditionLemma::query()
            ->whereHas('selectedReading', fn ($query) => $query->whereIn('conjecture_id', $conjectures->pluck('id')))
            ->with(['edition:id,title', 'selectedReading:id,conjecture_id'])
            ->get()
            ->groupBy(fn (EditionLemma $selection): int => (int) $selection->selectedReading->conjecture_id);

        $entries = [];

        foreach ($conjectures as $conjecture) {
            $entries[] = [
                'id' => $conjecture->id,
                'type' => $conjecture->type->value,
                'segment_id' => $conjecture->segment_id,
                'segment_label' => $conjecture->segment->label,
                'text' => $conjecture->text,
                'extent' => $conjecture->extent,
                'extent_characters' => $conjecture->extent_characters,
                'supplements_conjecture_id' => $conjecture->supplements_conjecture_id,
                'supplements_label' => $conjecture->supplements !== null
                    ? $conjecture->supplements->segment->label.' — '.($conjecture->supplements->proposed_by ?? $conjecture->supplements->user->name)
                    : null,
                'transposition_range_end_segment_id' => $conjecture->transposition_range_end_segment_id,
                'range_end_label' => $conjecture->transpositionRangeEnd?->label,
                'move_target_segment_id' => $conjecture->move_target_segment_id,
                'target_label' => $conjecture->moveTarget?->label,
                'move_position' => $conjecture->move_position,
                'ordering' => self::orderingPieces($conjecture),
                'proposed_by' => $conjecture->proposed_by,
                'entered_by' => $conjecture->user->name,
                'note' => $conjecture->note,
                'references' => $conjecture->references->map(fn ($reference) => [
                    'id' => $reference->id,
                    'item_id' => $reference->bibliography_item_id,
                    'label' => $reference->item->label,
                    'citation' => $reference->citation(),
                    'prenote' => $reference->prenote,
                    'postnote' => $reference->postnote,
                ])->values()->all(),
                'placed' => $conjecture->lemma_readings_count > 0,
                'adopted_by' => ($adoptedBy[$conjecture->id] ?? collect())->map(fn ($adoption) => $adoption->edition->title)->unique()->values()->all(),
                'selected_by' => ($selectedBy[$conjecture->id] ?? collect())->map(fn ($selection) => $selection->edition->title)->unique()->values()->all(),
                'deletion_impact' => [
                    'readings' => (int) $conjecture->lemma_readings_count,
                    'editionSelections' => ($selectedBy[$conjecture->id] ?? collect())->count(),
                    'adoptions' => ($adoptedBy[$conjecture->id] ?? collect())->count(),
                    'supplements' => (int) $conjecture->supplied_by_count,
                    'citations' => (int) $conjecture->references_count,
                ],
            ];
        }

        return $entries;
    }

    /**
     * The pieces of a reordering in proposed order — a divided segment's
     * parts labelled "3 2/2", the way the apparatus cites a witness's.
     *
     * @return list<array{id: int, label: string}>
     */
    private static function orderingPieces(Conjecture $conjecture): array
    {
        $counts = $conjecture->orderingEntries->countBy('segment_id');

        $pieces = [];

        foreach ($conjecture->orderingEntries->sortBy('sequence') as $entry) {
            $count = (int) ($counts[$entry->segment_id] ?? 1);
            $pieces[] = [
                'id' => (int) $entry->segment_id,
                'label' => $count > 1
                    ? sprintf('%s %d/%d', $entry->segment->label, $entry->part, $count)
                    : (string) $entry->segment->label,
            ];
        }

        return $pieces;
    }
}
