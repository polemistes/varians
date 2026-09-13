import { describe, expect, it } from 'vitest';
import { addressValue, nextLabel } from '@/lib/segmentLabel';

describe('the next label to propose', () => {
    it('counts trailing digits up', () => {
        expect(nextLabel('1.5')).toBe('1.6');
        expect(nextLabel('99')).toBe('100');
    });

    it('steps a trailing letter on, and wraps z', () => {
        expect(nextLabel('327a')).toBe('327b');
        expect(nextLabel('2.4A')).toBe('2.4B');
        expect(nextLabel('327z')).toBe('327aa');
    });

    it('leaves anything else alone', () => {
        expect(nextLabel('45*')).toBe('45*');
        expect(nextLabel('')).toBe('');
    });
});

describe('a level value as the server stores it', () => {
    it('is a number only when the text is nothing but digits', () => {
        expect(addressValue('12')).toBe(12);
        expect(addressValue('4a')).toBe('4a');
        expect(addressValue('a')).toBe('a');
    });
});
