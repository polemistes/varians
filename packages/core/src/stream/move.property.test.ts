import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import {
  clone,
  idsIn,
  membershipOf,
  pageIds,
  picture,
  randomStream,
  runProperty,
  shrinkList,
  assume,
  type Property,
  type Rng,
} from '../testing/random.ts';
import { isBreak, type Id, type Item, type Stream, type Token } from './items.ts';
import {
  conformPages,
  insertIntoPage,
  isConformed,
  moveRun,
  moveToPage,
  pagesWithText,
  repairSegmentStartsFrom,
} from './move.ts';
import { applyOps } from './ops.ts';
import { runsOfSegment, segmentAt, segmentRuns } from './words.ts';

const isPage = (item: Item) => isBreak(item) && item.type === 'page';

/** A stream from a short notation, for the pinned counterexamples: `t1` a word, `t1@s2` or `t1@s2.1` one that starts a segment (part), `/` a line break. */
function build(spec: string): Stream {
  let lines = 0;
  return {
    items: spec
      .split(/\s+/u)
      .filter(Boolean)
      .map((word): Item => {
        if (word === '/') return { kind: 'break', id: `l${++lines}`, type: 'line' };
        const [id, start] = word.split('@');
        const token: Token = { kind: 'token', id: id!, form: id! };
        if (start) {
          const [segmentId, part] = start.split('.');
          token.segment = part
            ? { segmentId: segmentId!, part: Number(part) }
            : { segmentId: segmentId! };
        }
        return token;
      }),
  };
}

function sorted(ids: Id[]): Id[] {
  return [...ids].sort();
}

function members(stream: Stream): Record<string, string | null> {
  return Object.fromEntries(membershipOf(stream));
}

/** The same through `segmentAt`, the way a reader asks: for every token and object. */
function membersByAt(stream: Stream): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  stream.items.forEach((item, i) => {
    if (!isBreak(item)) out[item.id] = segmentAt(stream, i)?.segmentId ?? null;
  });
  return out;
}

/** The words (tokens and objects) of a segment in content order: its runs by part, then place. */
function contentOrder(stream: Stream, segmentId: Id): Id[] {
  const out: Id[] = [];
  for (const run of runsOfSegment(stream, segmentId))
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (!isBreak(item)) out.push(item.id);
    }
  return out;
}

function segmentsIn(stream: Stream): Id[] {
  return [...new Set(segmentRuns(stream).flatMap((r) => (r.segmentId ? [r.segmentId] : [])))];
}

/** The invariants of a transcript's pages (design 3.4) for a witness whose pages are `order`. */
function expectPagesInShape(stream: Stream, order: readonly Id[]): void {
  const breaks = stream.items.filter(isPage) as Extract<Item, { kind: 'break' }>[];
  const named = breaks.map((b) => b.pageId);
  for (const brk of breaks) {
    expect(brk.pageId, `page break ${brk.id} names no page`).toBeDefined();
    expect(order, `page break ${brk.id} names a page that is not in the order`).toContain(
      brk.pageId,
    );
    expect(brk.label, `page break ${brk.id} carries a label`).toBeUndefined();
  }
  expect(new Set(named).size, `a page is named twice: ${named.join(' ')}`).toBe(named.length);
  const ranks = named.map((p) => order.indexOf(p!));
  expect(ranks, `page breaks out of order: ${named.join(' ')}`).toStrictEqual(
    [...ranks].sort((a, b) => a - b),
  );
}

// ---------------------------------------------------------------------------
// moveRun

interface MoveCase {
  stream: Stream;
  ids: Id[];
  after: Id | null;
}

function showMove(c: MoveCase): string {
  return `stream: ${picture(c.stream)}\nmove: ${c.ids.join(' ')} after ${c.after ?? 'the start'}`;
}

function generateMove(rng: Rng, size: number): MoveCase {
  const stream = randomStream(rng, {
    size,
    parts: rng.pick(['ordered', 'ordered', 'shuffled', 'none'] as const),
    segmentRate: rng.pick([0.1, 0.2, 0.35]),
    ...(rng.chance(0.5) ? { pages: pageIds(3) } : {}),
  });
  for (;;) {
    const start = rng.int(stream.items.length);
    const length = Math.min(rng.between(1, 4), stream.items.length - start);
    const run = stream.items.slice(start, start + length);
    if (run.some(isPage)) {
      // A page break cannot be moved with text; try elsewhere or give the stream a plain item.
      if (stream.items.every((item) => isPage(item)))
        stream.items.push({ kind: 'token', id: `extra${stream.items.length}`, form: 'a' });
      continue;
    }
    const ids = run.map((i) => i.id);
    const others = stream.items.filter((i) => !ids.includes(i.id));
    const after = others.length === 0 || rng.chance(0.12) ? null : rng.pick(others).id;
    return { stream, ids, after };
  }
}

function* shrinkMove(c: MoveCase): Generator<MoveCase> {
  for (let i = 0; i < c.stream.items.length; i++) {
    const gone = c.stream.items[i]!;
    if (c.ids.includes(gone.id) || gone.id === c.after) continue;
    yield { ...c, stream: { items: c.stream.items.filter((_, k) => k !== i) } };
  }
  if (c.ids.length > 1) {
    yield { ...c, ids: c.ids.slice(0, -1) };
    yield { ...c, ids: c.ids.slice(1) };
  }
  for (let i = 0; i < c.stream.items.length; i++) {
    const item = c.stream.items[i]! as unknown as Record<string, unknown>;
    for (const field of ['marks', 'norm', 'joinNext', 'sep', 'label']) {
      if (!(field in item)) continue;
      const next = { ...item };
      delete next[field];
      const items = c.stream.items.slice();
      items[i] = next as unknown as Item;
      yield { ...c, stream: { items } };
    }
  }
}

describe('moveRun (random)', () => {
  const generate = generateMove;

  it('loses and duplicates no item, keeps the segment of every token and object, and its operations apply cleanly', () => {
    runProperty('moveRun: items kept, segment of every word kept', {
      generate,
      show: showMove,
      shrink: shrinkMove,
      check({ stream, ids, after }) {
        const ops = moveRun(stream, ids, after);
        const before = clone(stream);
        const applied = applyOps(stream, ops);
        expect(stream).toStrictEqual(before);
        expect(sorted(idsIn(applied.stream))).toStrictEqual(sorted(idsIn(stream)));
        expect(members(applied.stream)).toStrictEqual(members(stream));
        expect(membersByAt(applied.stream)).toStrictEqual(membersByAt(stream));
        // The run stands after the item it was moved after, in its order.
        const at = applied.stream.items.findIndex((i) => i.id === ids[0]);
        expect(applied.stream.items.slice(at, at + ids.length).map((i) => i.id)).toStrictEqual(ids);
        const previous = at === 0 ? null : applied.stream.items[at - 1]!.id;
        const wasPrevious = (() => {
          const k = stream.items.findIndex((i) => i.id === ids[0]);
          return k === 0 ? null : stream.items[k - 1]!.id;
        })();
        if (wasPrevious !== after) expect(previous).toBe(after);
        // Only starts of segments changed: every field of every item is as it was.
        const strip = (s: Stream) =>
          s.items.map((item) => {
            const { segment: _segment, ...rest } = item as Item & { segment?: unknown };
            return rest;
          });
        expect([...strip(applied.stream)].sort((a, b) => a.id.localeCompare(b.id))).toStrictEqual(
          [...strip(stream)].sort((a, b) => a.id.localeCompare(b.id)),
        );
        // The reverse undoes the whole.
        expect(applyOps(applied.stream, clone(applied.reverse)).stream).toStrictEqual(before);
      },
    });
  });

  it('puts nothing in a move that leaves the run where it is', () => {
    runProperty('moveRun: no operations for a move that changes nothing', {
      generate(rng, size) {
        const c = generateMove(rng, size);
        const first = c.stream.items.findIndex((i) => i.id === c.ids[0]);
        return { ...c, after: first === 0 ? null : c.stream.items[first - 1]!.id };
      },
      show: showMove,
      shrink: shrinkMove,
      check({ stream, ids, after }) {
        expect(moveRun(stream, ids, after)).toStrictEqual([]);
      },
    });
  });

  // The three properties that follow are not in the design's wording; they
  // follow from "part numbers keep the content order" (design 3.5): moving a
  // run changes where its own words stand in their segment's text, and
  // nothing else. Each fails, always from one cause: after a move a segment
  // is in stretches, and the stretches are numbered by the old content
  // position of each stretch's *first* word, whether or not that word moved
  // and whatever else the stretch holds. (A second cause: the repair drops the
  // explicit start of a touched word when the flow gives it its segment
  // anyway, which merges parts that were deliberately out of physical order.)
  // Each is also pinned to its shrunk case. The counterexample to the second is
  // rare (seed 2200), so that property starts just before it.

  const unmovedKeepOrder: Property<MoveCase> = {
    generate,
    show: showMove,
    shrink: shrinkMove,
    check({ stream, ids, after }) {
      const moved = new Set(ids);
      const applied = applyOps(stream, moveRun(stream, ids, after)).stream;
      for (const segment of segmentsIn(stream)) {
        expect(
          contentOrder(applied, segment).filter((id) => !moved.has(id)),
          `unmoved words of ${segment}`,
        ).toStrictEqual(contentOrder(stream, segment).filter((id) => !moved.has(id)));
      }
    },
  };

  // Shrunk: `t8@s1 t9@s2 t12 <space t19>` (t12 and t19 follow t9 in s2; s2
  // reads t9 t12 t19), `moveRun([t8, t9], after t12)`. The result is
  // `t12@s2.2 t8@s1 t9@s2.1 t19`: s2 is in two stretches, [t12] and [t9 t19],
  // numbered by t12 and t9, and t9 stood before t12, so s2 now reads t9 t19
  // t12. Neither t12 nor t19 moved, and they have changed places.
  it.fails('keeps the content order of the words not moved', () => {
    runProperty('moveRun: content order of the unmoved words is kept', unmovedKeepOrder);
  });
  it.fails('keeps the content order of the words not moved (the shrunk case)', () => {
    const stream = build('t8@s1 t9@s2 t12 t19');
    unmovedKeepOrder.check({ stream, ids: ['t8', 't9'], after: 't12' });
  });

  const movedKeepOrder: Property<MoveCase> = {
    firstSeed: 2190,
    runs: 40,
    generate,
    show: showMove,
    shrink: shrinkMove,
    check({ stream, ids, after }) {
      const moved = new Set(ids);
      const applied = applyOps(stream, moveRun(stream, ids, after)).stream;
      for (const segment of segmentsIn(stream)) {
        expect(
          contentOrder(applied, segment).filter((id) => moved.has(id)),
          `moved words of ${segment}`,
        ).toStrictEqual(contentOrder(stream, segment).filter((id) => moved.has(id)));
      }
    },
  };

  // Shrunk: `t3@s4.1 t4@s4.2 t9 t10`, `moveRun([t3, t4], after t10)`. The
  // stretches of s4 after the move are [t9 t10 t3] and [t4] (the kept start of
  // t4), numbered by t9 and t4, so s4 reads t4 t9 t3 and the moved words t3 t4
  // have changed places.
  it.fails('keeps the content order of the moved words among themselves', () => {
    runProperty('moveRun: content order of the moved words is kept', movedKeepOrder);
  });
  it.fails('keeps the content order of the moved words among themselves (the shrunk case)', () => {
    const stream = build('t3@s4.1 t4@s4.2 t9 t10');
    movedKeepOrder.check({ stream, ids: ['t3', 't4'], after: 't10' });
  });

  const backRestoresOrder: Property<MoveCase> = {
    generate,
    show: showMove,
    shrink: shrinkMove,
    check({ stream, ids, after }) {
      const k = stream.items.findIndex((i) => i.id === ids[0]);
      const previous = k === 0 ? null : stream.items[k - 1]!.id;
      const there = applyOps(stream, moveRun(stream, ids, after)).stream;
      const back = applyOps(there, moveRun(there, ids, previous)).stream;
      expect(idsIn(back)).toStrictEqual(idsIn(stream));
      expect(members(back)).toStrictEqual(members(stream));
      for (const segment of segmentsIn(stream))
        expect(contentOrder(back, segment)).toStrictEqual(contentOrder(stream, segment));
    },
  };

  // Shrunk: `t8@s3.1 t21 t22@s3.2 t23`; move t8 after t23, then move it back
  // to the start. The words and their segments are as at first, but s3 reads
  // t22 t23 t8 t21 where it read t8 t21 t22 t23: the stretch [t8 t21] is
  // numbered by t8, which stood last when it was moved back.
  it.fails(
    'is undone by moving the run back: the same words in the same segments in the same order',
    () => {
      runProperty('moveRun: moving back restores order and membership', backRestoresOrder);
    },
  );
  it.fails('is undone by moving the run back (the shrunk case)', () => {
    const stream = build('t8@s3.1 t21 t22@s3.2 t23');
    backRestoresOrder.check({ stream, ids: ['t8'], after: 't23' });
  });
});

// ---------------------------------------------------------------------------
// moveToPage and insertIntoPage

interface PageCase {
  stream: Stream;
  order: Id[];
  /** The page moved to; null is Staging. */
  target: Id | null;
  ids: Id[];
}

function showPageCase(c: PageCase): string {
  return `pages: ${c.order.join(' ')}\nstream: ${picture(c.stream)}\nto: ${c.target ?? 'Staging'}  items: ${c.ids.join(' ')}`;
}

function generatePageCase(rng: Rng, size: number): PageCase {
  const order = pageIds(rng.between(1, 4));
  const stream = randomStream(rng, {
    size,
    parts: rng.pick(['ordered', 'ordered', 'shuffled'] as const),
    segmentRate: rng.pick([0.1, 0.2, 0.35]),
    pages: order,
  });
  const target = rng.chance(0.2) ? null : rng.pick(order);
  for (let attempt = 0; ; attempt++) {
    const start = rng.int(stream.items.length);
    const length = Math.min(rng.between(1, 4), stream.items.length - start);
    const run = stream.items.slice(start, start + length);
    if (run.some(isPage)) {
      if (attempt > 20)
        stream.items.push({ kind: 'token', id: `extra${stream.items.length}`, form: 'a' });
      continue;
    }
    return { stream, order, target, ids: run.map((i) => i.id) };
  }
}

function* shrinkPageCase(c: PageCase): Generator<PageCase> {
  for (let i = 0; i < c.stream.items.length; i++) {
    const gone = c.stream.items[i]!;
    if (c.ids.includes(gone.id)) continue;
    yield { ...c, stream: { items: c.stream.items.filter((_, k) => k !== i) } };
  }
  if (c.ids.length > 1) {
    yield { ...c, ids: c.ids.slice(0, -1) };
    yield { ...c, ids: c.ids.slice(1) };
  }
  if (c.order.length > 1 && c.target !== c.order[c.order.length - 1]) {
    const last = c.order[c.order.length - 1]!;
    if (!c.stream.items.some((i) => isPage(i) && (i as { pageId?: Id }).pageId === last))
      yield { ...c, order: c.order.slice(0, -1) };
  }
}

describe('moveToPage (random)', () => {
  it('moves the run to the end of the target page, loses nothing but orphaned line breaks, keeps every segment and the pages in shape', () => {
    runProperty('moveToPage: items, segments and page shape', {
      generate: generatePageCase,
      show: showPageCase,
      shrink: shrinkPageCase,
      check({ stream, order, target, ids }) {
        expectPagesInShape(stream, order);
        const before = clone(stream);
        const ops = moveToPage(stream, ids, target, { pageOrder: order, ids: sequentialIds('z') });
        const applied = applyOps(stream, ops);
        expect(stream).toStrictEqual(before);
        const after = applied.stream;
        // Nothing lost or duplicated: words, objects and every break but a plain line break stay.
        expect(new Set(idsIn(after)).size).toBe(after.items.length);
        const kept = new Set(idsIn(after));
        for (const item of stream.items) {
          if (kept.has(item.id)) continue;
          const orphan = isBreak(item) && item.type === 'line' && item.rend === undefined;
          expect(orphan, `${item.id} was lost`).toBe(true);
        }
        const wasThere = new Set(idsIn(stream));
        for (const item of after.items) {
          if (wasThere.has(item.id)) continue;
          expect(isBreak(item), `${item.id} is new and not a break`).toBe(true);
          if (isBreak(item) && item.type === 'page') expect(item.pageId).toBe(target);
          else expect(isBreak(item) && item.type).toBe('line');
        }
        expect(members(after)).toStrictEqual(members(stream));
        expectPagesInShape(after, order);
        // The run is the end of the target's text.
        const opener =
          target === null
            ? -1
            : after.items.findIndex((i) => isPage(i) && (i as { pageId?: Id }).pageId === target);
        if (target !== null)
          expect(opener, 'the target page has no break').toBeGreaterThanOrEqual(0);
        let end = opener + 1;
        while (end < after.items.length && !isPage(after.items[end]!)) end++;
        expect(after.items.slice(end - ids.length, end).map((i) => i.id)).toStrictEqual(ids);
        expect(end - ids.length).toBeGreaterThan(opener);
        expect(applyOps(after, clone(applied.reverse)).stream).toStrictEqual(before);
      },
    });
  });

  // Counterexample (shrunk): pages P1 (none with text); `<lacuna t5@s3.2> t11
  // t12@s3.1`, move t11 to Staging. s3 reads t12 t5 t11 (its parts are
  // out of physical order, as they are when a page was placed before another);
  // after the move t12 has lost its explicit start, because the flow from t5
  // now gives it s3, and s3 is one run in physical order: t5 t12 t11. Neither
  // t5 nor t12 moved, and they have changed places. See `moveRun` above.
  const pageMoveKeepsOrder: Property<PageCase> = {
    generate: generatePageCase,
    show: showPageCase,
    shrink: shrinkPageCase,
    check({ stream, order, target, ids }) {
      const moved = new Set(ids);
      const ops = moveToPage(stream, ids, target, { pageOrder: order, ids: sequentialIds('z') });
      const after = applyOps(stream, ops).stream;
      for (const segment of segmentsIn(stream)) {
        expect(
          contentOrder(after, segment).filter((id) => !moved.has(id)),
          `unmoved words of ${segment}`,
        ).toStrictEqual(contentOrder(stream, segment).filter((id) => !moved.has(id)));
      }
    },
  };

  it.fails('keeps the content order of the words not moved', () => {
    runProperty('moveToPage: content order of unmoved words is kept', pageMoveKeepsOrder);
  });
  it.fails('keeps the content order of the words not moved (the shrunk case)', () => {
    const stream: Stream = {
      items: [
        { kind: 'object', id: 't5', type: 'lacuna', segment: { segmentId: 's3', part: 2 } },
        { kind: 'token', id: 't11', form: 'a' },
        { kind: 'token', id: 't12', form: 'b', segment: { segmentId: 's3', part: 1 } },
      ],
    };
    pageMoveKeepsOrder.check({ stream, order: ['P1'], target: null, ids: ['t11'] });
  });
});

interface InsertCase {
  stream: Stream;
  order: Id[];
  target: Id | null;
  items: Item[];
}

function showInsert(c: InsertCase): string {
  return `pages: ${c.order.join(' ')}\nstream: ${picture(c.stream)}\ninto: ${c.target ?? 'Staging'}  new: ${c.items.map((i) => picture({ items: [i] })).join(' ')}`;
}

function generateInsert(rng: Rng, size: number, segments: boolean): InsertCase {
  const order = pageIds(rng.between(1, 4));
  const stream = randomStream(rng, { size, pages: order });
  const made = randomStream(rng, {
    size: Math.max(1, Math.floor(size / 3)),
    prefix: 'x',
    segments: segments ? ['s1', 's2', 's5'] : false,
    parts: 'ordered',
  });
  // An insertion never carries a page break of its own.
  const items = made.items.filter((i) => !isPage(i));
  if (items.length === 0) items.push({ kind: 'token', id: 'x0', form: 'a' });
  return { stream, order, target: rng.chance(0.2) ? null : rng.pick(order), items };
}

function* shrinkInsert(c: InsertCase): Generator<InsertCase> {
  for (const items of shrinkList(c.items, 1)) yield { ...c, items };
  for (let i = 0; i < c.stream.items.length; i++)
    yield { ...c, stream: { items: c.stream.items.filter((_, k) => k !== i) } };
}

describe('insertIntoPage (random)', () => {
  it('puts the items at the end of the page and changes no segment where the items start none', () => {
    runProperty(
      'insertIntoPage: items placed, nothing else changed, old words keep their segments',
      {
        generate: (rng, size) => generateInsert(rng, size, false),
        show: showInsert,
        shrink: shrinkInsert,
        check({ stream, order, target, items }) {
          expectPagesInShape(stream, order);
          const ops = insertIntoPage(stream, items, target, {
            pageOrder: order,
            ids: sequentialIds('z'),
          });
          const after = applyOps(stream, ops).stream;
          // Every old item stays, in its order; the new ones stand once.
          const old = new Set(idsIn(stream));
          expect(after.items.filter((i) => old.has(i.id)).map((i) => i.id)).toStrictEqual(
            idsIn(stream),
          );
          for (const item of items)
            expect(idsIn(after).filter((id) => id === item.id)).toHaveLength(1);
          expectPagesInShape(after, order);
          const was = members(stream);
          const now = members(after);
          for (const id of Object.keys(was)) expect(now[id], id).toBe(was[id]);
          // The new items end the target's text.
          const opener =
            target === null
              ? -1
              : after.items.findIndex((i) => isPage(i) && (i as { pageId?: Id }).pageId === target);
          let end = opener + 1;
          while (end < after.items.length && !isPage(after.items[end]!)) end++;
          expect(after.items.slice(end - items.length, end).map((i) => i.id)).toStrictEqual(
            items.map((i) => i.id),
          );
        },
      },
    );
  });

  it('with repairSegmentStartsFrom, keeps the segments of the old words and gives the new ones those of their own stream', () => {
    runProperty('insertIntoPage + repairSegmentStartsFrom: every word keeps the segment it had', {
      generate: (rng, size) => generateInsert(rng, size, true),
      show: showInsert,
      shrink: shrinkInsert,
      check({ stream, order, target, items }) {
        const own: Stream = { items };
        const ops = insertIntoPage(stream, items, target, {
          pageOrder: order,
          ids: sequentialIds('z'),
        });
        const placed = applyOps(stream, ops).stream;
        const repaired = applyOps(placed, repairSegmentStartsFrom([stream, own], placed)).stream;
        const now = members(repaired);
        for (const [id, segment] of Object.entries(members(stream)))
          expect(now[id], id).toBe(segment);
        for (const [id, segment] of Object.entries(members(own))) expect(now[id], id).toBe(segment);
      },
    });
  });
});

// ---------------------------------------------------------------------------
// conformPages

interface ConformCase {
  stream: Stream;
  order: Id[];
}

function showConform(c: ConformCase): string {
  return `pages: ${c.order.join(' ')}\nstream: ${picture(c.stream)}`;
}

function generateConform(rng: Rng, size: number, wrong: boolean): ConformCase {
  const all = pageIds(rng.between(1, 4));
  const stream = randomStream(rng, {
    size,
    parts: rng.pick(['ordered', 'ordered', 'shuffled'] as const),
    segmentRate: rng.pick([0.1, 0.2, 0.35]),
    pages: all,
    wrongPages: wrong,
  });
  // The witness may have lost a page the text still names.
  const order = all.length > 1 && rng.chance(0.3) ? all.filter(() => rng.chance(0.7)) : all;
  return { stream, order };
}

function* shrinkConform(c: ConformCase): Generator<ConformCase> {
  for (const items of shrinkList(c.stream.items)) yield { ...c, stream: { items } };
  for (let i = 0; i < c.stream.items.length; i++) {
    const item = c.stream.items[i]! as unknown as Record<string, unknown>;
    for (const field of ['label', 'segment']) {
      if (!(field in item)) continue;
      const next = { ...item };
      delete next[field];
      const items = c.stream.items.slice();
      items[i] = next as unknown as Item;
      yield { ...c, stream: { items } };
    }
  }
}

describe('conformPages (random)', () => {
  it('leaves page breaks naming the pages of the order, once, in order, without a label; loses no item but page breaks; keeps every segment', () => {
    runProperty('conformPages: shape, items, segments', {
      generate: (rng, size) => generateConform(rng, size, true),
      show: showConform,
      shrink: shrinkConform,
      check({ stream, order }) {
        const before = clone(stream);
        const ops = conformPages(stream, order, sequentialIds('z'));
        const applied = applyOps(stream, ops);
        expect(stream).toStrictEqual(before);
        const after = applied.stream;
        expectPagesInShape(after, order);
        // Everything but page breaks survives; what is new is a line break.
        const kept = new Set(idsIn(after));
        for (const item of stream.items)
          if (!isPage(item)) expect(kept.has(item.id), `${item.id} was lost`).toBe(true);
        const wasThere = new Set(idsIn(stream));
        for (const item of after.items)
          if (!wasThere.has(item.id)) expect(isBreak(item) && item.type, item.id).toBe('line');
        expect(new Set(idsIn(after)).size).toBe(after.items.length);
        expect(members(after)).toStrictEqual(members(stream));
        // A page named well, for the first time, keeps its break.
        const seen = new Set<Id>();
        for (const item of stream.items) {
          if (!isPage(item) || !(item as { pageId?: Id }).pageId) continue;
          const page = (item as { pageId: Id }).pageId;
          if (order.includes(page) && !seen.has(page)) {
            seen.add(page);
            expect(kept.has(item.id), `the first break of ${page} was removed`).toBe(true);
          }
        }
        // Idempotent.
        expect(conformPages(after, order, sequentialIds('y'))).toStrictEqual([]);
        expect(applyOps(after, clone(applied.reverse)).stream).toStrictEqual(before);
      },
    });
  });

  it('is told to have nothing to do by isConformed, and only then', () => {
    runProperty('isConformed: agrees with conformPages having nothing to do', {
      generate: (rng, size) => generateConform(rng, size, rng.chance(0.5)),
      show: showConform,
      shrink: shrinkConform,
      check({ stream, order }) {
        const nothing = conformPages(stream, order, sequentialIds('z')).length === 0;
        expect(isConformed(stream, order)).toBe(nothing);
      },
    });
  });

  it('makes no operations for a stream that is already in shape', () => {
    runProperty('conformPages: nothing to do for a stream in shape', {
      generate: (rng, size) => generateConform(rng, size, false),
      show: showConform,
      shrink: shrinkConform,
      check({ stream, order }) {
        assume(pagesWithText(stream).every((p) => order.includes(p)));
        expect(conformPages(stream, order, sequentialIds('z'))).toStrictEqual([]);
      },
    });
  });
});
