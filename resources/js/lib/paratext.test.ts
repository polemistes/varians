import { describe, expect, it } from 'vitest';
import { isLineStart, layoutOf, stackMarginBoxes } from '@/lib/paratext';

describe('where a paratext stands', () => {
    it('opens a line before the first run of a piece that starts one', () => {
        expect(
            isLineStart({
                placement: 'before',
                firstRunOfPiece: true,
                firstPiece: false,
                segmentStartsLine: true,
                breakBefore: null,
            }),
        ).toBe(true);
        expect(
            isLineStart({
                placement: 'before',
                firstRunOfPiece: true,
                firstPiece: false,
                segmentStartsLine: false,
                breakBefore: null,
            }),
        ).toBe(false);
    });

    it('opens a line before a run with a break of its own, never after a word', () => {
        expect(
            isLineStart({
                placement: 'before',
                firstRunOfPiece: false,
                firstPiece: false,
                segmentStartsLine: false,
                breakBefore: 'line',
            }),
        ).toBe(true);
        expect(
            isLineStart({
                placement: 'after',
                firstRunOfPiece: true,
                firstPiece: true,
                segmentStartsLine: true,
                breakBefore: 'line',
            }),
        ).toBe(false);
    });
});

describe("a speaker indication's layout", () => {
    it('follows the edition-wide setting', () => {
        expect(layoutOf('speaker', 'inline', true)).toBe('inline');
        expect(layoutOf('speaker', 'own_line', false)).toBe('own_line');
        expect(layoutOf('speaker', 'own_line_centered', true)).toBe(
            'own_line_centered',
        );
    });

    it('goes to the left margin only at a line beginning under line_start_margin', () => {
        expect(layoutOf('speaker', 'line_start_margin', true)).toBe(
            'left_margin',
        );
        expect(layoutOf('speaker', 'line_start_margin', false)).toBe('inline');
    });

    it('leaves the other kinds alone', () => {
        expect(layoutOf('right_margin', 'own_line', true)).toBe('right_margin');
        expect(layoutOf('inline', 'line_start_margin', true)).toBe('inline');
    });
});

describe('boxes stacked down a margin', () => {
    it('keep their own line top unless that overlaps the box above', () => {
        const tops = stackMarginBoxes(
            [
                { key: 'b', top: 30, height: 40 },
                { key: 'a', top: 0, height: 40 },
                { key: 'c', top: 200, height: 20 },
            ],
            4,
        );

        expect(tops.get('a')).toBe(0);
        expect(tops.get('b')).toBe(44);
        expect(tops.get('c')).toBe(200);
    });
});
