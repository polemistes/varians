/**
 * Variant sites as the reader uses them: which words of the text stand at
 * which site, the entries the apparatus prints under the reader's settings,
 * and which words of a witness a site's reading was read from.
 */
import {
  apparatusEntries,
  siteTokenIds,
  trimPunctuation,
  type ApparatusConventions,
  type ApparatusEntry,
  type Attachment,
  type Collation,
  type Site,
  type Unit,
} from '@varians/core';

/**
 * The order of sigla in the apparatus: the conspectus, each witness followed
 * by its further states and the variants it notes, where collated.
 */
export function siglaOrderOf(
  sigla: { siglum: string; states?: { siglum: string }[] | null; variantSiglum?: string | null }[],
): string[] {
  return sigla.flatMap((s) =>
    [s.siglum, ...(s.states ?? []).map((x) => x.siglum), s.variantSiglum].filter(
      (x): x is string => !!x,
    ),
  );
}

/** A site of a segment, as the words of the text point at it. */
export interface SiteRef {
  segmentId: string;
  siteIndex: number;
}

/** The parts of a segment view this module reads. */
export interface SegmentSites {
  segmentId: string;
  label: string;
  /** Only the sites are read; a collation without its columns will do. */
  collation: Pick<Collation, 'sites'>;
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
}

/** What the minor variants of a segment concern: its sites, what is attached to them, how their readings stand to the edition's words. */
interface MinorSegment {
  collation: Pick<Collation, 'sites'>;
  attachments: Record<number, Attachment[]>;
}

/**
 * A segment without its minor variants: their sites and what was attached to
 * them. What a reader's page works with unless the reader asks for them.
 */
export function withoutMinor<T extends MinorSegment>(segment: T): T {
  const left = new Set(segment.collation.sites.filter((s) => s.minor).map((s) => s.index));
  if (left.size === 0) return segment;
  const kept = <V>(record: Record<number, V>): Record<number, V> =>
    Object.fromEntries(Object.entries(record).filter(([index]) => !left.has(Number(index))));
  const out = {
    ...segment,
    collation: {
      ...segment.collation,
      sites: segment.collation.sites.filter((s) => !s.minor),
    },
    attachments: kept(segment.attachments),
  };
  return out;
}

/**
 * A segment whose minor variants stand like any other. The flag is what the
 * print apparatus leaves a place out by, as a printed edition does; taken
 * off, the place is marked in the text and listed like the rest. For the
 * apparatus entries only: a variant window still says which places are minor.
 */
export function minorAsOthers<T extends MinorSegment>(segment: T): T {
  if (!segment.collation.sites.some((s) => s.minor)) return segment;
  return {
    ...segment,
    collation: {
      ...segment.collation,
      sites: segment.collation.sites.map(({ minor: _minor, ...site }) => site),
    },
  };
}

/**
 * The segments as a reader's page works with them: the minor variants out
 * or, when the reader asks for them, in, with their flag kept so that the
 * window can say they are minor.
 */
export function withMinor<T extends MinorSegment>(
  segments: Record<string, T>,
  shown: boolean,
): Record<string, T> {
  if (shown) return segments;
  const out: Record<string, T> = {};
  for (const [id, segment] of Object.entries(segments)) out[id] = withoutMinor(segment);
  return out;
}

/** The segments with every minor variant standing like any other, for the entries a reader who asks for them is shown. */
export function listingMinor<T extends MinorSegment>(
  segments: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, segment] of Object.entries(segments)) out[id] = minorAsOthers(segment);
  return out;
}

/** Whether any place of the segments is minor. */
export function anyMinor(segments: Record<string, MinorSegment>): boolean {
  return Object.values(segments).some((s) => s.collation.sites.some((site) => site.minor));
}

/** The key of a site in maps and data attributes: `segmentId:siteIndex`. */
export function siteKey(segmentId: string, siteIndex: number): string {
  return `${segmentId}:${siteIndex}`;
}

export function parseSiteKey(key: string): { segmentId: string; siteIndex: number } | null {
  if (isOrderKey(key)) return null;
  const at = key.lastIndexOf(':');
  if (at <= 0) return null;
  const siteIndex = Number(key.slice(at + 1));
  return Number.isInteger(siteIndex) ? { segmentId: key.slice(0, at), siteIndex } : null;
}

/** The key of a variant over the order of whole segments, which stands at no site: `order:k`, k its place among the edition's. */
export function orderKey(index: number): string {
  return `order:${index}`;
}

export function parseOrderKey(key: string): number | null {
  const found = /^order:(\d+)$/.exec(key);
  return found ? Number(found[1]) : null;
}

export function isOrderKey(key: string): boolean {
  return parseOrderKey(key) !== null;
}

/**
 * Every edition token that stands at a variant site, with the sites it
 * stands at. A site's words come from `siteTokenIds`; a site with no words
 * of the edition (a witness adds something) marks none: it is marked at the
 * point between two words (`markSites`). The site over a whole line that
 * some witnesses do not have (`wanting`) marks none either: it is marked in
 * the margin (`lineMarks`), and its words keep only their own variants.
 */
export function siteByToken(view: {
  segments: Record<string, SegmentSites> | SegmentSites[];
}): Map<string, SiteRef[]> {
  const map = new Map<string, SiteRef[]>();
  const add = (tokenId: string, ref: SiteRef) => {
    const list = map.get(tokenId);
    if (!list) map.set(tokenId, [ref]);
    else if (!list.some((r) => r.segmentId === ref.segmentId && r.siteIndex === ref.siteIndex))
      list.push(ref);
  };
  const list = Array.isArray(view.segments) ? view.segments : Object.values(view.segments);
  for (const segment of list) {
    for (const site of segment.collation.sites) {
      if (site.wanting) continue;
      for (const id of siteTokenIds(site, segment.baseUnits))
        add(id, { segmentId: segment.segmentId, siteIndex: site.index });
    }
  }
  return map;
}

/** The apparatus entries of each segment under the given conventions, by segment id. */
export function entriesBySegment(
  segments: Record<string, SegmentSites>,
  conventions: ApparatusConventions,
  siglaOrder: string[],
): Map<string, ApparatusEntry[]> {
  const out = new Map<string, ApparatusEntry[]>();
  for (const segment of Object.values(segments)) {
    // apparatusEntries reads the sites only.
    const collation = segment.collation as Collation;
    out.set(
      segment.segmentId,
      apparatusEntries(collation, segment.label, segment.attachments, conventions, siglaOrder),
    );
  }
  return out;
}

/** Entries by site key, for the popover and the hover links. */
export function entryBySite(entries: Map<string, ApparatusEntry[]>): Map<string, ApparatusEntry> {
  const out = new Map<string, ApparatusEntry>();
  for (const [segmentId, list] of entries)
    for (const entry of list) out.set(siteKey(segmentId, entry.siteIndex), entry);
  return out;
}

/** The site of a segment by its index. */
export function siteOf(segment: SegmentSites | undefined, siteIndex: number): Site | undefined {
  return segment?.collation.sites.find((site) => site.index === siteIndex);
}

/**
 * The tokens of a witness that a site's reading was read from: the units
 * the collation kept for that text, empty where the witness omits the words
 * or lacks the segment. A site opened for a conjecture on words the witnesses
 * agree about keeps no units of the witnesses; there the witness's words are
 * found through the alignment and the witness's own units, when given.
 */
export function witnessTokensAt(
  site: Site | undefined,
  textId: string | null,
  fallback?: { aligned?: number[]; units?: Unit[] },
): string[] {
  if (!site || !textId) return [];
  const ids: string[] = [];
  const add = (unit: Unit | undefined) => {
    for (const id of unit?.tokenIds ?? []) if (!ids.includes(id)) ids.push(id);
  };
  const reading = site.readings.find((r) => r.textIds.includes(textId));
  for (const unit of reading?.units[textId] ?? []) add(unit);
  const agreesUnrecorded =
    (!reading || reading.base) && ids.length === 0 && site.baseTo > site.baseFrom;
  if (agreesUnrecorded && fallback?.aligned && fallback.units) {
    for (let b = site.baseFrom; b < site.baseTo; b++) {
      const index = fallback.aligned[b] ?? -1;
      if (index >= 0) add(fallback.units[index]);
    }
  }
  return ids;
}

/** For each witness text, the index of its unit standing with each edition unit (-1 where none), from the columns. */
export function alignedUnits(
  collation: Pick<Collation, 'columns' | 'baseId'>,
  baseLength: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const column of collation.columns) {
    const base = column.cells.get(collation.baseId);
    if (!base) continue;
    for (const [textId, cell] of column.cells) {
      if (textId === collation.baseId) continue;
      const row = (out[textId] ??= new Array<number>(baseLength).fill(-1));
      if (base.unitIndex < baseLength) row[base.unitIndex] = cell.unitIndex;
    }
  }
  return out;
}

/** The edition tokens of a site, in order: its own words, or, for a point between two words, the neighbour its notes are found by. */
export function editionTokensAt(segment: SegmentSites | undefined, siteIndex: number): string[] {
  const site = siteOf(segment, siteIndex);
  if (!segment || !site) return [];
  const ids = siteTokenIds(site, segment.baseUnits);
  if (ids.length) return ids;
  const neighbour = segment.baseUnits[site.baseFrom - 1] ?? segment.baseUnits[site.baseFrom];
  return [...(neighbour?.tokenIds ?? [])];
}

/** The mark of a variant at a point between two words, standing beside the word it is placed by. */
export interface PointMark {
  /** The keys of the variants at the point, space-separated, for its data attribute. */
  keys: string;
  /** Whether the mark follows the word it is placed by, or precedes it (at the start of a segment). */
  side: 'after' | 'before';
  /** That word, without its punctuation, for the mark's name. */
  word: string;
}

export interface SiteMarking {
  /** Words whose site prints an entry: underlined, and opening it. */
  marked: Set<string>;
  /** The keys of the printed sites of each such word, space-separated, for its data attribute. */
  keysOf: Map<string, string>;
  /** The first word of each printed site: the one that takes the keyboard's focus. */
  tabStops: Set<string>;
  /** The marks of the printed variants at a point between two words, by the token id of the word each follows. */
  after: Map<string, PointMark>;
  /** The marks that precede the first word of a segment, by the token id of that word. */
  before: Map<string, PointMark>;
}

/** Which words open an entry under the entries in force. */
export function markSites(
  sitesOfToken: Map<string, SiteRef[]>,
  entries: Map<string, unknown>,
  segments: Record<string, SegmentSites | undefined>,
): SiteMarking {
  const marked = new Set<string>();
  const keysOf = new Map<string, string>();
  for (const [tokenId, refs] of sitesOfToken) {
    const keys = refs
      .map((ref) => siteKey(ref.segmentId, ref.siteIndex))
      .filter((key) => entries.has(key));
    if (keys.length === 0) continue;
    marked.add(tokenId);
    keysOf.set(tokenId, keys.join(' '));
  }
  const tabStops = new Set<string>();
  const after = new Map<string, PointMark>();
  const before = new Map<string, PointMark>();
  const place = (map: Map<string, PointMark>, tokenId: string, mark: PointMark) => {
    const there = map.get(tokenId);
    map.set(tokenId, there ? { ...there, keys: `${there.keys} ${mark.keys}` } : mark);
  };
  for (const key of entries.keys()) {
    const ref = parseSiteKey(key);
    const segment = ref ? segments[ref.segmentId] : undefined;
    const site = ref ? siteOf(segment, ref.siteIndex) : undefined;
    if (!segment || !site || site.wanting) continue;
    if (site.baseFrom !== site.baseTo) {
      const first = siteTokenIds(site, segment.baseUnits)[0];
      if (first) tabStops.add(first);
      continue;
    }
    // A point between two words: its mark follows the word before it, or at the start of a segment precedes the first.
    const previous = segment.baseUnits[site.baseFrom - 1];
    const next = segment.baseUnits[site.baseFrom];
    const last = previous?.tokenIds[previous.tokenIds.length - 1];
    const first = next?.tokenIds[0];
    if (last)
      place(after, last, { keys: key, side: 'after', word: trimPunctuation(previous!.text) });
    else if (first)
      place(before, first, { keys: key, side: 'before', word: trimPunctuation(next!.text) });
  }
  return { marked, keysOf, tabStops, after, before };
}
