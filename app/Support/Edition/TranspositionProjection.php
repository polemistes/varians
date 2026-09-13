<?php

namespace App\Support\Edition;

use App\Enums\ConjectureType;
use App\Models\Conjecture;

/**
 * A Transposition conjecture is a statement — "these segments stand
 * before/after that one" — not a stored sequence the way a Reordering's
 * ordering entries are. This turns the statement into concrete orderings so
 * the rest of the order machinery can treat both kinds alike: the order
 * report offers it as a candidate sequence, the apply endpoint rewrites
 * positions to it, and the auto-mark pruner checks whether the printed
 * order still says it.
 */
class TranspositionProjection
{
    /**
     * The statement projected onto an affected set: the set's assignment
     * order with the range lifted out and reinserted on the stated side of
     * the target. Null when an anchor is missing from the set, the range is
     * inverted, or the target sits inside the range — the statement does
     * not resolve against this set.
     *
     * @param  list<int>  $numberingOrderedIds  the affected set, in numbering order, containing the statement's anchors
     * @return list<int>|null
     */
    public static function sequence(Conjecture $conjecture, array $numberingOrderedIds): ?array
    {
        if ($conjecture->type !== ConjectureType::Transposition || $conjecture->move_position === null) {
            return null;
        }

        $indexOf = array_flip($numberingOrderedIds);

        $startIndex = $indexOf[$conjecture->segment_id] ?? null;
        $endIndex = $indexOf[$conjecture->transposition_range_end_segment_id ?? $conjecture->segment_id] ?? null;
        $targetIndex = $indexOf[$conjecture->move_target_segment_id] ?? null;

        if ($startIndex === null || $endIndex === null || $targetIndex === null) {
            return null;
        }

        if ($endIndex < $startIndex || ($targetIndex >= $startIndex && $targetIndex <= $endIndex)) {
            return null;
        }

        $range = array_slice($numberingOrderedIds, $startIndex, $endIndex - $startIndex + 1);
        $rest = array_values(array_diff($numberingOrderedIds, $range));
        $restTargetIndex = array_search($conjecture->move_target_segment_id, $rest, true);

        if (! is_int($restTargetIndex)) {
            return null;
        }

        $insertAt = $conjecture->move_position === 'before' ? $restTargetIndex : $restTargetIndex + 1;
        array_splice($rest, $insertAt, 0, $range);

        return $rest;
    }

    /**
     * Whether the printed order still says what the statement says: the
     * range's endpoints bracket a run standing immediately on the stated
     * side of the target. An anchor missing from the order (a removed
     * segment) means the statement no longer resolves — false.
     *
     * @param  list<int>  $printedIds  the edition's segments in printed order
     */
    public static function holdsIn(Conjecture $conjecture, array $printedIds): bool
    {
        if ($conjecture->type !== ConjectureType::Transposition || $conjecture->move_position === null) {
            return false;
        }

        $indexOf = array_flip($printedIds);

        $startIndex = $indexOf[$conjecture->segment_id] ?? null;
        $endIndex = $indexOf[$conjecture->transposition_range_end_segment_id ?? $conjecture->segment_id] ?? null;
        $targetIndex = $indexOf[$conjecture->move_target_segment_id] ?? null;

        if ($startIndex === null || $endIndex === null || $targetIndex === null || $endIndex < $startIndex) {
            return false;
        }

        return $conjecture->move_position === 'before'
            ? $targetIndex === $endIndex + 1
            : $targetIndex === $startIndex - 1;
    }
}
