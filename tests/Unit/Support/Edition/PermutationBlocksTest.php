<?php

use App\Support\Edition\PermutationBlocks;

test('the identity permutation has no non-identity blocks', function () {
    expect(PermutationBlocks::nonIdentityBlocks([0, 1, 2, 3, 4]))->toBe([]);
});

test('a plain adjacent swap is its own single block', function () {
    expect(PermutationBlocks::nonIdentityBlocks([1, 0]))->toBe([[0, 1]]);
});

test('a whole range shuffled into what looks like a random order decomposes into its true independent blocks', function () {
    // Citation 12..18 in D's own order (the reference/identity axis) vs P's
    // physical order 14, 12, 13, 18, 17, 15, 16 — the example from the
    // design conversation. perm[i] = P's rank of whatever D has at rank i.
    // Despite looking like one big 7-line tangle, {12,13,14} and
    // {15,16,17,18} each independently keep to their own contiguous span in
    // *both* orderings — the finest decomposition correctly reports two
    // separate, unrelated shuffles rather than one vague 7-line block.
    $perm = [1, 2, 0, 5, 6, 4, 3];

    expect(PermutationBlocks::nonIdentityBlocks($perm))->toBe([[0, 2], [3, 6]]);
});

test('a genuine whole-range rotation stays one block, since no proper prefix ever closes', function () {
    // A cyclic rotation: rank i+1 for every position except the last,
    // which wraps to rank 0 — no contiguous prefix closes until the very
    // end, so the whole range is genuinely one indivisible tangle.
    expect(PermutationBlocks::nonIdentityBlocks([1, 2, 3, 4, 5, 6, 0]))->toBe([[0, 6]]);
});

test('two independent adjacent swaps decompose into two separate blocks, never merged', function () {
    // [1,0, 3,2, 4] — positions 0-1 swap, positions 2-3 swap independently,
    // position 4 untouched. Each pair is already self-contained on its own.
    expect(PermutationBlocks::nonIdentityBlocks([1, 0, 3, 2, 4]))->toBe([[0, 1], [2, 3]]);
});

test('a block that only partly reaches past its neighbor pulls the neighbor in too', function () {
    // Position 2 maps to rank 3 (outside [0,2]), so the block can't close
    // until rank 3 is included as well.
    expect(PermutationBlocks::nonIdentityBlocks([0, 1, 3, 2]))->toBe([[2, 3]]);
});
