import { describe, expect, it } from 'vitest';
import { stripOps, stripPunctuation } from '@/lib/greekText';

describe('stripping punctuation', () => {
    it('keeps the hyphen that divides a word at the end of a line', () => {
        expect(stripPunctuation('ἄνδ-\nρα, μοι')).toBe('ἄνδ-\nρα μοι');
        expect(stripPunctuation('ἄνδ- ρα')).toBe('ἄνδ ρα');
    });

    it('emits no op for that hyphen', () => {
        expect(stripOps('ἄνδ-\nρα, μοι', 'punctuation')).toEqual([
            { start: 7, end: 8, text: '' },
        ]);
    });
});
