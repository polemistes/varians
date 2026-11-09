/**
 * Moving text in a stream, and keeping a transcript's pages in shape
 * (PLAN-3 3.3 and 3.4).
 *
 * A transcript's stream has a fixed shape: the items before the first page
 * break are the text on no page ("Not on a page"); then each page break,
 * naming a page of the witness, opens that page's text. The page breaks
 * stand in the witness's order, no page is named twice, and a page break
 * carries no label.
 *
 * Segment membership flows: a word belongs to the segment whose start last
 * preceded it. Moving text changes what precedes what, so every move here is
 * followed by a repair of segment starts that keeps the segment of every
 * word as it was. The repair is one function, `repairSegmentStarts`, which
 * compares the stream before with the stream after.
 */

import { newId } from '../ids.ts';
import { isBreak, isObj, isToken, StreamError, type Break, type Id, type Item, type Stream } from './items.ts';
import { applyOp, applyOps, type Op } from './ops.ts';
import { segmentRuns, segmentStartOf } from './words.ts';

/** Tokens and objects: the items that belong to segments. Breaks do not. */
function isContent(item: Item | undefined): boolean {
  return isToken(item) || isObj(item);
}

function isPageBreakItem(item: Item | undefined): item is Break {
  return isBreak(item) && item.type === 'page';
}

/** The segment of every token and object by flow, and its place in its segment's content order. */
function membership(stream: Stream): { segment: Map<Id, Id | null>; rank: Map<Id, number> } {
  const segment = new Map<Id, Id | null>();
  const rank = new Map<Id, number>();
  const runs = segmentRuns(stream);
  const bySegment = new Map<Id, typeof runs>();
  for (const run of runs) {
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (isContent(item)) segment.set(item.id, run.segmentId);
    }
    if (run.segmentId === null) continue;
    const list = bySegment.get(run.segmentId) ?? [];
    list.push(run);
    bySegment.set(run.segmentId, list);
  }
  for (const list of bySegment.values()) {
    list.sort((a, b) => a.part - b.part || a.from - b.from);
    let n = 0;
    for (const run of list) {
      for (let i = run.from; i < run.to; i++) {
        const item = stream.items[i]!;
        if (isContent(item)) rank.set(item.id, n++);
      }
    }
  }
  return { segment, rank };
}

/** The content item before each content item, ignoring breaks; null for the first. */
function predecessors(stream: Stream): Map<Id, Id | null> {
  const out = new Map<Id, Id | null>();
  let previous: Id | null = null;
  for (const item of stream.items) {
    if (!isContent(item)) continue;
    out.set(item.id, previous);
    previous = item.id;
  }
  return out;
}

function sameStart(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The `set` ops that give every token and object of `after` the segment it
 * had in `before`. Both streams hold the same tokens and objects (breaks may
 * differ); `after` is `before` with items moved.
 *
 * Only items whose preceding token or object changed (ignoring breaks) are
 * free to gain or lose a start; the starts of every other item are kept, and
 * for the segments the move concerns only their part numbers may change. For
 * each concerned segment, its runs after the move are its maximal stretches
 * (a kept start also begins one); one stretch carries no part, several are
 * numbered in the content order their first items had before. An unassigned
 * stretch that follows assigned text begins with `{ segmentId: null }`.
 */
export function repairSegmentStarts(before: Stream, after: Stream): Op[] {
  const { segment: memberOf, rank } = membership(before);
  const previousBefore = predecessors(before);
  const previousAfter = predecessors(after);
  const touched = new Set<Id>();
  for (const [id, previous] of previousAfter) {
    if (!previousBefore.has(id)) {
      throw new StreamError(`item ${id} is not in the stream before the move`, 'invalid', [id]);
    }
    if (previousBefore.get(id) !== previous) touched.add(id);
  }
  if (touched.size === 0) return [];
  const concerned = new Set<Id | null>();
  for (const id of touched) concerned.add(memberOf.get(id) ?? null);

  // The stretches of `after`: a new one where membership changes or a kept start stands.
  interface Stretch {
    segmentId: Id | null;
    first: Item;
    hasPredecessor: boolean;
  }
  const stretches: Stretch[] = [];
  const firsts = new Set<Id>();
  let current: Stretch | null = null;
  for (const item of after.items) {
    if (!isContent(item)) continue;
    const seg = memberOf.get(item.id) ?? null;
    const keptStart = !touched.has(item.id) && segmentStartOf(item) !== undefined;
    if (!current || current.segmentId !== seg || keptStart) {
      current = { segmentId: seg, first: item, hasPredecessor: current !== null };
      stretches.push(current);
      firsts.add(item.id);
    }
  }

  // Part numbers of the concerned segments.
  const partOf = new Map<Id, number | undefined>();
  const bySegment = new Map<Id, Stretch[]>();
  for (const stretch of stretches) {
    if (stretch.segmentId === null || !concerned.has(stretch.segmentId)) continue;
    const list = bySegment.get(stretch.segmentId) ?? [];
    list.push(stretch);
    bySegment.set(stretch.segmentId, list);
  }
  for (const list of bySegment.values()) {
    if (list.length === 1) {
      partOf.set(list[0]!.first.id, undefined);
      continue;
    }
    const ordered = [...list].sort((a, b) => (rank.get(a.first.id) ?? 0) - (rank.get(b.first.id) ?? 0));
    ordered.forEach((stretch, k) => partOf.set(stretch.first.id, k + 1));
  }

  const ops: Op[] = [];
  const stretchOf = new Map(stretches.map((s) => [s.first.id, s] as const));
  for (const item of after.items) {
    if (!isContent(item)) continue;
    const existing = segmentStartOf(item);
    let wanted: unknown = existing;
    const stretch = stretchOf.get(item.id);
    if (stretch) {
      if (stretch.segmentId !== null && concerned.has(stretch.segmentId)) {
        const part = partOf.get(item.id);
        wanted = part === undefined ? { segmentId: stretch.segmentId } : { segmentId: stretch.segmentId, part };
      } else if (stretch.segmentId === null) {
        if (stretch.hasPredecessor) wanted = { segmentId: null };
        else if (touched.has(item.id)) wanted = undefined;
      }
    } else if (touched.has(item.id)) {
      wanted = undefined;
    }
    if (!sameStart(existing, wanted)) ops.push({ t: 'set', id: item.id, fields: { segment: wanted ?? null } });
  }
  return ops;
}

/**
 * Move a contiguous run of items to stand after `after` (null: the start),
 * keeping the segment of every word: a `move` op followed by the `set` ops of
 * `repairSegmentStarts`. The run may not contain a page break.
 */
export function moveRun(stream: Stream, ids: Id[], after: Id | null): Op[] {
  if (ids.length === 0) return [];
  const moving = new Set(ids);
  const first = stream.items.findIndex((item) => item.id === ids[0]);
  if (first < 0) throw new StreamError(`no item ${ids[0]}`, 'missing', [ids[0]!]);
  for (let k = 0; k < ids.length; k++) {
    const item = stream.items[first + k];
    if (!item || item.id !== ids[k]) throw new StreamError('moved items must be a contiguous run', 'invalid', ids);
    if (isPageBreakItem(item)) throw new StreamError('a page break cannot be moved with text', 'invalid', [item.id]);
  }
  if (after !== null && moving.has(after)) {
    throw new StreamError('cannot move a run after one of its own items', 'invalid', ids);
  }
  const predecessor = first > 0 ? stream.items[first - 1]!.id : null;
  if (predecessor === after) return [];
  const op: Op = { t: 'move', ids, after };
  const moved = applyOp(stream, op).stream;
  return [op, ...repairSegmentStarts(stream, moved)];
}

/** Index of the page break naming `pageId`, or -1. */
function pageBreakIndex(stream: Stream, pageId: Id): number {
  return stream.items.findIndex((item) => isPageBreakItem(item) && item.pageId === pageId);
}

/** The last item of the stretch that ends before index `end` and begins after the page break before it; null when that stretch is empty. */
function stretchEnd(stream: Stream, opener: number, end: number): Item | null {
  return end - 1 > opener ? stream.items[end - 1]! : null;
}

/** Where a page's stretch is: the index of its break (-1 for Not on a page) and the exclusive end. */
function stretchBounds(stream: Stream, pageId: Id | null): { opener: number; end: number } | null {
  const items = stream.items;
  const opener = pageId === null ? -1 : pageBreakIndex(stream, pageId);
  if (pageId !== null && opener < 0) return null;
  let end = opener + 1;
  while (end < items.length && !isPageBreakItem(items[end])) end++;
  return { opener, end };
}

/**
 * Where a page break belongs when a page has none (I3): after the last item
 * of the nearest preceding page that has a break, else after the last item
 * of the text on no page, else at the start.
 */
export function pageBreakPlace(stream: Stream, pageId: Id, pageOrder: readonly Id[]): Id | null {
  const at = pageOrder.indexOf(pageId);
  for (let k = at - 1; k >= 0; k--) {
    const bounds = stretchBounds(stream, pageOrder[k]!);
    if (bounds) return stream.items[bounds.end - 1]!.id;
  }
  const unplaced = stretchBounds(stream, null)!;
  return unplaced.end > 0 ? stream.items[unplaced.end - 1]!.id : null;
}

export interface MoveToPageOptions {
  /** The witness's pages in order. */
  pageOrder: readonly Id[];
  /** A source of new ids, for a page break or line break the move creates. */
  ids?: () => Id;
}

/**
 * Move a run of items to the end of a page's text (`target` a page id) or of
 * the text on no page (`target` null): the page's break is created where it
 * has none, a line break is put before the run when the target's text is not
 * empty and does not end with a break, and a line break left orphaned at the
 * old place (at the start or end of a page's text, or doubled) is removed.
 * Every word keeps its segment.
 */
export function moveToPage(stream: Stream, ids: Id[], target: Id | null, options: MoveToPageOptions): Op[] {
  if (ids.length === 0) return [];
  const makeId = options.ids ?? newId;
  const moving = new Set(ids);
  const ops: Op[] = [];
  let current = stream;
  const push = (more: Op[]) => {
    if (more.length === 0) return;
    current = applyOps(current, more).stream;
    ops.push(...more);
  };
  const first = current.items.findIndex((item) => item.id === ids[0]);
  if (first < 0) throw new StreamError(`no item ${ids[0]}`, 'missing', [ids[0]!]);
  const oldPrevious = first > 0 ? current.items[first - 1]!.id : null;

  if (target !== null && pageBreakIndex(current, target) < 0) {
    if (!options.pageOrder.includes(target)) throw new StreamError(`no page ${target}`, 'missing', [target]);
    const brk: Break = { kind: 'break', id: makeId(), type: 'page', pageId: target };
    push([{ t: 'insert', after: pageBreakPlace(current, target, options.pageOrder), items: [brk] }]);
  }
  const bounds = stretchBounds(current, target)!;
  const last = stretchEnd(current, bounds.opener, bounds.end);
  if (last && moving.has(last.id)) return ops; // Already at the end of the target.
  let after: Id | null = last ? last.id : bounds.opener >= 0 ? current.items[bounds.opener]!.id : null;
  if (last && !isBreak(last)) {
    const brk: Break = { kind: 'break', id: makeId(), type: 'line' };
    push([{ t: 'insert', after: last.id, items: [brk] }]);
    after = brk.id;
  }
  const moveOp: Op = { t: 'move', ids, after };
  push([moveOp]);

  // An orphaned line break at the old place.
  const items = current.items;
  const prevIndex = oldPrevious === null ? -1 : items.findIndex((item) => item.id === oldPrevious);
  const prev = prevIndex >= 0 ? items[prevIndex] : undefined;
  const next = items[prevIndex + 1];
  const plainLine = (item: Item | undefined) => isBreak(item) && item.type === 'line' && !moving.has(item.id);
  if ((prev === undefined || isBreak(prev)) && plainLine(next) && !(next as Break).rend) {
    push([{ t: 'delete', ids: [next!.id] }]);
  } else if (plainLine(prev) && (next === undefined || isPageBreakItem(next))) {
    push([{ t: 'delete', ids: [prev!.id] }]);
  }
  return [...ops, ...repairSegmentStarts(stream, current)];
}

/** The page ids named by page breaks, in stream order. */
export function pagesWithText(stream: Stream): Id[] {
  return stream.items.filter(isPageBreakItem).flatMap((item) => (item.pageId ? [item.pageId] : []));
}

/** Moves that turn the order `current` into `target` (the same ids). */
function reorderOps(stream: Stream, target: Id[]): { ops: Op[]; stream: Stream } {
  let cur = stream.items.map((item) => item.id);
  let s = stream;
  const ops: Op[] = [];
  for (let i = 0; i < target.length; i++) {
    if (cur[i] === target[i]) continue;
    const j = cur.indexOf(target[i]!, i);
    let len = 1;
    while (j + len < cur.length && i + len < target.length && cur[j + len] === target[i + len]) len++;
    const op: Op = { t: 'move', ids: cur.slice(j, j + len), after: i === 0 ? null : target[i - 1]! };
    s = applyOp(s, op).stream;
    cur = s.items.map((item) => item.id);
    ops.push(op);
  }
  return { ops, stream: s };
}

/**
 * The ops that make a stream keep a transcript's page invariants for a
 * witness whose pages are `pageOrder`, and none for a stream that keeps them:
 *
 * 1. a page break naming no page, or a page not in `pageOrder`, is removed
 *    and its items go to the end of the text on no page;
 * 2. a second break naming a page already named is removed and its items go
 *    to the end of that page's text;
 * 3. the pages' texts are put in the order of `pageOrder`;
 * 4. a `label` on a page break is removed.
 *
 * Text appended to a non-empty stretch that does not end with a break is
 * preceded by a new line break. Every word keeps its segment.
 */
export function conformPages(stream: Stream, pageOrder: readonly Id[], ids: () => Id = newId): Op[] {
  const known = new Set(pageOrder);
  const unplaced: Item[] = [];
  interface Block {
    brk: Break;
    items: Item[];
  }
  const blocks: Block[] = [];
  for (const item of stream.items) {
    if (isPageBreakItem(item)) blocks.push({ brk: item, items: [] });
    else if (blocks.length > 0) blocks[blocks.length - 1]!.items.push(item);
    else unplaced.push(item);
  }
  const kept = new Map<Id, Block>();
  const removed: Id[] = [];
  const toUnplaced: Item[][] = [];
  const toPage = new Map<Id, Item[][]>();
  for (const block of blocks) {
    const pageId = block.brk.pageId;
    if (!pageId || !known.has(pageId)) {
      removed.push(block.brk.id);
      toUnplaced.push(block.items);
    } else if (kept.has(pageId)) {
      removed.push(block.brk.id);
      toPage.set(pageId, [...(toPage.get(pageId) ?? []), block.items]);
    } else kept.set(pageId, block);
  }

  // The target order, with the line breaks it needs.
  const target: Item[] = [];
  const created: { brk: Break; after: Id }[] = [];
  const append = (stretch: Item[], more: Item[]) => {
    if (more.length === 0) return;
    const end = stretch[stretch.length - 1];
    if (end && !isBreak(end)) {
      const brk: Break = { kind: 'break', id: ids(), type: 'line' };
      created.push({ brk, after: end.id });
      stretch.push(brk);
    }
    stretch.push(...more);
  };
  const unplacedStretch = [...unplaced];
  for (const more of toUnplaced) append(unplacedStretch, more);
  target.push(...unplacedStretch);
  for (const pageId of pageOrder) {
    const block = kept.get(pageId);
    if (!block) continue;
    const stretch = [...block.items];
    for (const more of toPage.get(pageId) ?? []) append(stretch, more);
    target.push(block.brk, ...stretch);
  }

  const ops: Op[] = [];
  let current = stream;
  const push = (op: Op) => {
    current = applyOp(current, op).stream;
    ops.push(op);
  };
  if (removed.length > 0) push({ t: 'delete', ids: removed });
  for (const block of kept.values()) {
    if (block.brk.label !== undefined) push({ t: 'set', id: block.brk.id, fields: { label: null } });
  }
  for (const { brk, after } of created) push({ t: 'insert', after, items: [brk] });
  const reordered = reorderOps(
    current,
    target.map((item) => item.id),
  );
  ops.push(...reordered.ops);
  current = reordered.stream;
  return [...ops, ...repairSegmentStarts(stream, current)];
}
