/**
 * Marks of what stands between two pieces of the text and has no words in it
 * (in an edition, a segment that witnesses have and the edition does not
 * print). The host names the item each mark follows. In verse the mark stands
 * in a margin, at the foot of the line holding that item, between it and the
 * next line; in prose, where lines are not shown, it is the small point after
 * the item, in the text, as the reader marks a point between two words. A
 * click on it goes back to the host by the mark's key. Kept in a field of its
 * own, so that changing the marks never rebuilds the model.
 */

import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter } from '@codemirror/view';
import type { Id } from '@varians/core';
import { spanOf } from './bridge.ts';
import { modelField } from './state.ts';

export interface MarginMark {
  /** What the host knows the mark by. */
  key: string;
  /** The item the mark follows: it stands at the foot of that item's line, or after it. */
  after: Id;
  title: string;
  active?: boolean;
  /** The item stands in a prose paragraph: the mark is a point in the text, not a mark in the margin. */
  inText?: boolean;
}

export const setMarginMarks = StateEffect.define<MarginMark[]>();

const NONE: MarginMark[] = [];

export const marginMarksField = StateField.define<MarginMark[]>({
  create: () => NONE,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMarginMarks)) value = effect.value;
    return value;
  },
});

/** A mark of the host's as a sign: a caret that hands the mark to the host on a click, the caret staying where it is. */
function signOf(mark: MarginMark, className: string, onclick: (key: string) => void): HTMLElement {
  const sign = document.createElement('span');
  sign.className = mark.active ? `${className} ${className}-active` : className;
  sign.title = mark.title;
  sign.dataset.key = mark.key;
  sign.addEventListener('mousedown', (event) => event.preventDefault());
  sign.addEventListener('click', (event) => {
    event.stopPropagation();
    onclick(mark.key);
  });
  return sign;
}

const sameMark = (a: MarginMark, b: MarginMark) =>
  a.key === b.key && a.title === b.title && !!a.active === !!b.active;

class MarginMarker extends GutterMarker {
  constructor(
    readonly marks: MarginMark[],
    readonly onclick: (key: string) => void,
  ) {
    super();
  }

  override eq(other: MarginMarker): boolean {
    return (
      other.marks.length === this.marks.length &&
      other.marks.every((m, k) => sameMark(m, this.marks[k]!))
    );
  }

  override toDOM(): Node {
    const holder = document.createElement('span');
    holder.className = 'cm-margin-marks';
    // The gutters are hidden from assistive technology; what a mark opens is reached by stepping as well.
    for (const mark of this.marks) {
      const sign = signOf(mark, 'cm-margin-mark', this.onclick);
      sign.textContent = '‸';
      holder.appendChild(sign);
    }
    return holder;
  }
}

/** The gutter that shows the marks of `marginMarksField` that stand beside verse. */
export function marginGutter(onclick: (key: string) => void): Extension {
  return gutter({
    class: 'cm-margin-gutter',
    lineMarker: (view, line) => {
      const marks = view.state.field(marginMarksField);
      if (marks.length === 0) return null;
      const ledger = view.state.field(modelField).model.ledger;
      const here = marks.filter((mark) => {
        if (mark.inText) return false;
        const span = spanOf(ledger, mark.after);
        return span !== undefined && span.from >= line.from && span.from <= line.to;
      });
      return here.length ? new MarginMarker(here, onclick) : null;
    },
    lineMarkerChange: (update) =>
      update.startState.field(marginMarksField) !== update.state.field(marginMarksField) ||
      update.startState.field(modelField) !== update.state.field(modelField),
  });
}

/** The point in the text that marks a segment the edition does not print, where the text before it is prose. */
class PointWidget extends WidgetType {
  constructor(
    readonly mark: MarginMark,
    readonly onclick: (key: string) => void,
  ) {
    super();
  }

  override eq(other: PointWidget): boolean {
    return sameMark(other.mark, this.mark);
  }

  toDOM(): HTMLElement {
    // A mark of no width: its box is as wide as the space it stands in, and the same width is taken off its margin.
    return signOf(this.mark, 'cm-point-mark', this.onclick);
  }
}

/** The points of the marks of `marginMarksField` that stand in prose, after their items. */
export function pointMarks(onclick: (key: string) => void): Extension {
  return EditorView.decorations.compute([marginMarksField, modelField], (state) => {
    const marks = state.field(marginMarksField).filter((mark) => mark.inText);
    if (marks.length === 0) return Decoration.none;
    const ledger = state.field(modelField).model.ledger;
    const ranges: Range<Decoration>[] = [];
    for (const mark of marks) {
      const span = spanOf(ledger, mark.after);
      if (span)
        ranges.push(
          Decoration.widget({ widget: new PointWidget(mark, onclick), side: 1 }).range(span.to),
        );
    }
    return Decoration.set(ranges, true);
  });
}
