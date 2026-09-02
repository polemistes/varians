<?php

namespace App\Support\Edition;

use App\Models\Edition;
use App\Models\EditionPassage;
use Illuminate\Support\Collection;

/**
 * The one place an edition's stored passage order changes. Since the
 * materialized-order redesign, `EditionPassage.position` IS the printed
 * order — nothing is reordered at render time any more — so every move
 * (a cut-and-paste of passages, applying a transposition proposal, applying
 * a witness's order) comes through here, rewrites positions inside one
 * locked transaction, and renumbers the whole edition 1..n. Renumbering
 * wholesale is deliberate: positions carry no meaning beyond their order,
 * and midpoint arithmetic that never renumbers eventually exhausts decimal
 * precision.
 *
 * Callers are expected to run inside a DB transaction (both methods lock
 * the edition's rows with lockForUpdate).
 */
class PassageOrderRewriter
{
    /**
     * Move the contiguous run of passages between two canonical passages
     * (inclusive, located by current position) to before/after a target
     * passage outside the run. Returns false, touching nothing, when a
     * named passage isn't in the edition or the target sits inside the run
     * — the same silent-bail contract the render-time machinery had.
     */
    public static function moveRange(
        Edition $edition,
        int $rangeStartCanonicalPassageId,
        ?int $rangeEndCanonicalPassageId,
        int $targetCanonicalPassageId,
        string $movePosition,
    ): bool {
        $ordered = self::lockedPassages($edition);
        $byCanonicalId = $ordered->keyBy('canonical_passage_id');

        $start = $byCanonicalId->get($rangeStartCanonicalPassageId);
        $end = $byCanonicalId->get($rangeEndCanonicalPassageId ?? $rangeStartCanonicalPassageId);
        $target = $byCanonicalId->get($targetCanonicalPassageId);

        if ($start === null || $end === null || $target === null) {
            return false;
        }

        $from = min((float) $start->position, (float) $end->position);
        $to = max((float) $start->position, (float) $end->position);
        $targetPosition = (float) $target->position;

        if ($targetPosition >= $from && $targetPosition <= $to) {
            return false;
        }

        $moved = [];
        $remaining = [];

        foreach ($ordered as $passage) {
            $position = (float) $passage->position;

            if ($position >= $from && $position <= $to) {
                $moved[] = $passage;
            } else {
                $remaining[] = $passage;
            }
        }

        $targetIndex = null;

        foreach ($remaining as $index => $passage) {
            if ($passage->canonical_passage_id === $targetCanonicalPassageId) {
                $targetIndex = $index;

                break;
            }
        }

        if ($targetIndex === null) {
            return false;
        }

        $insertAt = $movePosition === 'before' ? $targetIndex : $targetIndex + 1;
        array_splice($remaining, $insertAt, 0, $moved);

        self::renumber($remaining);

        return true;
    }

    /**
     * Resequence a set of passages in place: they keep the position slots
     * the set currently occupies, filled in the given order. The sequence
     * must name exactly the passages occupying a contiguous run of the
     * edition's current order — anything else returns false untouched.
     *
     * @param  list<int>  $orderedCanonicalPassageIds
     */
    public static function applySequence(Edition $edition, array $orderedCanonicalPassageIds): bool
    {
        $ordered = self::lockedPassages($edition)->values();

        $indexOf = [];
        $byCanonicalId = [];

        foreach ($ordered as $index => $passage) {
            $indexOf[$passage->canonical_passage_id] = $index;
            $byCanonicalId[$passage->canonical_passage_id] = $passage;
        }

        $indexes = [];

        foreach ($orderedCanonicalPassageIds as $id) {
            if (! isset($indexOf[$id])) {
                return false;
            }

            $indexes[] = $indexOf[$id];
        }

        if ($indexes === [] || max($indexes) - min($indexes) !== count($indexes) - 1) {
            return false;
        }

        $slots = $indexes;
        sort($slots);

        $all = $ordered->all();

        foreach ($slots as $slot => $index) {
            $all[$index] = $byCanonicalId[$orderedCanonicalPassageIds[$slot]];
        }

        self::renumber($all);

        return true;
    }

    /**
     * @return Collection<int, EditionPassage>
     */
    private static function lockedPassages(Edition $edition): Collection
    {
        return EditionPassage::where('edition_id', $edition->id)
            ->orderBy('position')
            ->lockForUpdate()
            ->get()
            ->toBase();
    }

    /**
     * @param  array<int, EditionPassage>  $passages  in final order
     */
    private static function renumber(array $passages): void
    {
        foreach (array_values($passages) as $index => $passage) {
            $position = (float) ($index + 1);

            if ((float) $passage->position !== $position) {
                $passage->update(['position' => $position]);
            }
        }
    }
}
