/**
 * Words, segment runs and lines of a stream: the derived structure
 * everything else reads. Nothing here is stored.
 */

import {
  isBreak,
  isObj,
  isToken,
  readForm,
  type Id,
  type Item,
  type Mark,
  type Obj,
  type SegmentStart,
  type Stream,
  type Token,
} from './items.ts';

/** One word: one token, or several joined by `joinNext`. */
export interface Word {
  tokens: Token[];
  /** Index of the first token in the stream. */
  index: number;
  /** The written forms run together. */
  form: string;
  /** The read form: the first token's override if any, else the written forms run together. */
  norm: string;
}

/** Walk the words of a stream between two item indexes (end exclusive). Breaks inside a joined word are allowed. */
export function words(stream: Stream, from = 0, to = stream.items.length): Word[] {
  const out: Word[] = [];
  let i = from;
  while (i < to) {
    const item = stream.items[i];
    if (!isToken(item)) {
      i++;
      continue;
    }
    const tokens: Token[] = [item];
    let j = i + 1;
    let current = item;
    while (current.joinNext && j < to) {
      const next = stream.items[j];
      if (isToken(next)) {
        tokens.push(next);
        current = next;
        j++;
        if (!current.joinNext) break;
      } else if (isBreak(next)) {
        j++;
      } else break;
    }
    const form = tokens.map((t) => t.form).join('');
    const first = tokens[0]!;
    const norm = first.norm !== undefined ? first.norm : tokens.map((t) => readForm(t)).join('');
    out.push({ tokens, index: i, form, norm });
    i = Math.max(j, i + 1);
  }
  return out;
}

/** A run of items belonging to one segment (or unassigned) in physical order. */
export interface SegmentRun {
  segmentId: Id | null;
  part: number;
  /** First item index (the token or object carrying the segment start). */
  from: number;
  /** Exclusive end. */
  to: number;
}

/** The segment runs of a stream, in physical order. Items before any segment start are unassigned. */
export function segmentRuns(stream: Stream): SegmentRun[] {
  const runs: SegmentRun[] = [];
  let current: SegmentRun | null = null;
  stream.items.forEach((item, index) => {
    const start = segmentStartOf(item);
    if (start) {
      if (current) current.to = index;
      current = { segmentId: start.segmentId, part: start.part ?? 1, from: index, to: index + 1 };
      runs.push(current);
    } else if (current) {
      current.to = index + 1;
    } else if (isToken(item) || isObj(item)) {
      current = { segmentId: null, part: 1, from: index, to: index + 1 };
      runs.push(current);
    }
  });
  if (current) (current as SegmentRun).to = stream.items.length;
  return runs;
}

export function segmentStartOf(item: Item): SegmentStart | undefined {
  if (isToken(item) || isObj(item)) return item.segment;
  return undefined;
}

/** The runs of one segment, in content order (by part, then physical order). */
export function runsOfSegment(stream: Stream, segmentId: Id): SegmentRun[] {
  return segmentRuns(stream)
    .filter((run) => run.segmentId === segmentId)
    .sort((a, b) => a.part - b.part || a.from - b.from);
}

/**
 * The runs of every segment of a stream, each segment's in content order (by
 * part, then physical order), found in one pass. What `runsOfSegment` gives
 * for one segment, for all of them at the price of one: where the runs of
 * many segments of the same stream are wanted, this is the way, since
 * `runsOfSegment` divides the whole stream every time it is asked.
 */
export function runsBySegment(stream: Stream): Map<Id, SegmentRun[]> {
  const out = new Map<Id, SegmentRun[]>();
  for (const run of segmentRuns(stream)) {
    if (run.segmentId === null) continue;
    const list = out.get(run.segmentId);
    if (list) list.push(run);
    else out.set(run.segmentId, [run]);
  }
  for (const list of out.values())
    if (list.length > 1) list.sort((a, b) => a.part - b.part || a.from - b.from);
  return out;
}

/** The ids of the segments a stream assigns text to, in order of first appearance. */
export function segmentIds(stream: Stream): Id[] {
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const run of segmentRuns(stream)) {
    if (run.segmentId && !seen.has(run.segmentId)) {
      seen.add(run.segmentId);
      out.push(run.segmentId);
    }
  }
  return out;
}

/** The segment an item at `index` belongs to: the nearest segment start at or before it. */
export function segmentAt(stream: Stream, index: number): SegmentStart | undefined {
  for (let i = index; i >= 0; i--) {
    const start = segmentStartOf(stream.items[i]!);
    if (start) return start;
  }
  return undefined;
}

/** A line of the carrier: the items between two line-ending breaks. */
export interface Line {
  /** Index of the first item of the line (after the break that opened it). */
  from: number;
  /** Exclusive end: the index of the break that ends it, or the stream's length. */
  to: number;
  /** The break that opened the line, if any. */
  opener?: Item;
}

export function lines(stream: Stream): Line[] {
  const out: Line[] = [];
  let from = 0;
  let opener: Item | undefined;
  stream.items.forEach((item, index) => {
    if (isBreak(item)) {
      out.push(opener ? { from, to: index, opener } : { from, to: index });
      from = index + 1;
      opener = item;
    }
  });
  out.push(opener ? { from, to: stream.items.length, opener } : { from, to: stream.items.length });
  return out;
}

/** The index of the line an item stands on. */
export function lineOf(stream: Stream, index: number): number {
  let line = 0;
  for (let i = 0; i < index && i < stream.items.length; i++) {
    if (isBreak(stream.items[i]!)) line++;
  }
  return line;
}

/** Whether a token is wholly covered by a mark of a kind. */
export function wholeTokenMark(token: Token, kind: string): boolean {
  return (token.marks ?? []).some(
    (m) =>
      m.kind === kind &&
      (m.from === undefined || (m.from === 0 && m.to === Array.from(token.form).length)),
  );
}

/**
 * Which state of a witness is read:
 * - `corrected`: after every correction, deleted words left out and added words in;
 * - `original`: as first written, deleted words in and added words left out;
 * - `variant`: as corrected, with the variants the carrier notes in place of the words they concern;
 * - `{ kind: 'stage', upTo }`: as first written, with the corrections of stages 1 to `upTo` applied
 *   (a correction without a stage belongs to no stage and stays unapplied);
 * - `{ kind: 'hand', hands }`: as first written, with the corrections by any of these hands applied
 *   (the values as the marks name them: a hand's id, 'scribe', 'other').
 */
export type CollationState =
  | 'corrected'
  | 'original'
  | 'variant'
  | { kind: 'stage'; upTo: number }
  | { kind: 'hand'; hands: readonly string[] };

/** The mark of a kind that covers the whole token, if any. */
function wholeMark(token: Token, kind: string): Mark | undefined {
  return (token.marks ?? []).find(
    (m) =>
      m.kind === kind &&
      (m.from === undefined || (m.from === 0 && m.to === Array.from(token.form).length)),
  );
}

/** Whether a correction (a deletion or an addition) is applied in a state. */
function correctionApplies(mark: Mark, state: CollationState): boolean {
  if (typeof state === 'string') return state !== 'original';
  if (state.kind === 'stage')
    return typeof mark.attrs?.seq === 'number' && mark.attrs.seq <= state.upTo;
  return typeof mark.attrs?.hand === 'string' && state.hands.includes(mark.attrs.hand);
}

/** Whether a word is left out of a state: an added word whose addition is not applied, or a deleted word whose deletion is. */
export function excludedInState(tokens: readonly Token[], state: CollationState): boolean {
  if (tokens.length === 0) return false;
  const added = tokens.map((t) => wholeMark(t, 'add'));
  if (added.every((m) => m !== undefined) && !correctionApplies(added[0]!, state)) return true;
  const deleted = tokens.map((t) => wholeMark(t, 'del'));
  return deleted.every((m) => m !== undefined) && correctionApplies(deleted[0]!, state);
}

/** The variant mark of a token, if it has one (see `Mark` in items.ts). */
export function variantMark(token: Token): Mark | undefined {
  return token.marks?.find((m) => m.kind === 'variant' && typeof m.attrs?.group === 'string');
}

/** The group of a token's variant mark. */
export function variantGroup(token: Token): string | undefined {
  const group = variantMark(token)?.attrs?.group;
  return typeof group === 'string' ? group : undefined;
}

/** The neighbouring token of `index` in a direction, passing over breaks and objects other than gaps. */
function neighbourToken(stream: Stream, index: number, step: 1 | -1): Token | undefined {
  for (let i = index + step; i >= 0 && i < stream.items.length; i += step) {
    const item = stream.items[i]!;
    if (isToken(item)) return item;
    if (isObj(item) && item.type === 'gap') return undefined;
  }
  return undefined;
}

/**
 * The span of a variant: the consecutive tokens around `index` (breaks and
 * objects between them passed over, a gap ending it) whose variant mark has
 * `group`. `first` is the index of its first token.
 */
export function variantSpan(
  stream: Stream,
  index: number,
  group: string,
): { first: number; tokens: Token[] } {
  let first = index;
  for (let i = index - 1; i >= 0; i--) {
    const item = stream.items[i]!;
    if (isToken(item)) {
      if (variantGroup(item) !== group) break;
      first = i;
    } else if (isObj(item) && item.type === 'gap') break;
  }
  const tokens: Token[] = [];
  for (let i = first; i < stream.items.length; i++) {
    const item = stream.items[i]!;
    if (isToken(item)) {
      if (variantGroup(item) !== group) break;
      tokens.push(item);
    } else if (isObj(item) && item.type === 'gap') break;
  }
  return { first, tokens };
}

/** Whether the token at `index` begins the span of its variant. */
function beginsVariant(stream: Stream, index: number, group: string): boolean {
  const before = neighbourToken(stream, index, -1);
  return !before || variantGroup(before) !== group;
}

/**
 * The gap that breaks a word: one of its tokens has a gap as a point mark,
 * where letters of the word are lost or illegible. Given as the gap object
 * it stands for, under the token's id.
 */
export function brokenByGap(tokens: readonly Token[]): Obj | undefined {
  for (const token of tokens) {
    const mark = token.marks?.find(
      (m) => m.kind === 'gap' && m.from !== undefined && m.from === m.to,
    );
    if (!mark) continue;
    const gap: Obj = { kind: 'object', id: token.id, type: 'gap' };
    if (mark.attrs) gap.attrs = mark.attrs;
    return gap;
  }
  return undefined;
}

/** A unit collation aligns on: a word's read form divided at its spaces, or a gap. */
export interface Unit {
  /** The normalized form. */
  text: string;
  /** Ids of the tokens the unit was read from (all tokens of its word). */
  tokenIds: Id[];
  /** The gap object this unit stands for, when it is a gap. */
  gap?: Obj;
}

/**
 * The collation units of a stretch of a stream: the words of `[from, to)` in
 * the chosen state, read through their normalized forms, with gaps kept as
 * units that absorb whatever other witnesses have there.
 */
export function units(
  stream: Stream,
  from: number,
  to: number,
  state: CollationState = 'corrected',
): Unit[] {
  const out: Unit[] = [];
  let i = from;
  const wordsHere = words(stream, from, to);
  let w = 0;
  while (i < to) {
    const item = stream.items[i]!;
    if (isObj(item) && item.type === 'gap') {
      out.push({ text: '', tokenIds: [], gap: item });
      i++;
      continue;
    }
    if (!isToken(item)) {
      i++;
      continue;
    }
    const word = wordsHere[w];
    if (!word || word.index !== i) {
      i++;
      continue;
    }
    w++;
    const last = word.tokens[word.tokens.length - 1]!;
    i = stream.items.indexOf(last, i) + 1;
    if (state === 'variant') {
      const marked = word.tokens.find((t) => variantGroup(t) !== undefined);
      const group = marked ? variantGroup(marked)! : undefined;
      if (group !== undefined) {
        // The variant's words stand once, where its span begins; the other words of the span give way to them.
        const at = stream.items.indexOf(marked!, word.index);
        if (!beginsVariant(stream, at, group)) continue;
        const span = variantSpan(stream, at, group);
        const reading = variantMark(marked!)?.attrs?.reading;
        const tokenIds = span.tokens.map((t) => t.id);
        const parts = (typeof reading === 'string' ? reading : '')
          .split(/\s+/u)
          .filter((p) => p.length > 0);
        for (const part of parts) out.push({ text: part, tokenIds });
        continue;
      }
    }
    if (excludedInState(word.tokens, state)) continue;
    // A word that a gap breaks is not read: what is left of it counts with the gap.
    const broken = brokenByGap(word.tokens);
    if (broken) {
      if (!out[out.length - 1]?.gap) out.push({ text: '', tokenIds: [], gap: broken });
      continue;
    }
    const tokenIds = word.tokens.map((t) => t.id);
    const parts = word.norm.split(/\s+/u).filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    for (const part of parts) out.push({ text: part, tokenIds });
  }
  return out;
}

/** The collation units of one segment, every run in content order. */
export function segmentUnits(
  stream: Stream,
  segmentId: Id,
  state: CollationState = 'corrected',
): Unit[] {
  const out: Unit[] = [];
  for (const run of runsOfSegment(stream, segmentId))
    out.push(...units(stream, run.from, run.to, state));
  return out;
}
