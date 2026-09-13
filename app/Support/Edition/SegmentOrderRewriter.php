<?php

namespace App\Support\Edition;

use App\Models\Edition;
use App\Models\EditionSegment;
use Illuminate\Support\Collection;

/**
 * The one place an edition's stored segment order changes. Since the
 * materialized-order redesign, `EditionSegment.position` IS the printed
 * order — nothing is reordered at render time any more — so every move
 * (a cut-and-paste of segments, applying a transposition proposal, applying
 * a witness's order) comes through here, rewrites positions inside one
 * locked transaction, and renumbers the whole edition 1..n. Renumbering
 * wholesale is deliberate: positions carry no meaning beyond their order,
 * and midpoint arithmetic that never renumbers eventually exhausts decimal
 * precision.
 *
 * Callers are expected to run inside a DB transaction (both methods lock
 * the edition's rows with lockForUpdate).
 */
class SegmentOrderRewriter
{
    /**
     * Move the contiguous run of segments between two segments
     * (inclusive, located by current position) to before/after a target
     * segment outside the run. Returns false, touching nothing, when a
     * named segment isn't in the edition or the target sits inside the run
     * — the same silent-bail contract the render-time machinery had.
     */
    public static function moveRange(
        Edition $edition,
        int $rangeStartSegmentId,
        ?int $rangeEndSegmentId,
        int $targetSegmentId,
        string $movePosition,
    ): bool {
        $ordered = self::lockedSegments($edition);
        // A segment printed in pieces is located by its first part.
        $byCanonicalId = $ordered->where('part', 1)->keyBy('segment_id');

        $start = $byCanonicalId->get($rangeStartSegmentId);
        $end = $byCanonicalId->get($rangeEndSegmentId ?? $rangeStartSegmentId);
        $target = $byCanonicalId->get($targetSegmentId);

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

        foreach ($ordered as $segment) {
            $position = (float) $segment->position;

            if ($position >= $from && $position <= $to) {
                $moved[] = $segment;
            } else {
                $remaining[] = $segment;
            }
        }

        $targetIndex = null;

        foreach ($remaining as $index => $segment) {
            if ($segment->segment_id === $targetSegmentId) {
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
     * Resequence a set of segments in place: they keep the position slots
     * the set currently occupies, filled in the given order — the k-th
     * occupied slot (in position order) receives the sequence's k-th
     * segment. The slots need NOT be contiguous: an order-report block is
     * contiguous in numbering order, and the editor's own arrangement may
     * have scattered its members among other segments, which stay exactly
     * where they are. A sequence naming a segment not in the edition
     * returns false untouched.
     *
     * @param  list<int>  $orderedSegmentIds
     */
    public static function applySequence(Edition $edition, array $orderedSegmentIds): bool
    {
        $ordered = self::lockedSegments($edition)->values();

        $indexOf = [];
        $byCanonicalId = [];

        foreach ($ordered as $index => $segment) {
            // A segment printed in pieces is located by its first part.
            if (isset($indexOf[$segment->segment_id])) {
                continue;
            }

            $indexOf[$segment->segment_id] = $index;
            $byCanonicalId[$segment->segment_id] = $segment;
        }

        $indexes = [];

        foreach ($orderedSegmentIds as $id) {
            if (! isset($indexOf[$id])) {
                return false;
            }

            $indexes[] = $indexOf[$id];
        }

        if ($indexes === []) {
            return false;
        }

        $slots = $indexes;
        sort($slots);

        $all = $ordered->all();

        foreach ($slots as $slot => $index) {
            $all[$index] = $byCanonicalId[$orderedSegmentIds[$slot]];
        }

        self::renumber($all);

        return true;
    }

    /**
     * Resequence PIECES in place — rows named by (segment, part),
     * see EditionSegment::$part — with the same slot-filling as
     * applySequence. This is how an arrangement that divides lines is
     * printed (ArrangementAdopter). A piece the edition lacks returns
     * false untouched.
     *
     * @param  list<array{segment_id: int, part: int}>  $pieces
     */
    public static function applyPieceSequence(Edition $edition, array $pieces): bool
    {
        $ordered = self::lockedSegments($edition)->values();

        $indexOf = [];
        $rows = [];

        foreach ($ordered as $index => $row) {
            $key = $row->segment_id.':'.$row->part;
            $indexOf[$key] = $index;
            $rows[$key] = $row;
        }

        $indexes = [];

        foreach ($pieces as $piece) {
            $key = $piece['segment_id'].':'.$piece['part'];

            if (! isset($indexOf[$key])) {
                return false;
            }

            $indexes[] = $indexOf[$key];
        }

        if ($indexes === []) {
            return false;
        }

        $slots = $indexes;
        sort($slots);

        $all = $ordered->all();

        foreach ($slots as $slot => $index) {
            $all[$index] = $rows[$pieces[$slot]['segment_id'].':'.$pieces[$slot]['part']];
        }

        self::renumber($all);

        return true;
    }

    /**
     * Renumber the whole edition 1..n after rows were inserted at
     * fractional positions (see SegmentAdder::insertionPosition).
     */
    public static function renumberEdition(Edition $edition): void
    {
        self::renumber(self::lockedSegments($edition)->values()->all());
    }

    /**
     * @return Collection<int, EditionSegment>
     */
    private static function lockedSegments(Edition $edition): Collection
    {
        return EditionSegment::where('edition_id', $edition->id)
            ->orderBy('position')
            ->lockForUpdate()
            ->get()
            ->toBase();
    }

    /**
     * @param  array<int, EditionSegment>  $segments  in final order
     */
    private static function renumber(array $segments): void
    {
        foreach (array_values($segments) as $index => $segment) {
            $position = (float) ($index + 1);

            if ((float) $segment->position !== $position) {
                $segment->update(['position' => $position]);
            }
        }
    }
}
