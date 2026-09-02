<?php

namespace App\Support\Transcription;

use App\Models\TranscriptionSegment;
use Illuminate\Support\Collection;

/**
 * The citation consequences of a cut/paste relocation that SpanTransformer
 * cannot express, because they create or reshape rows rather than merely
 * moving offsets:
 *
 * - Cutting PART of a cited span and pasting it elsewhere is a sub-segment
 *   transposition: the fragment still reads as text of its original
 *   passage, so it becomes another *part* of that passage (see
 *   TranscriptionSegment::$part) — a new span at the paste site carrying
 *   the source's citation. The source keeps its citation on what remains,
 *   unflagged: nothing about the trim needs review once the fragment is
 *   properly re-cited.
 *
 * - Pasting INTO the middle of another cited span must not absorb the
 *   arrival into that citation: the target splits into two parts of its own
 *   passage, one on each side of the inserted text.
 *
 * This runs server-side only. The live preview shows the plain transform
 * until the autosave round-trip returns the created rows — a brief,
 * self-correcting divergence.
 *
 * @phpstan-type Effects array{overrides: array<int, array{start: int, end: int, needsReview: bool}>, unflag: list<int>, creates: list<array{canonical_passage_id: int, start: int, end: int, anchor_index: int, placement: 'before'|'after'}>}
 */
class RelocationSegmentEffects
{
    /**
     * @param  Collection<int, TranscriptionSegment>  $segments  the layer's segments, in the order applySpans will walk them
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
     * @return Effects
     */
    public static function plan(Collection $segments, array $ops): array
    {
        $overrides = [];
        $unflag = [];
        $creates = [];

        $original = array_values($segments->map(fn ($segment) => [
            'start' => (int) $segment->start_offset,
            'end' => (int) $segment->end_offset,
            'needsReview' => (bool) $segment->needs_review,
        ])->all());

        foreach (self::pairs($ops) as $pair) {
            [$cutIndex, $pasteIndex] = $pair;
            $cutOp = $ops[$cutIndex];
            $pasteOp = $ops[$pasteIndex];
            $pastedLength = mb_strlen($pasteOp['text']);

            // Segment offsets as they stand when the cut applies / when the
            // paste applies — replays of the op prefix, exactly what the
            // real transform sees at those moments.
            $atCut = $cutIndex === 0
                ? $original
                : SpanTransformer::transform($original, array_slice($ops, 0, $cutIndex));
            $atPaste = SpanTransformer::transform($original, array_slice($ops, 0, $pasteIndex));
            $opsAfterPasteInclusive = array_slice($ops, $pasteIndex);
            $opsAfterPaste = array_slice($ops, $pasteIndex + 1);

            foreach ($segments as $index => $segment) {
                $stateAtCut = $atCut[$index];

                if (($stateAtCut['deleted'] ?? false) === true) {
                    continue;
                }

                $overlapStart = max($stateAtCut['start'], $cutOp['start']);
                $overlapEnd = min($stateAtCut['end'], $cutOp['end']);
                $whollyInside = $stateAtCut['start'] >= $cutOp['start'] && $stateAtCut['end'] <= $cutOp['end'];

                if ($overlapEnd <= $overlapStart || $whollyInside) {
                    continue; // disjoint, or carried whole by the transform
                }

                // The fragment: this segment's share of the cut, re-anchored
                // at the paste destination and ridden through the remaining
                // ops so its offsets land in the final text.
                $relStart = $overlapStart - $cutOp['start'];
                $relEnd = $overlapEnd - $cutOp['start'];
                [$fragment] = SpanTransformer::transform(
                    [[
                        'start' => $pasteOp['start'] + $relStart,
                        'end' => $pasteOp['start'] + $relEnd,
                        'needsReview' => false,
                    ]],
                    $opsAfterPaste,
                );

                if (! $fragment['deleted'] && $fragment['end'] > $fragment['start']) {
                    $creates[] = [
                        'canonical_passage_id' => (int) $segment->canonical_passage_id,
                        'start' => $fragment['start'],
                        'end' => $fragment['end'],
                        'anchor_index' => $index,
                        // Cut from the segment's head: the fragment reads
                        // before what remains; from its tail (or interior,
                        // the closest expressible position): after.
                        'placement' => $cutOp['start'] <= $stateAtCut['start'] ? 'before' : 'after',
                    ];

                    // The trim is clean once the fragment carries the
                    // citation on — don't leave the source flagged for a
                    // review nothing needs.
                    if (! $original[$index]['needsReview']) {
                        $unflag[] = $index;
                    }
                }
            }

            // Split any segment the paste lands strictly inside: its passage
            // keeps citing both sides, never absorbing the arrival.
            foreach ($segments as $index => $segment) {
                $stateAtPaste = $atPaste[$index];

                if ($stateAtPaste['deleted']) {
                    continue;
                }

                if ($stateAtPaste['start'] >= $pasteOp['start'] || $stateAtPaste['end'] <= $pasteOp['start']) {
                    continue;
                }

                // Left half: ends where the paste begins; the paste op
                // itself leaves it alone (relocation-paste end gravity).
                [$left] = SpanTransformer::transform(
                    [[
                        'start' => $stateAtPaste['start'],
                        'end' => $pasteOp['start'],
                        'needsReview' => $stateAtPaste['needsReview'],
                    ]],
                    $opsAfterPasteInclusive,
                );

                // Right half: begins after the pasted text.
                [$right] = SpanTransformer::transform(
                    [[
                        'start' => $pasteOp['start'] + $pastedLength,
                        'end' => $stateAtPaste['end'] + $pastedLength,
                        'needsReview' => $stateAtPaste['needsReview'],
                    ]],
                    $opsAfterPaste,
                );

                if (! $left['deleted'] && $left['end'] > $left['start']) {
                    $overrides[$index] = [
                        'start' => $left['start'],
                        'end' => $left['end'],
                        'needsReview' => $left['needsReview'],
                    ];
                }

                if (! $right['deleted'] && $right['end'] > $right['start']) {
                    $creates[] = [
                        'canonical_passage_id' => (int) $segment->canonical_passage_id,
                        'start' => $right['start'],
                        'end' => $right['end'],
                        'anchor_index' => $index,
                        'placement' => 'after',
                    ];
                }
            }
        }

        return ['overrides' => $overrides, 'unflag' => $unflag, 'creates' => $creates];
    }

    /**
     * The validated cut/paste pairs in the log, as [cutIndex, pasteIndex] —
     * normalizeOps has already verified each claim, so a shared id here is
     * a genuine relocation.
     *
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
     * @return list<array{0: int, 1: int}>
     */
    private static function pairs(array $ops): array
    {
        $cuts = [];
        $pairs = [];

        foreach ($ops as $index => $op) {
            $cutId = $op['cut_id'] ?? null;

            if ($cutId === null) {
                continue;
            }

            if ($op['text'] === '' && $op['end'] > $op['start'] && ! isset($cuts[$cutId])) {
                $cuts[$cutId] = $index;

                continue;
            }

            if ($op['text'] !== '' && $op['start'] === $op['end'] && isset($cuts[$cutId])) {
                $pairs[] = [$cuts[$cutId], $index];
            }
        }

        return $pairs;
    }
}
