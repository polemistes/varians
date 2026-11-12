/**
 * Operations on a stream, and their reverses.
 *
 * Every edit an editor makes is expressed as a small list of these. They
 * name items by id, so a changeset means the same thing whatever else has
 * happened to the stream since, and two changesets conflict exactly when
 * they touch the same items. `apply` returns the new stream and the
 * operations that undo it; the history keeps both.
 */

import {
  StreamError,
  isToken,
  requireIndex,
  type Id,
  type Item,
  type Mark,
  type Stream,
  type Token,
} from './items.ts';

export type Op =
  /** Insert items after the item `after`, or at the start when null. */
  | { t: 'insert'; after: Id | null; items: Item[] }
  /** Remove items, wherever they stand. */
  | { t: 'delete'; ids: Id[] }
  /** Change fields of one item. A field set to `null` (or `undefined`, which JSON drops) is removed. */
  | { t: 'set'; id: Id; fields: Record<string, unknown> }
  /** Move a contiguous run of items to stand after `after` (null: the start). Ids are kept. */
  | { t: 'move'; ids: Id[]; after: Id | null }
  /** Divide a token's written form at character `at`; the first part keeps the id. */
  | { t: 'split'; id: Id; at: number; newId: Id; join?: boolean }
  /** Fuse a token with the token that follows it (breaks between them are not allowed). */
  | { t: 'join'; id: Id }
  /** Replace a contiguous run of items by other items. The exact reverse of split and join. */
  | { t: 'replace'; ids: Id[]; items: Item[] };

export interface Applied {
  stream: Stream;
  reverse: Op[];
}

/** Apply one operation, returning the new stream and the operations that reverse it. */
export function applyOp(stream: Stream, op: Op): Applied {
  switch (op.t) {
    case 'insert':
      return insert(stream, op.after, op.items);
    case 'delete':
      return remove(stream, op.ids);
    case 'set':
      return set(stream, op.id, op.fields);
    case 'move':
      return move(stream, op.ids, op.after);
    case 'split':
      return split(stream, op.id, op.at, op.newId, op.join ?? false);
    case 'join':
      return join(stream, op.id);
    case 'replace':
      return replace(stream, op.ids, op.items);
  }
}

/** Apply operations in order. The reverse list undoes them all when applied in order. */
export function applyOps(stream: Stream, ops: Op[]): Applied {
  const reverse: Op[] = [];
  let current = stream;
  for (const op of ops) {
    const result = applyOp(current, op);
    current = result.stream;
    reverse.unshift(...result.reverse);
  }
  return { stream: current, reverse };
}

/** Every id an operation touches or stands beside, for conflict detection. */
export function touchedIds(op: Op): Id[] {
  switch (op.t) {
    case 'insert':
      return [...(op.after ? [op.after] : []), ...op.items.map((i) => i.id)];
    case 'delete':
      return op.ids;
    case 'set':
      return [op.id];
    case 'move':
      return [...op.ids, ...(op.after ? [op.after] : [])];
    case 'split':
      return [op.id, op.newId];
    case 'join':
      return [op.id];
    case 'replace':
      return [...op.ids, ...op.items.map((i) => i.id)];
  }
}

function insert(stream: Stream, after: Id | null, items: Item[]): Applied {
  // The anchor is checked even when there is nothing to put after it.
  if (items.length === 0) {
    if (after !== null) requireIndex(stream, after);
    return { stream, reverse: [] };
  }
  const present = new Set(stream.items.map((i) => i.id));
  const seen = new Set<Id>();
  for (const item of items) {
    if (present.has(item.id) || seen.has(item.id)) {
      throw new StreamError(`item ${item.id} already present`, 'duplicate', [item.id]);
    }
    seen.add(item.id);
  }
  const at = after === null ? 0 : requireIndex(stream, after) + 1;
  const next = [...stream.items.slice(0, at), ...items, ...stream.items.slice(at)];
  return { stream: { items: next }, reverse: [{ t: 'delete', ids: items.map((i) => i.id) }] };
}

function remove(stream: Stream, ids: Id[]): Applied {
  if (ids.length === 0) return { stream, reverse: [] };
  const removing = new Set(ids);
  for (const id of ids) requireIndex(stream, id);
  const kept: Item[] = [];
  const reverse: Op[] = [];
  let run: Item[] = [];
  let predecessor: Id | null = null;
  const flush = () => {
    if (run.length > 0) {
      reverse.push({ t: 'insert', after: predecessor, items: run });
      run = [];
    }
  };
  for (const item of stream.items) {
    if (removing.has(item.id)) {
      run.push(item);
    } else {
      flush();
      kept.push(item);
      predecessor = item.id;
    }
  }
  flush();
  // Reverse inserts go after their predecessor, which is in the kept stream;
  // applied in order they rebuild the runs, each run's predecessor already standing.
  return { stream: { items: kept }, reverse };
}

function set(stream: Stream, id: Id, fields: Record<string, unknown>): Applied {
  const index = requireIndex(stream, id);
  const before = stream.items[index]!;
  if ('id' in fields || 'kind' in fields) {
    throw new StreamError('id and kind cannot be set', 'invalid', [id]);
  }
  const previous: Record<string, unknown> = {};
  const record = before as unknown as Record<string, unknown>;
  const after: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(fields)) {
    // An absent field is recorded as null, so that the reverse survives JSON and removes it again.
    previous[key] = key in record && record[key] !== undefined ? record[key] : null;
    if (value === undefined || value === null) delete after[key];
    else after[key] = value;
  }
  const items = stream.items.slice();
  items[index] = after as unknown as Item;
  return { stream: { items }, reverse: [{ t: 'set', id, fields: previous }] };
}

function move(stream: Stream, ids: Id[], after: Id | null): Applied {
  // The anchor is checked even when there is nothing to move to it.
  if (ids.length === 0) {
    if (after !== null) requireIndex(stream, after);
    return { stream, reverse: [] };
  }
  const first = requireIndex(stream, ids[0]!);
  for (let k = 0; k < ids.length; k++) {
    const item = stream.items[first + k];
    if (!item || item.id !== ids[k]) {
      throw new StreamError('moved items must be a contiguous run', 'invalid', ids);
    }
  }
  if (after !== null && ids.includes(after)) {
    throw new StreamError('cannot move a run after one of its own items', 'invalid', ids);
  }
  const previousPredecessor = first > 0 ? stream.items[first - 1]!.id : null;
  const run = stream.items.slice(first, first + ids.length);
  const without = [...stream.items.slice(0, first), ...stream.items.slice(first + ids.length)];
  const at = after === null ? 0 : without.findIndex((i) => i.id === after) + 1;
  if (after !== null && at === 0) throw new StreamError(`no item ${after}`, 'missing', [after]);
  const items = [...without.slice(0, at), ...run, ...without.slice(at)];
  return { stream: { items }, reverse: [{ t: 'move', ids, after: previousPredecessor }] };
}

/** Marks of a token divided at `at`: ranged marks are cut, whole-token marks go to both halves. */
function divideMarks(
  marks: Mark[] | undefined,
  at: number,
): [Mark[] | undefined, Mark[] | undefined] {
  if (!marks || marks.length === 0) return [undefined, undefined];
  const left: Mark[] = [];
  const right: Mark[] = [];
  for (const mark of marks) {
    if (mark.from === undefined || mark.to === undefined) {
      left.push({ ...mark });
      right.push({ ...mark });
      continue;
    }
    if (mark.to <= at) left.push({ ...mark });
    else if (mark.from >= at) right.push({ ...mark, from: mark.from - at, to: mark.to - at });
    else {
      left.push({ ...mark, to: at });
      right.push({ ...mark, from: 0, to: mark.to - at });
    }
  }
  return [left.length ? left : undefined, right.length ? right : undefined];
}

function split(stream: Stream, id: Id, at: number, newId: Id, joinHalves: boolean): Applied {
  const index = requireIndex(stream, id);
  const token = stream.items[index];
  if (!isToken(token)) throw new StreamError('only a token can be split', 'invalid', [id]);
  const chars = Array.from(token.form);
  if (at <= 0 || at >= chars.length) {
    throw new StreamError('split point must be inside the written form', 'invalid', [id]);
  }
  if (stream.items.some((i) => i.id === newId)) {
    throw new StreamError(`item ${newId} already present`, 'duplicate', [newId]);
  }
  const [leftMarks, rightMarks] = divideMarks(token.marks, at);
  const first: Token = { ...token, form: chars.slice(0, at).join('') };
  delete first.joinNext;
  if (joinHalves) first.joinNext = true;
  const second: Token = {
    kind: 'token',
    id: newId,
    form: chars.slice(at).join(''),
  };
  // The parts of a word have one language.
  if (token.lang !== undefined) second.lang = token.lang;
  if (token.joinNext) second.joinNext = true;
  if (leftMarks) first.marks = leftMarks;
  else delete first.marks;
  if (rightMarks) second.marks = rightMarks;
  // A read form belongs to the whole word; divided, neither half can claim it.
  if (token.norm !== undefined) {
    delete first.norm;
    first.unchecked = true;
    second.unchecked = true;
  }
  const items = stream.items.slice();
  items.splice(index, 1, first, second);
  return {
    stream: { items },
    reverse: [{ t: 'replace', ids: [id, newId], items: [token] }],
  };
}

function join(stream: Stream, id: Id): Applied {
  const index = requireIndex(stream, id);
  const first = stream.items[index];
  const second = stream.items[index + 1];
  if (!isToken(first) || !isToken(second)) {
    throw new StreamError('join needs two adjacent tokens', 'invalid', [id]);
  }
  const offset = Array.from(first.form).length;
  const marks: Mark[] = [];
  for (const mark of first.marks ?? []) {
    if (mark.from === undefined) marks.push({ ...mark, from: 0, to: offset });
    else marks.push({ ...mark });
  }
  for (const mark of second.marks ?? []) {
    if (mark.from === undefined) {
      marks.push({ ...mark, from: offset, to: offset + Array.from(second.form).length });
    } else marks.push({ ...mark, from: mark.from + offset, to: (mark.to ?? 0) + offset });
  }
  const joined: Token = { ...first, form: first.form + second.form };
  delete joined.joinNext;
  if (second.joinNext) joined.joinNext = true;
  if (marks.length) joined.marks = marks;
  else delete joined.marks;
  if (first.norm !== undefined || second.norm !== undefined) {
    delete joined.norm;
    joined.unchecked = true;
  }
  const items = stream.items.slice();
  items.splice(index, 2, joined);
  return {
    stream: { items },
    reverse: [{ t: 'replace', ids: [id], items: [first, second] }],
  };
}

function replace(stream: Stream, ids: Id[], items: Item[]): Applied {
  if (ids.length === 0) throw new StreamError('replace needs at least one item', 'invalid');
  const first = requireIndex(stream, ids[0]!);
  for (let k = 0; k < ids.length; k++) {
    const item = stream.items[first + k];
    if (!item || item.id !== ids[k]) {
      throw new StreamError('replaced items must be a contiguous run', 'invalid', ids);
    }
  }
  const removed = new Set(ids);
  const present = new Set(stream.items.filter((i) => !removed.has(i.id)).map((i) => i.id));
  for (const item of items) {
    if (present.has(item.id))
      throw new StreamError(`item ${item.id} already present`, 'duplicate', [item.id]);
    present.add(item.id);
  }
  const old = stream.items.slice(first, first + ids.length);
  const next = [
    ...stream.items.slice(0, first),
    ...items,
    ...stream.items.slice(first + ids.length),
  ];
  // A replace needs ids to name the run it undoes, so one that puts nothing in
  // place is undone by inserting the old items where they stood.
  if (items.length === 0) {
    const predecessor = first > 0 ? stream.items[first - 1]!.id : null;
    return { stream: { items: next }, reverse: [{ t: 'insert', after: predecessor, items: old }] };
  }
  return {
    stream: { items: next },
    reverse: [{ t: 'replace', ids: items.map((i) => i.id), items: old }],
  };
}
