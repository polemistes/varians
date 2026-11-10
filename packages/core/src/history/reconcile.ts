/**
 * Reconciling a document's history with an incoming copy of it:
 * what import and sync do when the same document arrives from another
 * installation. Pure: it reads two histories and our current content and
 * says what to do; the caller stores the result.
 *
 * The histories form a graph. Every changeset names its parent (null for a
 * document's first changeset, which stands on the document's initial
 * content, called the root below), and a merge changeset also names, in
 * `merged`, the incoming changesets whose operations it applied. A
 * changeset's ancestors are everything reachable through both kinds of link.
 *
 * `local` is every changeset we hold for the document, applied or kept for
 * provenance only. Our head is the last applied one; it is found as the one
 * changeset no other local changeset names as parent or merged, or given by
 * the caller in `options.head` (null when nothing has been applied here).
 * `incoming` is the other installation's applied history: it must be one
 * chain through the parent links, in any order (it is put in order here),
 * and may begin after the root when its first parent is one we know.
 *
 * The algorithm:
 *
 * 1. Check the input. Duplicate ids, a changeset without `parentId`, or
 *    incoming changesets that do not form one chain are errors
 *    (ReconcileError). Changesets of different documents are a conflict,
 *    `unrelated`; a changeset both sides hold under different parents means
 *    one side rewrote its history (thinning does this): conflict, `rewritten`.
 * 2. Nothing to do when the incoming head is known here, whether applied or
 *    kept for provenance. This covers identical histories and a local
 *    history that is ahead.
 * 3. Take the ancestors of our head (A) and of the incoming head (B). When
 *    they share nothing, not even the root, the documents are unrelated:
 *    conflict, `unrelated`.
 * 4. The base is the last incoming changeset that is an ancestor of our head
 *    (or the root, or the incoming chain's first parent). The incoming
 *    changesets after it are theirs.
 * 5. Fast-forward when our head is the base: theirs are applied to our
 *    content in order and keep their ids, authors, times and parents.
 * 6. Otherwise both sides have moved on. Ours are the local changesets in A
 *    and not in B. Of theirs, a merge changeset whose merged changesets are
 *    all ancestors of our head brings nothing new (its operations are ours,
 *    already applied) and is skipped; one whose merged changesets are partly
 *    ours cannot be divided: conflict, `partial-merge`. Likewise a merge
 *    changeset of ours that only folds in changesets the other side already
 *    has does not count as a change of ours.
 * 7. When nothing of theirs remains to apply, there is nothing to do; the
 *    incoming changesets not held here are returned in `keep`, to be stored
 *    without a version. Two installations that have merged each other's
 *    work therefore settle instead of answering merge with merge.
 * 8. The item ids the two sides touch are compared: the ids `touchedIds`
 *    gives for the operations, and the ids a join consumed, which only its
 *    reverse records. Any shared id is a conflict, `overlap`. So is an edit
 *    at the very start of the text on both sides (an insert or a move to the
 *    start), which names no item in common but has no order between the two:
 *    each installation would put the other's items first. Every item the
 *    incoming operations name must stand in our content when its operation
 *    comes (or have been made by an earlier incoming operation); a missing
 *    one is a conflict, `missing-anchor`, which is reported in preference to
 *    `overlap`. Then the operations are applied to our content; a join must
 *    fuse the token it fused on the other side, and any failure is a
 *    conflict, `inapplicable`.
 * 9. Disjoint ids are not the whole of it. A word belongs to the segment
 *    whose start last preceded it, so a change to one word can move
 *    another into a different segment without touching it: one side moves
 *    a word to the head of a line, relying on the start that stood before
 *    that place, and the other side changes that start. So, when the
 *    incoming text is given, the merged text is checked word by word: a
 *    word the other side did not give another segment keeps the segment it
 *    has here, and a word the other side did give another segment ends in
 *    theirs or in ours. Any other outcome is a conflict, `segments`.
 * 10. Otherwise the result is a merge: the operations to apply here as one
 *    merge changeset (parent our head, merged the ids of theirs), their
 *    reverse, and the content that results.
 *
 * A conflict lists the item ids concerned and the segments they stand in,
 * found in our content; an item no longer in our content (deleted here, or
 * made only on the other side) is placed by the item it was inserted after.
 */

import {
  StreamError,
  isToken,
  type Id,
  type Item,
  type SegmentStart,
  type Stream,
} from '../stream/items.ts';
import { applyOp, applyOps, touchedIds, type Op } from '../stream/ops.ts';
import { segmentRuns } from '../stream/words.ts';
import type { Changeset } from './changeset.ts';

/** What reconcile needs of a changeset; every other field is carried through untouched. */
export interface HistoryEntry {
  id: Id;
  parentId?: Id | null;
  merged?: Id[];
  documentId?: Id;
  ops: Op[];
  reverse: Op[];
}

export type ConflictReason =
  /** Both sides touched the same items. */
  | 'overlap'
  /** An incoming operation names an item our content no longer has. */
  | 'missing-anchor'
  /** The incoming operations could not be applied to our content as they were on the other side. */
  | 'inapplicable'
  /** The two sides' changes together would leave words in a segment neither side gave them. */
  | 'segments'
  /** An incoming merge changeset folds in some of our changes and some others; it cannot be divided. */
  | 'partial-merge'
  /** The histories share nothing: another document, or a history that begins after anything we know. */
  | 'unrelated'
  /** A changeset both sides hold stands on different parents: one side rewrote its history. */
  | 'rewritten';

export type Reconciliation<C extends HistoryEntry = Changeset> =
  /**
   * Nothing to apply. `keep`: incoming changesets not held here whose changes
   * are already in our content; store them without a version.
   */
  | { kind: 'nothing'; keep: C[] }
  /**
   * Our head is an ancestor of the incoming head: apply `apply` in order,
   * keeping ids, authors, times and parents, giving each a local version.
   * Some may already be held here without a version.
   */
  | { kind: 'fast-forward'; apply: C[]; content: Stream }
  /**
   * Both sides moved on and their changes are disjoint. The caller authors
   * one merge changeset with `ops` and `reverse`, parent our head and merged
   * the ids of `theirs`, and stores `theirs` without a version.
   */
  | {
      kind: 'merge';
      /** The last common changeset; null for the document's initial content. */
      base: Id | null;
      /** Our changesets after the base. */
      ours: C[];
      /** The incoming changesets after the base, in order. */
      theirs: C[];
      ops: Op[];
      reverse: Op[];
      content: Stream;
    }
  /**
   * Refused: nothing is applied. `theirs` are the incoming changesets not
   * held here, in order, for the caller to store unapplied (keep ours).
   */
  | { kind: 'conflict'; reason: ConflictReason; ids: Id[]; segments: Id[]; theirs: C[] };

export interface ReconcileOptions {
  /** Our head: the last changeset applied here, null when none has been. Found from `local` when absent. */
  head?: Id | null;
  /**
   * The incoming document's text as it stands on the other side. With it a
   * merge is checked for words that would change segment unasked; without
   * it the merge rests on the item ids alone.
   */
  incomingContent?: Stream;
}

export class ReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconcileError';
  }
}

/** The document's initial content, the parent of every first changeset. Ids never contain NUL. */
const ROOT = '\u0000root';

/** Reconcile our history of a document with an incoming one. */
export function reconcile<C extends HistoryEntry = Changeset>(
  local: C[],
  incoming: C[],
  content: Stream,
  options: ReconcileOptions = {},
): Reconciliation<C> {
  const localById = byId(local, 'local');
  for (const c of local) requireParent(c, 'local');
  const chain = orderChain(incoming);
  const unknown = () => chain.filter((c) => !localById.has(c.id));
  const refuse = (
    reason: ConflictReason,
    ids: Id[] = [],
    segments: Id[] = [],
  ): Reconciliation<C> => ({
    kind: 'conflict',
    reason,
    ids,
    segments,
    theirs: unknown(),
  });

  if (chain.length === 0) return { kind: 'nothing', keep: [] };

  const documents = new Set(
    [...local, ...chain].map((c) => c.documentId).filter((d) => d !== undefined),
  );
  if (documents.size > 1) return refuse('unrelated');
  for (const c of chain) {
    const ours = localById.get(c.id);
    if (ours && ours.parentId !== c.parentId) return refuse('rewritten');
  }

  const head = chain[chain.length - 1]!;
  if (localById.has(head.id)) return { kind: 'nothing', keep: unknown() };

  const ourHead = options.head !== undefined ? options.head : findHead(local);
  if (ourHead !== null && !localById.has(ourHead))
    throw new ReconcileError(`our head ${ourHead} is not in the local history`);

  const graph = new Map<Id, C>(localById);
  for (const c of chain) if (!graph.has(c.id)) graph.set(c.id, c);
  const ancestorsOf = (start: Id | null): Set<string> =>
    ancestors(graph, start === null ? [ROOT] : [start]);
  const ourSide = ancestorsOf(ourHead);
  const theirSide = ancestorsOf(head.id);
  if (![...ourSide].some((id) => theirSide.has(id))) return refuse('unrelated');

  let baseAt = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (ourSide.has(chain[i]!.id)) {
      baseAt = i;
      break;
    }
  }
  // Undefined when the incoming chain meets our history only through merge
  // links: then there is no single base and no fast-forward.
  let base: Id | null | undefined;
  if (baseAt >= 0) base = chain[baseAt]!.id;
  else {
    const first = chain[0]!.parentId!;
    if (first === null ? ourSide.has(ROOT) : ourSide.has(first)) base = first;
  }
  const theirs = chain.slice(baseAt + 1);

  if (base !== undefined && ourHead === base) {
    const applied = applyGuarded(content, theirs);
    if (!applied.ok)
      return refuse('inapplicable', applied.ids, segmentsOf(applied.ids, content, [], theirs));
    return { kind: 'fast-forward', apply: theirs, content: applied.stream };
  }

  // The changes a merge changeset folds in: the ancestors of its merged
  // changesets that are not ancestors of its parent.
  const folded = (c: C): { ids: Set<string>; unknown: boolean } => {
    const merged = c.merged ?? [];
    const ids = ancestors(
      graph,
      merged.filter((m) => graph.has(m)),
    );
    for (const id of ancestorsOf(c.parentId!)) ids.delete(id);
    return { ids, unknown: merged.some((m) => !graph.has(m)) };
  };
  const within = (ids: Set<string>, side: Set<string>) => [...ids].every((id) => side.has(id));

  const ours = local.filter((c) => ourSide.has(c.id) && !theirSide.has(c.id));
  const ourIds = new Set<Id>();
  const ourStart = new Set<Id>();
  for (const c of ours) {
    if (c.merged?.length) {
      const f = folded(c);
      if (!f.unknown && f.ids.size > 0 && within(f.ids, theirSide)) continue;
    }
    for (const id of touched(c)) ourIds.add(id);
    for (const id of placedAtStart(c)) ourStart.add(id);
  }

  const effective: C[] = [];
  for (const c of theirs) {
    if (c.merged?.length) {
      const f = folded(c);
      const here = [...f.ids].filter((id) => ourSide.has(id));
      if (!f.unknown && f.ids.size > 0 && here.length === f.ids.size) continue;
      if (here.length > 0) {
        const ids = [...touched(c)];
        return refuse('partial-merge', ids, segmentsOf(ids, content, ours, theirs));
      }
    }
    effective.push(c);
  }
  if (effective.length === 0) return { kind: 'nothing', keep: unknown() };

  const theirIds = new Set<Id>();
  const theirStart = new Set<Id>();
  for (const c of effective) {
    for (const id of touched(c)) theirIds.add(id);
    for (const id of placedAtStart(c)) theirStart.add(id);
  }
  const overlap = [...theirIds].filter((id) => ourIds.has(id));
  if (ourStart.size > 0 && theirStart.size > 0) overlap.push(...ourStart, ...theirStart);
  const missing = missingAnchors(content, effective);
  if (missing.length || overlap.length) {
    const ids = [...new Set([...missing, ...overlap])];
    return refuse(
      missing.length ? 'missing-anchor' : 'overlap',
      ids,
      segmentsOf(ids, content, ours, theirs),
    );
  }

  const applied = applyGuarded(content, effective);
  if (!applied.ok)
    return refuse('inapplicable', applied.ids, segmentsOf(applied.ids, content, ours, theirs));
  if (options.incomingContent) {
    const strayed = strayedWords(content, applied.stream, options.incomingContent, theirs);
    if (strayed.length)
      return refuse('segments', strayed, segmentsOf(strayed, content, ours, theirs));
  }
  return {
    kind: 'merge',
    base: base ?? null,
    ours,
    theirs,
    ops: effective.flatMap((c) => c.ops),
    reverse: applied.reverse,
    content: applied.stream,
  };
}

function byId<C extends HistoryEntry>(list: C[], side: string): Map<Id, C> {
  const map = new Map<Id, C>();
  for (const c of list) {
    if (map.has(c.id)) throw new ReconcileError(`${side} history holds changeset ${c.id} twice`);
    map.set(c.id, c);
  }
  return map;
}

function requireParent(c: HistoryEntry, side: string): void {
  if (c.parentId === undefined)
    throw new ReconcileError(`${side} changeset ${c.id} names no parent`);
}

/** The incoming changesets in chain order, or an error when they are not one chain. */
function orderChain<C extends HistoryEntry>(incoming: C[]): C[] {
  if (incoming.length === 0) return [];
  const map = byId(incoming, 'incoming');
  const childOf = new Map<Id, C>();
  const starts: C[] = [];
  for (const c of incoming) {
    requireParent(c, 'incoming');
    const parent = c.parentId!;
    if (parent !== null && map.has(parent)) {
      if (childOf.has(parent))
        throw new ReconcileError(
          `incoming history is not a chain: two changesets stand on ${parent}`,
        );
      childOf.set(parent, c);
    } else starts.push(c);
  }
  if (starts.length !== 1)
    throw new ReconcileError(`incoming history is not a chain: it has ${starts.length} beginnings`);
  const out: C[] = [];
  for (let c: C | undefined = starts[0]; c; c = childOf.get(c.id)) out.push(c);
  if (out.length !== incoming.length)
    throw new ReconcileError('incoming history is not a chain: it has a cycle');
  return out;
}

/** The one local changeset nothing else stands on or merges; null for an empty history. */
function findHead(local: HistoryEntry[]): Id | null {
  if (local.length === 0) return null;
  const named = new Set<Id>();
  for (const c of local) {
    if (c.parentId) named.add(c.parentId);
    for (const m of c.merged ?? []) named.add(m);
  }
  const tips = local.filter((c) => !named.has(c.id));
  if (tips.length !== 1) {
    throw new ReconcileError(`local history has ${tips.length} heads; name ours in options.head`);
  }
  return tips[0]!.id;
}

/** The starts and everything reachable from them through parents and merged ids; ROOT when a chain reaches the initial content. */
function ancestors(graph: Map<Id, HistoryEntry>, starts: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === ROOT) continue;
    const c = graph.get(id);
    if (!c) continue;
    if (c.parentId === null) stack.push(ROOT);
    else if (c.parentId !== undefined && graph.has(c.parentId)) stack.push(c.parentId);
    for (const m of c.merged ?? []) if (graph.has(m)) stack.push(m);
  }
  // An id outside the graph (a parent nobody here holds) is not an ancestor we know.
  for (const id of seen) if (id !== ROOT && !graph.has(id)) seen.delete(id);
  return seen;
}

/**
 * The tokens each join in a changeset fused with its own: a join's reverse
 * replaces the joined token by the two it came from. Keyed by the first token.
 */
function joinPartners(c: HistoryEntry): Map<Id, Set<Id>> {
  const out = new Map<Id, Set<Id>>();
  for (const op of c.reverse) {
    if (
      op.t !== 'replace' ||
      op.ids.length !== 1 ||
      op.items.length !== 2 ||
      op.items[0]!.id !== op.ids[0]
    )
      continue;
    const set = out.get(op.ids[0]!) ?? new Set<Id>();
    set.add(op.items[1]!.id);
    out.set(op.ids[0]!, set);
  }
  return out;
}

/** Every item id a changeset touches, with the tokens its joins consumed. */
function touched(c: HistoryEntry): Set<Id> {
  const out = new Set<Id>(c.ops.flatMap(touchedIds));
  for (const op of c.reverse) {
    if (op.t !== 'replace') continue;
    for (const id of op.ids) out.add(id);
    for (const item of op.items) out.add(item.id);
  }
  return out;
}

/**
 * The items a changeset inserts or moves to the very start of the text.
 * `touchedIds` leaves the start out (it is no item), so two edits there
 * would not meet; the merge treats the start as touched by both.
 */
function placedAtStart(c: HistoryEntry): Id[] {
  const out: Id[] = [];
  for (const op of c.ops) {
    if (op.t === 'insert' && op.after === null) out.push(...op.items.map((i) => i.id));
    else if (op.t === 'move' && op.after === null) out.push(...op.ids);
  }
  return out;
}

/** The items incoming operations name that will not stand in our content when their operation comes. */
function missingAnchors(content: Stream, changesets: HistoryEntry[]): Id[] {
  const present = new Set(content.items.map((i) => i.id));
  const missing: Id[] = [];
  const need = (id: Id | null) => {
    if (id !== null && !present.has(id) && !missing.includes(id)) missing.push(id);
  };
  for (const c of changesets) {
    const partners = joinPartners(c);
    for (const op of c.ops) {
      switch (op.t) {
        case 'insert':
          need(op.after);
          for (const item of op.items) present.add(item.id);
          break;
        case 'delete':
          op.ids.forEach(need);
          for (const id of op.ids) present.delete(id);
          break;
        case 'set':
          need(op.id);
          break;
        case 'move':
          op.ids.forEach(need);
          need(op.after);
          break;
        case 'split':
          need(op.id);
          present.add(op.newId);
          break;
        case 'join': {
          need(op.id);
          const candidates = [...(partners.get(op.id) ?? [])];
          if (candidates.length && !candidates.some((id) => present.has(id))) need(candidates[0]!);
          for (const id of candidates) present.delete(id);
          break;
        }
        case 'replace':
          op.ids.forEach(need);
          for (const id of op.ids) present.delete(id);
          for (const item of op.items) present.add(item.id);
          break;
      }
    }
  }
  return missing;
}

/** The segment every token and object of a stream belongs to; null for the unassigned. */
function membership(stream: Stream): Map<Id, Id | null> {
  const out = new Map<Id, Id | null>();
  for (const run of segmentRuns(stream)) {
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (item.kind !== 'break') out.set(item.id, run.segmentId);
    }
  }
  return out;
}

/**
 * The words a merge would leave in a segment that neither side gave them.
 *
 * `theirs` are the incoming changesets after the base, in order, and
 * `incoming` the text they led to; undoing them gives the incoming text as
 * it stood at the base, and so which words the other side gave another
 * segment. A word they left in its segment must have in the merged text
 * the segment it has in ours; a word they gave another segment must have
 * theirs or ours (two people numbering different passages each change, by
 * the flow of the text, words the other then numbers: either holds).
 *
 * Empty when the incoming text cannot be taken back to the base (its
 * history does not lead to it): the merge then rests on the ids alone.
 */
function strayedWords(
  ours: Stream,
  merged: Stream,
  incoming: Stream,
  theirs: HistoryEntry[],
): Id[] {
  let before = incoming;
  try {
    for (let i = theirs.length - 1; i >= 0; i--)
      before = applyOps(before, theirs[i]!.reverse).stream;
  } catch (error) {
    if (error instanceof StreamError) return [];
    throw error;
  }
  const here = membership(ours);
  const theirsBefore = membership(before);
  const theirsNow = membership(incoming);
  const strayed: Id[] = [];
  for (const [id, now] of membership(merged)) {
    if (!here.has(id) || !theirsBefore.has(id) || !theirsNow.has(id)) continue;
    const mine = here.get(id);
    const given = theirsNow.get(id);
    const untouchedThere = theirsBefore.get(id) === given;
    if (now !== mine && (untouchedThere || now !== given)) strayed.push(id);
  }
  return strayed;
}

type Guarded = { ok: true; stream: Stream; reverse: Op[] } | { ok: false; ids: Id[] };

/** Apply changesets in order; a join must fuse the token it fused where it was made. */
function applyGuarded(content: Stream, changesets: HistoryEntry[]): Guarded {
  let stream = content;
  const reverse: Op[] = [];
  for (const c of changesets) {
    const partners = joinPartners(c);
    for (const op of c.ops) {
      if (op.t === 'join') {
        const candidates = partners.get(op.id);
        const at = stream.items.findIndex((i) => i.id === op.id);
        const next = at >= 0 ? stream.items[at + 1] : undefined;
        if (candidates && (!next || !candidates.has(next.id))) {
          return {
            ok: false,
            ids: [op.id, ...(next && isToken(next) ? [next.id] : []), ...candidates],
          };
        }
      }
      try {
        const result = applyOp(stream, op);
        stream = result.stream;
        reverse.unshift(...result.reverse);
      } catch (error) {
        if (error instanceof StreamError)
          return { ok: false, ids: error.ids.length ? error.ids : touchedIds(op) };
        throw error;
      }
    }
  }
  return { ok: true, stream, reverse };
}

/**
 * The segments of the given items, in the order they stand in our content.
 * An item not in our content is placed by the item it was inserted after,
 * from our reverse operations (which reinsert what we deleted) and their
 * operations (which insert what they made).
 */
function segmentsOf(
  ids: Id[],
  content: Stream,
  ours: HistoryEntry[],
  theirs: HistoryEntry[],
): Id[] {
  const index = new Map<Id, number>();
  content.items.forEach((item, i) => index.set(item.id, i));
  const anchor = new Map<Id, Id | null>();
  const learn = (op: Op) => {
    if (op.t === 'insert') {
      op.items.forEach((item, k) => {
        if (!anchor.has(item.id)) anchor.set(item.id, k === 0 ? op.after : op.items[k - 1]!.id);
      });
    } else if (op.t === 'replace') {
      for (const item of op.items)
        if (item.id !== op.ids[0] && !anchor.has(item.id)) anchor.set(item.id, op.ids[0]!);
    } else if (op.t === 'split') {
      if (!anchor.has(op.newId)) anchor.set(op.newId, op.id);
    }
  };
  for (const c of ours) c.reverse.forEach(learn);
  for (const c of theirs) c.ops.forEach(learn);

  const positions = new Set<number>();
  for (const id of ids) {
    let current: Id | null | undefined = id;
    const seen = new Set<Id>();
    while (current !== null && current !== undefined && !index.has(current) && !seen.has(current)) {
      seen.add(current);
      current = anchor.get(current);
    }
    if (current === null) positions.add(0);
    else if (current !== undefined && index.has(current)) positions.add(index.get(current)!);
  }

  const out: Id[] = [];
  for (const at of [...positions].sort((a, b) => a - b)) {
    const segment = segmentAt(content.items, at);
    if (segment !== null && !out.includes(segment)) out.push(segment);
  }
  return out;
}

/** The segment the item at `at` belongs to: the nearest segment start at or before it. */
function segmentAt(items: Item[], at: number): Id | null {
  for (let k = Math.min(at, items.length - 1); k >= 0; k--) {
    const start = (items[k] as { segment?: SegmentStart }).segment;
    if (start !== undefined) return start.segmentId;
  }
  return null;
}
