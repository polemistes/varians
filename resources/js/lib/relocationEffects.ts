/**
 * The assignment consequences of a cut/paste relocation beyond offset moves,
 * for LIVE PREVIEW — the client mirror of
 * App\Support\Transcription\RelocationAssignmentEffects (which remains the
 * authority at save time); keep the two in step. Cutting PART of an assigned
 * span makes the fragment a new part of its segment at the paste site, and
 * pasting INTO another assigned span splits it around the arrival — the
 * preview shows those badges the moment the paste lands, instead of after
 * the autosave round-trip.
 */
import { applyOps, transformSpans } from '@/lib/transcriptionEdit';
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

/**
 * `text` is the text BEFORE the ops. Every replay is given it, so the plan
 * sees exactly what the real transform sees — the assignment that carries on
 * across a gap included; without it that claim is invisible and the plan
 * works from stale bounds (see SpanTransformer::claimant).
 */
export function planRelocationEffects(
    assignments: SpanRow[],
    ops: TextEditOp[],
    text: string | null = null,
): RelocationEffects {
    const overrides = new Map<
        number,
        { start: number; end: number; needsReview: boolean }
    >();
    const unflag = new Set<number>();
    const creates: RelocationEffects['creates'] = [];

    const original = assignments.map((assignment) => ({
        start: assignment.start_offset,
        end: assignment.end_offset,
        needsReview: assignment.needs_review,
    }));

    for (const [cutIndex, pasteIndex] of pairs(ops)) {
        const cutOp = ops[cutIndex];
        const pasteOp = ops[pasteIndex];
        const pastedLength = [...pasteOp.text].length;

        const atCut =
            cutIndex === 0
                ? original.map((span) => ({ ...span, deleted: false }))
                : transformSpans(original, ops.slice(0, cutIndex), true, text);
        const atPaste = transformSpans(
            original,
            ops.slice(0, pasteIndex),
            true,
            text,
        );
        const opsAfterPasteInclusive = ops.slice(pasteIndex);
        const opsAfterPaste = ops.slice(pasteIndex + 1);
        // The text as the rows created here first see it: before the paste
        // for the left half, after it for the fragment and the right half.
        const textAtPaste =
            text === null ? null : applyOps(text, ops.slice(0, pasteIndex));
        const textAfterPaste =
            textAtPaste === null ? null : applyOps(textAtPaste, [pasteOp]);

        assignments.forEach((assignment, index) => {
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

            // The fragment: this assignment's share of the cut, re-anchored at
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
                true,
                textAfterPaste,
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

        // Split any assignment the paste lands strictly inside.
        assignments.forEach((assignment, index) => {
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
                true,
                textAtPaste,
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
                true,
                textAfterPaste,
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
