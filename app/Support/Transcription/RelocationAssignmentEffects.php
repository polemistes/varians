<?php

namespace App\Support\Transcription;

use App\Models\Assignment;
use Illuminate\Support\Collection;

/**
 * The assignment consequences of a cut/paste relocation that SpanTransformer
 * cannot express, because they create or reshape rows rather than merely
 * moving offsets:
 *
 * - Cutting PART of an assigned span and pasting it elsewhere is a sub-assignment
 *   transposition: the fragment still reads as text of its original
 *   segment, so it becomes another *part* of that segment (see
 *   Assignment::$part) — a new span at the paste site carrying
 *   the source's assignment. The source keeps its assignment on what remains,
 *   unflagged: nothing about the trim needs review once the fragment is
 *   properly assign afreshd.
 *
 * - Pasting INTO the middle of another assigned span must not absorb the
 *   arrival into that assignment: the target splits into two parts of its own
 *   segment, one on each side of the inserted text.
 *
 * Mirrored for the live preview in resources/js/lib/relocationEffects.ts —
 * keep the two in step. Every replay here is given the TEXT the ops apply
 * to, so it sees exactly what the real transform sees, the assignment that
 * carries on across a gap included (see SpanTransformer::claimant); without
 * the text that claim is invisible and the plan works from stale bounds.
 *
 * @phpstan-type Effects array{overrides: array<int, array{start: int, end: int, needsReview: bool}>, unflag: list<int>, creates: list<array{segment_id: int, start: int, end: int, anchor_index: int, placement: 'before'|'after'}>}
 */
class RelocationAssignmentEffects
{
    /**
     * @param  Collection<int, Assignment>  $assignments  the layer's assignments, in the order applySpans will walk them
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
     * @param  string|null  $text  the text BEFORE the ops
     * @return Effects
     */
    public static function plan(Collection $assignments, array $ops, ?string $text = null): array
    {
        $overrides = [];
        $unflag = [];
        $creates = [];

        $original = array_values($assignments->map(fn ($assignment) => [
            'start' => (int) $assignment->start_offset,
            'end' => (int) $assignment->end_offset,
            'needsReview' => (bool) $assignment->needs_review,
        ])->all());

        foreach (self::pairs($ops) as $pair) {
            [$cutIndex, $pasteIndex] = $pair;
            $cutOp = $ops[$cutIndex];
            $pasteOp = $ops[$pasteIndex];
            $pastedLength = mb_strlen($pasteOp['text']);

            // Assignment offsets as they stand when the cut applies / when the
            // paste applies — replays of the op prefix, exactly what the
            // real transform sees at those moments.
            $atCut = $cutIndex === 0
                ? $original
                : SpanTransformer::transform($original, array_slice($ops, 0, $cutIndex), true, $text);
            $atPaste = SpanTransformer::transform($original, array_slice($ops, 0, $pasteIndex), true, $text);
            $opsAfterPasteInclusive = array_slice($ops, $pasteIndex);
            $opsAfterPaste = array_slice($ops, $pasteIndex + 1);
            // The text as the rows created here first see it: before the
            // paste for the left half, after it for the fragment and the
            // right half.
            $textAtPaste = $text === null ? null : TextOpApplier::applyAll($text, array_slice($ops, 0, $pasteIndex));
            $textAfterPaste = $text === null ? null : TextOpApplier::apply($textAtPaste, $pasteOp);

            foreach ($assignments as $index => $assignment) {
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

                // The fragment: this assignment's share of the cut, re-anchored
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
                    true,
                    $textAfterPaste,
                );

                if (! $fragment['deleted'] && $fragment['end'] > $fragment['start']) {
                    $creates[] = [
                        'segment_id' => (int) $assignment->segment_id,
                        'start' => $fragment['start'],
                        'end' => $fragment['end'],
                        'anchor_index' => $index,
                        // Cut from the assignment's head: the fragment reads
                        // before what remains; from its tail (or interior,
                        // the closest expressible position): after.
                        'placement' => $cutOp['start'] <= $stateAtCut['start'] ? 'before' : 'after',
                    ];

                    // The trim is clean once the fragment carries the
                    // assignment on — don't leave the source flagged for a
                    // review nothing needs.
                    if (! $original[$index]['needsReview']) {
                        $unflag[] = $index;
                    }
                }
            }

            // Split any assignment the paste lands strictly inside: its segment
            // keeps assigning both sides, never absorbing the arrival.
            foreach ($assignments as $index => $assignment) {
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
                    true,
                    $textAtPaste,
                );

                // Right half: begins after the pasted text.
                [$right] = SpanTransformer::transform(
                    [[
                        'start' => $pasteOp['start'] + $pastedLength,
                        'end' => $stateAtPaste['end'] + $pastedLength,
                        'needsReview' => $stateAtPaste['needsReview'],
                    ]],
                    $opsAfterPaste,
                    true,
                    $textAfterPaste,
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
                        'segment_id' => (int) $assignment->segment_id,
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
     * a genuine relocation. Public because LayerMirror walks the same pairs.
     *
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
     * @return list<array{0: int, 1: int}>
     */
    public static function pairs(array $ops): array
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
