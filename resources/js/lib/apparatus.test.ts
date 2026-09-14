import { describe, expect, it } from 'vitest';
import { inflateCandidate, inflateRun } from '@/lib/apparatus';

describe('a candidate off the wire', () => {
    it('gets its defaults, its key and the spelling the text has', () => {
        const candidate = inflateCandidate({
            label: 'A',
            text: 'μυρί᾽',
            reading_id: 18,
            transcription_layer_id: 2,
            start_offset: 47,
            end_offset: 52,
        });

        expect(candidate).toMatchObject({
            key: 'reading:18',
            omitted: false,
            selected: false,
            conjecture_id: null,
            references: [],
            needs_review: false,
            diplomatic: 'μυρί᾽',
        });
    });

    it('keeps a null diplomatic apart from a spelling left unsaid', () => {
        expect(
            inflateCandidate({
                label: 'Bekker',
                text: 'γὰρ',
                reading_id: 3,
                conjecture_id: 7,
                conjecture_type: 'substitution',
                diplomatic: null,
            }).diplomatic,
        ).toBeNull();
        expect(
            inflateCandidate({
                label: 'B',
                text: 'δὲ',
                reading_id: 4,
                diplomatic: 'ΔΕ',
            }).diplomatic,
        ).toBe('ΔΕ');
    });
});

describe('a run off the wire', () => {
    it('gets its defaults and inflates its candidates', () => {
        const run = inflateRun({
            lemma_id: 5,
            base_start: 0,
            base_end: 5,
            text: 'μῆνιν',
            candidates: [{ label: 'A', text: 'μῆνιν', reading_id: 1 }],
        });

        expect(run).toMatchObject({
            decided: false,
            gap: false,
            omitted: false,
            break_before: null,
            diplomatic: 'μῆνιν',
            orthographic_variation: false,
        });
        expect(run.candidates[0]?.key).toBe('reading:1');
    });
});
