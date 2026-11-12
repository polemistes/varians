/**
 * Undo of typed text brings back the very words it removed. Found in the
 * workbench: words deleted and restored with Ctrl+Z came back as new words,
 * so their boxes on the image no longer knew them.
 */
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { fromText, sequentialIds } from '@varians/core';
import { buildModel } from './model.ts';
import { modelExtensions, modelField } from './state.ts';

function editorState(text: string) {
  const model = buildModel(fromText(text, { lang: 'grc', ids: sequentialIds() }), {
    form: 'written',
  });
  return EditorState.create({
    doc: model.ledger.text,
    extensions: [modelField.init(() => ({ model, ops: [] })), modelExtensions, history()],
  });
}

const ids = (state: EditorState) =>
  state.field(modelField).model.view.stream.items.map((i) => i.id);

function run(state: EditorState, command: typeof undo): EditorState {
  let next = state;
  command({ state, dispatch: (tr: Transaction) => (next = tr.state) });
  return next;
}

describe('undo of typed text', () => {
  it('restores deleted words with their ids', () => {
    let state = editorState('aa bb cc\ndd ee');
    const before = ids(state);
    state = state.update({ changes: { from: 0, to: 11 } }).state; // "aa bb cc\ndd" gone
    expect(state.doc.toString()).toBe(' ee');
    expect(ids(state)).not.toContain('t1');
    state = run(state, undo);
    expect(state.doc.toString()).toBe('aa bb cc\ndd ee');
    expect(ids(state)).toEqual(before);
    expect(state.field(modelField).model.misaligned).toBeFalsy();
    // Redo deletes the same words again; a second undo restores them again.
    state = run(state, redo);
    expect(state.doc.toString()).toBe(' ee');
    state = run(state, undo);
    expect(ids(state)).toEqual(before);
  });

  it('undoes several typed changes in one step, newest first', () => {
    let state = editorState('aa bb');
    const before = ids(state);
    state = state.update({ changes: { from: 5, insert: ' c' }, userEvent: 'input.type' }).state;
    state = state.update({ changes: { from: 7, insert: 'c' }, userEvent: 'input.type' }).state;
    state = state.update({ changes: { from: 0, to: 3 }, userEvent: 'delete.backward' }).state;
    expect(state.doc.toString()).toBe('bb cc');
    state = run(state, undo);
    state = run(state, undo);
    expect(state.doc.toString()).toBe('aa bb');
    expect(ids(state)).toEqual(before);
  });
});
