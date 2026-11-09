/**
 * Pure helpers of the edition editor: which segments are on show, which an
 * edit touched, the sites of a free selection or an insertion point, the
 * index from witness words to sites, and the classes the text editor puts
 * on the edition's words.
 */
import {
  segmentAt,
  segmentIds as segmentIdsOf,
  siteKey,
  siteTokenIds,
  touchedIds,
  type Id,
  type Op,
  type Reading,
  type Site,
  type Stream,
  type Token,
  newId,
} from '@varians/core';
import type { ActiveSite, SegmentViewClient } from './types.ts';

/** The segments of the stream in the edition's order. */
export function segmentOrder(stream: Stream): Id[] {
  return segmentIdsOf(stream);
}

/** A window of segment ids around the active one: `radius` before and after. */
export function segmentWindow(order: Id[], active: Id | null, radius = 8): Id[] {
  if (order.length === 0) return [];
  const at = active ? Math.max(0, order.indexOf(active)) : 0;
  const from = Math.max(0, at - radius);
  const to = Math.min(order.length, from + radius * 2 + 1);
  return order.slice(Math.max(0, to - (radius * 2 + 1)), to);
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
function unitRange(segment: SegmentViewClient, tokenIds: Id[]): { from: number; to: number } | null {
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

/** A site over a free selection of the edition's words, for registering and adopting a conjecture there. */
export function siteForTokens(segment: SegmentViewClient, tokenIds: Id[]): Site | null {
  const covering = segment.collation.sites.find((site) => {
    const ids = new Set(siteTokenIds(site, segment.baseUnits));
    return tokenIds.length > 0 && tokenIds.every((id) => ids.has(id));
  });
  if (covering) return covering;
  const range = unitRange(segment, tokenIds);
  if (!range) return null;
  return { index: -1, columnFrom: 0, columnTo: 0, baseFrom: range.from, baseTo: range.to, readings: [], kind: 'textual' };
}

/** An insertion point after a word of the edition (or at the segment's start when null). */
export function insertionSite(segment: SegmentViewClient, afterTokenId: Id | null): Site {
  let at = 0;
  if (afterTokenId) {
    const range = unitRange(segment, [afterTokenId]);
    at = range ? range.to : segment.baseUnits.length;
  }
  const existing = segment.collation.sites.find((s) => s.baseFrom === at && s.baseTo === at);
  return existing ?? { index: -1, columnFrom: 0, columnTo: 0, baseFrom: at, baseTo: at, readings: [], kind: 'textual' };
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
            for (const tokenId of unit.tokenIds) out.set(tokenId, { segmentId: segment.segmentId, site, reading, textId });
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

/** Whether a site deserves a mark in the text: a different reading or something attached. */
export function siteShows(segment: SegmentViewClient, site: Site): boolean {
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
export function tokenClassesFor(segments: Iterable<SegmentViewClient>, options: ClassOptions): Record<Id, string> {
  const out: Record<Id, string> = {};
  const add = (id: Id, className: string) => {
    out[id] = out[id] ? `${out[id]} ${className}` : className;
  };
  for (const segment of segments) {
    for (const site of segment.collation.sites) {
      if (!siteShows(segment, site)) continue;
      const active = options.active?.segmentId === segment.segmentId && options.active.siteIndex === site.index;
      for (const id of siteTokenIds(site, segment.baseUnits)) {
        add(id, 'vs-site');
        if (active) add(id, 'vs-active');
      }
    }
  }
  for (const segment of segments) for (const d of segment.drift ?? []) add(d.tokenId, 'vs-drift');
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
export function activeSiteFor(segments: Iterable<SegmentViewClient>, tokenIds: Id[], caret: Id | null): ActiveSite | null {
  const wanted = caret ? [caret, ...tokenIds] : tokenIds;
  for (const segment of segments) {
    for (const site of segment.collation.sites) {
      const ids = new Set(siteTokenIds(site, segment.baseUnits));
      if (wanted.some((id) => ids.has(id))) return { segmentId: segment.segmentId, siteIndex: site.index };
    }
  }
  return null;
}

export interface SiteRef {
  segmentId: Id;
  site: Site;
}

/** Every site that shows, in the edition's order. */
export function sitesInOrder(order: Id[], views: Record<Id, SegmentViewClient>): SiteRef[] {
  const out: SiteRef[] = [];
  for (const segmentId of order) {
    const segment = views[segmentId];
    if (!segment) continue;
    const sites = segment.collation.sites
      .filter((site) => siteShows(segment, site))
      .sort((a, b) => a.baseFrom - b.baseFrom || a.baseTo - b.baseTo);
    for (const site of sites) out.push({ segmentId, site });
  }
  return out;
}

/** The next (or previous) site from the active one; with `unreviewedOnly`, skipping reviewed ones. */
export function stepSite(
  order: Id[],
  views: Record<Id, SegmentViewClient>,
  active: ActiveSite | null,
  direction: 1 | -1,
  reviewed: Record<Id, string[]>,
  unreviewedOnly = false,
): SiteRef | null {
  const all = sitesInOrder(order, views);
  if (all.length === 0) return null;
  const at = active ? all.findIndex((r) => r.segmentId === active.segmentId && r.site.index === active.siteIndex) : -1;
  const isDone = (ref: SiteRef) => (reviewed[ref.segmentId] ?? []).includes(siteKey(ref.site, views[ref.segmentId]!.baseUnits));
  for (let step = 1; step <= all.length; step++) {
    const index = at < 0 ? (direction === 1 ? step - 1 : all.length - step) : (at + direction * step + all.length * step) % all.length;
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
  const reordered = direction === -1 ? [...contents.slice(1), contents[0]!] : [contents[contents.length - 1]!, ...contents.slice(0, -1)];
  // The breaks between the lines of the range, in place.
  const breaks = all.slice(lo + 1, hi + 1).map((line) => stream.items[line.from - 1]!);
  const items = reordered.flatMap((content, k) => (k < breaks.length ? [...content, breaks[k]!] : content));
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
    const lettersChanged = (typeof form === 'string' && form !== item.form) || (typeof norm === 'string' && norm !== (item.norm ?? item.form));
    if (!lettersChanged) continue;
    claimed.add(op.id);
    out.push({ t: 'set', id: op.id, fields: { source: { kind: 'editor' } } });
  }
  return out;
}

/**
 * Take a witness's current reading for a word the edition took from it
 * (PLAN 4.7): the word gets the witness's present read form, as one word or
 * several, keeping its source, its segment start and its place. Nothing when
 * the witness no longer has the word: that is a matter for the apparatus.
 */
export function takeCurrentOps(stream: Stream, drift: { tokenId: Id; now: string }, ids: () => Id = newId): Op[] {
  const token = stream.items.find((item) => item.id === drift.tokenId);
  if (!token || token.kind !== 'token') return [];
  const parts = drift.now.split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0] === token.form ? [] : [{ t: 'set', id: token.id, fields: { form: parts[0]! } }];
  const items: Token[] = parts.map((form, i) => {
    const next: Token = { kind: 'token', id: i === 0 ? token.id : ids(), form };
    if (token.source) next.source = token.source;
    if (i === 0 && token.segment) next.segment = token.segment;
    return next;
  });
  return [{ t: 'replace', ids: [token.id], items }];
}
