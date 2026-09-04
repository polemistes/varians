/**
 * The citation consequences of a cut/paste relocation beyond offset moves,
 * for LIVE PREVIEW — the client mirror of
 * App\Support\Transcription\RelocationSegmentEffects (which remains the
 * authority at save time); keep the two in step. Cutting PART of a cited
 * span makes the fragment a new part of its passage at the paste site, and
 * pasting INTO another cited span splits it around the arrival — the
 * preview shows those badges the moment the paste lands, instead of after
 * the autosave round-trip.
 */
import { transformSpans } from '@/lib/transcriptionEdit';
import type { TextEditOp } from '@/lib/transcriptionEdit';

type SpanRow = {
    start_offset: number;
    end_offset: number;
    needs_review: boolean;
};

export type RelocationEffects = {
    overrides: Map<
        number,
        { start: number; end: number; needsReview: boolean }
    >;
    unflag: Set<number>;
    creates: {
        anchorIndex: number;
        start: number;
        end: number;
        placement: 'before' | 'after';
    }[];
};

/** The validated cut/paste pairs in the log, as [cutIndex, pasteIndex]. */
function pairs(ops: TextEditOp[]): [number, number][] {
    const cuts = new Map<string, number>();
    const result: [number, number][] = [];

    for (const [index, op] of ops.entries()) {
        const cutId = op.cut_id ?? null;

        if (cutId === null) {
            continue;
        }

        if (op.text === '' && op.end > op.start && !cuts.has(cutId)) {
            cuts.set(cutId, index);
            continue;
        }

        if (op.text !== '' && op.start === op.end && cuts.has(cutId)) {
            result.push([cuts.get(cutId)!, index]);
        }
    }

    return result;
}

export function planRelocationEffects(
    segments: SpanRow[],
    ops: TextEditOp[],
): RelocationEffects {
    const overrides = new Map<
        number,
        { start: number; end: number; needsReview: boolean }
    >();
    const unflag = new Set<number>();
    const creates: RelocationEffects['creates'] = [];

    const original = segments.map((segment) => ({
        start: segment.start_offset,
        end: segment.end_offset,
        needsReview: segment.needs_review,
    }));

    for (const [cutIndex, pasteIndex] of pairs(ops)) {
        const cutOp = ops[cutIndex];
        const pasteOp = ops[pasteIndex];
        const pastedLength = [...pasteOp.text].length;

        const atCut =
            cutIndex === 0
                ? original.map((span) => ({ ...span, deleted: false }))
                : transformSpans(original, ops.slice(0, cutIndex));
        const atPaste = transformSpans(original, ops.slice(0, pasteIndex));
        const opsAfterPasteInclusive = ops.slice(pasteIndex);
        const opsAfterPaste = ops.slice(pasteIndex + 1);

        segments.forEach((segment, index) => {
            const stateAtCut = atCut[index];

            if (stateAtCut.deleted) {
                return;
            }

            const overlapStart = Math.max(stateAtCut.start, cutOp.start);
            const overlapEnd = Math.min(stateAtCut.end, cutOp.end);
            const whollyInside =
                stateAtCut.start >= cutOp.start && stateAtCut.end <= cutOp.end;

            if (overlapEnd <= overlapStart || whollyInside) {
                return; // disjoint, or carried whole by the transform
            }

            // The fragment: this segment's share of the cut, re-anchored at
            // the paste destination and ridden through the remaining ops.
            const relStart = overlapStart - cutOp.start;
            const relEnd = overlapEnd - cutOp.start;
            const [fragment] = transformSpans(
                [
                    {
                        start: pasteOp.start + relStart,
                        end: pasteOp.start + relEnd,
                        needsReview: false,
                    },
                ],
                opsAfterPaste,
            );

            if (!fragment.deleted && fragment.end > fragment.start) {
                creates.push({
                    anchorIndex: index,
                    start: fragment.start,
                    end: fragment.end,
                    placement:
                        cutOp.start <= stateAtCut.start ? 'before' : 'after',
                });

                if (!original[index].needsReview) {
                    unflag.add(index);
                }
            }
        });

        // Split any segment the paste lands strictly inside.
        segments.forEach((segment, index) => {
            const stateAtPaste = atPaste[index];

            if (stateAtPaste.deleted) {
                return;
            }

            if (
                stateAtPaste.start >= pasteOp.start ||
                stateAtPaste.end <= pasteOp.start
            ) {
                return;
            }

            const [left] = transformSpans(
                [
                    {
                        start: stateAtPaste.start,
                        end: pasteOp.start,
                        needsReview: stateAtPaste.needsReview,
                    },
                ],
                opsAfterPasteInclusive,
            );

            const [right] = transformSpans(
                [
                    {
                        start: pasteOp.start + pastedLength,
                        end: stateAtPaste.end + pastedLength,
                        needsReview: stateAtPaste.needsReview,
                    },
                ],
                opsAfterPaste,
            );

            if (!left.deleted && left.end > left.start) {
                overrides.set(index, {
                    start: left.start,
                    end: left.end,
                    needsReview: left.needsReview,
                });
            }

            if (!right.deleted && right.end > right.start) {
                creates.push({
                    anchorIndex: index,
                    start: right.start,
                    end: right.end,
                    placement: 'after',
                });
            }
        });
    }

    return { overrides, unflag, creates };
}
