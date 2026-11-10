/**
 * Classes the host puts on tokens: the variant sites of an edition, the
 * words of a hovered image zone, the active site. Kept in a field of its
 * own, so that changing a highlight never rebuilds the model.
 */

import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Id } from '@varians/core';
import { spanOf } from './bridge.ts';
import type { Model } from './model.ts';
import { modelField } from './state.ts';

/** Token id to one or more class names, separated by spaces. */
export type TokenClasses = Record<Id, string>;

export const setTokenClasses = StateEffect.define<TokenClasses>();

interface HighlightState {
  classes: TokenClasses;
  decorations: DecorationSet;
}

const marks = new Map<string, Decoration>();

function markFor(className: string): Decoration {
  let mark = marks.get(className);
  if (!mark) {
    mark = Decoration.mark({ class: className });
    marks.set(className, mark);
  }
  return mark;
}

/** The decorations of the classes over the tokens shown by the model. */
export function highlightDecorations(classes: TokenClasses, model: Model): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const [id, className] of Object.entries(classes)) {
    if (!className) continue;
    const span = spanOf(model.ledger, id);
    if (!span || span.to <= span.from || span.kind === 'break') continue;
    ranges.push(markFor(className).range(span.from, span.to));
  }
  return Decoration.set(ranges, true);
}

export const tokenClassField = StateField.define<HighlightState>({
  create: () => ({ classes: {}, decorations: Decoration.none }),
  update(value, tr) {
    let classes = value.classes;
    for (const effect of tr.effects) if (effect.is(setTokenClasses)) classes = effect.value;
    const before = tr.startState.field(modelField, false);
    const after = tr.state.field(modelField, false);
    const modelChanged = before?.model !== after?.model;
    if (classes === value.classes && !modelChanged) {
      return tr.docChanged ? { classes, decorations: value.decorations.map(tr.changes) } : value;
    }
    return {
      classes,
      decorations: after ? highlightDecorations(classes, after.model) : Decoration.none,
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
