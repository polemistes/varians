/**
 * Who changed what: walking changesets forward from a state, the person who
 * last changed each item. Anchors an operation only stands beside (the item
 * an insertion follows) are not changed by it; the token a join swallows is.
 */

import { applyOp, type Changeset, type Id, type Op, type Stream } from '@varians/core';

/** The ids an operation changes when applied to `stream`. */
export function changedIds(stream: Stream, op: Op): Id[] {
  switch (op.t) {
    case 'insert':
      return op.items.map((i) => i.id);
    case 'delete':
      return op.ids;
    case 'set':
      return [op.id];
    case 'move':
      return op.ids;
    case 'split':
      return [op.id, op.newId];
    case 'join': {
      const index = stream.items.findIndex((i) => i.id === op.id);
      const next = index >= 0 ? stream.items[index + 1] : undefined;
      return next ? [op.id, next.id] : [op.id];
    }
    case 'replace':
      return [...op.ids, ...op.items.map((i) => i.id)];
  }
}

/** Apply changesets in order from `start`, noting for each item the user who last changed it. */
export function applyWithAuthors(start: Stream, changesets: Changeset[]): { stream: Stream; authors: Map<Id, string> } {
  const authors = new Map<Id, string>();
  let stream = start;
  for (const c of [...changesets].sort((a, b) => a.version - b.version)) {
    for (const op of c.ops) {
      for (const id of changedIds(stream, op)) authors.set(id, c.userId);
      stream = applyOp(stream, op).stream;
    }
  }
  return { stream, authors };
}
