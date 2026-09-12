/**
 * Mirrors App\Support\Transcription\SpanTransformer and TextOpApplier for
 * live client-side preview while the scholar is typing in the transcription
 * editor — see those classes for the authoritative, server-side replay this
 * mirrors. Kept in sync with the same case matrix (see
 * tests/Unit/Support/Transcription/SpanTransformerTest.php), including:
 *
 * - cut/paste relocation: an op pair sharing a `cut_id` (one pure deletion,
 *   one later pure insertion of the same text) carries every span wholly
 *   inside the cut to the paste point, offsets shifted verbatim, unflagged;
 * - tombstones: a destroyed span collapses to zero width at the point of
 *   destruction, flagged, and keeps transforming — it is never dropped from
 *   the preview, because the server keeps the row too.
 */

export type TextEditOp = {
    start: number;
    end: number;
    text: string;
    cut_id?: string | null;
    /**
     * A whole-gesture edit (paste, import, undo/redo, strip, a
     * selection-wide deletion) rather than a keystroke — the sibling layer
     * mirrors atomic word-boundary edits verbatim; see LayerMirror.
     */
    atomic?: boolean;
    /**
     * Which side of a citation's marker the caret stood on. A marker holds
     * no text, so the offsets either side of it are EQUAL; this is the one
     * thing the offset cannot say, and it decides whether what was typed
     * belongs to the citation the marker announces or to what stands before
     * it. Nothing typed, and no caret, ever crosses a marker.
     */
    side?: 'before' | 'after' | null;
    /**
     * What the sibling layer should receive where this op's `text` would
     * otherwise be replayed verbatim: an undo carries the sibling's own
     * former words (snapshotted when the edit was made), so undoing a
     * mirrored deletion restores γίνεται there, not the diplomatic
     * ΓΙΓΝΕΤΑΙ this layer removed. See LayerMirror.
     */
    mirror_text?: string | null;
};

/**
 * How an edit op came about, as reported by the editor component — a
 * clipboard cut or paste can be paired into a citation-preserving
 * relocation; typing cannot.
 */
export type EditSource = 'typing' | 'cut' | 'paste';

type Span = { start: number; end: number; needsReview: boolean };
type TransformedSpan = Span & { deleted: boolean };
type WorkingSpan = TransformedSpan & {
    carried: { cutId: string; relStart: number; relEnd: number } | null;
};

export function applyOps(text: string, ops: TextEditOp[]): string {
    return ops.reduce((current, op) => applyOp(current, op), text);
}

function applyOp(text: string, op: TextEditOp): string {
    const chars = [...text];

    return (
        chars.slice(0, op.start).join('') +
        op.text +
        chars.slice(op.end).join('')
    );
}

export function transformSpans(
    spans: Span[],
    ops: TextEditOp[],
    takesTextAtStart = false,
): TransformedSpan[] {
    let results: WorkingSpan[] = spans.map((span) => ({
        ...span,
        deleted: false,
        carried: null,
    }));

    for (const op of ops) {
        const cutId = op.cut_id ?? null;
        const isCut = cutId !== null && op.text === '' && op.end > op.start;
        const isPaste = cutId !== null && op.text !== '' && op.start === op.end;
        // Which citation, if any, takes what is typed here.
        const claim =
            takesTextAtStart && op.start === op.end && !isPaste
                ? claimant(results, op.start, op.side ?? null, op.text)
                : null;

        results = results.map((span, index) => {
            const claims = takesTextAtStart && index === claim;

            if (span.carried !== null) {
                if (isPaste && span.carried.cutId === cutId) {
                    return {
                        ...span,
                        start: op.start + span.carried.relStart,
                        end: op.start + span.carried.relEnd,
                        carried: null,
                    };
                }

                // The span itself is in the clipboard; only its fallback
                // tombstone position rides through intermediate ops, so
                // positional effects apply but destruction flags don't.
                return {
                    ...applySpanOp(span, op, isPaste, claims, takesTextAtStart),
                    needsReview: span.needsReview,
                    deleted: span.deleted,
                };
            }

            if (isCut && span.start >= op.start && span.end <= op.end) {
                return {
                    ...span,
                    start: op.start,
                    end: op.start,
                    carried: {
                        cutId,
                        relStart: span.start - op.start,
                        relEnd: span.end - op.start,
                    },
                };
            }

            return applySpanOp(span, op, isPaste, claims, takesTextAtStart);
        });
    }

    return results.map(({ carried, ...span }) =>
        carried !== null ? { ...span, deleted: true, needsReview: true } : span,
    );
}

/**
 * Which citation takes what is typed at this point, by index, or null when
 * none does. TOUCHING means touching: nothing between the caret and the
 * citation's characters. Standing against its words claims for it, and
 * whatever is typed there is the citation's, a space as much as a letter. A
 * caret with whitespace between it and every citation claims for none of
 * them — that whitespace is the gap, and the gap is nobody's.
 *
 * `side` settles the one case an offset cannot: both sides of a citation's
 * marker measure to the SAME offset, so typing on the marker's near side
 * must not write into the citation it announces. Mirrors
 * App\Support\Transcription\SpanTransformer::claimant.
 */
function claimant(
    spans: WorkingSpan[],
    p: number,
    side: 'before' | 'after' | null = null,
    inserted = '',
): number | null {
    let atEnd: number | null = null;
    // A citation never begins with whitespace: a break typed at its first
    // character belongs above it, and the citation moves down with its
    // marker. Whitespace at its END is claimed, holding the line open.
    const opensWithSpace = inserted !== '' && /^\s/u.test(inserted);

    for (const [index, span] of spans.entries()) {
        if (span.carried !== null || span.end <= span.start) {
            continue;
        }

        if (p > span.start && p < span.end) {
            return index;
        }

        if (
            p === span.start &&
            !opensWithSpace &&
            (side !== 'before' || !spanEndsAt(spans, p))
        ) {
            return index;
        }

        if (p === span.end) {
            atEnd = index;
        }
    }

    return atEnd;
}

/**
 * Whether a live span ends exactly here — whether the near side of a marker
 * at this offset belongs to anybody at all. Where nothing ends there the
 * near side is nobody's, and withholding the claim for it left words typed
 * at a marker unassigned between two citations (user report).
 */
function spanEndsAt(spans: WorkingSpan[], p: number): boolean {
    return spans.some(
        (span) =>
            span.carried === null && span.end > span.start && span.end === p,
    );
}

function applySpanOp(
    span: WorkingSpan,
    op: TextEditOp,
    isRelocationPaste = false,
    claims = false,
    citations = false,
): WorkingSpan {
    const insertedLen = [...op.text].length;

    if (op.start === op.end) {
        return applyInsertion(
            span,
            op.start,
            insertedLen,
            isRelocationPaste,
            claims,
            citations,
        );
    }

    const delta = insertedLen - (op.end - op.start);

    return applyReplace(span, op.start, op.end, insertedLen, delta);
}

// A pure insertion joins the span it TOUCHES: at its first character, at its
// last, or anywhere within. A citation never owns the whitespace at its
// edges, so what lies between two of them is a visible gap, and a caret in
// that gap touches neither. Where two spans meet, the one that BEGINS at the
// caret takes the text. Mirrors App\Support\Transcription\SpanTransformer —
// keep the two in step. A relocation paste is exempt: those words belong to
// the citation carried with them.
function applyInsertion(
    span: WorkingSpan,
    p: number,
    insertedLen: number,
    isRelocationPaste = false,
    claims = false,
    citations = false,
): WorkingSpan {
    // For citations the claim decides everything: the one that takes the text
    // grows to cover it, and every other is only pushed along.
    if (citations && !isRelocationPaste) {
        if (claims) {
            return { ...span, end: span.end + insertedLen };
        }

        if (p <= span.start) {
            return {
                ...span,
                start: span.start + insertedLen,
                end: span.end + insertedLen,
            };
        }

        return span;
    }

    if (p <= span.start) {
        return {
            ...span,
            start: span.start + insertedLen,
            end: span.end + insertedLen,
        };
    }

    if (isRelocationPaste ? p < span.end : p <= span.end) {
        return { ...span, end: span.end + insertedLen };
    }

    return span;
}

function applyReplace(
    span: WorkingSpan,
    start: number,
    end: number,
    insertedLen: number,
    delta: number,
): WorkingSpan {
    if (span.end <= start) {
        return span;
    }

    if (span.start >= end) {
        return { ...span, start: span.start + delta, end: span.end + delta };
    }

    if (start <= span.start && end >= span.end) {
        if (insertedLen === 0) {
            // Collapse to a zero-width tombstone at the point of
            // destruction — kept and flagged, mirroring the server.
            return {
                ...span,
                start,
                end: start,
                deleted: true,
                needsReview: true,
            };
        }

        return {
            ...span,
            start,
            end: start + insertedLen,
            needsReview: true,
        };
    }

    if (span.start <= start && end <= span.end) {
        return { ...span, end: span.end + delta };
    }

    if (start < span.start) {
        return {
            ...span,
            start: end + delta,
            end: span.end + delta,
            needsReview: true,
        };
    }

    return { ...span, end: start, needsReview: true };
}
