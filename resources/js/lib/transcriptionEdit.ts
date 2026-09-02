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

        results = results.map((span) => {
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
                    ...applySpanOp(span, op, isPaste),
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

            return applySpanOp(span, op, isPaste);
        });
    }

    return results.map(({ carried, ...span }) =>
        carried !== null ? { ...span, deleted: true, needsReview: true } : span,
    );
}

function applySpanOp(
    span: WorkingSpan,
    op: TextEditOp,
    isRelocationPaste = false,
): WorkingSpan {
    const insertedLen = [...op.text].length;

    if (op.start === op.end) {
        return applyInsertion(span, op.start, insertedLen, isRelocationPaste);
    }

    const delta = insertedLen - (op.end - op.start);

    return applyReplace(span, op.start, op.end, insertedLen, delta);
}

// Boundary "gravity": a pure insertion exactly at a span's start pushes the
// span forward (right-gravity — typing there doesn't join it), while one
// exactly at a span's end extends it (left-gravity — typing there continues
// it). This is what makes "insert inside a range, it becomes part of that
// range" work for the common case of continuing to type right after
// something you were just editing. A relocation paste is the exception: the
// pasted words belong to the citation carried with them, never to a span
// that merely ends where they landed.
function applyInsertion(
    span: WorkingSpan,
    p: number,
    insertedLen: number,
    isRelocationPaste = false,
): WorkingSpan {
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
