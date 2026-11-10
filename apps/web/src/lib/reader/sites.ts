/**
 * Variant sites as the reader uses them: which words of the text stand at
 * which site, the entries the apparatus prints under the reader's settings,
 * and which words of a witness a site's reading was read from.
 */
import {
  apparatusEntries,
  siteTokenIds,
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
  /** The site has no words of the edition (an addition): the word before it, or after it, stands for it. */
  insertion?: boolean;
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

/**
 * A segment as a reader is given it, without the places the editor does not
 * report: their sites, what was attached to them, and how their readings
 * stand to the edition's words. The editor's own view keeps them.
 */
export function withoutUnreported<
  T extends {
    collation: Pick<Collation, 'sites'>;
    attachments: Record<number, Attachment[]>;
    relations?: Record<number, unknown>;
  },
>(segment: T): T {
  const left = new Set(segment.collation.sites.filter((s) => s.unreported).map((s) => s.index));
  if (left.size === 0) return segment;
  const kept = <V>(record: Record<number, V>): Record<number, V> =>
    Object.fromEntries(Object.entries(record).filter(([index]) => !left.has(Number(index))));
  const out = {
    ...segment,
    collation: {
      ...segment.collation,
      sites: segment.collation.sites.filter((s) => !s.unreported),
    },
    attachments: kept(segment.attachments),
  };
  if (segment.relations) out.relations = kept(segment.relations);
  return out;
}

/** The key of a site in maps and data attributes: `segmentId:siteIndex`. */
export function siteKey(segmentId: string, siteIndex: number): string {
  return `${segmentId}:${siteIndex}`;
}

export function parseSiteKey(key: string): { segmentId: string; siteIndex: number } | null {
  const at = key.lastIndexOf(':');
  if (at <= 0) return null;
  const siteIndex = Number(key.slice(at + 1));
  return Number.isInteger(siteIndex) ? { segmentId: key.slice(0, at), siteIndex } : null;
}

/**
 * Every edition token that stands at a variant site, with the sites it
 * stands at. A site's words come from `siteTokenIds`; a site with no words
 * of the edition (a witness adds something) is reached through the word
 * before it, or the word after it at the start of a segment.
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
      const ids = siteTokenIds(site, segment.baseUnits);
      if (ids.length > 0) {
        for (const id of ids) add(id, { segmentId: segment.segmentId, siteIndex: site.index });
        continue;
      }
      const neighbour = segment.baseUnits[site.baseFrom - 1] ?? segment.baseUnits[site.baseFrom];
      for (const id of neighbour?.tokenIds ?? [])
        add(id, { segmentId: segment.segmentId, siteIndex: site.index, insertion: true });
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

/** The edition tokens of a site, in order: its own words, or the neighbour standing for an addition. */
export function editionTokensAt(segment: SegmentSites | undefined, siteIndex: number): string[] {
  const site = siteOf(segment, siteIndex);
  if (!segment || !site) return [];
  const ids = siteTokenIds(site, segment.baseUnits);
  if (ids.length) return ids;
  const neighbour = segment.baseUnits[site.baseFrom - 1] ?? segment.baseUnits[site.baseFrom];
  return [...(neighbour?.tokenIds ?? [])];
}

export interface SiteMarking {
  /** Words whose site prints an entry: underlined, and opening it. */
  marked: Set<string>;
  /** The keys of the printed sites of each such word, space-separated, for its data attribute. */
  keysOf: Map<string, string>;
  /** The first word of each printed site: the one that takes the keyboard's focus. */
  tabStops: Set<string>;
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
  for (const key of entries.keys()) {
    const ref = parseSiteKey(key);
    const first = ref ? editionTokensAt(segments[ref.segmentId], ref.siteIndex)[0] : undefined;
    if (first) tabStops.add(first);
  }
  return { marked, keysOf, tabStops };
}
