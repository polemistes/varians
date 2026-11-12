/**
 * Collation in passages (docs/design.md, section 3.10), as the server does
 * it with its cache between the steps: every segment of the edition is
 * collated alone, which says where the text may be cut; consecutive
 * segments whose boundary something may cross are one passage, collated
 * whole; and passages near one another are linked where a witness has a
 * word in the one that it is without in the other.
 *
 * The cache has one row for each segment of an edition: the segment
 * collated alone, under the hash of its inputs, and, for the first segment
 * of a passage of several (or of one with segments the edition does not
 * print after it), the passage collated whole, under the hash of the
 * passage's inputs. A passage of one segment is its collation alone. Links
 * between passages and the editor's marks are put over what is cached, each
 * time, so that neither collates anything again.
 *
 * A page asks for some segments. The plan around them is made from the
 * segments alone, as far on either side as it takes to reach a boundary
 * that is cut whatever stands beyond it, and the passages near enough to
 * link with theirs are made with them.
 */

import {
  applySiteKinds,
  BOUNDARY_ZONE,
  boundaryReason,
  collate,
  collatePassage,
  FAR_REACH,
  linkAll,
  MAX_PASSAGE_SEGMENTS,
  MAX_PASSAGE_UNITS,
  passageInputs,
  segmentsJoined,
  type Collation,
  type CollationText,
  type Passage,
  type PassageSegment,
  type SegmentAlone,
  type SegmentInputs,
  type Site,
  type SiteMark,
  type Stream,
  type Unit,
} from '@varians/core';
import { collationCache, type Database } from '@varians/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  collationTexts,
  editionUnits,
  inputHash,
  passageHash,
  reviveCollation,
  segmentOrderOf,
  segmentTexts,
  serializeCollation,
  unprintedSegments,
  type EditionContext,
  type SegmentText,
} from './collation.ts';

/** A passage of an edition collated: what a view of it is made from. */
export interface PassageResult {
  /** The passage's first segment: the key it is cached and given under. */
  segmentId: string;
  /** Its segments in order, each with the edition's units it holds; one the edition does not print holds none. */
  segments: PassageSegment[];
  /** The edition's units of the passage, each naming the segment its word begins in. */
  baseUnits: Unit[];
  /** The witnesses as they were collated over it. */
  witnesses: CollationText[];
  /** Linked with the passages near it, the editor's marks put over it. */
  collation: Collation;
}

/** How many cache rows one statement reads, and how many rows are written at a time. */
const ROW_READ = 1000;
const ROW_WRITE = 25;
/**
 * How many segments beyond a stretch are read at first to find the boundary
 * that is cut nearest it on either side: more are read where that is not
 * enough.
 */
const MARGIN = 4;
/** The edition's units on either side of a boundary within which a departure on both sides leaves it uncut. */
const ZONE = BOUNDARY_ZONE;
/** How many of the edition's units on either side of what is asked the passages linked with it are made from. */
const LINK_REACH = FAR_REACH;

/** What a cache row holds. */
interface Stored {
  alone: unknown;
  passage?: { hash: string; collation: unknown };
}

/** What is known of one of the edition's segments. */
interface Fact {
  segmentId: string;
  base: CollationText;
  texts: SegmentText[];
  /** The inputs of the segment collated alone. */
  witnesses: CollationText[];
  hash: string;
  /** The segments the edition does not print that stand after this one, with their texts. */
  followers: { segmentId: string; base: CollationText; texts: SegmentText[] }[];
  /** The row as read (undefined: not read yet; null: none). */
  stored?: Stored | null;
  /** The segment collated alone, when known. */
  alone?: Collation;
  /** The row is to be written. */
  dirty?: boolean;
}

const joinsOf = new WeakMap<Stream, Map<string, Set<string>>>();

/** For a stream, the segments a word begun in each runs on into: found once for each stream. */
function joins(stream: Stream): Map<string, Set<string>> {
  let found = joinsOf.get(stream);
  if (!found) {
    found = segmentsJoined(stream);
    joinsOf.set(stream, found);
  }
  return found;
}

export interface PassageOptions {
  /**
   * Collate afresh at most this many segments alone that the cache lacks,
   * those nearest `near` first, and the passages of several segments those
   * make; what is left is named in `pending`.
   */
  budget?: number;
  /** A segment id: the one the budget is spent nearest. */
  near?: string;
}

/**
 * An edition's collation, in passages, for some segments: the passages that
 * hold the segments asked for (every segment when `wanted` is null), in the
 * order of the text. A segment the edition does not print is asked for by
 * its own id and comes in the passage of the segment it stands after. With a
 * budget, the segments it did not reach are `pending`, nearest `near` first.
 */
export async function collatePassagesFor(
  db: Database,
  context: EditionContext,
  wanted: readonly string[] | null,
  options: PassageOptions = {},
): Promise<{ passages: PassageResult[]; pending: string[] }> {
  const content = context.edition.content;
  const order = segmentOrderOf(content);
  const n = order.length;
  if (n === 0) return { passages: [], pending: [] };
  const indexOf = new Map(order.map((id, i) => [id, i] as const));
  const following = new Map<string, string[]>();
  const afterOf = new Map<string, string>();
  for (const u of unprintedSegments(context)) {
    following.set(u.after, [...(following.get(u.after) ?? []), u.segmentId]);
    afterOf.set(u.segmentId, u.after);
  }
  const at = (id: string): number | undefined => {
    const own = indexOf.get(id);
    if (own !== undefined) return own;
    const after = afterOf.get(id);
    return after === undefined ? undefined : indexOf.get(after);
  };
  const wantedAt = new Set<number>();
  if (wanted === null) for (let i = 0; i < n; i++) wantedAt.add(i);
  else
    for (const id of wanted) {
      const i = at(id);
      if (i !== undefined) wantedAt.add(i);
    }
  if (wantedAt.size === 0) return { passages: [], pending: [] };
  const nearAt = options.near !== undefined ? (at(options.near) ?? 0) : 0;
  let budget = options.budget ?? Infinity;

  const facts = new Map<number, Fact>();
  const factOf = (i: number): Fact => {
    let fact = facts.get(i);
    if (!fact) {
      const segmentId = order[i]!;
      const { base, texts } = segmentTexts(context, segmentId);
      const witnesses = collationTexts(texts);
      fact = {
        segmentId,
        base,
        texts,
        witnesses,
        hash: inputHash(context, base, witnesses),
        followers: (following.get(segmentId) ?? []).map((id) => ({
          segmentId: id,
          ...segmentTexts(context, id, true),
        })),
      };
      facts.set(i, fact);
    }
    return fact;
  };
  /** The number of the edition's units in a segment, without reading the witnesses. */
  const unitsAt = (i: number): number =>
    facts.get(i)?.base.units.length ?? editionUnits(content, order[i]!).length;

  // Writing rows: between stretches of collating, so that other requests run meanwhile.
  const dirty: number[] = [];
  const write = async (all = false) => {
    while (dirty.length >= (all ? 1 : ROW_WRITE)) {
      const rows = dirty.splice(0, ROW_WRITE).map((i) => {
        const fact = facts.get(i)!;
        fact.dirty = false;
        return {
          editionId: context.edition.id,
          versionNumber: context.versionNumber ?? 0,
          segmentId: fact.segmentId,
          inputHash: fact.hash,
          result: fact.stored!,
        };
      });
      await db
        .insert(collationCache)
        .values(rows)
        .onConflictDoUpdate({
          target: [collationCache.editionId, collationCache.versionNumber, collationCache.segmentId],
          set: {
            inputHash: sql`excluded.input_hash`,
            result: sql`excluded.result`,
            computedAt: new Date(),
          },
        });
    }
  };
  const markDirty = (i: number) => {
    const fact = facts.get(i)!;
    if (!fact.dirty) {
      fact.dirty = true;
      dirty.push(i);
    }
  };

  /**
   * Know the segments [from, to) alone: from what is remembered, else from
   * the cache in one statement, and what both lack collated, within the
   * budget.
   */
  const ensure = async (from: number, to: number) => {
    const unread: number[] = [];
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
      const fact = factOf(i);
      if (fact.alone || fact.stored !== undefined) continue;
      const known = recall(fact.hash);
      if (known) fact.alone = known;
      else unread.push(i);
    }
    for (let k = 0; k < unread.length; k += ROW_READ) {
      const chunk = unread.slice(k, k + ROW_READ);
      const rows = await db
        .select({
          segmentId: collationCache.segmentId,
          inputHash: collationCache.inputHash,
          result: collationCache.result,
        })
        .from(collationCache)
        .where(
          and(
            eq(collationCache.editionId, context.edition.id),
            eq(collationCache.versionNumber, context.versionNumber ?? 0),
            inArray(
              collationCache.segmentId,
              chunk.map((i) => order[i]!),
            ),
          ),
        );
      const byId = new Map(rows.map((r) => [r.segmentId, r] as const));
      for (const i of chunk) {
        const fact = facts.get(i)!;
        const row = byId.get(fact.segmentId);
        const stored = row?.result as Stored | undefined;
        if (row && row.inputHash === fact.hash && stored && 'alone' in stored) {
          fact.stored = stored;
          fact.alone = reviveCollation(stored.alone);
          remember(fact.hash, fact.alone);
        } else fact.stored = null;
      }
    }
    const lacking: number[] = [];
    for (let i = Math.max(0, from); i < Math.min(n, to); i++)
      if (!facts.get(i)!.alone) lacking.push(i);
    lacking.sort((a, b) => Math.abs(a - nearAt) - Math.abs(b - nearAt) || a - b);
    for (const i of lacking) {
      if (budget < 1) break;
      budget -= 1;
      const fact = facts.get(i)!;
      fact.alone = collate(fact.base, fact.witnesses);
      remember(fact.hash, fact.alone);
      fact.stored = { alone: serializeCollation(fact.alone) };
      markDirty(i);
      await write();
    }
  };

  /** A segment as the plan reads it, once it is known alone. */
  const aloneOf = (i: number): SegmentAlone | null => {
    const fact = facts.get(i);
    if (!fact?.alone) return null;
    const next = order[i + 1];
    const own = [fact.segmentId, ...fact.followers.map((f) => f.segmentId)];
    const joined = (stream: Stream) => {
      if (next === undefined) return false;
      const found = joins(stream);
      return own.some((s) => found.get(s)?.has(next) || found.get(next)?.has(s));
    };
    const dividedIntoNext: string[] = [];
    if (joined(content)) dividedIntoNext.push(context.edition.id);
    for (const t of context.transcriptions.values())
      if (joined(t.content)) dividedIntoNext.push(t.id);
    const unprintedAfter = [
      ...new Set(
        fact.followers.flatMap((f) =>
          f.texts.filter((t) => !t.state && t.units.some((u) => !u.gap)).map((t) => t.id),
        ),
      ),
    ];
    return {
      segmentId: fact.segmentId,
      baseUnits: fact.base.units.length,
      witnesses: fact.witnesses,
      collation: fact.alone,
      ...(dividedIntoNext.length ? { dividedIntoNext } : {}),
      ...(unprintedAfter.length ? { unprintedAfter } : {}),
    };
  };
  const alones = new Map<number, SegmentAlone>();
  /** A segment as the plan reads it, or null where it is not known alone. */
  const alone = (i: number): SegmentAlone | null => {
    let found = alones.get(i);
    if (!found) {
      const made = aloneOf(i);
      if (!made) return null;
      alones.set(i, made);
      found = made;
    }
    return found;
  };
  const cuts = new Map<number, boolean>();
  /**
   * Whether the boundary before segment k is cut: null where that cannot be
   * told, for want of a segment its reason reads (the segments on either
   * side, and those a departure near the boundary is looked for in, as far
   * as the zone reaches). Each boundary is read once.
   */
  const cutAt = (k: number): boolean | null => {
    if (k <= 0 || k >= n) return true;
    const known = cuts.get(k);
    if (known !== undefined) return known;
    let from = k - 1;
    for (let units = 0; from >= 0; from--) {
      const one = alone(from);
      if (!one) return null;
      units += one.baseUnits;
      if (units >= ZONE || from === 0) break;
    }
    let to = k;
    for (let units = 0; to < n; to++) {
      const one = alone(to);
      if (!one) return null;
      units += one.baseUnits;
      if (units >= ZONE || to === n - 1) break;
    }
    const segments: SegmentAlone[] = [];
    for (let i = from; i <= to; i++) segments.push(alone(i)!);
    const cut = boundaryReason(segments, k - from) === null;
    cuts.set(k, cut);
    return cut;
  };

  // The stretches of the text to plan: around what is asked, as far as the passages linked with it reach.
  const asked = [...wantedAt].sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (const i of asked) {
    const last = intervals[intervals.length - 1];
    if (last && i <= last[1] + 1) last[1] = i;
    else intervals.push([i, i]);
  }
  const widened: [number, number][] = [];
  for (const [a, b] of intervals) {
    let lo = a;
    for (let units = 0; lo > 0 && units < LINK_REACH; ) units += unitsAt(--lo);
    let hi = b;
    for (let units = 0; hi < n - 1 && units < LINK_REACH; ) units += unitsAt(++hi);
    const last = widened[widened.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else widened.push([lo, hi]);
  }

  // Each stretch reaches out to a boundary that is cut on either side; the passages between are planned.
  const planned: number[][] = [];
  for (const [lo, hi] of widened) {
    let from = Math.max(0, lo - MARGIN);
    let to = Math.min(n, hi + 1 + MARGIN);
    let left: number | undefined;
    let right: number | undefined;
    for (;;) {
      await ensure(from, to);
      if (left === undefined)
        for (let k = lo; k >= Math.max(0, from); k--)
          if (cutAt(k) === true) {
            left = k;
            break;
          }
      if (right === undefined)
        for (let k = hi + 1; k <= Math.min(n, to); k++)
          if (cutAt(k) === true) {
            right = k;
            break;
          }
      if (left !== undefined && right !== undefined) break;
      if (left === undefined) from = Math.max(0, from - 4 * MARGIN);
      if (right === undefined) to = Math.min(n, to + 4 * MARGIN);
    }
    // Every boundary between the two is read; where one cannot be, for want of a segment beyond those read, more are read.
    for (let more = 0; more < 4; more++) {
      let lacking = false;
      for (let k = left + 1; k < right && !lacking; k++) if (cutAt(k) === null) lacking = true;
      if (!lacking || (from === 0 && to === n)) break;
      from = Math.max(0, Math.min(from, left) - MARGIN);
      to = Math.min(n, Math.max(to, right) + MARGIN);
      await ensure(from, to);
    }
    // Between two boundaries that are cut, nothing is cut but where a passage reaches its limits.
    let start = left;
    while (start < right) {
      let end = start + 1;
      while (end < right && cutAt(end) === false) end++;
      // A stretch with a boundary that cannot be read (beyond the budget) is not planned: its segments are pending.
      if (end < right && cutAt(end) === null) {
        start = end + 1;
        while (start < right && cutAt(start) !== true) start++;
        continue;
      }
      let current: number[] = [];
      let size = 0;
      for (let i = start; i < end; i++) {
        const units = alone(i)!.baseUnits;
        if (
          current.length > 0 &&
          (current.length >= MAX_PASSAGE_SEGMENTS || size + units > MAX_PASSAGE_UNITS)
        ) {
          planned.push(current);
          current = [];
          size = 0;
        }
        current.push(i);
        size += units;
      }
      if (current.length) planned.push(current);
      start = end;
    }
  }
  // Two stretches planned apart may reach over the same passages: each is kept once.
  const starts = new Set<number>();
  for (let k = planned.length - 1; k >= 0; k--) {
    if (starts.has(planned[k]![0]!)) planned.splice(k, 1);
    else starts.add(planned[k]![0]!);
  }
  planned.sort((x, y) => x[0]! - y[0]!);

  // Each passage: its collation alone where it is one segment, else from the cache or collated whole.
  const made: (PassageResult | null)[] = [];
  /** What each passage was collated from, by its hash: what the links between passages are remembered by. */
  const identity: string[] = [];
  const lackingPassages: {
    k: number;
    ids: number[];
    inputs: ReturnType<typeof passageInputs>;
    hash: string;
  }[] = [];
  planned.forEach((ids, k) => {
    const first = facts.get(ids[0]!)!;
    if (ids.length === 1 && first.followers.length === 0) {
      identity.push(`a:${first.hash}`);
      made.push({
        segmentId: first.segmentId,
        segments: [
          { segmentId: first.segmentId, from: 0, to: first.base.units.length, printed: true },
        ],
        baseUnits: first.base.units.map((u) => ({ ...u, segmentId: first.segmentId })),
        witnesses: first.witnesses,
        collation: first.alone!,
      });
      return;
    }
    const parts = ids.flatMap((i) => {
      const fact = facts.get(i)!;
      return [
        { segmentId: fact.segmentId, base: fact.base, texts: fact.texts, unprinted: false },
        ...fact.followers.map((f) => ({ ...f, unprinted: true })),
      ];
    });
    // A further state of a witness that differs in any segment of the passage is given for every segment of it.
    const differing = new Set(
      parts.flatMap((p) => p.texts.filter((t) => t.state?.differs).map((t) => t.id)),
    );
    const inputs = passageInputs(
      parts.map(
        (p): SegmentInputs => ({
          segmentId: p.segmentId,
          base: p.base,
          witnesses: collationTexts(p.texts, (t) => differing.has(t.id)),
          ...(p.unprinted ? { unprinted: true } : {}),
        }),
      ),
    );
    const hash = passageHash(context, inputs);
    identity.push(`p:${hash}`);
    const known = recall(`p:${hash}`);
    if (known) {
      made.push(passageResult(inputs, known));
      return;
    }
    made.push(null);
    lackingPassages.push({ k, ids, inputs, hash });
  });
  // The rows of passages not remembered, where the segment they are kept under was known without its row.
  const unreadRows = lackingPassages
    .map((l) => l.ids[0]!)
    .filter((i) => facts.get(i)!.stored === undefined);
  for (let k = 0; k < unreadRows.length; k += ROW_READ) {
    const chunk = unreadRows.slice(k, k + ROW_READ);
    const rows = await db
      .select({
        segmentId: collationCache.segmentId,
        inputHash: collationCache.inputHash,
        result: collationCache.result,
      })
      .from(collationCache)
      .where(
        and(
          eq(collationCache.editionId, context.edition.id),
            eq(collationCache.versionNumber, context.versionNumber ?? 0),
          inArray(
            collationCache.segmentId,
            chunk.map((i) => order[i]!),
          ),
        ),
      );
    const byId = new Map(rows.map((r) => [r.segmentId, r] as const));
    for (const i of chunk) {
      const fact = facts.get(i)!;
      const row = byId.get(fact.segmentId);
      const stored = row?.result as Stored | undefined;
      fact.stored =
        row && row.inputHash === fact.hash && stored && 'alone' in stored ? stored : null;
    }
  }
  const stillLacking: typeof lackingPassages = [];
  for (const lacking of lackingPassages) {
    const stored = facts.get(lacking.ids[0]!)!.stored?.passage;
    if (stored && stored.hash === lacking.hash) {
      const collation = reviveCollation(stored.collation);
      remember(`p:${lacking.hash}`, collation);
      made[lacking.k] = passageResult(lacking.inputs, collation);
    } else stillLacking.push(lacking);
  }
  for (const { k, ids, inputs } of stillLacking) {
    const passage = collatePassage(inputs);
    remember(`p:${passageHash(context, inputs)}`, passage.collation);
    made[k] = passageResult(inputs, passage.collation);
    const first = facts.get(ids[0]!)!;
    first.stored = {
      ...(first.stored ?? { alone: serializeCollation(first.alone!) }),
      passage: {
        hash: passageHash(context, inputs),
        collation: serializeCollation(passage.collation),
      },
    };
    markDirty(ids[0]!);
    await write();
  }
  await write(true);

  // Neighbours are linked, in each run of passages made one after another.
  const runs: { passages: PassageResult[]; keys: string[] }[] = [];
  let run: { passages: PassageResult[]; keys: string[] } = { passages: [], keys: [] };
  planned.forEach((ids, k) => {
    const passage = made[k];
    const adjacent = k > 0 && planned[k - 1]![planned[k - 1]!.length - 1]! + 1 === ids[0];
    if (!passage || !adjacent) {
      if (run.passages.length) runs.push(run);
      run = { passages: [], keys: [] };
    }
    if (passage) {
      run.passages.push(passage);
      run.keys.push(identity[k]!);
    }
  });
  if (run.passages.length) runs.push(run);
  for (const { passages: list, keys } of runs) linkRun(context, list, keys);

  // What was asked: the passages that hold it, the editor's marks put over them.
  const passages: PassageResult[] = [];
  const covered = new Set<number>();
  planned.forEach((ids, k) => {
    const passage = made[k];
    if (!passage) return;
    for (const i of ids) covered.add(i);
    if (!ids.some((i) => wantedAt.has(i))) return;
    passages.push({
      ...passage,
      collation: applySiteKinds(passage.collation, passage.baseUnits, marksOf(context, passage)),
    });
  });
  const pending = [...wantedAt]
    .filter((i) => !covered.has(i))
    .sort((a, b) => Math.abs(a - nearAt) - Math.abs(b - nearAt) || a - b)
    .flatMap((i) => [order[i]!, ...(following.get(order[i]!) ?? [])])
    .filter((id) => wanted === null || indexOf.has(id) || wanted.includes(id));
  return { passages, pending };
}

/**
 * Collations remembered by the hash of their inputs, the most recently used
 * kept: a collation is a pure function of what it reads, so that one with
 * the same hash is the same whatever edition or request asks for it, and a
 * page asked for again need not read it from the cache and parse it. They
 * are never changed once made (the links and the marks are put over copies).
 */
const remembered = new Map<string, Collation>();
const REMEMBERED_KEPT = 2000;

/** Forget every collation remembered, and the links: as if the process had just started (for measuring and testing a cold cache). */
export function forgetCollations(): void {
  remembered.clear();
  linksOf.clear();
}

function recall(key: string): Collation | undefined {
  const found = remembered.get(key);
  if (found) {
    remembered.delete(key);
    remembered.set(key, found);
  }
  return found;
}

function remember(key: string, collation: Collation): void {
  remembered.delete(key);
  remembered.set(key, collation);
  if (remembered.size > REMEMBERED_KEPT) remembered.delete(remembered.keys().next().value!);
}

/** What linking a run of passages changed: for each passage, the sites given a link, or a link taken off (null). */
type Links = [siteIndex: number, link: Site['transposition'] | null][][];

/**
 * The links of runs of passages, by what the passages were collated from:
 * linking reads every passage of a run, the same runs are asked for again
 * and again (the whole text by the reader and the outline), and it changes
 * only when one of them does.
 */
const linksOf = new Map<string, Links>();
const LINKS_KEPT = 64;

/** Link a run of neighbouring passages (`linkAll`), from what is remembered of the same run where it can be. */
function linkRun(context: EditionContext, list: PassageResult[], keys: string[]): void {
  const key = createHash('sha256').update(keys.join('|')).digest('hex');
  let links = linksOf.get(key);
  if (!links) {
    const linked: Pick<Passage, 'segments' | 'collation' | 'base' | 'witnesses'>[] = list.map(
      (p) => ({
        segments: p.segments,
        collation: p.collation,
        base: { id: context.edition.id, siglum: 'ed.', units: p.baseUnits },
        witnesses: p.witnesses,
      }),
    );
    linkAll(linked);
    links = list.map((p, k) => {
      const before = new Map(p.collation.sites.map((site) => [site.index, site] as const));
      const changed: Links[number] = [];
      for (const site of linked[k]!.collation.sites) {
        const was = before.get(site.index)?.transposition;
        if (JSON.stringify(was) !== JSON.stringify(site.transposition))
          changed.push([site.index, site.transposition ?? null]);
      }
      return changed;
    });
    linksOf.set(key, links);
    if (linksOf.size > LINKS_KEPT) linksOf.delete(linksOf.keys().next().value!);
  }
  list.forEach((p, k) => {
    const changed = links[k]!;
    if (changed.length === 0) return;
    const by = new Map(changed);
    p.collation = {
      ...p.collation,
      sites: p.collation.sites.map((site) => {
        if (!by.has(site.index)) return site;
        const link = by.get(site.index);
        if (link) return { ...site, transposition: link };
        const { transposition: _gone, ...rest } = site;
        return rest;
      }),
    };
  });
}

function passageResult(
  inputs: ReturnType<typeof passageInputs>,
  collation: Collation,
): PassageResult {
  return {
    segmentId: inputs.segments[0]!.segmentId,
    segments: inputs.segments,
    baseUnits: inputs.base.units,
    witnesses: inputs.witnesses,
    collation,
  };
}

/** The editor's marks of every segment of a passage, together: each is kept under the segment its variant's words begin in. */
export function marksOf(
  context: EditionContext,
  passage: Pick<PassageResult, 'segments'>,
): Map<string, SiteMark> | undefined {
  const found = passage.segments.flatMap((s) => [...(context.siteKinds.get(s.segmentId) ?? [])]);
  return found.length ? new Map(found) : undefined;
}

/** One segment of an edition collated alone, from the cache when the inputs are unchanged, with the editor's marks. */
export async function collateSegment(
  db: Database,
  context: EditionContext,
  segmentId: string,
): Promise<Collation> {
  const { base, texts: all } = segmentTexts(context, segmentId);
  const texts = collationTexts(all);
  const hash = inputHash(context, base, texts);
  const [row] = await db
    .select({ inputHash: collationCache.inputHash, result: collationCache.result })
    .from(collationCache)
    .where(
      and(
        eq(collationCache.editionId, context.edition.id),
            eq(collationCache.versionNumber, context.versionNumber ?? 0),
        eq(collationCache.segmentId, segmentId),
      ),
    );
  const stored = row?.result as Stored | undefined;
  let collation: Collation;
  if (row && row.inputHash === hash && stored && 'alone' in stored)
    collation = reviveCollation(stored.alone);
  else {
    collation = collate(base, texts);
    await db
      .insert(collationCache)
      .values({
        editionId: context.edition.id,
          versionNumber: context.versionNumber ?? 0,
        segmentId,
        inputHash: hash,
        result: { alone: serializeCollation(collation) } satisfies Stored,
      })
      .onConflictDoUpdate({
        target: [collationCache.editionId, collationCache.versionNumber, collationCache.segmentId],
        set: {
          inputHash: hash,
          result: { alone: serializeCollation(collation) },
          computedAt: new Date(),
        },
      });
  }
  return applySiteKinds(collation, base.units, context.siteKinds.get(segmentId));
}

/** Every passage of the edition, in the order of its text. */
export async function collateEdition(
  db: Database,
  context: EditionContext,
): Promise<PassageResult[]> {
  return (await collatePassagesFor(db, context, null)).passages;
}
