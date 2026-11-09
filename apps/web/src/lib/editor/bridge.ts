/**
 * The bridge between a token stream and a CodeMirror document.
 *
 * The editor shows plain text: tokens separated by spaces, breaks as
 * newlines, objects as a placeholder character. A ledger records which
 * range of the text each item occupies. When the text changes, the ledger
 * is mapped through the change set and the changed lines are read back into
 * items, each word keeping the id of the token whose text it grew out of.
 * The result is a small list of operations on the stream, never a rewrite.
 */

import { ChangeSet, Text } from '@codemirror/state';
import {
  applyOps,
  isToken,
  newId,
  readForm,
  type Break,
  type Id,
  type Item,
  type Mark,
  type Obj,
  type Op,
  type SegmentStart,
  type Stream,
  type Token,
} from '@varians/core';

export type Form = 'written' | 'read';

export interface Span {
  from: number;
  to: number;
  id: Id;
  kind: Item['kind'];
}

export interface Ledger {
  text: string;
  spans: Span[];
}

/** Stands in the text for an object item (a gap, a figure); rendered as a widget. */
export const OBJECT_CHAR = '￼';

/** The text a token shows in a form. */
export function tokenText(token: Token, form: Form): string {
  return form === 'read' ? readForm(token) : token.form;
}

/** Render a stream to text and the ledger of where each item stands. */
export function render(stream: Stream, form: Form): Ledger {
  let text = '';
  const spans: Span[] = [];
  let atLineStart = true;
  for (const item of stream.items) {
    if (item.kind === 'break') {
      spans.push({ from: text.length, to: text.length + 1, id: item.id, kind: 'break' });
      text += '\n';
      atLineStart = true;
      continue;
    }
    if (!atLineStart) text += ' ';
    const shown = item.kind === 'token' ? tokenText(item, form) : OBJECT_CHAR;
    spans.push({ from: text.length, to: text.length + shown.length, id: item.id, kind: item.kind });
    text += shown;
    atLineStart = false;
  }
  return { text, spans };
}

export function spanOf(ledger: Ledger, id: Id): Span | undefined {
  return ledger.spans.find((s) => s.id === id);
}

/** The item whose span contains the position, or that the position touches at its end. */
export function spanAt(ledger: Ledger, pos: number): Span | undefined {
  let best: Span | undefined;
  for (const span of ledger.spans) {
    if (span.from > pos) break;
    if (pos >= span.from && pos <= span.to) best = span;
  }
  return best;
}

/** Spans of tokens and objects overlapping a range (a collapsed range touches). */
export function spansIn(ledger: Ledger, from: number, to: number): Span[] {
  return ledger.spans.filter(
    (s) =>
      s.kind !== 'break' &&
      (from === to ? s.from <= from && s.to >= from : s.from < to && s.to > from),
  );
}

export interface ReconcileOptions {
  ids?: () => Id;
  /** Whether a written form changed under an existing read form needs the editor's check. */
  needsCheck?: (token: Token, newForm: string) => boolean;
}

export interface Reconciled {
  ops: Op[];
  stream: Stream;
  ledger: Ledger;
}

interface Slot {
  from: number;
  to: number;
  kind: 'token' | 'object' | 'break';
  text: string;
}

/** Read the words, objects and newlines of a text range as slots. */
function slotsOf(doc: Text, from: number, to: number): Slot[] {
  const slots: Slot[] = [];
  const text = doc.sliceString(from, to);
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n') {
      slots.push({ from: from + i, to: from + i + 1, kind: 'break', text: '\n' });
      i++;
      continue;
    }
    if (ch === OBJECT_CHAR) {
      slots.push({ from: from + i, to: from + i + 1, kind: 'object', text: ch });
      i++;
      continue;
    }
    if (/\s/u.test(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && !/\s/u.test(text[j]!) && text[j] !== OBJECT_CHAR) j++;
    slots.push({ from: from + i, to: from + j, kind: 'token', text: text.slice(i, j) });
    i = j;
  }
  return slots;
}

interface MappedSpan {
  span: Span;
  from: number;
  to: number;
}

/**
 * Apply a CodeMirror change set to a stream rendered as `ledger`, returning
 * the operations, the new stream and the new ledger.
 */
export function reconcile(
  stream: Stream,
  ledger: Ledger,
  changes: ChangeSet,
  form: Form,
  options: ReconcileOptions = {},
): Reconciled {
  const ids = options.ids ?? newId;
  const needsCheck = options.needsCheck ?? ((token: Token) => token.norm !== undefined);
  if (changes.empty) return { ops: [], stream, ledger };
  const oldDoc = Text.of(ledger.text.split('\n'));
  const newDoc = changes.apply(oldDoc);
  const inverted = changes.invert(oldDoc);

  // The changed range in the new document, widened to whole lines.
  let changedFrom = Infinity;
  let changedTo = -Infinity;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    changedFrom = Math.min(changedFrom, fromB);
    changedTo = Math.max(changedTo, toB);
  });
  const rangeFrom = Math.min(newDoc.lineAt(Math.min(changedFrom, newDoc.length)).from, changedFrom);
  const rangeTo = Math.max(newDoc.lineAt(Math.min(changedTo, newDoc.length)).to, changedTo);

  // Old items whose span overlaps the range in old coordinates, in order.
  const oldFrom = inverted.mapPos(rangeFrom, -1);
  const oldTo = inverted.mapPos(rangeTo, 1);
  const affected = ledger.spans.filter((s) => s.from < oldTo && s.to > oldFrom);
  const byId = new Map(stream.items.map((item) => [item.id, item] as const));
  const mapped: MappedSpan[] = affected.map((span) => ({
    span,
    from: changes.mapPos(span.from, -1),
    to: changes.mapPos(span.to, 1),
  }));

  const slots = slotsOf(newDoc, rangeFrom, rangeTo);
  const taken = new Set<Id>();
  const newItems: Item[] = [];
  const setOps: Op[] = [];
  /** Segment starts that lost their item and wait for the next one. */
  let pendingSegment: SegmentStart | undefined;
  /** The segment start each new item should carry, where it differs from what it has. */
  const desiredSegment = new Map<Id, SegmentStart>();

  const give = (item: Item, segment: SegmentStart | undefined): Item => {
    if (!segment || item.kind === 'break') return item;
    if ((item as Token | Obj).segment) return item;
    desiredSegment.set(item.id, segment);
    return { ...item, segment } as Item;
  };

  // Words that kept their text pair up first, in order; the rest pair by position.
  const shownText = (span: Span): string => {
    const item = byId.get(span.id)!;
    return item.kind === 'token' ? tokenText(item, form) : OBJECT_CHAR;
  };
  const oldWords = mapped.filter((m) => m.span.kind !== 'break');
  const wordSlots = slots.filter((s) => s.kind !== 'break');
  const paired = new Map<Slot, MappedSpan>();
  for (const [o, s] of lcsPairs(
    oldWords.map((m) => shownText(m.span)),
    wordSlots.map((s) => s.text),
  )) {
    paired.set(wordSlots[s]!, oldWords[o]!);
    taken.add(oldWords[o]!.span.id);
  }

  for (const slot of slots) {
    const candidates = paired.has(slot)
      ? [paired.get(slot)!, ...overlapping(mapped, slot, taken)]
      : slot.kind === 'break'
        ? mapped.filter(
            (m) => !taken.has(m.span.id) && m.span.kind === 'break' && m.from === slot.from,
          )
        : overlapping(mapped, slot, taken);
    const match = candidates[0];
    if (match) {
      taken.add(match.span.id);
      const old = byId.get(match.span.id)!;
      if (slot.kind === 'break' || old.kind === 'break') {
        newItems.push(old);
        continue;
      }
      let item: Item = old;
      if (old.kind === 'token') {
        const updated = updateToken(old, slot.text, form, match, changes, needsCheck);
        let token = updated.token;
        if (updated.changed) setOps.push({ t: 'set', id: old.id, fields: updated.fields });
        // Parts swallowed by this word (a word divided across lines put together again):
        // the word now continues, or not, where its last part did.
        const parts = candidates
          .slice(1)
          .map((other) => byId.get(other.span.id))
          .filter((part): part is Token => part?.kind === 'token');
        const last = parts[parts.length - 1];
        if (last && (token.joinNext === true) !== (last.joinNext === true)) {
          token = { ...token };
          if (last.joinNext) token.joinNext = true;
          else delete token.joinNext;
          setOps.push(setJoin(token, last.joinNext === true));
        }
        item = token;
      }
      item = give(item, pendingSegment);
      pendingSegment = undefined;
      newItems.push(item);
      // Other old items swallowed by this slot (a join) pass their segment start on.
      for (const other of candidates.slice(1)) {
        const swallowed = byId.get(other.span.id);
        if (swallowed && swallowed.kind !== 'break' && swallowed.segment && !pendingSegment) {
          pendingSegment = swallowed.segment;
        }
      }
      continue;
    }
    if (slot.kind === 'break') {
      newItems.push({ kind: 'break', id: ids(), type: 'line' } satisfies Break);
      continue;
    }
    if (slot.kind === 'object') continue; // a placeholder with no object behind it is dropped
    const token: Token = { kind: 'token', id: ids(), form: slot.text };
    newItems.push(give(token, pendingSegment));
    pendingSegment = undefined;
  }

  // Old items no slot took are removed; a removed segment start moves to the next item without one.
  const oldIds = affected.map((m) => m.id);
  const removed = oldIds.filter((id) => !taken.has(id));
  const orphaned: SegmentStart[] = [];
  for (const id of removed) {
    const item = byId.get(id);
    if (item && item.kind !== 'break' && item.segment) orphaned.push(item.segment);
  }
  if (pendingSegment) orphaned.push(pendingSegment);
  for (const segment of orphaned) {
    const index = newItems.findIndex((n) => n.kind !== 'break' && !(n as Token | Obj).segment);
    if (index >= 0) newItems[index] = give(newItems[index]!, segment);
  }

  const ops = structuralOps(stream, oldIds, newItems, byId);
  for (const op of setOps) if (op.t === 'set' && newItems.some((n) => n.id === op.id)) ops.push(op);
  for (const [id, segment] of desiredSegment) {
    if (byId.has(id) && !removed.includes(id)) ops.push({ t: 'set', id, fields: { segment } });
  }
  const applied = applyOps(stream, ops);
  return { ops, stream: applied.stream, ledger: render(applied.stream, form) };
}

/** Old word items whose mapped range still overlaps a slot, in order, not yet taken. */
function overlapping(mapped: MappedSpan[], slot: Slot, taken: Set<Id>): MappedSpan[] {
  return mapped.filter(
    (m) =>
      !taken.has(m.span.id) &&
      m.span.kind !== 'break' &&
      m.to > m.from &&
      m.from < slot.to &&
      m.to > slot.from,
  );
}

/** Index pairs of a longest common subsequence of two word lists. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** UTF-16 offset of a code point index in a string. */
function utf16Offset(text: string, codePoints: number): number {
  return Array.from(text).slice(0, codePoints).join('').length;
}

/** Code point index of a UTF-16 offset in a string. */
function codePointIndex(text: string, utf16: number): number {
  return Array.from(text.slice(0, utf16)).length;
}

/** A token's new fields after its text in the current form changed. */
function updateToken(
  old: Token,
  text: string,
  form: Form,
  mapped: MappedSpan,
  changes: ChangeSet,
  needsCheck: (token: Token, newForm: string) => boolean,
): { token: Token; changed: boolean; fields: Record<string, unknown> } {
  const span = mapped.span;
  const shown = tokenText(old, form);
  if (shown === text) return { token: old, changed: false, fields: {} };
  const fields: Record<string, unknown> = {};
  const token: Token = { ...old };
  if (form === 'read') {
    if (text === old.form) {
      fields.norm = undefined;
      delete token.norm;
    } else {
      fields.norm = text;
      token.norm = text;
    }
    if (old.unchecked) {
      fields.unchecked = undefined;
      delete token.unchecked;
    }
  } else {
    fields.form = text;
    token.form = text;
    const marks = mapMarks(old.marks, span, changes, old.form, text);
    if (marks !== old.marks) {
      fields.marks = marks;
      if (marks) token.marks = marks;
      else delete token.marks;
    }
    if (old.norm !== undefined && old.norm === text) {
      fields.norm = undefined;
      delete token.norm;
      if (old.unchecked) {
        fields.unchecked = undefined;
        delete token.unchecked;
      }
    } else if (needsCheck(old, text)) {
      fields.unchecked = true;
      token.unchecked = true;
    }
  }
  return { token, changed: true, fields };
}

/**
 * Ranged marks of a token moved through the change set. Mark offsets count
 * code points of the written form; the change set counts UTF-16 units. A
 * word replaced whole keeps its marks where the old text survives inside
 * the new; otherwise marks left empty are dropped.
 */
function mapMarks(
  marks: Mark[] | undefined,
  span: Span,
  changes: ChangeSet,
  oldText: string,
  newText: string,
): Mark[] | undefined {
  if (!marks || marks.length === 0) return marks;
  const out: Mark[] = [];
  const newFrom = changes.mapPos(span.from, -1);
  const newLength = Array.from(newText).length;
  const shift = newText.includes(oldText)
    ? codePointIndex(newText, newText.indexOf(oldText))
    : null;
  for (const mark of marks) {
    if (mark.from === undefined || mark.to === undefined) {
      out.push(mark);
      continue;
    }
    const startPos = span.from + utf16Offset(oldText, mark.from);
    const endPos = span.from + utf16Offset(oldText, mark.to);
    let from = codePointIndex(newText, Math.max(0, changes.mapPos(startPos, 1) - newFrom));
    let to = codePointIndex(newText, Math.max(0, changes.mapPos(endPos, -1) - newFrom));
    if (!(to > from && to <= newLength) && shift !== null) {
      from = shift + mark.from;
      to = shift + mark.to;
    }
    if (to > from && from >= 0 && to <= newLength) out.push({ ...mark, from, to });
  }
  return out.length ? out : undefined;
}

/**
 * Operations turning the old items of the range into the new ones: deletes
 * and inserts when kept items stay in order, otherwise one replace.
 */
function structuralOps(stream: Stream, oldIds: Id[], newItems: Item[], byId: Map<Id, Item>): Op[] {
  const oldSet = new Set(oldIds);
  const kept = newItems.map((i) => i.id).filter((id) => byId.has(id) && oldSet.has(id));
  const keptSet = new Set(kept);
  const keptOldOrder = oldIds.filter((id) => keptSet.has(id));
  const sameOrder = kept.every((id, i) => id === keptOldOrder[i]);
  if (!sameOrder) {
    return [{ t: 'replace', ids: oldIds, items: newItems }];
  }
  const ops: Op[] = [];
  const removed = oldIds.filter((id) => !keptSet.has(id));
  if (removed.length) ops.push({ t: 'delete', ids: removed });
  let run: Item[] = [];
  let after: Id | null = predecessorOf(stream, oldIds);
  for (const item of newItems) {
    if (keptSet.has(item.id)) {
      if (run.length) ops.push({ t: 'insert', after, items: run.map(stripSegmentOfKept) });
      run = [];
      after = item.id;
    } else run.push(item);
  }
  if (run.length) ops.push({ t: 'insert', after, items: run });
  return ops;
}

function stripSegmentOfKept(item: Item): Item {
  return item;
}

function predecessorOf(stream: Stream, oldIds: Id[]): Id | null {
  if (oldIds.length === 0)
    return stream.items.length ? stream.items[stream.items.length - 1]!.id : null;
  const index = stream.items.findIndex((i) => i.id === oldIds[0]);
  return index > 0 ? stream.items[index - 1]!.id : null;
}

/** Set or clear the join between a token and the next (a word divided at a line's end). */
export function setJoin(token: Token, join: boolean): Op {
  return { t: 'set', id: token.id, fields: { joinNext: join ? true : undefined } };
}

/** Whether the stream is empty of text. */
export function isEmpty(stream: Stream): boolean {
  return !stream.items.some(isToken);
}

export { ChangeSet, Text };
