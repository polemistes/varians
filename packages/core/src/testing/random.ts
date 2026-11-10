/**
 * Random (property) testing for the core: a seeded source of random
 * numbers, a runner that shrinks and reports a failing case, and generators
 * of streams, operations and texts to collate.
 *
 * A property is a function that must hold for every case a generator can
 * make. Every case here is plain data (JSON), made from a seed, so that a
 * failure can be reproduced from the seed alone:
 *
 *     PROPERTY_SEED=1234 PROPERTY_RUNS=1 pnpm exec vitest run <file>
 *
 * `PROPERTY_RUNS` sets the number of cases for every property (300 by
 * default), `PROPERTY_SEED` the seed of the first.
 */

import type { Break, Id, Item, Mark, Obj, Stream, Token } from '../stream/items.ts';
import { isBreak, isObj, isToken } from '../stream/items.ts';
import type { Op } from '../stream/ops.ts';
import { applyOp } from '../stream/ops.ts';
import { segmentRuns } from '../stream/words.ts';

// ---------------------------------------------------------------------------
// Random numbers

/** A small seeded generator (mulberry32): the same seed always gives the same stream of numbers. */
export class Rng {
  private state: number;

  constructor(public readonly seed: number) {
    this.state = seed >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** An integer in [lo, hi]. */
  between(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error('pick from nothing');
    return xs[this.int(xs.length)]!;
  }

  /** A choice with weights: `[[value, weight], …]`. */
  weighted<T>(choices: readonly (readonly [T, number])[]): T {
    const total = choices.reduce((sum, [, w]) => sum + w, 0);
    let at = this.next() * total;
    for (const [value, weight] of choices) {
      at -= weight;
      if (at < 0) return value;
    }
    return choices[choices.length - 1]![0];
  }

  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// The runner

export const RUNS = Math.max(1, Number(process.env.PROPERTY_RUNS) || 300);
const FIRST_SEED = Number(process.env.PROPERTY_SEED) || 1;

/** Thrown by `assume`: the case is not one the property speaks of. */
export class Discard extends Error {
  constructor(why = 'discarded') {
    super(why);
    this.name = 'Discard';
  }
}

/** Leave the case out: it does not meet the property's precondition. */
export function assume(condition: unknown, why?: string): asserts condition {
  if (!condition) throw new Discard(why);
}

export interface Property<C> {
  /** Make a case from the generator; `size` runs from 1 to `maxSize`, so that cases are small and large. */
  generate(rng: Rng, size: number): C;
  /** Throws (any error) when the property does not hold, `Discard` when the case does not apply. Must not change the case. */
  check(c: C): void;
  /** Simpler cases to try in place of a failing one. */
  shrink?(c: C): Iterable<C>;
  /** A readable picture of a case, printed with a failure. */
  show?(c: C): string;
  runs?: number;
  maxSize?: number;
}

export interface PropertyResult {
  name: string;
  runs: number;
  discarded: number;
}

function copy<C>(c: C): C {
  return JSON.parse(JSON.stringify(c)) as C;
}

function message(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > 2400 ? `${text.slice(0, 2400)}\n… (cut)` : text;
}

/**
 * Run a property over seeded cases. On the first failure the case is shrunk
 * (by the property's `shrink`, greedily) and an error is thrown that names
 * the seed and shows the smallest case found. Prints one line with the
 * number of cases run and discarded.
 */
export function runProperty<C>(name: string, property: Property<C>): PropertyResult {
  const runs = property.runs ?? RUNS;
  const maxSize = property.maxSize ?? 12;
  let discarded = 0;
  const attempt = (c: C): unknown => {
    try {
      property.check(copy(c));
      return undefined;
    } catch (error) {
      if (error instanceof Discard) return undefined;
      return error ?? new Error('failed');
    }
  };
  for (let run = 0; run < runs; run++) {
    const seed = FIRST_SEED + run;
    const size = 1 + (seed % maxSize);
    const original = property.generate(new Rng(seed), size);
    let verdict: unknown;
    let skipped = false;
    try {
      property.check(copy(original));
    } catch (error) {
      if (error instanceof Discard) skipped = true;
      else verdict = error ?? new Error('failed');
    }
    if (skipped) {
      discarded++;
      continue;
    }
    if (verdict === undefined) continue;
    // Shrink by hand: take the first simpler case that still fails, and go on from it.
    let smallest = original;
    let checks = 0;
    let progress = true;
    while (progress && property.shrink && checks < 4000) {
      progress = false;
      for (const candidate of property.shrink(smallest)) {
        checks++;
        const error = attempt(candidate);
        if (error !== undefined) {
          smallest = candidate;
          verdict = error;
          progress = true;
          break;
        }
        if (checks >= 4000) break;
      }
    }
    const picture = property.show ? property.show(smallest) : JSON.stringify(smallest, null, 1);
    const report = [
      `property "${name}" failed: seed ${seed} (PROPERTY_SEED=${seed} PROPERTY_RUNS=1), size ${size}, case ${run + 1} of ${runs}`,
      `smallest case found (${checks} shrink attempts):`,
      picture,
      message(verdict),
    ].join('\n');
    // A property kept as `it.fails` passes by failing: PROPERTY_VERBOSE=1 prints why.
    if (process.env.PROPERTY_VERBOSE) console.log(report);
    throw new Error(report);
  }
  console.log(`[property] ${name}: ${runs - discarded} cases checked, ${discarded} discarded`);
  return { name, runs, discarded };
}

/** Simpler lists: each element left out in turn (whole halves first for long lists). */
export function* shrinkList<T>(xs: readonly T[], keep = 0): Generator<T[]> {
  if (xs.length <= keep) return;
  if (xs.length > 8) {
    const half = Math.floor(xs.length / 2);
    yield xs.slice(0, half);
    yield xs.slice(half);
  }
  for (let i = xs.length - 1; i >= 0; i--) {
    if (xs.length - 1 < keep) continue;
    yield [...xs.slice(0, i), ...xs.slice(i + 1)];
  }
}

/**
 * Simpler streams: an item left out; the marks, segment start, read form,
 * join, separator or label of an item taken away.
 */
export function* shrinkStream(stream: Stream): Generator<Stream> {
  for (const items of shrinkList(stream.items)) yield { items };
  for (let i = 0; i < stream.items.length; i++) {
    const item = stream.items[i]!;
    const strip = (field: string): Stream | null => {
      if (!(field in item)) return null;
      const next = { ...(item as unknown as Record<string, unknown>) };
      delete next[field];
      const items = stream.items.slice();
      items[i] = next as unknown as Item;
      return { items };
    };
    for (const field of ['marks', 'segment', 'norm', 'joinNext', 'sep', 'label', 'unchecked']) {
      const smaller = strip(field);
      if (smaller) yield smaller;
    }
  }
}

// ---------------------------------------------------------------------------
// Pictures

/** One item as a short word: `t3:μῆνιν~norm+@s1.2{del,unclear:0-2}`, `/b4` a line break, `#P1(b2)` a page break, `<gap o1>` an object. */
export function pictureItem(item: Item): string {
  if (isBreak(item)) {
    if (item.type === 'page')
      return `#${item.pageId ?? '?'}${item.label !== undefined ? `:${item.label}` : ''}(${item.id})`;
    const sign = { line: '/', column: '|', paragraph: '¶' }[item.type as 'line'] ?? '?';
    return `${sign}${item.id}${item.label !== undefined ? `:${item.label}` : ''}`;
  }
  const start = item.segment
    ? `@${item.segment.segmentId ?? '-'}${item.segment.part !== undefined ? `.${item.segment.part}` : ''}`
    : '';
  if (isObj(item)) return `<${item.type} ${item.id}${start}>`;
  const marks = (item.marks ?? [])
    .map((m) => `${m.kind}${m.from !== undefined ? `:${m.from}-${m.to}` : ''}`)
    .join(',');
  return (
    `${item.id}:${item.form}` +
    (item.norm !== undefined ? `~${item.norm}` : '') +
    (item.joinNext ? '+' : '') +
    start +
    (marks ? `{${marks}}` : '')
  );
}

/** A stream as one line of items. */
export function picture(stream: Stream): string {
  return stream.items.map(pictureItem).join(' ');
}

export function showOp(op: Op): string {
  return JSON.stringify(op);
}

/** The segment every token and object belongs to by flow; null for the unassigned. */
export function membershipOf(stream: Stream): Map<Id, Id | null> {
  const out = new Map<Id, Id | null>();
  for (const run of segmentRuns(stream)) {
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (!isBreak(item)) out.set(item.id, run.segmentId);
    }
  }
  return out;
}

/** The ids of every item, in order. */
export function idsIn(stream: Stream): Id[] {
  return stream.items.map((item) => item.id);
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Streams

export const WORDS = [
  'μῆνιν',
  'ἄειδε',
  'θεὰ',
  'Πηληϊάδεω',
  'Ἀχιλῆος',
  'οὐλομένην',
  'ἣ',
  'μυρί',
  'Ἀχαιοῖς',
  'ἄλγε',
  'ἔθηκε',
  'a',
  'bb',
  'ccc',
  '𐅀x',
];

export const SEGMENTS = ['s1', 's2', 's3', 's4'];

export type MarkKind =
  | 'unclear'
  | 'damage'
  | 'hi'
  | 'abbr'
  | 'del'
  | 'add'
  | 'gap'
  | 'sic'
  | 'orig'
  | 'crux'
  | 'handShift'
  | 'space'
  | 'supplied'
  | 'surplus'
  | 'corr'
  | 'variant';

export interface StreamOptions {
  /** Roughly how many items: up to three times this. */
  size: number;
  /** The segments starts are drawn from; false for none. */
  segments?: readonly string[] | false;
  /** The share of tokens and objects that begin a run of a segment. */
  segmentRate?: number;
  /** How the parts of a segment standing in several runs are numbered. */
  parts?: 'ordered' | 'shuffled' | 'none';
  /** Whether a start may name no segment. */
  nullStarts?: boolean;
  /** Line, column and paragraph breaks (always on for a line break). */
  breaks?: boolean;
  objects?: boolean;
  /** The kinds of mark a token may carry; none by default. */
  marks?: readonly MarkKind[];
  norms?: boolean;
  joins?: boolean;
  /** Page breaks naming these pages, in this order, with text between. */
  pages?: readonly Id[];
  /** Page breaks made wrong: naming no page, an unknown page, one twice, out of order, with a label. */
  wrongPages?: boolean;
  prefix?: string;
  words?: readonly string[];
}

export interface MarkOptions {
  kinds: readonly MarkKind[];
  /** Attributes only the kinds' TEI renderings can carry. */
  teiSafe?: boolean;
}

/** Marks for a token of this form, with ranges that lie inside it. */
export function randomMarks(rng: Rng, form: string, options: MarkOptions): Mark[] | undefined {
  if (options.kinds.length === 0 || !rng.chance(0.3)) return undefined;
  const length = Array.from(form).length;
  const marks: Mark[] = [];
  const count = rng.weighted([
    [1, 6],
    [2, 2],
    [3, 1],
  ] as const);
  for (let k = 0; k < count; k++) {
    const kind = rng.pick(options.kinds);
    const mark: Mark = { kind };
    switch (kind) {
      case 'gap':
        // A gap inside a word is a point mark: letters are lost there.
        mark.from = rng.between(0, length);
        mark.to = mark.from;
        mark.attrs = { reason: rng.pick(['lost', 'illegible']), quantity: rng.between(1, 4) };
        break;
      case 'abbr':
        mark.attrs = { expan: `${form}x` };
        break;
      case 'handShift':
        mark.attrs = { new: '#h2' };
        break;
      case 'space':
        mark.from = rng.between(0, length);
        mark.to = mark.from;
        mark.attrs = { quantity: rng.between(1, 3) };
        break;
      case 'corr':
        mark.attrs = { corr: `${form}c` };
        if (length >= 1) {
          mark.from = 0;
          mark.to = length;
        }
        break;
      case 'variant':
        mark.attrs = { group: `g${rng.between(1, 3)}`, reading: 'x', place: 'margin' };
        break;
      case 'del':
      case 'add':
        if (rng.chance(0.8)) mark.attrs = { place: 'above' };
        break;
      case 'hi':
        mark.attrs = { rend: rng.pick(['rubric', 'superscript']) };
        break;
      case 'damage':
        mark.attrs = { agent: 'water' };
        break;
      default:
        break;
    }
    if (mark.from === undefined && kind !== 'handShift' && kind !== 'variant' && length >= 2) {
      // Whole token, or a range of its letters.
      if (rng.chance(0.4)) {
        mark.from = rng.between(0, length - 1);
        mark.to = rng.between(mark.from + 1, length);
      }
    }
    marks.push(mark);
  }
  return marks;
}

/** A random stream: tokens, breaks and objects, with segment starts, page breaks and marks as asked. */
export function randomStream(rng: Rng, options: StreamOptions): Stream {
  const prefix = options.prefix ?? 't';
  let n = 0;
  const fresh = () => `${prefix}${++n}`;
  const words = options.words ?? WORDS;
  const count = rng.between(1, Math.max(1, options.size * 3));
  const items: Item[] = [];
  const kinds: [string, number][] = [['token', 70]];
  kinds.push(['line', 12]);
  if (options.breaks !== false) kinds.push(['column', 2], ['paragraph', 2]);
  if (options.objects !== false) kinds.push(['object', 7]);
  for (let i = 0; i < count; i++) {
    const kind = rng.weighted(kinds);
    if (kind === 'token') {
      const form = rng.pick(words);
      const token: Token = { kind: 'token', id: fresh(), form };
      if (options.norms && rng.chance(0.15)) {
        token.norm = rng.chance(0.2) ? `${rng.pick(words)} ${rng.pick(words)}` : rng.pick(words);
        if (rng.chance(0.3)) token.unchecked = true;
      }
      if (options.joins && rng.chance(0.12)) token.joinNext = true;
      if (rng.chance(0.08)) token.sep = rng.pick(['space', 'none', 'interpunct', 'other'] as const);
      const marks = randomMarks(rng, form, { kinds: options.marks ?? [] });
      if (marks) token.marks = marks;
      items.push(token);
    } else if (kind === 'object') {
      const type = rng.pick([
        'gap',
        'figure',
        'mark',
        'note',
        'lacuna',
        'paratext',
        'space',
      ] as const);
      const obj: Obj = { kind: 'object', id: fresh(), type };
      if (type === 'gap')
        obj.attrs = { reason: rng.pick(['lost', 'illegible']), quantity: rng.between(1, 5) };
      if (type === 'note' || type === 'paratext' || type === 'figure')
        obj.text = rng.pick(['n', 'a note', 'head']);
      items.push(obj);
    } else {
      const brk: Break = { kind: 'break', id: fresh(), type: kind as Break['type'] };
      if (kind === 'column' && rng.chance(0.5)) brk.label = 'b';
      items.push(brk);
    }
  }
  // Segment starts.
  if (options.segments !== false) {
    const pool = options.segments ?? SEGMENTS;
    const rate = options.segmentRate ?? 0.18;
    const starts: { segmentId: Id | null; part?: number }[] = [];
    const holders: (Token | Obj)[] = [];
    for (const item of items) {
      if (isBreak(item) || !rng.chance(rate)) continue;
      const segmentId = options.nullStarts !== false && rng.chance(0.08) ? null : rng.pick(pool);
      const start: { segmentId: Id | null; part?: number } = { segmentId };
      item.segment = start;
      starts.push(start);
      holders.push(item);
    }
    const mode = options.parts ?? 'ordered';
    if (mode !== 'none') {
      const bySegment = new Map<Id, { segmentId: Id | null; part?: number }[]>();
      for (const start of starts) {
        if (start.segmentId === null) continue;
        const list = bySegment.get(start.segmentId) ?? [];
        list.push(start);
        bySegment.set(start.segmentId, list);
      }
      for (const list of bySegment.values()) {
        if (list.length === 1) {
          if (rng.chance(0.2)) list[0]!.part = 1;
          continue;
        }
        const numbers = list.map((_, k) => k + 1);
        const order = mode === 'shuffled' ? rng.shuffle(numbers) : numbers;
        list.forEach((start, k) => (start.part = order[k]!));
      }
    }
  }
  // Pages.
  if (options.pages && options.pages.length > 0) {
    const order = options.pages;
    const chosen = order.filter(() => rng.chance(0.7));
    const at = chosen.map(() => rng.between(0, items.length)).sort((a, b) => a - b);
    const breaks: Break[] = chosen.map((pageId) => ({
      kind: 'break',
      id: fresh(),
      type: 'page',
      pageId,
    }));
    if (options.wrongPages) {
      const named = breaks.map((b) => b.pageId!);
      const shuffled = rng.chance(0.5) ? rng.shuffle(named) : named;
      breaks.forEach((brk, k) => {
        const roll = rng.int(10);
        if (roll === 0) delete brk.pageId;
        else if (roll === 1) brk.pageId = 'unknown';
        else if (roll <= 3) brk.pageId = rng.pick(order);
        else brk.pageId = shuffled[k]!;
        if (rng.chance(0.2)) brk.label = '12r';
      });
      if (rng.chance(0.3)) {
        // A break nobody asked for, at the start or anywhere.
        const extra: Break = { kind: 'break', id: fresh(), type: 'page' };
        if (rng.chance(0.5)) extra.pageId = rng.pick(order);
        breaks.push(extra);
        at.push(rng.between(0, items.length));
        const sorted = at
          .map((place, k) => ({ place, brk: breaks[k]! }))
          .sort((a, b) => a.place - b.place);
        breaks.splice(0, breaks.length, ...sorted.map((s) => s.brk));
        at.splice(0, at.length, ...sorted.map((s) => s.place));
      }
    }
    for (let k = breaks.length - 1; k >= 0; k--) items.splice(at[k]!, 0, breaks[k]!);
  }
  return { items };
}

/** The same stream with every segment start given a segment of its own, so that each segment is in one run. */
export function uniqueSegments(stream: Stream): Stream {
  let n = 0;
  return {
    items: stream.items.map((item) => {
      if (isBreak(item) || !item.segment) return item;
      const segmentId = item.segment.segmentId === null ? null : `u${++n}`;
      return { ...item, segment: { segmentId } };
    }),
  };
}

/** Pages `P1 … Pn`. */
export function pageIds(n: number): Id[] {
  return Array.from({ length: n }, (_, k) => `P${k + 1}`);
}

// ---------------------------------------------------------------------------
// Operations

export interface OpOptions {
  /** Kinds of operation to draw from; all by default. */
  kinds?: readonly Op['t'][];
  /** Draw ids for new items. */
  fresh: () => Id;
  /** Whether a `replace` may put nothing in place of the items it takes out (default: yes). */
  replaceByNothing?: boolean;
}

function newToken(rng: Rng, fresh: () => Id): Token {
  const token: Token = { kind: 'token', id: fresh(), form: rng.pick(WORDS) };
  if (rng.chance(0.15)) token.norm = rng.pick(WORDS);
  return token;
}

function newItem(rng: Rng, fresh: () => Id): Item {
  const roll = rng.int(10);
  if (roll === 0) return { kind: 'break', id: fresh(), type: 'line' };
  if (roll === 1) return { kind: 'object', id: fresh(), type: 'gap', attrs: { quantity: 2 } };
  return newToken(rng, fresh);
}

/** A run of items standing next to each other, as indexes [start, start + length). */
function randomRun(
  rng: Rng,
  stream: Stream,
  max: number,
  noPageBreaks = false,
): [number, number] | null {
  if (stream.items.length === 0) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const start = rng.int(stream.items.length);
    const length = Math.min(rng.between(1, max), stream.items.length - start);
    const run = stream.items.slice(start, start + length);
    if (noPageBreaks && run.some((item) => isBreak(item) && item.type === 'page')) continue;
    return [start, length];
  }
  return null;
}

/** One operation that is valid on this stream, or null when the stream allows none of the kinds. */
export function randomOp(rng: Rng, stream: Stream, options: OpOptions): Op | null {
  const kinds =
    options.kinds ?? (['insert', 'delete', 'set', 'move', 'split', 'join', 'replace'] as const);
  const items = stream.items;
  for (let attempt = 0; attempt < 10; attempt++) {
    const t = rng.pick(kinds);
    switch (t) {
      case 'insert': {
        const after = items.length === 0 || rng.chance(0.1) ? null : rng.pick(items).id;
        const made = Array.from({ length: rng.between(1, 3) }, () => newItem(rng, options.fresh));
        return { t, after, items: made };
      }
      case 'delete': {
        if (items.length === 0) break;
        const ids = rng
          .shuffle(items)
          .slice(0, rng.between(1, 3))
          .map((i) => i.id);
        return { t, ids };
      }
      case 'set': {
        if (items.length === 0) break;
        const item = rng.pick(items);
        const fields: Record<string, unknown> = {};
        if (isToken(item)) {
          const choice = rng.int(7);
          if (choice === 0) fields.form = rng.pick(WORDS);
          else if (choice === 1) fields.norm = rng.chance(0.3) ? null : rng.pick(WORDS);
          else if (choice === 2) fields.joinNext = rng.chance(0.5) ? true : null;
          else if (choice === 3) fields.unchecked = rng.chance(0.5) ? true : null;
          else if (choice === 4)
            fields.segment = rng.chance(0.4)
              ? null
              : {
                  segmentId: rng.pick(SEGMENTS),
                  ...(rng.chance(0.3) ? { part: rng.between(1, 3) } : {}),
                };
          else if (choice === 5)
            fields.marks = rng.chance(0.3)
              ? null
              : (randomMarks(rng, item.form, { kinds: ['unclear', 'del', 'add', 'hi'] }) ?? null);
          else {
            fields.sep = rng.pick(['space', 'none', null] as const);
            fields.form = rng.pick(WORDS);
          }
        } else if (isBreak(item)) {
          fields.label = rng.chance(0.3) ? null : 'x';
        } else {
          fields.text = rng.chance(0.3) ? null : 'a note';
          if (rng.chance(0.3)) fields.segment = { segmentId: rng.pick(SEGMENTS) };
        }
        return { t, id: item.id, fields };
      }
      case 'move': {
        const run = randomRun(rng, stream, 3);
        if (!run) break;
        const ids = items.slice(run[0], run[0] + run[1]).map((i) => i.id);
        const others = items.filter((i) => !ids.includes(i.id));
        const after = others.length === 0 || rng.chance(0.1) ? null : rng.pick(others).id;
        return { t, ids, after };
      }
      case 'split': {
        const candidates = items.filter((i) => isToken(i) && Array.from(i.form).length >= 2);
        if (candidates.length === 0) break;
        const token = rng.pick(candidates) as Token;
        const at = rng.between(1, Array.from(token.form).length - 1);
        const op: Op = { t, id: token.id, at, newId: options.fresh() };
        if (rng.chance(0.4)) op.join = true;
        return op;
      }
      case 'join': {
        const places: number[] = [];
        for (let i = 0; i + 1 < items.length; i++)
          if (isToken(items[i]) && isToken(items[i + 1])) places.push(i);
        if (places.length === 0) break;
        return { t, id: items[rng.pick(places)]!.id };
      }
      case 'replace': {
        const run = randomRun(rng, stream, 3);
        if (!run) break;
        const old = items.slice(run[0], run[0] + run[1]);
        const made: Item[] = Array.from(
          { length: rng.between(options.replaceByNothing === false ? 1 : 0, 3) },
          () => newItem(rng, options.fresh),
        );
        // Sometimes keep an id of what is replaced, as split and join do.
        if (made.length > 0 && rng.chance(0.3)) made[0] = { ...made[0]!, id: old[0]!.id } as Item;
        return { t, ids: old.map((i) => i.id), items: made };
      }
    }
  }
  return null;
}

/** A stream and operations that are each valid where they stand in the sequence. */
export interface OpsCase {
  stream: Stream;
  ops: Op[];
}

export function randomOps(
  rng: Rng,
  stream: Stream,
  count: number,
  options: Omit<OpOptions, 'fresh'> = {},
): Op[] {
  let n = 0;
  const fresh = () => `n${++n}`;
  const ops: Op[] = [];
  let current = stream;
  for (let k = 0; k < count; k++) {
    const op = randomOp(rng, current, { ...options, fresh });
    if (!op) continue;
    try {
      current = applyOp(current, op).stream;
    } catch {
      continue;
    }
    ops.push(op);
  }
  return ops;
}

export function showOpsCase(c: OpsCase): string {
  return [
    `stream: ${picture(c.stream)}`,
    ...c.ops.map((op, k) => `op ${k + 1}: ${showOp(op)}`),
  ].join('\n');
}

/** Whether every operation applies where it stands in the sequence. */
export function appliesInOrder(c: OpsCase): boolean {
  try {
    let current = c.stream;
    for (const op of c.ops) current = applyOp(current, op).stream;
    return true;
  } catch {
    return false;
  }
}

/** Smaller forms of one operation: fewer ids or items. */
export function* shrinkOp(op: Op): Generator<Op> {
  switch (op.t) {
    case 'insert':
      for (const items of shrinkList(op.items, 1)) yield { ...op, items };
      break;
    case 'delete':
      for (const ids of shrinkList(op.ids, 1)) yield { ...op, ids };
      break;
    case 'move':
      if (op.ids.length > 1) {
        yield { ...op, ids: op.ids.slice(0, -1) };
        yield { ...op, ids: op.ids.slice(1) };
      }
      break;
    case 'replace':
      if (op.ids.length > 1) {
        yield { ...op, ids: op.ids.slice(0, -1) };
        yield { ...op, ids: op.ids.slice(1) };
      }
      for (const items of shrinkList(op.items)) yield { ...op, items };
      break;
    default:
      break;
  }
}

/** Shorter operation lists and smaller streams, keeping only those on which every operation is still valid. */
export function* shrinkOpsCase(c: OpsCase): Generator<OpsCase> {
  for (const ops of shrinkList(c.ops)) {
    const smaller = { stream: c.stream, ops };
    if (appliesInOrder(smaller)) yield smaller;
  }
  for (let k = 0; k < c.ops.length; k++) {
    for (const op of shrinkOp(c.ops[k]!)) {
      const ops = c.ops.slice();
      ops[k] = op;
      const smaller = { stream: c.stream, ops };
      if (appliesInOrder(smaller)) yield smaller;
    }
  }
  for (const stream of shrinkStream(c.stream)) {
    const smaller = { stream, ops: c.ops };
    if (appliesInOrder(smaller)) yield smaller;
  }
}

// ---------------------------------------------------------------------------
// Texts to collate

export interface Unit {
  text: string;
  tokenIds: Id[];
  gap?: Obj;
}

/** Words with accent variants and near spellings, so that folds agree and disagree. */
export const COLLATION_WORDS = [
  'ἦ',
  'ἤ',
  'η',
  'ἄνδρα',
  'ἀνδρα',
  'ανδρα',
  'μοι',
  'ἔννεπε',
  'ἔνεπε',
  'Μοῦσα',
  'μοῦσα',
  'πολύτροπον',
  'πολυτροπον',
  'ὃς',
  'ὅς',
  'μάλα',
  'πολλὰ',
  'πολλά',
  'πλάγχθη',
  'ἐπεὶ',
  'Τροίης',
  'ἱερὸν',
  'πτολίεθρον',
  'ἔπερσεν',
];

export function unit(id: Id, text: string): Unit {
  return { text, tokenIds: [id] };
}

export function gapUnit(id: Id): Unit {
  return { text: '', tokenIds: [], gap: { kind: 'object', id, type: 'gap' } };
}

export interface TextsCase {
  /** The base's words; `null` stands for a gap. */
  base: (string | null)[];
  witnesses: { siglum: string; words: (string | null)[]; present: boolean }[];
}

export interface TextsOptions {
  gaps?: boolean;
  /** How far witnesses stay close to the base (mutations of it), or are drawn freely. */
  free?: boolean;
  /** Smallest and largest number of witnesses. */
  witnesses?: [number, number];
  /** Words: pool to draw from. */
  words?: readonly string[];
  /** Largest base length (default 3 + 2 * size). */
  length?: number;
}

/** Mutate a text: words replaced, left out, added, transposed, accents changed, gaps put in. */
export function mutateWords(
  rng: Rng,
  words: readonly (string | null)[],
  pool: readonly string[],
  gaps: boolean,
  edits: number,
): (string | null)[] {
  const out = [...words];
  for (let k = 0; k < edits; k++) {
    const kind = rng.int(gaps ? 6 : 5);
    const at = out.length === 0 ? 0 : rng.int(out.length);
    if (kind === 0 && out.length > 0) out[at] = rng.pick(pool);
    else if (kind === 1 && out.length > 0) out.splice(at, 1);
    else if (kind === 2) out.splice(at, 0, rng.pick(pool));
    else if (kind === 3 && out.length > 1) {
      const to = rng.int(out.length);
      const [moved] = out.splice(at, 1);
      out.splice(to, 0, moved!);
    } else if (kind === 4 && out.length > 0 && out[at] !== null) {
      out[at] = out[at]!.normalize('NFD').replace(/[̀-̔]/gu, '').normalize('NFC');
    } else if (kind === 5) {
      if (rng.chance(0.5) && out.length > 0) out[at] = null;
      else out.splice(at, 0, null);
    }
  }
  return out;
}

export function randomTexts(rng: Rng, size: number, options: TextsOptions = {}): TextsCase {
  const pool = options.words ?? COLLATION_WORDS;
  const length = rng.between(options.length === undefined ? 1 : 1, options.length ?? 3 + 2 * size);
  const base: (string | null)[] = Array.from({ length }, () => rng.pick(pool));
  const [lo, hi] = options.witnesses ?? [1, 3];
  const count = rng.between(lo, hi);
  const witnesses: TextsCase['witnesses'] = [];
  for (let k = 0; k < count; k++) {
    let words: (string | null)[];
    if (options.free) {
      words = Array.from({ length: rng.between(0, length + 2) }, () => rng.pick(pool));
    } else if (rng.chance(0.12)) {
      words = [...base];
    } else {
      words = mutateWords(
        rng,
        base,
        pool,
        options.gaps === true,
        rng.between(1, 1 + Math.floor(size / 2)),
      );
    }
    witnesses.push({ siglum: String.fromCharCode(65 + k), words, present: true });
  }
  return { base, witnesses };
}

/** Units of a text: ids `<id>.<n>`, a gap for each `null`. */
export function unitsOf(id: string, words: readonly (string | null)[]): Unit[] {
  return words.map((w, i) => (w === null ? gapUnit(`${id}.${i + 1}`) : unit(`${id}.${i + 1}`, w)));
}

export function showTexts(c: TextsCase): string {
  const line = (words: readonly (string | null)[]) => words.map((w) => w ?? '[gap]').join(' ');
  return [
    `base: ${line(c.base)}`,
    ...c.witnesses.map((w) => `${w.siglum}${w.present ? '' : ' (not present)'}: ${line(w.words)}`),
  ].join('\n');
}

export function* shrinkTexts(c: TextsCase): Generator<TextsCase> {
  for (const witnesses of shrinkList(c.witnesses, 1)) yield { base: c.base, witnesses };
  for (const base of shrinkList(c.base, 1)) yield { base, witnesses: c.witnesses };
  for (let k = 0; k < c.witnesses.length; k++) {
    for (const words of shrinkList(c.witnesses[k]!.words)) {
      const witnesses = c.witnesses.slice();
      witnesses[k] = { ...witnesses[k]!, words };
      yield { base: c.base, witnesses };
    }
  }
}
