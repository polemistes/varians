import { describe, expect, it } from 'vitest';
import { mapOffset, pattern, words } from '@/lib/wordSpans';

/**
 * The client mirror of App\Support\Transcription\WordDivision (the PHP
 * WordDivisionTest is the contract): a word divided at a line's end with a
 * hyphen is one word.
 */
describe('a word divided at the end of a line', () => {
    it('is one word, and only when a hyphen stands before the break', () => {
        expect(words('ἄνδ-\nρα μοι')).toEqual([
            { start: 0, end: 7 },
            { start: 8, end: 11 },
        ]);
        expect(words('ἄνδ\nρα')).toHaveLength(2);
        expect(words('ἄνδ- ρα')).toHaveLength(2);
    });

    it('is one mark in the pattern the layers are compared by', () => {
        expect(pattern('ἄνδ-\nρα μοι')).toBe('w w');
        expect(pattern('ἄνδ-\nρα μοι')).toBe(pattern('ανδ-\nρα μοι'));
    });

    it('has no counterpart offset inside it, at the hyphen either', () => {
        expect(mapOffset('ἄνδ-\nρα μοι', 'ανδ-\nρα μοι', 4)).toBeNull();
        expect(mapOffset('ἄνδ-\nρα μοι', 'ανδ-\nρα μοι', 8)).toBe(8);
    });
});
