/**
 * Undoing and bringing back, as operations. Pure: the server applies what
 * these return as a new changeset, so the history is never rewritten.
 */

import { StreamError, applyOp, type Id, type Item, type Op, type Stream } from '@varians/core';

/**
 * The operations that bring `current` back to `target`: one replacement of
 * all current items by the items as they were, which keeps their ids (an
 * insertion or a deletion when either side is empty). Empty when both are empty.
 */
export function revertOps(current: Stream, target: Stream): Op[] {
  const ids = current.items.map((i) => i.id);
  if (ids.length === 0 && target.items.length === 0) return [];
  if (ids.length === 0) return [{ t: 'insert', after: null, items: target.items }];
  if (target.items.length === 0) return [{ t: 'delete', ids }];
  return [{ t: 'replace', ids, items: target.items }];
}

/**
 * Where to put back what followed `id`: the item itself when it still
 * stands, else the nearest earlier item of a reference state that does
 * (null meaning the start). Undefined when `id` is found nowhere, so that
 * nothing is put back in a place that cannot be known.
 */
function survivingAnchor(
  id: Id | null,
  references: Stream[],
  present: Set<Id>,
): Id | null | undefined {
  if (id === null || present.has(id)) return id;
  for (const reference of references) {
    const at = reference.items.findIndex((i) => i.id === id);
    if (at < 0) continue;
    for (let k = at - 1; k >= 0; k--) {
      const candidate = reference.items[k]!.id;
      if (present.has(candidate)) return candidate;
    }
    return null;
  }
  return undefined;
}

/** Whether `ids` stand together, in this order, in `stream`. */
function contiguous(stream: Stream, ids: Id[]): boolean {
  if (ids.length === 0) return false;
  const first = stream.items.findIndex((i) => i.id === ids[0]);
  if (first < 0) return false;
  return ids.every((id, k) => stream.items[first + k]?.id === id);
}

/** One operation fitted to the stream as it is now, or null when nothing of it can apply. */
function adapt(stream: Stream, op: Op, references: Stream[]): Op | null {
  const present = new Set(stream.items.map((i) => i.id));
  switch (op.t) {
    case 'insert': {
      const items = op.items.filter((i) => !present.has(i.id));
      const after = survivingAnchor(op.after, references, present);
      if (items.length === 0 || after === undefined) return null;
      return { t: 'insert', after, items };
    }
    case 'delete': {
      const ids = op.ids.filter((id) => present.has(id));
      return ids.length ? { t: 'delete', ids } : null;
    }
    case 'set':
      return present.has(op.id) ? op : null;
    case 'move': {
      const ids = op.ids.filter((id) => present.has(id));
      if (!contiguous(stream, ids)) return null;
      const after = survivingAnchor(op.after, references, present);
      if (after === undefined || (after !== null && ids.includes(after))) return null;
      return { t: 'move', ids, after };
    }
    case 'replace': {
      const ids = op.ids.filter((id) => present.has(id));
      if (!contiguous(stream, ids)) return null;
      const replaced = new Set(ids);
      const items: Item[] = op.items.filter((i) => replaced.has(i.id) || !present.has(i.id));
      return { t: 'replace', ids, items };
    }
    case 'split':
    case 'join':
      return present.has(op.id) ? op : null;
  }
}

/**
 * As much of a list of reversing operations as still applies to `current`:
 * each is fitted to what is there now (ids that are gone are dropped, items
 * already back are not inserted twice, an anchor that is gone gives way to
 * the nearest earlier item that remains, looked up in `references`) and kept
 * when it applies. Returns the operations, in order, that apply cleanly to
 * `current`, and how many could not be applied at all.
 */
export function salvageOps(
  current: Stream,
  ops: Op[],
  references: Stream[] = [],
): { ops: Op[]; skipped: number; stream: Stream } {
  let stream = current;
  const kept: Op[] = [];
  let skipped = 0;
  for (const op of ops) {
    const fitted = adapt(stream, op, references);
    if (!fitted) {
      skipped++;
      continue;
    }
    try {
      stream = applyOp(stream, fitted).stream;
      kept.push(fitted);
    } catch (error) {
      if (!(error instanceof StreamError)) throw error;
      skipped++;
    }
  }
  return { ops: kept, skipped, stream };
}

/** A short text for an item, for naming the words an undo would touch. */
export function itemWord(item: Item): string {
  switch (item.kind) {
    case 'token':
      return item.form;
    case 'object':
      return item.text ?? `[${item.type}]`;
    case 'break':
      return '¶';
  }
}

/**
 * The text of each id, as it stands in the first stream that has it, else as
 * it was in the items operations carry. Ids found nowhere are left out.
 */
export function wordsOf(ids: Id[], streams: Stream[], ops: Op[] = []): Record<Id, string> {
  const out: Record<Id, string> = {};
  const wanted = new Set(ids);
  for (const stream of streams) {
    for (const item of stream.items)
      if (wanted.has(item.id) && !(item.id in out)) out[item.id] = itemWord(item);
  }
  for (const op of ops) {
    const items = op.t === 'insert' || op.t === 'replace' ? op.items : [];
    for (const item of items)
      if (wanted.has(item.id) && !(item.id in out)) out[item.id] = itemWord(item);
  }
  return out;
}
