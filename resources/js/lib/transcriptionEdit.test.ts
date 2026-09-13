import { describe, expect, it } from 'vitest';
import { shiftOp, transformSpans } from '@/lib/transcriptionEdit';
import type { TextEditOp } from '@/lib/transcriptionEdit';

/**
 * The client mirror of App\Support\Transcription\SpanTransformer, which the
 * editor applies to its own copy of the citations while the scholar types —
 * so a keystroke's effect is seen at once and again, identically, when the
 * server replays it. The two must agree case for case: where they don't, a
 * citation jumps the moment a save lands. The PHP cases live in
 * tests/Feature/TranscriptionTextUpdateTest.php and
 * tests/Unit/Support/Transcription/SpanTransformerTest.php.
 */
const cite = (start: number, end: number) => ({
    start,
    end,
    needsReview: false,
});

const bounds = (spans: { start: number; end: number }[]) =>
    spans.map((span) => [span.start, span.end]);

/** One keystroke over citations that know their own text. */
const typed = (
    spans: { start: number; end: number; needsReview: boolean }[],
    text: string,
    op: TextEditOp,
) => bounds(transformSpans(spans, [op], true, text));

describe('what a keystroke at a citation joins', () => {
    // "alpha gamma": two citations with one space between them, so the
    // marker of the second stands at offset 6 and the caret can rest on
    // either side of it — both measuring to that same 6.
    const separated = () => [cite(0, 5), cite(6, 11)];
    const text = 'alpha gamma';

    it('gives the near side of a marker to what lies before it', () => {
        expect(
            typed(separated(), text, {
                start: 6,
                end: 6,
                text: 'X',
                side: 'before',
            }),
        ).toEqual([
            [0, 7],
            [7, 12],
        ]);
    });

    it('gives the far side to the citation the marker announces', () => {
        expect(
            typed(separated(), text, {
                start: 6,
                end: 6,
                text: 'X',
                side: 'after',
            }),
        ).toEqual([
            [0, 5],
            [6, 12],
        ]);
    });

    it('extends a citation typed against its last character', () => {
        expect(
            typed(separated(), text, { start: 5, end: 5, text: 'X' }),
        ).toEqual([
            [0, 6],
            [7, 12],
        ]);
    });

    it('keeps a space typed at a citation’s end for that citation', () => {
        expect(
            typed(separated(), text, { start: 5, end: 5, text: ' ' }),
        ).toEqual([
            [0, 6],
            [7, 12],
        ]);
    });

    it('leaves a line break typed at a cited line’s start above it', () => {
        // The citation goes down with its marker rather than growing a
        // blank first line.
        expect(
            typed(separated(), text, {
                start: 6,
                end: 6,
                text: '\n',
                side: 'after',
            }),
        ).toEqual([
            [0, 5],
            [7, 12],
        ]);
    });

    it('reaches both sides of two citations that meet flush', () => {
        const flush = () => [cite(0, 3), cite(3, 7)];

        expect(
            typed(flush(), 'etazeta', {
                start: 3,
                end: 3,
                text: 'X',
                side: 'before',
            }),
        ).toEqual([
            [0, 4],
            [4, 8],
        ]);

        expect(
            typed(flush(), 'etazeta', {
                start: 3,
                end: 3,
                text: 'X',
                side: 'after',
            }),
        ).toEqual([
            [0, 3],
            [3, 8],
        ]);
    });
});

describe('text that arrived rather than being typed', () => {
    // A wider gap, so the caret can stand in it touching neither citation.
    const spans = () => [cite(0, 5), cite(7, 12)];
    const text = 'alpha  gamma';

    it('is carried by the citation before it when TYPED, leaving nothing uncited', () => {
        expect(typed(spans(), text, { start: 6, end: 6, text: 'X' })).toEqual([
            [0, 7],
            [8, 13],
        ]);
    });

    it('stays uncited when it is IMPORTED', () => {
        expect(
            typed(spans(), text, {
                start: 6,
                end: 6,
                text: 'X',
                imported: true,
            }),
        ).toEqual([
            [0, 5],
            [8, 13],
        ]);
    });
});

describe('measuring an op from another origin', () => {
    const op: TextEditOp = {
        start: 3,
        end: 5,
        text: 'X',
        side: 'before',
        imported: true,
        atomic: true,
        cut_id: 'c1',
        mirror_text: 'γίνεται',
    };

    it('moves the offsets and nothing else', () => {
        expect(shiftOp(op, 100)).toEqual({ ...op, start: 103, end: 105 });
    });

    it('drops no field on the way — every one of them decides something', () => {
        // The bug this pins: a pane re-measuring a page-relative op by
        // rebuilding it from {start, end, text} threw away the marker side
        // the editor had just read from the DOM, so typing at a marker's
        // near side wrote into the citation the marker announces.
        expect(Object.keys(shiftOp(op, 100)).sort()).toEqual(
            Object.keys(op).sort(),
        );
    });
});
