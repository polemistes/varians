import { describe, expect, it } from 'vitest';
import { planRelocationEffects } from '@/lib/relocationEffects';
import type { TextEditOp } from '@/lib/transcriptionEdit';

/**
 * The client mirror of RelocationAssignmentEffects: given the text, the plan
 * sees the assignment that carried on across a gap (the `enclosing` claim)
 * with the words it took, so cutting those words makes a fragment of it.
 * The PHP case lives in RelocationAssignmentEffectsTest.
 */
describe('planning a relocation from the text', () => {
    const rows = () => [
        { start_offset: 0, end_offset: 3, needs_review: false },
        { start_offset: 5, end_offset: 8, needs_review: false },
    ];
    const ops: TextEditOp[] = [
        { start: 4, end: 4, text: 'x' },
        { start: 3, end: 5, text: '', cut_id: 'c1' },
        { start: 7, end: 7, text: ' x', cut_id: 'c1' },
    ];

    it('sees the words the assignment before reached over', () => {
        const effects = planRelocationEffects(rows(), ops, 'the  fox');

        expect(effects.creates).toEqual([
            { anchorIndex: 0, start: 7, end: 9, placement: 'after' },
        ]);
    });

    it('cannot see them without the text', () => {
        expect(planRelocationEffects(rows(), ops).creates).toEqual([]);
    });
});
