/**
 * Copying text from a transcript into an edition (docs/design.md, section
 * 3.9): the text of chosen segments of a transcript, as `deriveEdition`
 * gives it, put into an edition's stream. A segment the edition has is
 * replaced where it stands; a segment it does not have goes after the
 * edition's segment that precedes it in the order of the work, or to the
 * beginning. Everything else in the edition keeps its id and its place.
 */

import { newId } from '../ids.ts';
import {
  cloneItem,
  isBreak,
  isToken,
  type Break,
  type Id,
  type Item,
  type Stream,
} from '../stream/items.ts';
import { repairSegmentStartsFrom } from '../stream/move.ts';
import { applyOp, type Op } from '../stream/ops.ts';
import { runsBySegment, segmentRuns, type SegmentRun } from '../stream/words.ts';
import { ownLineInsert, standsOnOwnLine, type AdoptOptions } from './adopt.ts';
import { deriveEdition } from './derive.ts';
import { printPlace } from './print.ts';

/** What a copy does: the operations, the segments copied (in the transcript's order) and those of them the edition had. */
export interface TextCopy {
  ops: Op[];
  copied: Id[];
  replaced: Id[];
}

/** A run of the text copied: its segment, and where its content and the breaks after it lie among the derived items. */
interface CopiedRun {
  segmentId: Id;
  /** Content order among the runs of its segment, as the transcript numbers its parts. */
  part: number;
  /** Index of the first item and the exclusive end of its content (the breaks after it are not content). */
  from: number;
  to: number;
  /** Exclusive end of the breaks that follow it, before the next run. */
  end: number;
}

/** The runs of a derived text, each with its content and the breaks after it apart. */
function copiedRuns(items: readonly Item[]): CopiedRun[] {
  const out: CopiedRun[] = [];
  for (const run of segmentRuns({ items: items as Item[] })) {
    let to = run.to;
    while (to > run.from && isBreak(items[to - 1])) to--;
    // Text of no segment cannot come out of a copy by segments; it stays with the run before it.
    const previous = out[out.length - 1];
    if (run.segmentId === null && previous) {
      previous.to = to;
      previous.end = run.to;
      continue;
    }
    out.push({ segmentId: run.segmentId ?? '', part: run.part, from: run.from, to, end: run.to });
  }
  return out;
}

/**
 * The segments a copy of these segments of a transcript would bring, in the
 * transcript's order, and those of them the edition has text for. A segment
 * asked for that brings nothing (none of its words is in the transcript, or
 * its one word is a part of a word divided before it) is not among them.
 */
export function segmentsToCopy(
  edition: Stream,
  transcript: Stream,
  segmentIds: ReadonlySet<Id>,
): { copied: Id[]; replaced: Id[] } {
  const derived = deriveEdition(transcript, '', { segmentIds: new Set(segmentIds) });
  const copied = [...new Set(copiedRuns(derived.items).map((run) => run.segmentId))];
  const has = runsBySegment(edition);
  return { copied, replaced: copied.filter((id) => has.has(id)) };
}

/** The types of a stretch of breaks, to tell whether two stretches break the text alike. */
const breakShape = (items: readonly Item[]): string =>
  items.map((item) => (isBreak(item) ? item.type : item.kind)).join(' ');

/**
 * Copy the text of segments of a transcript into an edition.
 *
 * What is copied is what `deriveEdition` gives for `segmentIds`: the read
 * forms as the edition's words, each sourced from the transcript's token,
 * with the transcript's line and paragraph breaks, divided words, gaps,
 * lacunae and paratext. Then:
 *
 * - A segment the edition has is replaced where it stands, run by run in
 *   content order: the copy's first run takes the place of the edition's
 *   first, and so on; runs the copy has over go after its last one placed,
 *   and runs the edition has over go. The breaks inside a run replaced go
 *   with it; those that end it stay.
 * - A segment the edition does not have goes after the edition's segment
 *   that precedes it in `workOrder` (as `printPlace` finds the end of that
 *   segment), or to the beginning of the text where none does. Segments that
 *   go to one place keep the transcript's order. In a verse paragraph they
 *   stand on lines of their own, in prose in the run of the text, as a
 *   segment printed by adopting does (`ownLineInsert`, `standsOnOwnLine`).
 * - Where two runs that follow each other in the copy end up side by side,
 *   the transcript's breaks stand between them (none, where it runs them on).
 * - A line left empty by the change, and a break left at the start or the
 *   end of the text, go; a word joined to a word that no longer follows it
 *   is joined to nothing. Every other item keeps its id, its place among the
 *   others and its segment, as a move keeps it.
 */
export function copyFromTranscript(
  edition: Stream,
  transcript: Stream,
  transcriptionId: Id,
  segmentIds: ReadonlySet<Id>,
  workOrder: readonly Id[],
  options: AdoptOptions = {},
): TextCopy {
  const ids = options.ids ?? newId;
  const derived = deriveEdition(transcript, transcriptionId, {
    segmentIds: new Set(segmentIds),
    ids,
  });
  const copiedItems = derived.items.map((item) => cloneItem(item));
  const runs = copiedRuns(copiedItems);
  const copied = [...new Set(runs.map((run) => run.segmentId))];
  const editionRuns = runsBySegment(edition);
  const replaced = copied.filter((id) => editionRuns.has(id));
  if (runs.length === 0) return { ops: [], copied, replaced };

  const runIndex = new Map(runs.map((run, k) => [run, k] as const));
  const contentOf = (run: CopiedRun) => copiedItems.slice(run.from, run.to);
  const breaksAfter = (run: CopiedRun) => copiedItems.slice(run.to, run.end);
  const lineBreak = (): Break => ({ kind: 'break', id: ids(), type: 'line' });
  /** Runs one after another: the transcript's breaks between two that follow each other in it, else a line break in verse and nothing in prose. */
  const joinRuns = (list: CopiedRun[], ownLine: boolean): Item[] => {
    const out: Item[] = [];
    list.forEach((run, k) => {
      if (k > 0) {
        const previous = list[k - 1]!;
        if (runIndex.get(previous)! + 1 === runIndex.get(run)) out.push(...breaksAfter(previous));
        else if (ownLine) out.push(lineBreak());
      }
      out.push(...contentOf(run));
    });
    return out;
  };
  const inContentOrder = (list: CopiedRun[]) =>
    [...list].sort((a, b) => a.part - b.part || a.from - b.from);
  const runsOf = new Map<Id, CopiedRun[]>();
  for (const run of runs) runsOf.set(run.segmentId, [...(runsOf.get(run.segmentId) ?? []), run]);

  // 1. The segments the edition has: each of its runs, without the breaks that end it, replaced by a run of the copy.
  const replacement = new Map<number, Item[]>();
  const removed = new Set<number>();
  for (const segmentId of replaced) {
    const theirs = editionRuns.get(segmentId)!;
    const ours = inContentOrder(runsOf.get(segmentId)!);
    theirs.forEach((run: SegmentRun, k) => {
      let to = run.to;
      while (to > run.from && isBreak(edition.items[to - 1])) to--;
      for (let i = run.from; i < to; i++) removed.add(i);
      if (k >= ours.length) return;
      const last = k === Math.min(theirs.length, ours.length) - 1;
      const placed = last ? ours.slice(k) : [ours[k]!];
      const ownLine = standsOnOwnLine(edition, edition.items[run.from]!.id, options);
      replacement.set(run.from, joinRuns(placed, ownLine));
    });
  }
  let working: Stream = { items: [] };
  edition.items.forEach((item, i) => {
    const instead = replacement.get(i);
    if (instead) working.items.push(...instead);
    if (!removed.has(i)) working.items.push(item);
  });

  // 2. The segments the edition does not have, after the segment of the edition before them in the work's order.
  const rank = new Map(workOrder.map((id, k) => [id, k] as const));
  const ranked = [...editionRuns.keys()]
    .filter((id) => rank.has(id))
    .sort((a, b) => rank.get(a)! - rank.get(b)!);
  const anchorOf = (segmentId: Id): Id | null => {
    const at = rank.get(segmentId);
    if (at === undefined) return null;
    let anchor: Id | null = null;
    for (const id of ranked) if (rank.get(id)! < at) anchor = id;
    return anchor;
  };
  const groups = new Map<Id | null, CopiedRun[]>();
  for (const run of runs) {
    if (editionRuns.has(run.segmentId)) continue;
    const anchor = anchorOf(run.segmentId);
    groups.set(anchor, [...(groups.get(anchor) ?? []), run]);
  }
  for (const [anchor, list] of groups) {
    let at: Id | null = anchor === null ? null : printPlace(working, anchor);
    if (at === null) {
      // The beginning of the text, inside a paragraph break that opens it.
      const first = working.items[0];
      at = isBreak(first) && first.type === 'paragraph' ? first.id : null;
    }
    const ownLine = standsOnOwnLine(working, at, options);
    const items = joinRuns(list, ownLine);
    const op: Op = ownLine
      ? ownLineInsert(working, at, items, ids)
      : { t: 'insert', after: at, items };
    working = applyOp(working, op).stream;
  }

  // 3. Runs side by side that follow each other in the copy have the transcript's breaks between them.
  const position = new Map(working.items.map((item, k) => [item.id, k] as const));
  const dropped = new Set<Id>();
  const after = new Map<Id, Item[]>();
  for (let k = 0; k + 1 < runs.length; k++) {
    const run = runs[k]!;
    const next = runs[k + 1]!;
    const last = position.get(copiedItems[run.to - 1]!.id)!;
    const first = position.get(copiedItems[next.from]!.id)!;
    if (first <= last) continue;
    const between = working.items.slice(last + 1, first);
    if (!between.every(isBreak)) continue;
    const wanted = breaksAfter(run);
    if (breakShape(between) === breakShape(wanted)) continue;
    for (const item of between) dropped.add(item.id);
    after.set(working.items[last]!.id, wanted);
  }
  let items: Item[] = [];
  for (const item of working.items) {
    if (!dropped.has(item.id)) items.push(item);
    const more = after.get(item.id);
    if (more) items.push(...more);
  }

  // 4. No empty line, and no break at either end, that the copy made.
  const old = new Map(edition.items.map((item, k) => [item.id, k] as const));
  const wereSideBySide = (a: Item, b: Item) =>
    old.has(a.id) && old.has(b.id) && old.get(b.id) === old.get(a.id)! + 1;
  const tidy: Item[] = [];
  for (const item of items) {
    const previous = tidy[tidy.length - 1];
    if (isBreak(item) && isBreak(previous) && !wereSideBySide(previous, item)) {
      // A paragraph break outweighs a line break; between two alike, the edition's stays.
      const keepNew =
        (item.type === 'paragraph' && previous.type !== 'paragraph') ||
        (item.type === previous.type && !old.has(previous.id) && old.has(item.id));
      if (keepNew) tidy[tidy.length - 1] = item;
      continue;
    }
    tidy.push(item);
  }
  while (
    isBreak(tidy[0]) &&
    tidy[0].type !== 'paragraph' &&
    !(old.get(tidy[0].id) === 0 && isBreak(edition.items[0]))
  )
    tidy.shift();
  while (
    isBreak(tidy[tidy.length - 1]) &&
    old.get(tidy[tidy.length - 1]!.id) !== edition.items.length - 1
  )
    tidy.pop();
  items = tidy;

  // 5. A word stays joined only to the word it was joined to.
  const partnerIn = (list: readonly Item[]) => {
    const out = new Map<Id, Id | null>();
    list.forEach((item, k) => {
      if (!isToken(item) || !item.joinNext) return;
      let j = k + 1;
      while (isBreak(list[j])) j++;
      out.set(item.id, list[j]?.id ?? null);
    });
    return out;
  };
  const partners = new Map([...partnerIn(edition.items), ...partnerIn(copiedItems)]);
  const nowFollowing = partnerIn(items);
  const fields = new Map<Id, Record<string, unknown>>();
  const change = (id: Id, more: Record<string, unknown>) =>
    fields.set(id, { ...(fields.get(id) ?? {}), ...more });
  const fresh = new Map(copiedItems.map((item) => [item.id, item] as const));
  for (const [id, following] of nowFollowing) {
    if (partners.get(id) === following) continue;
    const item = fresh.get(id);
    if (item && isToken(item)) delete item.joinNext;
    else change(id, { joinNext: null });
  }

  // 6. Every word keeps its segment, those of the edition as they were, those copied as the transcript has them.
  const result: Stream = { items };
  for (const op of repairSegmentStartsFrom([edition, { items: copiedItems }], result)) {
    if (op.t !== 'set') continue;
    const item = fresh.get(op.id);
    if (!item || isBreak(item)) {
      change(op.id, op.fields);
      continue;
    }
    const segment = op.fields.segment;
    if (segment === null || segment === undefined) delete item.segment;
    else item.segment = segment as NonNullable<typeof item.segment>;
  }

  // The operations: what went, what came after which item of the edition, and what changed on the edition's own.
  const ops: Op[] = [];
  const kept = new Set(items.map((item) => item.id));
  const gone = edition.items.filter((item) => !kept.has(item.id)).map((item) => item.id);
  if (gone.length > 0) ops.push({ t: 'delete', ids: gone });
  let previous: Id | null = null;
  let pending: Item[] = [];
  let pendingAfter: Id | null = null;
  const flush = () => {
    if (pending.length > 0) ops.push({ t: 'insert', after: pendingAfter, items: pending });
    pending = [];
  };
  for (const item of items) {
    if (old.has(item.id)) {
      flush();
    } else {
      if (pending.length === 0) pendingAfter = previous;
      pending.push(item);
    }
    previous = item.id;
  }
  flush();
  for (const [id, set] of fields) ops.push({ t: 'set', id, fields: set });
  return { ops, copied, replaced };
}
