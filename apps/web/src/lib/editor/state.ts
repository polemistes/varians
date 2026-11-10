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

import { Annotation, StateEffect, StateField } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Op } from '@varians/core';
import { buildDecorations } from './decorations.ts';
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
      );
      return { model: result.model, ops: result.ops, typed: result.typed };
    } catch (error) {
      console.error('[editor] the change could not be read back into the stream', error);
      return { model: { ...value.model, misaligned: true }, ops: [] };
    }
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

export const modelExtensions = [decorationField, modelHistory];
