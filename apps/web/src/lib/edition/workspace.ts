/**
 * Pure helpers of the edition editor: which segments are on show, which an
 * edit touched, the sites of a free selection or an insertion point, the
 * index from witness words to sites, and the classes the text editor puts
 * on the edition's words.
 */
import {
  lineationsAt,
  printPlace,
  segmentAt,
  segmentIds as segmentIdsOf,
  siteTokenIds,
  touchedIds,
  type Id,
  type Item,
  type Lineation,
  type Op,
  type Reading,
  type Site,
  type Stream,
  type Token,
  newId,
} from '@varians/core';
import { isReviewedIn, type SegmentOutline, type SiteOutline } from './outline.ts';
import type { ActiveSite, SegmentViewClient } from './types.ts';

/** The segments of the stream in the edition's order. */
export function segmentOrder(stream: Stream): Id[] {
  return segmentIdsOf(stream);
}

/** How many segments each side of the active one are on show. */
export const WINDOW_RADIUS = 8;

/** How many segments the editor opens with: the window around the first. */
export const OPENING_SEGMENTS = WINDOW_RADIUS * 2 + 1;

/** A window of segment ids around the active one: `radius` before and after. */
export function segmentWindow(order: Id[], active: Id | null, radius = WINDOW_RADIUS): Id[] {
  if (order.length === 0) return [];
  const at = active ? Math.max(0, order.indexOf(active)) : 0;
  const from = Math.max(0, at - radius);
  const to = Math.min(order.length, from + radius * 2 + 1);
  return order.slice(Math.max(0, to - (radius * 2 + 1)), to);
}

/**
 * The items of the stream from the first word of the segments on show to the
 * last, which is all the edition's text a variant of those segments quotes
 * (the words, and the lacuna marks among them). Scanning once and indexing
 * only this stretch keeps what an edit costs the band small in a long text.
 */
export function itemsAround(
  stream: Stream,
  segments: readonly Pick<SegmentViewClient, 'baseUnits'>[],
): Item[] {
  const wanted = new Set<Id>();
  for (const segment of segments)
    for (const unit of segment.baseUnits) for (const id of unit.tokenIds) wanted.add(id);
  let from = -1;
  let to = -1;
  stream.items.forEach((item, i) => {
    if (!wanted.has(item.id)) return;
    if (from < 0) from = i;
    to = i;
  });
  return from < 0 ? [] : stream.items.slice(from, to + 1);
}

/** The segment an item belongs to, by id; null when it is unassigned or unknown. */
export function segmentOfItem(stream: Stream, id: Id): Id | null {
  const index = stream.items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return segmentAt(stream, index)?.segmentId ?? null;
}

/** The segments an edit touched: looked up in the stream before the edit and after it. */
export function segmentsTouched(before: Stream, after: Stream, ops: Op[]): Id[] {
  const out = new Set<Id>();
  for (const op of ops) {
    for (const id of touchedIds(op)) {
      const segment = segmentOfItem(after, id) ?? segmentOfItem(before, id);
      if (segment) out.add(segment);
    }
  }
  return [...out];
}

/** Unit indexes of the segment's base units that carry any of the tokens. */
function unitRange(
  segment: SegmentViewClient,
  tokenIds: Id[],
): { from: number; to: number } | null {
  const wanted = new Set(tokenIds);
  let from = -1;
  let to = -1;
  segment.baseUnits.forEach((unit, index) => {
    if (unit.tokenIds.some((id) => wanted.has(id))) {
      if (from < 0) from = index;
      to = index + 1;
    }
  });
  return from < 0 ? null : { from, to };
}

/**
 * A site over a free selection of the edition's words, for registering and
 * adopting a conjecture there. The site of witnesses lacking the whole
 * segment is taken only for a selection of the whole segment.
 */
export function siteForTokens(segment: SegmentViewClient, tokenIds: Id[]): Site | null {
  const covering = segment.collation.sites.find((site) => {
    const ids = new Set(siteTokenIds(site, segment.baseUnits));
    if (site.wanting && ids.size !== new Set(tokenIds).size) return false;
    return tokenIds.length > 0 && tokenIds.every((id) => ids.has(id));
  });
  if (covering) return covering;
  const range = unitRange(segment, tokenIds);
  if (!range) return null;
  return {
    index: -1,
    columnFrom: 0,
    columnTo: 0,
    baseFrom: range.from,
    baseTo: range.to,
    readings: [],
    kind: 'textual',
  };
}

/** An insertion point after a word of the edition (or at the segment's start when null). */
export function insertionSite(segment: SegmentViewClient, afterTokenId: Id | null): Site {
  let at = 0;
  if (afterTokenId) {
    const range = unitRange(segment, [afterTokenId]);
    at = range ? range.to : segment.baseUnits.length;
  }
  const existing = segment.collation.sites.find((s) => s.baseFrom === at && s.baseTo === at);
  return (
    existing ?? {
      index: -1,
      columnFrom: 0,
      columnTo: 0,
      baseFrom: at,
      baseTo: at,
      readings: [],
      kind: 'textual',
    }
  );
}

export interface WitnessWord {
  segmentId: Id;
  site: Site;
  reading: Reading;
  textId: Id;
}

/** Witness token id to the site and reading it stands in, over the segments given. */
export function witnessIndex(segments: Iterable<SegmentViewClient>): Map<Id, WitnessWord> {
  const out = new Map<Id, WitnessWord>();
  for (const segment of segments) {
    for (const site of segment.collation.sites) {
      for (const reading of site.readings) {
        if (reading.base) continue;
        for (const textId of reading.textIds) {
          for (const unit of reading.units[textId] ?? []) {
            for (const tokenId of unit.tokenIds)
              out.set(tokenId, { segmentId: segment.segmentId, site, reading, textId });
          }
        }
      }
    }
  }
  return out;
}

/** The witness tokens of one text at a site: what to light in the witness pane. */
export function witnessTokensAt(site: Site, textId: Id): Id[] {
  for (const reading of site.readings) {
    if (!reading.textIds.includes(textId)) continue;
    return (reading.units[textId] ?? []).flatMap((unit) => unit.tokenIds);
  }
  return [];
}

/** Whether a site deserves a mark in the text: a different reading or something attached, unless the editor judges the variant minor. */
export function siteShows(segment: Pick<SegmentViewClient, 'attachments'>, site: Site): boolean {
  if (site.minor) return false;
  if ((segment.attachments[site.index] ?? []).length > 0) return true;
  return site.readings.some((r) => !r.base);
}

export interface ClassOptions {
  active: ActiveSite | null;
  /** Tint the words the edition took from a conjecture or typed itself. */
  colourBySource?: boolean;
  stream?: Stream;
}

/** Classes for the edition's words: variant sites dotted, the active site lit, sources tinted on request. */
export function tokenClassesFor(
  outlines: Iterable<SegmentOutline>,
  options: ClassOptions,
): Record<Id, string> {
  const out: Record<Id, string> = {};
  const add = (id: Id, className: string) => {
    out[id] = out[id] ? `${out[id]} ${className}` : className;
  };
  const all = [...outlines];
  for (const outline of all) {
    for (const site of outline.sites) {
      const active =
        options.active?.segmentId === outline.segmentId && options.active.siteIndex === site.index;
      for (const id of site.tokens) {
        add(id, 'vs-site');
        if (active) add(id, 'vs-active');
      }
    }
  }
  for (const outline of all) for (const id of outline.drift) add(id, 'vs-drift');
  if (options.colourBySource && options.stream) {
    for (const item of options.stream.items) {
      if (item.kind !== 'token' || !item.source) continue;
      if (item.source.kind === 'conjecture') add(item.id, 'vs-conjecture');
      else if (item.source.kind === 'editor') add(item.id, 'vs-editor');
    }
  }
  return out;
}

/** The active site for a selection: the site covering the caret's (or first selected) word. */
export function activeSiteFor(
  segments: Iterable<SegmentViewClient>,
  tokenIds: Id[],
  caret: Id | null,
): ActiveSite | null {
  const wanted = caret ? [caret, ...tokenIds] : tokenIds;
  for (const segment of segments) {
    for (const site of segment.collation.sites) {
      const ids = new Set(siteTokenIds(site, segment.baseUnits));
      // The site of a witness lacking the segment is the caret's only when the whole segment is selected.
      if (site.wanting && !(tokenIds.length > 0 && [...ids].every((id) => tokenIds.includes(id))))
        continue;
      if (wanted.some((id) => ids.has(id)))
        return { segmentId: segment.segmentId, siteIndex: site.index };
    }
  }
  return null;
}

export interface SiteRef {
  /** The passage's first segment. */
  segmentId: Id;
  site: SiteOutline;
}

/**
 * Where a place stands in the text, for putting places in order: the
 * position of the segment its words begin in among the edition's segments,
 * and for a segment the edition does not print, just after the segment it
 * stands after. Null for a place none of whose segments is in the text.
 */
function standing(site: SiteOutline, position: ReadonlyMap<Id, number>): number | null {
  if (site.unprinted) {
    const after = position.get(site.unprinted.after);
    return after === undefined ? null : after + 0.5;
  }
  for (const id of site.segments) {
    const at = position.get(id);
    if (at !== undefined) return at;
  }
  return null;
}

/**
 * Every place that shows, in the order of the text: by the passages, in the
 * order of their segments, and within a passage by where the words stand.
 * A passage none of whose segments is in the text any more is left out.
 */
export function sitesInOrder(order: Id[], outlines: Record<Id, SegmentOutline>): SiteRef[] {
  const position = new Map(order.map((id, i) => [id, i] as const));
  const ranked: { ref: SiteRef; at: number; k: number }[] = [];
  for (const outline of Object.values(outlines)) {
    const first = outline.segments.find((s) => s.printed && position.has(s.segmentId));
    if (!first) continue;
    const base = position.get(first.segmentId)!;
    outline.sites.forEach((site, k) =>
      ranked.push({ ref: { segmentId: outline.segmentId, site }, at: base, k }),
    );
  }
  ranked.sort((a, b) => a.at - b.at || a.k - b.k);
  return ranked.map((r) => r.ref);
}

/**
 * The segment of the text a segment stands at: itself, or for one the
 * edition does not print, the segment it stands after, as the outlines say.
 */
export function placeInText(
  order: Id[],
  outlines: Record<Id, SegmentOutline>,
  segmentId: Id | null,
): Id | null {
  if (segmentId === null || order.includes(segmentId)) return segmentId;
  for (const outline of Object.values(outlines))
    for (const site of outline.sites)
      if (site.unprinted?.segmentId === segmentId) return site.unprinted.after;
  return segmentId;
}

/** The segments on show around a segment: `radius` of the text's each way; around one the edition does not print, the window of the segment it follows. */
export function windowAround(
  order: Id[],
  outlines: Record<Id, SegmentOutline>,
  centre: Id | null,
  radius = WINDOW_RADIUS,
): Id[] {
  return segmentWindow(order, placeInText(order, outlines, centre), radius);
}

/**
 * Where the mark of a segment the edition does not print stands in the
 * text: after the item the line would be printed after (`printPlace`), for
 * each such variant that shows. In the order of the text. Where that item
 * stands in a prose paragraph (`convention` is the edition's kind of a
 * paragraph that is not marked) the mark is the point after it, in the text;
 * in verse it stands between two lines, in the margin.
 */
export function unprintedMarks(
  stream: Stream,
  order: Id[],
  outlines: Record<Id, SegmentOutline>,
  convention: Lineation = 'verse',
): { passage: Id; segmentId: Id; after: Id; site: SiteOutline; inText: boolean }[] {
  const found: { passage: Id; segmentId: Id; after: Id; site: SiteOutline }[] = [];
  for (const ref of sitesInOrder(order, outlines)) {
    const unprinted = ref.site.unprinted;
    if (!unprinted) continue;
    const place = printPlace(stream, unprinted.after);
    if (place)
      found.push({
        passage: ref.segmentId,
        segmentId: unprinted.segmentId,
        after: place,
        site: ref.site,
      });
  }
  const kinds = lineationsAt(stream.items, new Set(found.map((mark) => mark.after)), convention);
  return found.map((mark) => ({ ...mark, inText: kinds.get(mark.after) === 'prose' }));
}

/** The next (or previous) site from the active one; with `unreviewedOnly`, skipping reviewed ones. */
export function stepSite(
  order: Id[],
  outlines: Record<Id, SegmentOutline>,
  active: ActiveSite | null,
  direction: 1 | -1,
  reviewed: Record<Id, string[]>,
  unreviewedOnly = false,
  /** The segment the caret is in: where the step starts when no place is open. */
  from?: Id | null,
): SiteRef | null {
  const all = sitesInOrder(order, outlines);
  if (all.length === 0) return null;
  let at = active
    ? all.findIndex((r) => r.segmentId === active.segmentId && r.site.index === active.siteIndex)
    : -1;
  if (at < 0 && from) {
    // No place is open: the next one is the first in the caret's segment or after it, the previous
    // one the last before it, and not the first or last of the whole text.
    const position = new Map(order.map((id, i) => [id, i] as const));
    const here = position.get(placeInText(order, outlines, from) ?? from);
    if (here !== undefined) {
      const first = all.findIndex((r) => (standing(r.site, position) ?? -1) >= here);
      if (direction === 1) at = first < 0 ? all.length - 1 : first - 1;
      else at = first < 0 ? all.length : first;
    }
  }
  const sets = new Map(Object.entries(reviewed).map(([id, keys]) => [id, new Set(keys)] as const));
  const isDone = (ref: SiteRef) => {
    const outline = outlines[ref.segmentId];
    return outline ? isReviewedIn(outline, ref.site.key, sets) : false;
  };
  for (let step = 1; step <= all.length; step++) {
    const index =
      at < 0
        ? direction === 1
          ? step - 1
          : all.length - step
        : (at + direction * step + all.length * step) % all.length;
    const ref = all[index]!;
    if (!unreviewedOnly || !isDone(ref)) return ref;
  }
  return null;
}

/** Ids of the items an operation list brings in (inserted or replacing). */
export function insertedIds(ops: Op[]): Id[] {
  const out: Id[] = [];
  for (const op of ops) {
    if (op.t === 'insert' || op.t === 'replace') for (const item of op.items) out.push(item.id);
  }
  return out;
}

/**
 * Operations moving the lines that hold the given tokens one line up or
 * down: a transposition of whole lines. The lines' items keep their ids, so
 * their words keep their sources and their segment starts; the breaks stay
 * where they were, as separators.
 */
export function moveLinesOps(stream: Stream, tokenIds: Id[], direction: -1 | 1): Op[] {
  const all = linesOfStream(stream);
  if (all.length < 2 || tokenIds.length === 0) return [];
  const wanted = new Set(tokenIds);
  let first = -1;
  let last = -1;
  all.forEach((line, index) => {
    for (let i = line.from; i < line.to; i++) {
      if (wanted.has(stream.items[i]!.id)) {
        if (first < 0) first = index;
        last = index;
        break;
      }
    }
  });
  if (first < 0) return [];
  if (direction === -1 && first === 0) return [];
  if (direction === 1 && last === all.length - 1) return [];
  const lo = direction === -1 ? first - 1 : first;
  const hi = direction === -1 ? last : last + 1;
  const contents = all.slice(lo, hi + 1).map((line) => stream.items.slice(line.from, line.to));
  const reordered =
    direction === -1
      ? [...contents.slice(1), contents[0]!]
      : [contents[contents.length - 1]!, ...contents.slice(0, -1)];
  // The breaks between the lines of the range, in place.
  const breaks = all.slice(lo + 1, hi + 1).map((line) => stream.items[line.from - 1]!);
  const items = reordered.flatMap((content, k) =>
    k < breaks.length ? [...content, breaks[k]!] : content,
  );
  const from = all[lo]!.from;
  const to = all[hi]!.to;
  const ids = stream.items.slice(from, to).map((item) => item.id);
  if (ids.length === 0) return [];
  return [{ t: 'replace', ids, items }];
}

/** The lines of a stream as item ranges (breaks excluded). */
function linesOfStream(stream: Stream): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from = 0;
  stream.items.forEach((item, index) => {
    if (item.kind === 'break') {
      out.push({ from, to: index });
      from = index + 1;
    }
  });
  out.push({ from, to: stream.items.length });
  return out;
}

/**
 * Words the editor typed over become the editor's: a change of letters in a
 * word taken from a witness or a conjecture makes its source the editor, so
 * that the edition never credits a witness with an emendation. Splitting and
 * joining keep the letters, and with them the source. Returns the extra
 * operations to send with the editor's own.
 */
export function claimTypedWords(before: Stream, ops: Op[]): Op[] {
  const byId = new Map(before.items.map((item) => [item.id, item] as const));
  const claimed = new Set<Id>();
  const out: Op[] = [];
  for (const op of ops) {
    if (op.t !== 'set' || claimed.has(op.id) || 'source' in op.fields) continue;
    const item = byId.get(op.id);
    if (!item || item.kind !== 'token' || !item.source || item.source.kind === 'editor') continue;
    const form = op.fields.form;
    const norm = op.fields.norm;
    const lettersChanged =
      (typeof form === 'string' && form !== item.form) ||
      (typeof norm === 'string' && norm !== (item.norm ?? item.form));
    if (!lettersChanged) continue;
    claimed.add(op.id);
    out.push({ t: 'set', id: op.id, fields: { source: { kind: 'editor' } } });
  }
  return out;
}

/**
 * Take a witness's current reading for a word the edition took from it:
 * the word gets the witness's present read form, as one word or
 * several, keeping its source, its segment start and its place. A word the
 * edition keeps divided is taken whole in its first part, the parts after it
 * going (a segment one of them began begins at the next word). Nothing when
 * the witness no longer has the word: that is a matter for the apparatus.
 */
export function takeCurrentOps(
  stream: Stream,
  drift: { tokenId: Id; now: string },
  ids: () => Id = newId,
): Op[] {
  const index = stream.items.findIndex((item) => item.id === drift.tokenId);
  const token = stream.items[index];
  if (!token || token.kind !== 'token') return [];
  const parts = drift.now.split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return [];
  // The parts of a divided word that follow this one.
  const later: Token[] = [];
  let end = index;
  for (let last: Token = token, i = index + 1; last.joinNext && i < stream.items.length; i++) {
    const next = stream.items[i]!;
    if (next.kind === 'break') continue;
    if (next.kind !== 'token') break;
    later.push(next);
    last = next;
    end = i;
  }
  const dropped: Op[] = [];
  if (later.length) {
    dropped.push({ t: 'delete', ids: later.map((part) => part.id) });
    const carried = later.findLast((part) => part.segment)?.segment;
    const next = stream.items.slice(end + 1).find((item) => item.kind !== 'break');
    if (carried && next && !next.segment)
      dropped.push({ t: 'set', id: next.id, fields: { segment: carried } });
  }
  if (parts.length === 1) {
    if (parts[0] === token.form && !later.length) return [];
    // Whole, the word is no longer divided: no part follows to join.
    const fields: Record<string, unknown> = { form: parts[0]! };
    if (later.length) fields.joinNext = null;
    return [{ t: 'set', id: token.id, fields }, ...dropped];
  }
  const items: Token[] = parts.map((form, i) => {
    const next: Token = { kind: 'token', id: i === 0 ? token.id : ids(), form };
    // The parts keep the language of the word they come from.
    if (token.lang !== undefined) next.lang = token.lang;
    if (token.source) next.source = token.source;
    if (i === 0 && token.segment) next.segment = token.segment;
    return next;
  });
  return [{ t: 'replace', ids: [token.id], items }, ...dropped];
}
