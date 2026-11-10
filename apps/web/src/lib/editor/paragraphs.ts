/**
 * The paragraphs of an edition's text in the editor: which paragraph a
 * position is in, whether it is verse or prose, and what marking some
 * paragraphs as the one or the other does. A paragraph runs from a paragraph
 * break to the next, and its kind is the one its opening break carries, else the
 * edition's own. The first paragraph has no break before it, unless one that
 * begins the text opens it.
 */

import { isBreak, type Break, type Id, type Item, type Lineation, type Op } from '@varians/core';
import { shownOf } from './decorations.ts';
import type { Model } from './model.ts';

export interface ParagraphRef {
  /** The paragraph break that opens it; null for the first paragraph of a text that does not begin with one. */
  opener: Break | null;
  kind: Lineation;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** The paragraphs of the shown text in order, with the document position each begins at. */
function paragraphList(model: Model): { ref: ParagraphRef; from: number }[] {
  const convention = model.lineation ?? 'verse';
  const out: { ref: ParagraphRef; from: number }[] = [];
  for (const [i, span] of model.ledger.spans.entries()) {
    if (span.kind !== 'break') continue;
    const item = model.byId.get(span.id);
    if (!isBreak(item) || item.type !== 'paragraph') continue;
    // A break that begins the text opens the paragraph that follows it, which begins with the text.
    out.push({ ref: refOf(item, convention), from: i === 0 ? 0 : span.to });
  }
  if (out[0]?.from !== 0) out.unshift({ ref: refOf(null, convention), from: 0 });
  return out;
}

function refOf(opener: Break | null, convention: Lineation): ParagraphRef {
  return { opener, kind: opener?.lineation ?? convention };
}

/** The index of the paragraph a position is in: a position before a break is at the end of the paragraph above it. */
function indexAt(list: { from: number }[], pos: number): number {
  let index = 0;
  list.forEach((paragraph, i) => {
    if (paragraph.from <= pos) index = i;
  });
  return index;
}

/** The paragraph a position is in. */
export function paragraphAt(model: Model, pos: number): ParagraphRef {
  const list = paragraphList(model);
  return list[indexAt(list, pos)]!.ref;
}

/** The paragraphs a selection touches, in order; a selection that ends where a paragraph begins does not touch it. */
export function paragraphsIn(model: Model, from: number, to: number): ParagraphRef[] {
  const list = paragraphList(model);
  const first = indexAt(list, from);
  const last = indexAt(list, to > from ? to - 1 : to);
  return list.slice(first, last + 1).map((paragraph) => paragraph.ref);
}

/**
 * The line break that is not shown and that the caret stands against: it
 * stands between the word before it and the word after, and the caret can
 * only be at the end of the one or the start of the other. `next` is where the
 * caret goes to begin the paragraph that the break could open.
 */
export function hiddenBreakAt(model: Model, pos: number): { id: Id; next: number } | null {
  const shown = shownOf(model);
  const spans = model.ledger.spans;
  for (const [i, span] of spans.entries()) {
    if (
      span.kind !== 'break' ||
      !shown.hidden.has(span.id) ||
      shown.hidden.has(spans[i - 1]?.id ?? '')
    )
      continue;
    // The breaks not shown in a row stand for one: it is the first that is the paragraph's.
    let last = i;
    while (spans[last + 1] && shown.hidden.has(spans[last + 1]!.id)) last++;
    const start = spans[i - 1]?.to ?? span.from;
    const end = spans[last + 1]?.from ?? spans[last]!.to;
    if (pos === start || pos === end) return { id: span.id, next: end };
  }
  return null;
}

/** The kind of every paragraph the selection touches, when it is one kind; null where they differ. */
export function lineationIn(model: Model, from: number, to: number): Lineation | null {
  const kinds = new Set(paragraphsIn(model, from, to).map((ref) => ref.kind));
  return kinds.size === 1 ? [...kinds][0]! : null;
}

export interface Marking {
  ops: Op[];
  /** The text change that shows the operations, where they add the break that begins the text. */
  change?: TextChange;
}

/**
 * The operations that make the paragraphs of a selection verse or prose: each
 * paragraph that is not of that kind has it marked on the break that opens it.
 * A first paragraph that no break opens gets one, at the start of the text; a
 * line break that begins the text becomes that paragraph break. Null where
 * every paragraph is of the kind already.
 */
export function markLineation(
  model: Model,
  from: number,
  to: number,
  kind: Lineation,
  ids: () => Id,
): Marking | null {
  const ops: Op[] = [];
  let change: TextChange | undefined;
  for (const ref of paragraphsIn(model, from, to)) {
    if (ref.kind === kind) continue;
    if (ref.opener) {
      ops.push({ t: 'set', id: ref.opener.id, fields: { lineation: kind } });
      continue;
    }
    const first = model.view.stream.items[0] as Item | undefined;
    if (isBreak(first) && first.type !== 'paragraph' && first.type !== 'page') {
      // A line break at the start of the text opens the first paragraph.
      ops.push({ t: 'set', id: first.id, fields: { type: 'paragraph', lineation: kind } });
      continue;
    }
    const brk: Break = { kind: 'break', id: ids(), type: 'paragraph', lineation: kind };
    ops.push({ t: 'insert', after: null, items: [brk] });
    change = { from: 0, to: 0, insert: '\n' };
  }
  return ops.length ? { ops, ...(change ? { change } : {}) } : null;
}
