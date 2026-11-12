/**
 * The editor state that carries the model.
 *
 * One state field holds the model and the operations the last transaction
 * produced. A transaction that changes the document runs the bridge; one
 * that carries a model edit (a mark, a join, an object with its text) applies
 * operations instead, and the history inverts those edits, so undo and redo
 * cover them like text. `setModel` replaces the model wholesale, for a
 * stream that arrived from outside.
 */

import { Annotation, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Id, Op } from '@varians/core';
import { buildDecorations, buildRunOn } from './decorations.ts';
import { tokenSpanAt } from './selection.ts';
import { editModel, reconcileModel, withForm, type Intent, type Model } from './model.ts';

export interface ModelEdit {
  /** Operations on the shown items. */
  ops: Op[];
  /** Operations that undo them. */
  reverse: Op[];
}

export const setModel = StateEffect.define<Model>();
export const modelEdit = StateEffect.define<ModelEdit>();
/**
 * Operations on the whole stream, not only the items shown: text moved to
 * another page, or brought back from one. The transaction carries the text
 * change that shows them; the editor applies the operations to its whole
 * stream and rebuilds the model. The history inverts them like model edits.
 */
export const wholeEdit = StateEffect.define<ModelEdit>();
export const editIntent = Annotation.define<Intent>();

/**
 * The language chosen for what is typed next, with no words selected: new
 * words take it instead of their neighbours' while the caret stays in the
 * word it was in, or in the words typed since; moved elsewhere, the caret
 * lets it go.
 */
export interface Typing {
  lang: string;
  /** The word at the caret when it was chosen or last typed; null between words. */
  word: Id | null;
}

/** Choose the language of what is typed next; null lets it go. */
export const setTypingLanguage = StateEffect.define<string | null>();

export interface ModelState {
  model: Model;
  /** The operations on the whole stream this transaction produced. */
  ops: Op[];
  /** For typed text: the edit on the shown items and its reverse, which the history keeps. */
  typed?: ModelEdit;
  /** Operations on the whole stream the editor is still to apply (a whole edit). */
  whole?: Op[];
}

export const modelField = StateField.define<ModelState>({
  create() {
    throw new Error('the model field needs an initial value: add modelField.init(...)');
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setModel)) return { model: effect.value, ops: [] };
    }
    const wholeEdits = tr.effects.filter((e) => e.is(wholeEdit));
    if (wholeEdits.length) {
      // The model no longer matches the document; the editor rebuilds it from the whole stream at once.
      return {
        model: { ...value.model, misaligned: true },
        ops: [],
        whole: wholeEdits.flatMap((e) => e.value.ops),
      };
    }
    const edits = tr.effects.filter((e) => e.is(modelEdit));
    if (edits.length) {
      const doc = tr.newDoc.toString();
      let model = value.model;
      const ops: Op[] = [];
      let failed = false;
      for (const edit of edits) {
        try {
          const result = editModel(model, edit.value.ops, doc);
          model = result.model;
          ops.push(...result.ops);
        } catch (error) {
          failed = true;
          console.warn('[editor] a model edit could not be applied', error);
        }
      }
      if (failed) model = withForm(model, model.form, doc);
      return { model, ops };
    }
    if (!tr.docChanged) return value;
    try {
      const result = reconcileModel(
        value.model,
        tr.changes,
        tr.newDoc.toString(),
        tr.annotation(editIntent),
        undefined,
        tr.startState.field(typingField, false)?.lang,
      );
      return { model: result.model, ops: result.ops, typed: result.typed };
    } catch (error) {
      console.error('[editor] the change could not be read back into the stream', error);
      return { model: { ...value.model, misaligned: true }, ops: [] };
    }
  },
});

/** The word at the main caret of a state, by its model's ledger. */
function wordAtCaret(state: EditorState): Id | null {
  const model = state.field(modelField).model;
  return tokenSpanAt(model.ledger, state.selection.main.head)?.id ?? null;
}

export const typingField = StateField.define<Typing | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTypingLanguage))
        return effect.value ? { lang: effect.value, word: wordAtCaret(tr.state) } : null;
    }
    if (!value || (!tr.docChanged && !tr.selection)) return value;
    const word = wordAtCaret(tr.state);
    if (word === value.word) return value;
    // Typing carries the choice on to the word typed; moving the caret elsewhere ends it.
    return tr.docChanged ? { ...value, word } : null;
  },
});

export const decorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(
      state.field(modelField).model,
      state.facet(EditorView.perLineTextDirection),
    );
  },
  update(deco, tr) {
    const before = tr.startState.field(modelField).model;
    const after = tr.state.field(modelField).model;
    if (after !== before || tr.reconfigured) {
      return buildDecorations(after, tr.state.facet(EditorView.perLineTextDirection));
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The line breaks not shown, and the spaces that stand for nothing, as
 * replaced ranges that the caret skips (`buildRunOn`). A field of its own, so
 * that the ranges alone are the editor's atomic ranges.
 */
export const runOnField = StateField.define<DecorationSet>({
  create(state) {
    return buildRunOn(state.field(modelField).model);
  },
  update(deco, tr) {
    const before = tr.startState.field(modelField).model;
    const after = tr.state.field(modelField).model;
    if (after !== before) return buildRunOn(after);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/**
 * Model edits are undone by their reverse operations; so is typed text,
 * whose undo then brings back the very items it removed, ids and all.
 */
export const modelHistory = invertedEffects.of((tr) => {
  const wholes = tr.effects.filter((e) => e.is(wholeEdit));
  if (wholes.length)
    return wholes
      .reverse()
      .map((e) => wholeEdit.of({ ops: e.value.reverse, reverse: e.value.ops }));
  const edits = tr.effects.filter((e) => e.is(modelEdit));
  if (edits.length)
    return edits.reverse().map((e) => modelEdit.of({ ops: e.value.reverse, reverse: e.value.ops }));
  const typed = tr.docChanged ? tr.state.field(modelField, false)?.typed : undefined;
  return typed ? [modelEdit.of({ ops: typed.reverse, reverse: typed.ops })] : [];
});

export const modelExtensions = [typingField, decorationField, runOnField, modelHistory];
