/**
 * What a review card shows of one change: the lines it touched as they were
 * and as they became, clipped around the words that changed, and where the
 * change stands in the current text for putting the cards in the order of
 * the text. Pure.
 */

import {
  lines as carrierLines,
  segmentAt,
  type Id,
  type Item,
  type Stream,
  type StreamDiff,
  type Token,
} from '@varians/core';
import { indexDiff, markedCell, plainCell } from './placement.ts';
import type { Cell, CompactLine, SerializedDiff } from './types.ts';

export interface TouchedLines {
  before: CompactLine[];
  after: CompactLine[];
  /** Lines touched in all, on the side that touched more. */
  total: number;
}

export interface TouchedOptions {
  /** Lines shown per side. */
  max?: number;
  /** Unchanged words kept on either side of a change before the line is clipped. */
  context?: number;
}

/**
 * Line index of every item: tokens and objects by the line they stand on, a
 * break by the line it closes (as the old text shows a removed break) or by
 * the line it opens (as the new text shows an added one).
 */
function lineIndex(stream: Stream, breaks: 'close' | 'open'): Map<Id, number> {
  const out = new Map<Id, number>();
  let line = 0;
  for (const item of stream.items) {
    if (item.kind === 'break') {
      out.set(item.id, breaks === 'close' ? line : line + 1);
      line++;
    } else out.set(item.id, line);
  }
  return out;
}

/** Keep the marked cells and `context` cells either side; runs left out become one null. */
export function clipCells(cells: Cell[], context: number): (Cell | null)[] {
  const marked = cells.map((c) => c.added || c.removed || c.changed || c.moved || !!c.away);
  if (!marked.some(Boolean)) {
    const head: (Cell | null)[] = cells.slice(0, context * 2 + 1);
    if (cells.length > head.length) head.push(null);
    return head;
  }
  const keep = cells.map(() => false);
  marked.forEach((m, i) => {
    if (!m) return;
    for (let k = Math.max(0, i - context); k <= Math.min(cells.length - 1, i + context); k++)
      keep[k] = true;
  });
  // An ellipsis for one word saves nothing: keep the word.
  keep.forEach((kept, i) => {
    if (!kept && keep[i - 1] !== false && keep[i + 1] !== false) keep[i] = true;
  });
  const out: (Cell | null)[] = [];
  cells.forEach((cell, i) => {
    if (keep[i]) out.push(cell);
    else if (out[out.length - 1] !== null) out.push(null);
  });
  return out;
}

/** The lines a change touched, before and after it, with what changed marked. */
export function touchedLines(
  before: Stream,
  after: Stream,
  diff: StreamDiff | Pick<SerializedDiff, 'changes'>,
  options: TouchedOptions = {},
): TouchedLines {
  const max = options.max ?? 3;
  const context = options.context ?? 4;
  const marks = indexDiff(diff);
  const removedIds = new Set(marks.removed.map((r) => r.item.id));
  const beforeLines = carrierLines(before);
  const afterLines = carrierLines(after);
  const beforeLineOf = lineIndex(before, 'close');
  const afterLineOf = lineIndex(after, 'open');

  const touchedBefore = new Set<number>();
  const touchedAfter = new Set<number>();
  for (const id of removedIds) touchedBefore.add(beforeLineOf.get(id) ?? 0);
  for (const id of [...marks.changed.keys(), ...marks.moved]) {
    const was = beforeLineOf.get(id);
    if (was !== undefined) touchedBefore.add(was);
    const now = afterLineOf.get(id);
    if (now !== undefined) touchedAfter.add(now);
  }
  for (const r of marks.removed)
    touchedAfter.add(r.after === null ? 0 : (afterLineOf.get(r.after) ?? 0));
  // An addition shows in the old text at the line of the nearest earlier item that was already there.
  after.items.forEach((item, i) => {
    if (!marks.added.has(item.id)) return;
    touchedAfter.add(afterLineOf.get(item.id) ?? 0);
    let line = 0;
    for (let k = i - 1; k >= 0; k--) {
      const anchor = after.items[k]!;
      const there = beforeLineOf.get(anchor.id);
      if (there !== undefined) {
        // After a break means at the start of the line it opens.
        line = anchor.kind === 'break' ? there + 1 : there;
        break;
      }
    }
    touchedBefore.add(Math.min(line, Math.max(0, beforeLines.length - 1)));
  });

  const beforeCells = (index: number): Cell[] => {
    const line = beforeLines[index];
    if (!line) return [];
    const cells: Cell[] = [];
    for (let i = line.from; i <= line.to && i < before.items.length; i++) {
      const item = before.items[i]!;
      // The break that closes the line shows only when the change touched it.
      if (
        i === line.to &&
        !(removedIds.has(item.id) || marks.changed.has(item.id) || marks.moved.has(item.id))
      )
        continue;
      const cell = plainCell(item, i);
      if (removedIds.has(item.id)) cell.removed = true;
      if (marks.moved.has(item.id)) cell.away = true;
      const change = marks.changed.get(item.id);
      if (change) {
        cell.changed = true;
        cell.fields = change.fields;
      }
      cells.push(cell);
    }
    return cells;
  };
  const afterCells = (index: number): Cell[] => {
    const line = afterLines[index];
    if (!line) return [];
    const cells: Cell[] = [];
    const opener = line.from > 0 ? after.items[line.from - 1] : undefined;
    if (
      opener &&
      (marks.added.has(opener.id) || marks.moved.has(opener.id) || marks.changed.has(opener.id))
    ) {
      cells.push(markedCell(opener, line.from - 1, marks, {}));
    }
    for (let i = line.from; i < line.to; i++) cells.push(markedCell(after.items[i]!, i, marks, {}));
    return cells;
  };

  const build = (
    stream: Stream,
    indexes: Set<number>,
    cellsOf: (i: number) => Cell[],
    lineList: { from: number }[],
    prefix: string,
  ): CompactLine[] =>
    [...indexes]
      .sort((a, b) => a - b)
      .slice(0, max)
      .map((i) => ({
        key: `${prefix}${i}`,
        segmentId:
          lineList[i] && lineList[i]!.from < stream.items.length
            ? (segmentAt(stream, lineList[i]!.from)?.segmentId ?? null)
            : null,
        cells: clipCells(cellsOf(i), context),
      }));

  return {
    before: before.items.length ? build(before, touchedBefore, beforeCells, beforeLines, 'b') : [],
    after: after.items.length ? build(after, touchedAfter, afterCells, afterLines, 'a') : [],
    total: Math.max(
      before.items.length ? touchedBefore.size : 0,
      after.items.length ? touchedAfter.size : 0,
    ),
  };
}

/**
 * Where a change stands in `current`, for putting changes in the order of
 * the text: the smallest index of an item it added, changed or moved, and
 * just after the item its removals followed. An item since gone counts just
 * after the nearest earlier item of `after` (the text the change made) that
 * still stands. A change nothing of which can be placed sorts last.
 */
export function positionIn(
  current: Map<Id, number>,
  diff: StreamDiff | Pick<SerializedDiff, 'changes'>,
  after?: Stream,
): number {
  let afterIndex: Map<Id, number> | null = null;
  const place = (id: Id): number | undefined => {
    const at = current.get(id);
    if (at !== undefined || !after) return at;
    afterIndex ??= new Map(after.items.map((item, i) => [item.id, i]));
    const from = afterIndex.get(id);
    if (from === undefined) return undefined;
    for (let k = from - 1; k >= 0; k--) {
      const there = current.get(after.items[k]!.id);
      if (there !== undefined) return there + 0.5;
    }
    return -0.5;
  };
  let best = Number.MAX_SAFE_INTEGER;
  for (const change of diff.changes) {
    let at: number | undefined;
    if (change.kind === 'added' || change.kind === 'moved') at = place(change.item.id);
    else if (change.kind === 'changed') at = place(change.after.id);
    else if (change.after === null) at = -0.5;
    else {
      const anchor = place(change.after);
      at = anchor === undefined ? undefined : Math.floor(anchor) + 0.5;
    }
    if (at !== undefined) best = Math.min(best, at);
  }
  return best;
}

/** An item with only what a card shows: a token without its provenance. */
export function slimItem<T extends Item>(item: T): T {
  if (item.kind !== 'token' || item.source === undefined) return item;
  const copy = { ...item } as Token;
  delete copy.source;
  return copy as T;
}

/** A line lightened for sending: provenance of its tokens left out. */
export function slimLine(line: CompactLine): CompactLine {
  return {
    ...line,
    cells: line.cells.map((cell) =>
      cell
        ? { ...cell, item: slimItem(cell.item), was: cell.was ? slimItem(cell.was) : null }
        : null,
    ),
  };
}
