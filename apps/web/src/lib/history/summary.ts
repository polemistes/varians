/**
 * Counting what changed, for the one-line summaries of sessions and
 * changesets: words added, removed, changed and moved, and line breaks and
 * objects added, removed and changed. Pure.
 */

import type { Change, Item, Op } from '@varians/core';
import type { HistoryStrings } from '../strings/history.ts';
import type { ChangeCounts } from './types.ts';

export function emptyCounts(): ChangeCounts {
  return { added: 0, removed: 0, changed: 0, moved: 0, breaksAdded: 0, breaksRemoved: 0, breaksMoved: 0, objectsAdded: 0, objectsRemoved: 0, objectsChanged: 0 };
}

type Happening = 'added' | 'removed' | 'changed' | 'moved';

function tally(counts: ChangeCounts, item: Item, what: Happening, by = 1): void {
  if (item.kind === 'token') counts[what] += by;
  else if (item.kind === 'break') {
    if (what === 'added') counts.breaksAdded += by;
    else if (what === 'removed') counts.breaksRemoved += by;
    else counts.breaksMoved += by;
  } else if (what === 'added') counts.objectsAdded += by;
  else if (what === 'removed') counts.objectsRemoved += by;
  else counts.objectsChanged += by;
}

/** Counts from a diff: words, breaks and objects by what happened to them. */
export function countChanges(diff: { changes: Change[] }): ChangeCounts {
  const counts = emptyCounts();
  const moved = new Set<string>();
  for (const change of diff.changes) {
    switch (change.kind) {
      case 'added':
        tally(counts, change.item, 'added');
        break;
      case 'removed':
        tally(counts, change.item, 'removed');
        break;
      case 'moved':
        moved.add(change.item.id);
        tally(counts, change.item, 'moved');
        break;
      case 'changed':
        // A word both moved and re-spelt counts once, as changed. The core
        // reports the move first.
        if (moved.has(change.after.id)) tally(counts, change.after, 'moved', -1);
        tally(counts, change.after, 'changed');
        break;
    }
  }
  return counts;
}

/**
 * Counts from operations alone, when no diff is at hand. Approximate: a
 * deletion cannot tell words from breaks, and a replacement counts its
 * items as changed.
 */
export function countOps(ops: Op[]): ChangeCounts {
  const counts = emptyCounts();
  for (const op of ops) {
    switch (op.t) {
      case 'insert':
        for (const item of op.items) tally(counts, item, 'added');
        break;
      case 'delete':
        counts.removed += op.ids.length;
        break;
      case 'set':
      case 'split':
      case 'join':
        counts.changed++;
        break;
      case 'move':
        counts.moved += op.ids.length;
        break;
      case 'replace':
        counts.changed += Math.max(op.ids.length, op.items.length);
        break;
    }
  }
  return counts;
}

export function addCounts(a: ChangeCounts, b: ChangeCounts): ChangeCounts {
  const out = emptyCounts();
  for (const key of Object.keys(out) as (keyof ChangeCounts)[]) out[key] = a[key] + b[key];
  return out;
}

/** "3 words added, 1 changed, 1 line break added", or the strings' "no change". */
export function describeCounts(counts: ChangeCounts, t: Pick<HistoryStrings, 'words' | 'noChange'>): string {
  const parts: string[] = [];
  // The first count of words names them; the ones after it do not need to.
  const words = (n: number, phrase: (n: number, noun: boolean) => string) => {
    if (n) parts.push(phrase(n, parts.length === 0));
  };
  words(counts.added, t.words.added);
  words(counts.removed, t.words.removed);
  words(counts.changed, t.words.changed);
  words(counts.moved, t.words.moved);
  if (counts.breaksAdded) parts.push(t.words.breaksAdded(counts.breaksAdded));
  if (counts.breaksRemoved) parts.push(t.words.breaksRemoved(counts.breaksRemoved));
  if (counts.breaksMoved) parts.push(t.words.breaksMoved(counts.breaksMoved));
  if (counts.objectsAdded) parts.push(t.words.objectsAdded(counts.objectsAdded));
  if (counts.objectsRemoved) parts.push(t.words.objectsRemoved(counts.objectsRemoved));
  if (counts.objectsChanged) parts.push(t.words.objectsChanged(counts.objectsChanged));
  return parts.length ? parts.join(', ') : t.noChange;
}
