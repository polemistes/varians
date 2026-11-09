/**
 * What the editor does when the page or the form shown changes: the undo
 * history of the old text is dropped and the caret goes to the same word.
 * Found in the transcription workbench: after switching from the written
 * to the read form, or to another page, an undo replayed an edit of the old
 * text at the same positions of the new one.
 */
import { describe, expect, it } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { history, undoDepth } from '@codemirror/commands';
import { fromText, sequentialIds, type Break, type Token } from '@varians/core';
import { caretAfterViewChange, resetHistory } from './editor.ts';
import { buildModel } from './model.ts';

describe('resetHistory', () => {
  it('empties the undo history in two steps, where one would keep it', () => {
    const undo = new Compartment();
    let state = EditorState.create({ doc: 'ΜΗΝΙΝ', extensions: [undo.of(history())] });
    state = state.update({ changes: { from: 5, insert: 'Ω' } }).state;
    expect(undoDepth(state)).toBe(1);
    const [drop, add] = resetHistory(undo);
    expect(undoDepth(state.update({ effects: [drop!, add!] }).state)).toBe(1);
    for (const effects of resetHistory(undo)) state = state.update({ effects }).state;
    expect(undoDepth(state)).toBe(0);
    // The history works again afterwards.
    state = state.update({ changes: { from: 0, insert: 'Ψ' } }).state;
    expect(undoDepth(state)).toBe(1);
  });
});

describe('caretAfterViewChange', () => {
  // Page p1: `ΜΗΝΙΝ ΑΕΙΔΕ`, page p2: `ΘΕΑ`; ΑΕΙΔΕ is read as ἄειδε.
  function paged() {
    const s = fromText('\nΜΗΝΙΝ ΑΕΙΔΕ\nΘΕΑ', { ids: sequentialIds() });
    (s.items[0] as Break).type = 'page';
    (s.items[0] as Break).pageId = 'p1';
    (s.items[3] as Break).type = 'page';
    (s.items[3] as Break).pageId = 'p2';
    (s.items[2] as Token).norm = 'ἄειδε';
    return s;
  }

  it('keeps the caret on its word when the form changes', () => {
    const read = buildModel(paged(), { form: 'read', page: 'p1' });
    expect(read.ledger.text).toBe('ΜΗΝΙΝ ἄειδε');
    expect(caretAfterViewChange(read, 't3')).toBe(6);
  });

  it('goes to the start of a page that does not show the word', () => {
    const other = buildModel(paged(), { form: 'written', page: 'p2' });
    expect(caretAfterViewChange(other, 't3')).toBe(0);
    expect(caretAfterViewChange(other, null)).toBe(0);
  });
});
