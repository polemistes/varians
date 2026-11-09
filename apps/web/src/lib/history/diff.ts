/**
 * The difference between two states of a document, as the history shows it.
 *
 * The core's diffStreams compares by item id and finds moves with a longest
 * common subsequence, which costs the product of the two lengths. Two states
 * a history compares are mostly the same text, so the common head and tail
 * are set aside first and only the stretch between is compared; the anchors
 * the core reports as "the start" are then the last item of the head.
 */

import { diffStreams, type Item, type Stream, type StreamDiff } from '@varians/core';

/** Structural equality of JSON values, blind to key order and to keys whose value is undefined. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((k) => left[k] !== undefined);
  const otherKeys = Object.keys(right).filter((k) => right[k] !== undefined);
  if (keys.length !== otherKeys.length) return false;
  for (const key of keys) if (!deepEqual(left[key], right[key])) return false;
  return true;
}

/** The same item in the same state: the same object, or the same id with equal contents. */
export function sameItem(a: Item, b: Item): boolean {
  return a === b || (a.id === b.id && deepEqual(a, b));
}

/** Compare two states of a stream: diffStreams over the stretch between their common head and tail. */
export function diffStates(before: Stream, after: Stream): StreamDiff {
  const a = before.items;
  const b = after.items;
  let head = 0;
  const shorter = Math.min(a.length, b.length);
  while (head < shorter && sameItem(a[head]!, b[head]!)) head++;
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && sameItem(a[endA - 1]!, b[endB - 1]!)) {
    endA--;
    endB--;
  }
  if (head === 0 && endA === a.length && endB === b.length) return diffStreams(before, after);
  const diff = diffStreams({ items: a.slice(head, endA) }, { items: b.slice(head, endB) });
  if (head === 0) return diff;
  // Inside the stretch "the start" is the last item of the common head.
  const anchor = a[head - 1]!.id;
  for (const change of diff.changes) {
    if (change.kind === 'removed' && change.after === null) change.after = anchor;
    if (change.kind === 'moved') {
      if (change.from === null) change.from = anchor;
      if (change.to === null) change.to = anchor;
    }
  }
  return diff;
}
