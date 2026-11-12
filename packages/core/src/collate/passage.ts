/**
 * Passages (docs/design.md, section 3.10): the text is collated in runs of
 * consecutive segments of the edition taken together. The boundary between
 * two segments is a place where the text may be cut, and it is cut only
 * where nothing can cross it. Each segment is first collated alone to find
 * this out; a passage of several segments is then collated whole, and two
 * neighbouring passages are linked where a witness has words in the one that
 * it is without in the other.
 *
 * Every step is a pure function of what the one before gives, so that a
 * caller with a cache between the steps (the server) takes them one by one;
 * `collatePassages` takes them all at once, from the streams themselves.
 */

import type { Id, Stream } from '../stream/items.ts';
import {
  runUnits,
  runsBySegment,
  segmentsJoined,
  type CollationState,
  type SegmentRun,
  type Unit,
} from '../stream/words.ts';
import { fold as foldText } from '../normalize/fold.ts';
import {
  collate,
  FAR_REACH,
  TRANSPOSITION_REACH,
  unitFold,
  type Collation,
  type CollationOptions,
  type CollationText,
  type Site,
} from './collate.ts';

// ---------------------------------------------------------------------------
// The plan

/** What the plan of passages needs to know of one segment of the edition, collated alone. */
export interface SegmentAlone {
  segmentId: Id;
  /** The number of the edition's units in the segment. */
  baseUnits: number;
  /** The witnesses as they were collated: their units for the segment, and whether their text runs on without it. */
  witnesses: readonly Pick<CollationText, 'id' | 'units' | 'present'>[];
  /** The segment collated alone, the edition's units against the witnesses'. */
  collation: Collation;
  /**
   * The texts (the edition's id among them) in which a word is divided
   * across the boundary after this segment: it begins in this segment, or
   * in a segment the edition does not print that stands after it, and has a
   * part in the next segment of the edition's order, or the reverse.
   */
  dividedIntoNext?: readonly Id[];
  /** The witnesses that have words in a segment the edition does not print, standing after this one. */
  unprintedAfter?: readonly Id[];
}

export interface PassageOptions {
  /** The most segments a passage holds: 12. */
  maxSegments?: number;
  /** The most units of the edition a passage holds: 240. A segment longer than that is a passage alone. */
  maxUnits?: number;
  /**
   * How many of the edition's units on either side of a boundary a witness
   * must depart within, on both sides, for the boundary to be left uncut:
   * the reach of a transposition and one more (4).
   */
  zone?: number;
  /** The reach of a transposition, for the default zone: 3. */
  transpositionReach?: number;
}

export const MAX_PASSAGE_SEGMENTS = 12;
export const MAX_PASSAGE_UNITS = 240;
/** The zone on either side of a boundary: the reach of a transposition and one more. */
export const BOUNDARY_ZONE = TRANSPOSITION_REACH + 1;

/** Why a boundary is left uncut: the first witness found (or the edition) and what it does there. */
export type BoundaryReason =
  /** A word is divided across the boundary, in this text. */
  | { kind: 'divided'; textId: Id }
  /** The witness has words at the boundary that the edition does not have: at the end of the one segment, the start of the other, or in a segment the edition does not print that stands there. */
  | { kind: 'words'; textId: Id }
  /** The witness is there and has no words at all for the segment on one side. */
  | { kind: 'without'; textId: Id }
  /** The witness departs from the edition close to the boundary on both sides. */
  | { kind: 'departures'; textId: Id };

interface Side {
  there: Set<Id>;
  words: Set<Id>;
}

function sideOf(segment: SegmentAlone): Side {
  const absent = new Set(segment.collation.absent);
  const there = new Set<Id>();
  const words = new Set<Id>();
  for (const w of segment.witnesses) {
    if (absent.has(w.id)) continue;
    if (w.units.length === 0 && !w.present) continue;
    there.add(w.id);
    if (w.units.some((u) => !u.gap)) words.add(w.id);
  }
  return { there, words };
}

/** The witnesses with words in the columns the alignment adds before the base's first unit (`end` false) or after its last. */
function wordsAtEdge(collation: Collation, end: boolean): Set<Id> {
  const columns = collation.columns;
  const baseAt = columns
    .map((column, k) => (column.cells.has(collation.baseId) ? k : -1))
    .filter((k) => k >= 0);
  const edge = end
    ? columns.slice(baseAt.length ? baseAt[baseAt.length - 1]! + 1 : 0)
    : columns.slice(0, baseAt.length ? baseAt[0]! : columns.length);
  const out = new Set<Id>();
  for (const column of edge)
    for (const [id, cell] of column.cells)
      if (id !== collation.baseId && !cell.lacunose && cell.unitIndex >= 0) out.add(id);
  return out;
}

/**
 * For each witness that departs from the base in a segment, how far its
 * departure nearest the end (`end`) or the start of the segment stands from
 * that edge, in the base's units: the units between a site over words and
 * the edge, and for a site at a point, those between the point and the edge
 * less one half, so that a point just beyond the zone's last unit still
 * counts.
 */
function departureDistances(segment: SegmentAlone, end: boolean): Map<Id, number> {
  const n = segment.baseUnits;
  const out = new Map<Id, number>();
  for (const site of segment.collation.sites) {
    const point = site.baseTo === site.baseFrom;
    const distance =
      (end ? n - (point ? site.baseFrom : site.baseTo) : site.baseFrom) - (point ? 0.5 : 0);
    for (const reading of site.readings)
      if (!reading.base)
        for (const id of reading.textIds)
          if (!out.has(id) || out.get(id)! > distance) out.set(id, distance);
  }
  return out;
}

/**
 * Whether the boundary before `segments[at]` (between it and the segment
 * before it, in the edition's order) is left uncut, and why: where, for
 * some witness that is there, a word is divided across it (in the witness
 * or the edition); the witness has words at the boundary that the edition
 * does not have; the witness is there on both sides and has no words for
 * the segment on one; or it departs from the edition within the zone on
 * both sides. The zone is a number of the edition's words, and reaches past
 * a segment shorter than it, through segments where the witness is there
 * and reads as the edition. A witness that is not there on a side (lost
 * there, or without text) leaves the boundary alone. Null where the
 * boundary may be cut.
 */
export function boundaryReason(
  segments: readonly SegmentAlone[],
  at: number,
  options: PassageOptions = {},
): BoundaryReason | null {
  const zone =
    options.zone ??
    (options.transpositionReach === undefined ? BOUNDARY_ZONE : options.transpositionReach + 1);
  const left = segments[at - 1];
  const right = segments[at];
  if (!left || !right) return null;
  const divided = left.dividedIntoNext?.[0];
  if (divided !== undefined) return { kind: 'divided', textId: divided };
  const one = sideOf(left);
  const other = sideOf(right);
  const ids = [
    ...new Set([...left.witnesses.map((w) => w.id), ...right.witnesses.map((w) => w.id)]),
  ];
  const atEnd = wordsAtEdge(left.collation, true);
  const atStart = wordsAtEdge(right.collation, false);
  const unprinted = new Set(left.unprintedAfter ?? []);
  for (const id of ids) {
    if ((one.there.has(id) && atEnd.has(id)) || (other.there.has(id) && atStart.has(id)))
      return { kind: 'words', textId: id };
    if (unprinted.has(id)) return { kind: 'words', textId: id };
  }
  for (const id of ids) {
    if (!one.there.has(id) || !other.there.has(id)) continue;
    if (!one.words.has(id) || !other.words.has(id)) return { kind: 'without', textId: id };
  }
  // How far from the boundary a witness first departs, walking away from it through the segments it is there in.
  const distances = new Map<SegmentAlone, [Map<Id, number>, Map<Id, number>]>();
  const reach = (id: Id, from: number, step: 1 | -1): number => {
    let passed = 0;
    for (let k = from; k >= 0 && k < segments.length && passed < zone; k += step) {
      const segment = segments[k]!;
      if (!sideOf(segment).there.has(id)) return Infinity;
      let known = distances.get(segment);
      if (!known) {
        known = [departureDistances(segment, true), departureDistances(segment, false)];
        distances.set(segment, known);
      }
      const distance = known[step < 0 ? 0 : 1].get(id);
      if (distance !== undefined) return passed + distance;
      passed += segment.baseUnits;
    }
    return Infinity;
  };
  for (const id of ids) {
    if (!one.there.has(id) || !other.there.has(id)) continue;
    if (reach(id, at - 1, -1) < zone && reach(id, at, 1) < zone)
      return { kind: 'departures', textId: id };
  }
  return null;
}

/**
 * The passages of an edition: its segments, given in its order each with
 * its collation alone, cut into runs of consecutive segments at every
 * boundary `boundaryReason` leaves cut, and wherever a passage would
 * otherwise hold more than `maxSegments` segments or `maxUnits` units of the
 * edition. Each passage is the ids of its segments, in order.
 */
export function planPassages(
  segments: readonly SegmentAlone[],
  options: PassageOptions = {},
): Id[][] {
  const maxSegments = options.maxSegments ?? MAX_PASSAGE_SEGMENTS;
  const maxUnits = options.maxUnits ?? MAX_PASSAGE_UNITS;
  const out: Id[][] = [];
  let current: Id[] = [];
  let size = 0;
  segments.forEach((segment, k) => {
    const joined =
      k > 0 &&
      current.length < maxSegments &&
      size + segment.baseUnits <= maxUnits &&
      boundaryReason(segments, k, options) !== null;
    if (!joined && current.length > 0) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(segment.segmentId);
    size += segment.baseUnits;
  });
  if (current.length > 0) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Collating a passage

/** The inputs of one segment of a passage, as for collating it alone. */
export interface SegmentInputs {
  segmentId: Id;
  /** The edition's units of the segment; none for a segment the edition does not print. */
  base: CollationText;
  /**
   * The witnesses: their units for the segment, and `present` where the
   * text runs on without it. A witness not given, or given without units
   * and not present, has no text for the segment (lost, or outside what its
   * transcript covers).
   */
  witnesses: readonly CollationText[];
  /** The edition does not print the segment: it stands after the edition's segment before it in the list. */
  unprinted?: boolean;
}

/** Where a segment stands in a passage: the base's units [from, to), none for a segment the edition does not print. */
export interface PassageSegment {
  segmentId: Id;
  from: number;
  to: number;
  printed: boolean;
}

export interface PassageInputs {
  base: CollationText;
  witnesses: CollationText[];
  segments: PassageSegment[];
  /** The unit index at which each segment the edition prints begins, in order. */
  segmentStarts: number[];
}

/**
 * The inputs of a passage from those of its segments, given in the order of
 * the passage (the edition's segments in its order, each followed by the
 * segments it does not print that stand after it): the base's units of all
 * its segments in order; each witness's units those of its segments in the
 * same order, every unit naming the segment it begins in. A witness with no
 * text for one of the edition's segments is not there over that segment's
 * units (`notThere`); one whose text runs on without a segment simply has
 * no words there. The witnesses come in the order they are first given.
 */
export function passageInputs(segments: readonly SegmentInputs[]): PassageInputs {
  const first = segments[0];
  if (!first) throw new Error('a passage needs at least one segment');
  const baseUnits: Unit[] = [];
  const placed: PassageSegment[] = [];
  for (const segment of segments) {
    const from = baseUnits.length;
    for (const unit of segment.base.units)
      baseUnits.push({ ...unit, segmentId: segment.segmentId });
    placed.push({
      segmentId: segment.segmentId,
      from,
      to: baseUnits.length,
      printed: !segment.unprinted,
    });
  }
  const order: Id[] = [];
  const siglumOf = new Map<Id, string>();
  for (const segment of segments)
    for (const w of segment.witnesses)
      if (!siglumOf.has(w.id)) {
        order.push(w.id);
        siglumOf.set(w.id, w.siglum);
      }
  const witnesses = order.map((id): CollationText => {
    const units: Unit[] = [];
    const notThere: { from: number; to: number }[] = [];
    let present = false;
    segments.forEach((segment, k) => {
      const w = segment.witnesses.find((x) => x.id === id);
      const where = placed[k]!;
      if (w && (w.units.length > 0 || w.present)) {
        present = true;
        for (const unit of w.units) units.push({ ...unit, segmentId: segment.segmentId });
      } else if (where.to > where.from) {
        const last = notThere[notThere.length - 1];
        if (last && last.to === where.from) last.to = where.to;
        else notThere.push({ from: where.from, to: where.to });
      }
    });
    const text: CollationText = { id, siglum: siglumOf.get(id)!, units };
    if (present) text.present = true;
    if (present && notThere.length > 0) text.notThere = notThere;
    return text;
  });
  return {
    base: { ...first.base, units: baseUnits },
    witnesses,
    segments: placed,
    segmentStarts: placed.filter((s) => s.printed).map((s) => s.from),
  };
}

/** A passage collated: its segments, where each begins, its inputs and its collation. */
export interface Passage extends PassageInputs {
  collation: Collation;
}

/** Collate a passage whole, the places over whole segments that a witness is without marked `wanting`. */
export function collatePassage(inputs: PassageInputs, options: CollationOptions = {}): Passage {
  return {
    ...inputs,
    collation: collate(inputs.base, inputs.witnesses, {
      ...options,
      segmentStarts: inputs.segmentStarts,
    }),
  };
}

/** The number of the base's units a collation was made over. */
function baseLength(collation: Collation): number {
  let n = 0;
  for (const column of collation.columns) if (column.cells.has(collation.baseId)) n++;
  return n;
}

/**
 * Link two neighbouring passages where a witness has a word in the one that
 * it is without in the other, as a collation links two places within its
 * own stretch: a word of the edition the witness has nothing for, and, in
 * the other passage, a word the witness adds where the edition has none,
 * with the same letters (accents aside, as the alignment places words),
 * within `farReach` of the edition's units of each other across the
 * boundary. The two sites the words stand in (the narrowest at which the
 * witness has a reading of its own) then name each other (`transposition`,
 * with `inPassage` the first segment of the other passage), so that the
 * witness has added nothing where it has the word (`additionIn`). The
 * nearest are linked first, each word once; a site already linked keeps its
 * link. Gives the two collations anew; the passages given are not changed.
 */
export function linkPassages(
  left: Pick<Passage, 'segments' | 'collation' | 'base' | 'witnesses'>,
  right: Pick<Passage, 'segments' | 'collation' | 'base' | 'witnesses'>,
  options: Pick<CollationOptions, 'farReach'> & {
    /** The edition's units in the passages between the two, where they are not neighbours. */
    between?: number;
  } = {},
): [Collation, Collation] {
  const farReach = options.farReach ?? FAR_REACH;
  const between = options.between ?? 0;
  const letters = (unit: Unit) => ({ ...unitFold(unit.lang), stripDiacritics: true });
  const leftId = left.segments[0]!.segmentId;
  const rightId = right.segments[0]!.segmentId;
  const one = { ...left.collation, sites: left.collation.sites.map((s) => ({ ...s })) };
  const other = { ...right.collation, sites: right.collation.sites.map((s) => ({ ...s })) };
  const n = baseLength(left.collation) + between;
  const unitKey = (u: Unit) => `${u.tokenIds.join(',')}|${u.text}`;

  /** A word of the edition a witness has nothing for, or a word it adds: its letters, where it stands, and its site. */
  interface Word {
    letters: string;
    /** The base's unit, or the point before which the word is added. */
    at: number;
    site: Site;
  }
  /** The words a witness is without (`added` false) or adds in a passage, each with the site that reports it. */
  const wordsOf = (
    passage: Pick<Passage, 'base' | 'witnesses'>,
    collation: Collation,
    textId: Id,
    added: boolean,
  ): Word[] => {
    const units = passage.witnesses.find((w) => w.id === textId)?.units ?? [];
    const out: Word[] = [];
    let slot = 0;
    let seen = false;
    for (const column of collation.columns) {
      const baseCell = column.cells.get(collation.baseId);
      const cell = column.cells.get(textId);
      if (cell) seen = true;
      if (baseCell) {
        const unit = passage.base.units[baseCell.unitIndex];
        if (!added && !cell && unit && !unit.gap) {
          const site = collation.sites.find(
            (s) =>
              s.baseFrom <= baseCell.unitIndex &&
              baseCell.unitIndex < s.baseTo &&
              s.readings.some((r) => !r.base && r.textIds.includes(textId)),
          );
          // A word within a stretch the witness has in another order has not left its place.
          const transposed =
            site?.transposition?.withSite === site?.index && !site?.transposition?.inPassage;
          if (site && !transposed)
            out.push({ letters: foldText(unit.text, letters(unit)), at: baseCell.unitIndex, site });
        }
        slot = baseCell.unitIndex + 1;
        continue;
      }
      if (!added || !cell || cell.lacunose || cell.unitIndex < 0) continue;
      const unit = units[cell.unitIndex];
      if (!unit || unit.gap) continue;
      const key = unitKey(unit);
      const site = collation.sites.find((s) =>
        s.readings.some((r) => !r.base && (r.units[textId] ?? []).some((u) => unitKey(u) === key)),
      );
      if (site) out.push({ letters: foldText(unit.text, letters(unit)), at: slot, site });
    }
    // A witness that stands in no column (one without any text of the passage) is without nothing here.
    return seen ? out : [];
  };

  interface Link {
    leftSite: Site;
    rightSite: Site;
    textId: Id;
    distance: number;
  }
  const links: Link[] = [];
  const ids = [...new Set([...left.witnesses, ...right.witnesses].map((w) => w.id))];
  for (const textId of ids) {
    // The word is without in the left passage and added in the right, or the reverse.
    for (const absenceLeft of [true, false]) {
      const missing = absenceLeft
        ? wordsOf(left, one, textId, false)
        : wordsOf(right, other, textId, false);
      const addedWords = absenceLeft
        ? wordsOf(right, other, textId, true)
        : wordsOf(left, one, textId, true);
      const pairs: { m: Word; a: Word; distance: number }[] = [];
      for (const m of missing)
        for (const a of addedWords) {
          if (m.letters !== a.letters) continue;
          const distance = absenceLeft ? n + a.at - m.at : n + m.at - a.at;
          if (distance <= farReach) pairs.push({ m, a, distance });
        }
      pairs.sort((x, y) => x.distance - y.distance || x.m.at - y.m.at || x.a.at - y.a.at);
      const used = new Set<Word>();
      for (const { m, a, distance } of pairs) {
        if (used.has(m) || used.has(a)) continue;
        used.add(m);
        used.add(a);
        links.push(
          absenceLeft
            ? { leftSite: m.site, rightSite: a.site, textId, distance }
            : { leftSite: a.site, rightSite: m.site, textId, distance },
        );
      }
    }
  }
  // The nearest first, so that the outcome does not depend on the order of the witnesses.
  links.sort(
    (x, y) =>
      x.distance - y.distance ||
      x.leftSite.index - y.leftSite.index ||
      x.rightSite.index - y.rightSite.index ||
      (x.textId < y.textId ? -1 : x.textId > y.textId ? 1 : 0),
  );
  const partner = new Map<Site, { site: Site; passage: Id }>();
  const textIds = new Map<Site, Id[]>();
  for (const link of links) {
    const pairs: [Site, Site, Id][] = [
      [link.leftSite, link.rightSite, rightId],
      [link.rightSite, link.leftSite, leftId],
    ];
    // A site with a link of its own, or to another site, keeps it.
    const free = pairs.every(([site, to]) => {
      const known = partner.get(site);
      if (known) return known.site === to;
      return !site.transposition;
    });
    if (!free) continue;
    for (const [site, to, passage] of pairs) {
      partner.set(site, { site: to, passage });
      const list = textIds.get(site) ?? [];
      if (!list.includes(link.textId)) list.push(link.textId);
      textIds.set(site, list);
    }
  }
  for (const [site, { site: to, passage }] of partner) {
    const list = textIds.get(site)!;
    // In the order the readings name the witnesses.
    const order = site.readings.flatMap((r) => r.textIds);
    list.sort((x, y) => order.indexOf(x) - order.indexOf(y));
    site.transposition = { withSite: to.index, textIds: list, inPassage: passage };
  }
  return [one, other];
}

/**
 * The segments a site's words lie in, in the order of the passage: those of
 * the base's units it covers; at a point, those the witnesses give the
 * words they have there, or, where none does, the segment of the base's
 * unit before the point (after it, at the very start). For labelling a site
 * "1.5" or "1.5–1.6".
 */
export function siteSegments(site: Site, baseUnits: readonly Unit[]): Id[] {
  const out: Id[] = [];
  const add = (id: Id | undefined) => {
    if (id !== undefined && !out.includes(id)) out.push(id);
  };
  if (site.baseTo > site.baseFrom) {
    for (let i = site.baseFrom; i < site.baseTo; i++) add(baseUnits[i]?.segmentId);
    return out;
  }
  for (const reading of site.readings)
    if (!reading.base)
      for (const units of Object.values(reading.units)) for (const u of units) add(u.segmentId);
  if (out.length === 0) add((baseUnits[site.baseFrom - 1] ?? baseUnits[site.baseFrom])?.segmentId);
  return out;
}

// ---------------------------------------------------------------------------
// The whole of it, from streams

/** A text to collate: an edition or a transcript, read in a state. */
export interface StreamText {
  id: Id;
  siglum: string;
  stream: Stream;
  state?: CollationState;
}

export interface CollatePassagesOptions extends CollationOptions, PassageOptions {
  /**
   * The sort key of every segment in the work's numbering, which places a
   * segment the edition does not print after the edition's segment before
   * it, and gives each witness the stretch it covers. The id itself where
   * a segment has none.
   */
  segmentKeys?: ReadonlyMap<Id, string>;
}

export interface CollatedPassages {
  /** The passages in the edition's order, each collated, neighbours linked. */
  passages: Passage[];
  /** Each of the edition's segments collated alone, from which the passages were planned. */
  alone: Map<Id, Collation>;
}

/**
 * Collate an edition against its witnesses in passages, as the server does
 * with its cache between the steps: every segment of the edition collated
 * alone; the passages planned from that; each passage collated whole; and
 * neighbouring passages linked.
 *
 * The edition's segments are taken in the order they first appear in its
 * stream. A segment some witness has and the edition does not print stands
 * in the passage of the edition's segment that precedes it in the work's
 * numbering, its words after that segment's, when it lies between the first
 * and the last segment the edition prints. A witness whose stream has no
 * text for a segment of the edition runs on without it where the segment
 * lies between the first and the last segment it has, and is not there for
 * it elsewhere.
 */
export function collatePassages(
  edition: StreamText,
  witnesses: readonly StreamText[],
  options: CollatePassagesOptions = {},
): CollatedPassages {
  const keyOf = (id: Id) => options.segmentKeys?.get(id) ?? id;
  const index = new Map<Id, Map<Id, SegmentRun[]>>();
  for (const text of [edition, ...witnesses]) index.set(text.id, runsBySegment(text.stream));
  const editionRuns = index.get(edition.id)!;
  const order = [...editionRuns.keys()];
  const printed = new Set(order);
  const hasWords = (text: StreamText, runs: SegmentRun[]) =>
    runs.some((run) => {
      for (let i = run.from; i < run.to; i++)
        if (text.stream.items[i]!.kind === 'token') return true;
      return false;
    });

  // The segments the edition does not print, after the edition's segment before each in the numbering.
  const byKey = [...order].sort((a, b) => compare(keyOf(a), keyOf(b)));
  const following = new Map<Id, Id[]>();
  if (byKey.length >= 2) {
    const firstKey = keyOf(byKey[0]!);
    const lastKey = keyOf(byKey[byKey.length - 1]!);
    const found = new Set<Id>();
    for (const w of witnesses)
      for (const [segmentId, runs] of index.get(w.id)!) {
        if (printed.has(segmentId) || found.has(segmentId)) continue;
        const key = keyOf(segmentId);
        if (key <= firstKey || key >= lastKey || !hasWords(w, runs)) continue;
        found.add(segmentId);
      }
    for (const segmentId of [...found].sort((a, b) => compare(keyOf(a), keyOf(b)))) {
      const key = keyOf(segmentId);
      let after = byKey[0]!;
      for (const id of byKey) if (keyOf(id) < key) after = id;
      following.set(after, [...(following.get(after) ?? []), segmentId]);
    }
  }

  // The stretch of the work each witness covers, by sort key.
  const span = new Map<Id, { first: string; last: string }>();
  for (const w of witnesses) {
    const keys = [...index.get(w.id)!.entries()]
      .filter(([, runs]) => hasWords(w, runs))
      .map(([id]) => keyOf(id))
      .sort(compare);
    if (keys.length > 0) span.set(w.id, { first: keys[0]!, last: keys[keys.length - 1]! });
  }

  const inputsOf = (segmentId: Id, unprinted: boolean): SegmentInputs => {
    const own = (text: StreamText) =>
      runUnits(text.stream, index.get(text.id)!.get(segmentId) ?? [], text.state).units;
    const base: CollationText = {
      id: edition.id,
      siglum: edition.siglum,
      units: unprinted ? [] : own(edition),
    };
    const texts: CollationText[] = [];
    for (const w of witnesses) {
      const runs = index.get(w.id)!.get(segmentId);
      if (runs) {
        texts.push({ id: w.id, siglum: w.siglum, units: own(w), present: true });
        continue;
      }
      if (unprinted) continue;
      const covered = span.get(w.id);
      const key = keyOf(segmentId);
      const runsOn = covered !== undefined && key > covered.first && key < covered.last;
      texts.push({ id: w.id, siglum: w.siglum, units: [], ...(runsOn ? { present: true } : {}) });
    }
    return { segmentId, base, witnesses: texts, ...(unprinted ? { unprinted: true } : {}) };
  };

  const joins = new Map<Id, Map<Id, Set<Id>>>();
  for (const text of [edition, ...witnesses]) joins.set(text.id, segmentsJoined(text.stream));
  const joined = (textId: Id, a: Id, b: Id) =>
    joins.get(textId)!.get(a)?.has(b) === true || joins.get(textId)!.get(b)?.has(a) === true;

  const alone = new Map<Id, Collation>();
  const inputs = new Map<Id, SegmentInputs>();
  const facts: SegmentAlone[] = order.map((segmentId, k) => {
    const own = inputsOf(segmentId, false);
    inputs.set(segmentId, own);
    for (const u of following.get(segmentId) ?? []) inputs.set(u, inputsOf(u, true));
    const collation = collate(own.base, [...own.witnesses], options);
    alone.set(segmentId, collation);
    const next = order[k + 1];
    const after = following.get(segmentId) ?? [];
    const dividedIntoNext =
      next === undefined
        ? []
        : [edition, ...witnesses]
            .filter((t) => [segmentId, ...after].some((s) => joined(t.id, s, next)))
            .map((t) => t.id);
    const unprintedAfter = witnesses
      .filter((w) =>
        after.some((u) =>
          inputs.get(u)!.witnesses.some((x) => x.id === w.id && x.units.some((v) => !v.gap)),
        ),
      )
      .map((w) => w.id);
    return {
      segmentId,
      baseUnits: own.base.units.length,
      witnesses: own.witnesses,
      collation,
      ...(dividedIntoNext.length ? { dividedIntoNext } : {}),
      ...(unprintedAfter.length ? { unprintedAfter } : {}),
    };
  });

  const passages = planPassages(facts, options).map((segmentIds) =>
    collatePassage(
      passageInputs(
        segmentIds.flatMap((id) => [
          inputs.get(id)!,
          ...(following.get(id) ?? []).map((u) => inputs.get(u)!),
        ]),
      ),
      options,
    ),
  );
  linkAll(passages, options);
  return { passages, alone };
}

/**
 * Link every two passages that lie within `farReach` of each other
 * (`linkPassages`), neighbours first and then those farther apart, so that
 * a word a witness has moved past a short passage is linked too. Changes the
 * passages' collations in place.
 */
export function linkAll(
  passages: Pick<Passage, 'segments' | 'collation' | 'base' | 'witnesses'>[],
  options: Pick<CollationOptions, 'farReach'> = {},
): void {
  const farReach = options.farReach ?? FAR_REACH;
  for (let gap = 1; gap < passages.length; gap++)
    for (let k = 0; k + gap < passages.length; k++) {
      let between = 0;
      for (let j = k + 1; j < k + gap; j++) between += passages[j]!.base.units.length;
      if (between > farReach) continue;
      const [one, other] = linkPassages(passages[k]!, passages[k + gap]!, { ...options, between });
      passages[k]!.collation = one;
      passages[k + gap]!.collation = other;
    }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
