/**
 * Marks in the margin between two lines of the text: where the host has
 * something to show that stands between the lines and has no words in the
 * text (in an edition, a line that witnesses have and the edition does not
 * print). The host names the item each mark follows; the mark stands at the
 * foot of the line holding that item, and a click on it goes back to the host
 * by the mark's key. Kept in a field of its own, so that changing the marks
 * never rebuilds the model.
 */

import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { GutterMarker, gutter } from '@codemirror/view';
import type { Id } from '@varians/core';
import { spanOf } from './bridge.ts';
import { modelField } from './state.ts';

export interface MarginMark {
  /** What the host knows the mark by. */
  key: string;
  /** The item the mark follows: it stands at the foot of that item's line. */
  after: Id;
  title: string;
  active?: boolean;
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
      other.marks.every(
        (m, k) =>
          m.key === this.marks[k]!.key &&
          m.title === this.marks[k]!.title &&
          !!m.active === !!this.marks[k]!.active,
      )
    );
  }

  override toDOM(): Node {
    const holder = document.createElement('span');
    holder.className = 'cm-margin-marks';
    // The gutters are hidden from assistive technology; what a mark opens is reached by stepping as well.
    for (const mark of this.marks) {
      const sign = document.createElement('span');
      sign.className = mark.active ? 'cm-margin-mark cm-margin-mark-active' : 'cm-margin-mark';
      sign.title = mark.title;
      sign.dataset.key = mark.key;
      sign.textContent = '‸';
      // The caret stays where it is: the click only hands the mark to the host.
      sign.addEventListener('mousedown', (event) => event.preventDefault());
      sign.addEventListener('click', (event) => {
        event.stopPropagation();
        this.onclick(mark.key);
      });
      holder.appendChild(sign);
    }
    return holder;
  }
}

/** The gutter that shows the marks of `marginMarksField`. */
export function marginGutter(onclick: (key: string) => void): Extension {
  return gutter({
    class: 'cm-margin-gutter',
    lineMarker: (view, line) => {
      const marks = view.state.field(marginMarksField);
      if (marks.length === 0) return null;
      const ledger = view.state.field(modelField).model.ledger;
      const here = marks.filter((mark) => {
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
