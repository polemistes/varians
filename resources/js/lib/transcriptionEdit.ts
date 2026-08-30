/**
 * Mirrors App\Support\Transcription\SpanTransformer and TextOpApplier for
 * live client-side preview while the scholar is typing in the transcription
 * editor's "edit text" mode — see those classes for the authoritative,
 * server-side replay this mirrors. Kept in sync with the same case matrix
 * (see tests/Unit/Support/Transcription/SpanTransformerTest.php).
 */

export type TextEditOp = { start: number; end: number; text: string };

type Span = { start: number; end: number; needsReview: boolean };
type TransformedSpan = Span & { deleted: boolean };

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
    let results: TransformedSpan[] = spans.map((span) => ({
        ...span,
        deleted: false,
    }));

    for (const op of ops) {
        results = results.map((span) =>
            span.deleted ? span : applySpanOp(span, op),
        );
    }

    return results;
}

function applySpanOp(span: TransformedSpan, op: TextEditOp): TransformedSpan {
    const insertedLen = [...op.text].length;

    if (op.start === op.end) {
        return applyInsertion(span, op.start, insertedLen);
    }

    const delta = insertedLen - (op.end - op.start);

    return applyReplace(span, op.start, op.end, insertedLen, delta);
}

// Boundary "gravity": a pure insertion exactly at a span's start pushes the
// span forward (right-gravity — typing there doesn't join it), while one
// exactly at a span's end extends it (left-gravity — typing there continues
// it). This is what makes "insert inside a range, it becomes part of that
// range" work for the common case of continuing to type right after
// something you were just editing.
function applyInsertion(
    span: TransformedSpan,
    p: number,
    insertedLen: number,
): TransformedSpan {
    if (p <= span.start) {
        return {
            ...span,
            start: span.start + insertedLen,
            end: span.end + insertedLen,
        };
    }

    if (p <= span.end) {
        return { ...span, end: span.end + insertedLen };
    }

    return span;
}

function applyReplace(
    span: TransformedSpan,
    start: number,
    end: number,
    insertedLen: number,
    delta: number,
): TransformedSpan {
    if (span.end <= start) {
        return span;
    }

    if (span.start >= end) {
        return { ...span, start: span.start + delta, end: span.end + delta };
    }

    if (start <= span.start && end >= span.end) {
        if (insertedLen === 0) {
            return { ...span, deleted: true };
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
