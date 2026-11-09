/**
 * Where a column or paragraph break goes, shown before it is made:
 * while the breaks are offered, the line a break would begin carries a
 * dashed rule and says what would begin there.
 */

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { Break } from '@varians/core';
import { linesOf } from './decorations.ts';
import { editorStrings } from './labels.ts';
import { breakTarget, lineAt, type BreakTarget, type BreakType, type LineInfo } from './lines.ts';
import type { Model } from './model.ts';
import { modelField } from './state.ts';

export interface BreakAt {
  /** The line the break would begin. */
  line: LineInfo;
  /** The break that opens it now, if any. */
  opener: Break | null;
  target: BreakTarget;
}

/** What a break of this type, made with the caret at `pos`, would do. */
export function breakAt(model: Model, pos: number, type: BreakType): BreakAt | null {
  if (model.misaligned) return null;
  const line = lineAt(linesOf(model), pos);
  if (!line) return null;
  // On the first line of a page shown alone, the page's own break opens it.
  const item = line.opener ? model.byId.get(line.opener.id) : line.from === 0 ? model.view.anchor : null;
  const opener = item && item.kind === 'break' ? item : null;
  return { line, opener, target: breakTarget(opener, type) };
}

/** The break shown in advance: one type, `any` for wherever a break could go, null for none. */
export type BreakPreview = BreakType | 'any' | null;

export const setBreakPreview = StateEffect.define<BreakPreview>();

const previewField = StateField.define<BreakPreview>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setBreakPreview)) value = effect.value;
    return value;
  },
});

const previewDecorations = EditorView.decorations.compute([previewField, 'selection', modelField], (state) => {
  const preview = state.field(previewField);
  if (!preview) return Decoration.none;
  const model = state.field(modelField).model;
  const pos = state.selection.main.head;
  const types: BreakType[] = preview === 'any' ? ['column', 'paragraph'] : [preview];
  const found = types.map((type) => breakAt(model, pos, type)).find((at) => at && at.target.t !== 'none');
  if (!found) return Decoration.none;
  return Decoration.set([
    Decoration.line({
      class: `cm-break-preview cm-break-preview-${preview}`,
      attributes: { 'data-preview': editorStrings.breakPreview[preview] },
    }).range(found.line.from),
  ]);
});

export const breakPreview = [previewField, previewDecorations];
