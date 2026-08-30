<?php

namespace App\Support\Edition;

/**
 * Decomposes a permutation into the finest sequence of contiguous,
 * self-contained blocks — the standard "closed prefix" scan used to find
 * where two orderings of the same set genuinely tangle together versus
 * where they merely happen to sit next to each other.
 *
 * A block [start, end] is "closed" when the set of ranks the reference
 * ordering's positions start..end map to under the permutation is *exactly*
 * the set {start..end} again — nothing inside reaches outside, and nothing
 * outside reaches in. A plain adjacent swap is the smallest possible
 * non-identity block (size 2); two independent adjacent swaps decompose
 * into two separate blocks, never merged into one, since each is already
 * self-contained on its own.
 */
class PermutationBlocks
{
    /**
     * @param  array<int, int>  $perm  perm[i] = the rank (in some other ordering) of whatever sits at rank i in the reference ordering — a permutation of 0..count($perm)-1.
     * @return array<int, array{0: int, 1: int}> every non-identity block, as [start, end] index pairs (inclusive, 0-based) into $perm.
     */
    public static function nonIdentityBlocks(array $perm): array
    {
        $blocks = [];
        $blockStart = 0;
        $runningMax = -1;

        foreach ($perm as $i => $rank) {
            $runningMax = max($runningMax, $rank);

            if ($runningMax === $i) {
                if (! self::isIdentity($perm, $blockStart, $i)) {
                    $blocks[] = [$blockStart, $i];
                }

                $blockStart = $i + 1;
            }
        }

        return $blocks;
    }

    /**
     * @param  array<int, int>  $perm
     */
    private static function isIdentity(array $perm, int $start, int $end): bool
    {
        for ($i = $start; $i <= $end; $i++) {
            if ($perm[$i] !== $i) {
                return false;
            }
        }

        return true;
    }
}
