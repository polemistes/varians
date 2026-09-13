import { describe, expect, it } from 'vitest';
import { EditHistory } from '@/lib/editHistory';
import type { TextEditOp } from '@/lib/transcriptionEdit';

/**
 * A relocation is ONE history step: the paste half joins the entry its cut
 * began, so an undo replays both halves together and they reach the server
 * in one save as a pair. Split across two steps, the undo of the paste went
 * up as a lone deletion — which the server destroys rather than carries.
 */
const cut: TextEditOp = {
    start: 4,
    end: 10,
    text: '',
    cut_id: 'c1',
    atomic: true,
};
const paste: TextEditOp = {
    start: 7,
    end: 7,
    text: 'quick ',
    cut_id: 'c1',
    atomic: true,
};

describe('a cut and its paste in history', () => {
    it('are undone together, as a freshly paired relocation back', () => {
        const history = new EditHistory();
        history.record(cut, 'the quick fox', 'atomic');
        history.record(paste, 'the fox', 'atomic');

        const undo = history.undo();

        expect(undo?.ops).toHaveLength(2);
        expect(undo?.ops[0]).toMatchObject({ start: 7, end: 13, text: '' });
        expect(undo?.ops[1]).toMatchObject({
            start: 4,
            end: 4,
            text: 'quick ',
        });
        expect(undo?.ops[0].cut_id).toBe(undo?.ops[1].cut_id);
        expect(undo?.ops[0].cut_id).not.toBe('c1');
        expect(history.canUndo).toBe(false);
    });

    it('are redone together, cut before paste, paired again', () => {
        const history = new EditHistory();
        history.record(cut, 'the quick fox', 'atomic');
        history.record(paste, 'the fox', 'atomic');
        history.undo();

        const redo = history.redo();

        expect(redo?.ops).toHaveLength(2);
        expect(redo?.ops[0]).toMatchObject({ start: 4, end: 10, text: '' });
        expect(redo?.ops[1]).toMatchObject({
            start: 7,
            end: 7,
            text: 'quick ',
        });
        expect(redo?.ops[0].cut_id).toBe(redo?.ops[1].cut_id);
    });

    it('keep the spans a lone cut would have destroyed, for the undo', () => {
        const history = new EditHistory();
        history.record(cut, 'the quick fox', 'atomic', {
            assignments: [
                { segment_id: 1, start_offset: 4, end_offset: 9, part: 1 },
            ],
            regions: [],
        });
        history.record(paste, 'the fox', 'atomic');

        expect(history.undo()?.restore.assignments).toHaveLength(1);
    });

    it('stay separate steps when something was typed between them', () => {
        const history = new EditHistory();
        history.record(cut, 'the quick fox', 'atomic');
        history.record({ start: 0, end: 0, text: 'X' }, 'the fox', 'typing');
        history.record({ ...paste, start: 8, end: 8 }, 'Xthe fox', 'atomic');

        const undo = history.undo();

        expect(undo?.ops).toHaveLength(1);
        expect(undo?.ops[0]).toMatchObject({ start: 8, end: 14, text: '' });
        expect(history.canUndo).toBe(true);
    });
});
