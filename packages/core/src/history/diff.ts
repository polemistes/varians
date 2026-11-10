/**
 * The difference between two states of a stream, by item id: what the
 * history panel marks when a moment is looked at. Items keep
 * their ids through edits, so a changed word is one change, not a deletion
 * beside an insertion, and a moved line is one move.
 */

import { isToken, type Id, type Item, type Stream, type Token } from '../stream/items.ts';

export type Change =
  | { kind: 'added'; item: Item }
  | {
      kind: 'removed';
      item: Item;
      /** The id of the item it followed in the old state, for placing it in the new. */ after: Id | null;
    }
  | {
      kind: 'changed';
      before: Token;
      after: Token;
      fields: ('form' | 'norm' | 'marks' | 'segment' | 'joinNext' | 'source')[];
    }
  | { kind: 'moved'; item: Item; from: Id | null; to: Id | null };

export interface StreamDiff {
  changes: Change[];
  /** Ids of items that changed, were added or moved, for highlighting in the new state. */
  touched: Set<Id>;
  added: number;
  removed: number;
  changed: number;
  moved: number;
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Compare two states of a stream. */
export function diffStreams(before: Stream, after: Stream): StreamDiff {
  const oldIndex = new Map<Id, number>();
  before.items.forEach((item, i) => oldIndex.set(item.id, i));
  const newIndex = new Map<Id, number>();
  after.items.forEach((item, i) => newIndex.set(item.id, i));
  const changes: Change[] = [];
  const touched = new Set<Id>();
  let added = 0;
  let removed = 0;
  let changed = 0;
  let moved = 0;

  // Removed items, each placed after the nearest kept predecessor in the old state.
  before.items.forEach((item, i) => {
    if (newIndex.has(item.id)) return;
    let after: Id | null = null;
    for (let k = i - 1; k >= 0; k--) {
      if (newIndex.has(before.items[k]!.id)) {
        after = before.items[k]!.id;
        break;
      }
    }
    changes.push({ kind: 'removed', item, after });
    removed++;
  });

  // Kept items whose order among kept items changed are moves: the ones not
  // in the longest common subsequence of the kept sequence.
  const keptOld = before.items.filter((i) => newIndex.has(i.id)).map((i) => i.id);
  const keptNew = after.items.filter((i) => oldIndex.has(i.id)).map((i) => i.id);
  const stable = new Set(lcsIds(keptOld, keptNew));

  after.items.forEach((item, i) => {
    const oldAt = oldIndex.get(item.id);
    if (oldAt === undefined) {
      changes.push({ kind: 'added', item });
      touched.add(item.id);
      added++;
      return;
    }
    const old = before.items[oldAt]!;
    if (!stable.has(item.id)) {
      changes.push({
        kind: 'moved',
        item,
        from: oldAt > 0 ? before.items[oldAt - 1]!.id : null,
        to: i > 0 ? after.items[i - 1]!.id : null,
      });
      touched.add(item.id);
      moved++;
    }
    if (isToken(old) && isToken(item)) {
      const fields: ('form' | 'norm' | 'marks' | 'segment' | 'joinNext' | 'source')[] = [];
      if (old.form !== item.form) fields.push('form');
      if (!same(old.norm, item.norm)) fields.push('norm');
      if (!same(old.marks, item.marks)) fields.push('marks');
      if (!same(old.segment, item.segment)) fields.push('segment');
      if (!same(old.joinNext, item.joinNext)) fields.push('joinNext');
      if (!same(old.source, item.source)) fields.push('source');
      if (fields.length) {
        changes.push({ kind: 'changed', before: old, after: item, fields });
        touched.add(item.id);
        changed++;
      }
    } else if (!same(old, item)) {
      changes.push({ kind: 'changed', before: old as Token, after: item as Token, fields: [] });
      touched.add(item.id);
      changed++;
    }
  });

  return { changes, touched, added, removed, changed, moved };
}

function lcsIds(a: Id[], b: Id[]): Id[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: Id[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** A short account of a diff: "3 words added, 1 removed, 2 changed". */
export function summarizeDiff(diff: StreamDiff): string {
  const parts: string[] = [];
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
  if (diff.added) parts.push(`${count(diff.added, 'item')} added`);
  if (diff.removed) parts.push(`${diff.removed} removed`);
  if (diff.changed) parts.push(`${diff.changed} changed`);
  if (diff.moved) parts.push(`${diff.moved} moved`);
  return parts.length ? parts.join(', ') : 'no change';
}
