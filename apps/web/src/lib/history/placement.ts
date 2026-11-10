/**
 * Placing a diff on a text for display: the lines of the stream as laid out,
 * each item a cell carrying what happened to it and who did it, and the
 * removed items put back where they stood (after the kept item the diff
 * names, or at the start of the line their break opened). Pure; the view
 * only renders the result.
 */

import {
  gapText,
  layoutLines,
  type Change,
  type Id,
  type Item,
  type LayoutOptions,
  type Stream,
} from '@varians/core';
import type { Cell, SerializedDiff } from './types.ts';

export interface LineOpener {
  added: boolean;
  moved: boolean;
  author: string | null;
}

export interface RenderLine {
  key: string;
  label: string | null;
  cells: Cell[];
  /** Holds only removed items: a stretch whose words and breaks were all removed. */
  ghost: boolean;
  paragraph: boolean;
  /** The break that opened the line, when it was added or moved. */
  opener: LineOpener | null;
}

export function plainCell(item: Item, index: number): Cell {
  return {
    item,
    index,
    added: false,
    removed: false,
    changed: false,
    moved: false,
    was: null,
    fields: [],
    author: null,
  };
}

/** What a diff says happened to each item, by id. */
export interface DiffIndex {
  added: Set<Id>;
  moved: Set<Id>;
  changed: Map<Id, Extract<Change, { kind: 'changed' }>>;
  removed: Extract<Change, { kind: 'removed' }>[];
}

export function indexDiff(diff: Pick<SerializedDiff, 'changes'> | null): DiffIndex {
  const out: DiffIndex = { added: new Set(), moved: new Set(), changed: new Map(), removed: [] };
  for (const change of diff?.changes ?? []) {
    switch (change.kind) {
      case 'added':
        out.added.add(change.item.id);
        break;
      case 'moved':
        out.moved.add(change.item.id);
        break;
      case 'changed':
        out.changed.set(change.after.id, change);
        break;
      case 'removed':
        out.removed.push(change);
        break;
    }
  }
  return out;
}

/** A cell of a present item, marked by the diff. */
export function markedCell(
  item: Item,
  index: number,
  marks: DiffIndex,
  authors: Record<Id, string>,
): Cell {
  const cell = plainCell(item, index);
  if (marks.added.has(item.id)) cell.added = true;
  if (marks.moved.has(item.id)) cell.moved = true;
  const change = marks.changed.get(item.id);
  if (change) {
    cell.changed = true;
    cell.was = change.before.kind === 'token' ? change.before : null;
    cell.fields = change.fields;
  }
  if (cell.added || cell.moved || cell.changed) cell.author = authors[item.id] ?? null;
  return cell;
}

/** Lay a stream out and mark the diff on it. Without a diff every cell is plain. */
export function renderLines(
  stream: Stream,
  diff: Pick<SerializedDiff, 'changes'> | null,
  labelOf: (segmentId: Id) => string,
  options: LayoutOptions = {},
  authors: Record<Id, string> = {},
): RenderLine[] {
  const lines = layoutLines(stream, labelOf, options);
  const indexOf = new Map<Id, number>();
  stream.items.forEach((item, i) => indexOf.set(item.id, i));
  const marks = indexDiff(diff);

  // Removed items by the index of the kept item they followed (-1: the start).
  const removedAt = new Map<number, Item[]>();
  for (const change of marks.removed) {
    const anchor = change.after === null ? -1 : (indexOf.get(change.after) ?? -1);
    const list = removedAt.get(anchor);
    if (list) list.push(change.item);
    else removedAt.set(anchor, [change.item]);
  }

  const consumed = new Set<number>();
  const take = (anchor: number): Cell[] => {
    const items = removedAt.get(anchor);
    if (!items) return [];
    consumed.add(anchor);
    return items.map((item) => ({
      ...plainCell(item, -1),
      removed: true,
      author: authors[item.id] ?? null,
    }));
  };

  const out: RenderLine[] = [];
  for (const line of lines) {
    const cells: Cell[] = [...take(line.from - 1)];
    for (let i = line.from; i < line.to; i++) {
      cells.push(markedCell(stream.items[i]!, i, marks, authors));
      cells.push(...take(i));
    }
    let opener: LineOpener | null = null;
    const openerItem = line.from > 0 ? stream.items[line.from - 1] : undefined;
    if (
      openerItem?.kind === 'break' &&
      (marks.added.has(openerItem.id) || marks.moved.has(openerItem.id))
    ) {
      opener = {
        added: marks.added.has(openerItem.id),
        moved: marks.moved.has(openerItem.id),
        author: authors[openerItem.id] ?? null,
      };
    }
    out.push({
      key: `l${line.index}`,
      label: line.label,
      cells,
      ghost: false,
      paragraph: line.paragraph,
      opener,
    });
  }

  // Removed items anchored where no rendered line reaches (the break of a line
  // left empty) become ghost lines in their place.
  const orphans = [...removedAt.keys()].filter((a) => !consumed.has(a)).sort((a, b) => a - b);
  for (const anchor of orphans) {
    const ghost: RenderLine = {
      key: `g${anchor}`,
      label: null,
      cells: take(anchor),
      ghost: true,
      paragraph: false,
      opener: null,
    };
    const at = out.findIndex((l) => !l.ghost && firstIndex(l) > anchor);
    if (at < 0) out.push(ghost);
    else out.splice(at, 0, ghost);
  }
  return out;
}

function firstIndex(line: RenderLine): number {
  const present = line.cells.find((c) => !c.removed);
  return present ? present.index : Number.POSITIVE_INFINITY;
}

/** The text of an item as a cell shows it: a break as a pilcrow. */
export function cellText(item: Item, form: 'written' | 'read' = 'written'): string {
  switch (item.kind) {
    case 'token':
      return form === 'read' ? (item.norm ?? item.form) : item.form;
    case 'object':
      if (item.type === 'gap') return gapText(item.attrs ?? {});
      return item.text ?? `[${item.type}]`;
    case 'break':
      return '¶';
  }
}

/** Whether a space separates this cell from the next: not inside a word divided by joinNext. */
export function spaceAfter(cell: Cell): boolean {
  return !(cell.item.kind === 'token' && cell.item.joinNext);
}
