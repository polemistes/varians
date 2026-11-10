/**
 * What the reader's page is sent of an edition's segments, and how the page
 * takes it in. A reading of a place names the texts that have it, by id and
 * siglum, and in an edition of thirty witnesses that is most of the weight of
 * the collation. The wire names every text once (`texts`), and a reading
 * names them by place in that list; the units of the words each text has at
 * a place, and the alignment of each text with the edition, are not sent at
 * all, for the page asks for them of the segments it opens (`SegmentDetail`).
 * Pure, so that the page can use it.
 */
import type { Attachment, Collation, Reading, Site, SiteKind, Unit } from '@varians/core';
import type { ReaderData, ReaderNote, ReaderSegment } from './types.ts';

/** What the reader's page is sent: the page data with its segments as they travel. */
export interface ReaderWireData extends Omit<ReaderData, 'segments'> {
  segments: Record<string, WireSegment>;
  texts: WireText[];
  /** The id the edition's own text is known by in the collations. */
  baseId: string;
}

/** A text of the collation: the id it is known by and the siglum it is printed with. */
export type WireText = [id: string, siglum: string];

export interface WireReading {
  text: string;
  fold: string;
  /** The texts that have the reading, by place in the list of texts, in the reading's order. */
  t: number[];
  omission?: true;
  lacunose?: true;
  base?: true;
}

export interface WireSite {
  index: number;
  baseFrom: number;
  baseTo: number;
  kind: SiteKind;
  kindByEditor?: true;
  wanting?: true;
  /** The editor judges the place minor: a reader's page shows it only when asked. */
  minor?: true;
  readings: WireReading[];
  /** The texts whose words exchange places with those of another site, by place in the list. */
  transposition?: { withSite: number; t: number[] };
}

export interface WireSegment {
  segmentId: string;
  label: string;
  sites: WireSite[];
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
  unplaced: Attachment[];
  absent: string[];
  notes: ReaderNote[];
  cites?: Record<string, string[]>;
}

/**
 * What a segment has in the full collation and not on the wire: the words of
 * each text at each place (by the place's index, then the reading's index
 * among the place's readings), and where each text stands against the edition.
 */
export interface SegmentDetail {
  units: Record<number, Record<string, Unit[]>[]>;
  aligned: Record<string, number[]>;
}

/** The detail of a segment, from its full collation. */
export function detailOf(
  collation: Pick<Collation, 'sites' | 'columns' | 'baseId'>,
  aligned: Record<string, number[]>,
): SegmentDetail {
  const units: SegmentDetail['units'] = {};
  for (const site of collation.sites) units[site.index] = site.readings.map((r) => r.units);
  return { units, aligned };
}

/** The parts of a segment view the wire is made from. */
export interface PackableSegment {
  segmentId: string;
  label: string;
  /** The siglum of each text, for a reading that does not carry it. */
  collation: Pick<Collation, 'sites'> & Partial<Pick<Collation, 'sigla'>>;
  baseUnits: Unit[];
  attachments: Record<number, Attachment[]>;
  unplaced: Attachment[];
  absent: string[];
  notes: ReaderNote[];
  cites?: Record<string, string[]>;
}

/** The segments made ready to send, with the list of texts they name. */
export function packSegments(segments: Iterable<PackableSegment>): {
  segments: Record<string, WireSegment>;
  texts: WireText[];
} {
  const texts: WireText[] = [];
  const place = new Map<string, number>();
  const placeOf = (id: string, siglum: string): number => {
    const key = `${id}\u0000${siglum}`;
    let at = place.get(key);
    if (at === undefined) {
      at = texts.length;
      texts.push([id, siglum]);
      place.set(key, at);
    }
    return at;
  };
  const out: Record<string, WireSegment> = {};
  for (const segment of segments) {
    const names = segment.collation.sigla ?? {};
    const sites = segment.collation.sites.map((site): WireSite => {
      const wire: WireSite = {
        index: site.index,
        baseFrom: site.baseFrom,
        baseTo: site.baseTo,
        kind: site.kind,
        readings: site.readings.map((reading) => {
          const packed: WireReading = {
            text: reading.text,
            fold: reading.fold,
            t: reading.textIds.map((id, i) => placeOf(id, reading.sigla[i] ?? names[id] ?? id)),
          };
          if (reading.omission) packed.omission = true;
          if (reading.lacunose) packed.lacunose = true;
          if (reading.base) packed.base = true;
          return packed;
        }),
      };
      if (site.kindByEditor) wire.kindByEditor = true;
      if (site.wanting) wire.wanting = true;
      if (site.minor) wire.minor = true;
      if (site.transposition)
        wire.transposition = {
          withSite: site.transposition.withSite,
          t: site.transposition.textIds.map((id) => placeOf(id, names[id] ?? id)),
        };
      return wire;
    });
    out[segment.segmentId] = {
      segmentId: segment.segmentId,
      label: segment.label,
      sites,
      baseUnits: segment.baseUnits,
      attachments: segment.attachments,
      unplaced: segment.unplaced,
      absent: segment.absent,
      notes: segment.notes,
      ...(segment.cites ? { cites: segment.cites } : {}),
    };
  }
  return { segments: out, texts };
}

/** A segment as the page uses it, from what was sent: the readings without their units, no columns, no alignment. */
export function unpackSegment(wire: WireSegment, texts: WireText[], baseId: string): ReaderSegment {
  const sites = wire.sites.map((site): Site => {
    const unpacked: Site = {
      index: site.index,
      columnFrom: 0,
      columnTo: 0,
      baseFrom: site.baseFrom,
      baseTo: site.baseTo,
      kind: site.kind,
      readings: site.readings.map(
        (reading): Reading => ({
          text: reading.text,
          fold: reading.fold,
          textIds: reading.t.map((at) => texts[at]![0]),
          sigla: reading.t.map((at) => texts[at]![1]),
          units: {},
          omission: reading.omission === true,
          lacunose: reading.lacunose === true,
          base: reading.base === true,
        }),
      ),
    };
    if (site.kindByEditor) unpacked.kindByEditor = true;
    if (site.wanting) unpacked.wanting = true;
    if (site.minor) unpacked.minor = true;
    if (site.transposition)
      unpacked.transposition = {
        withSite: site.transposition.withSite,
        textIds: site.transposition.t.map((at) => texts[at]![0]),
      };
    return unpacked;
  });
  return {
    segmentId: wire.segmentId,
    label: wire.label,
    collation: { columns: [], sites, anchors: [], baseId, absent: [], sigla: {} },
    baseUnits: wire.baseUnits,
    attachments: wire.attachments,
    unplaced: wire.unplaced,
    absent: wire.absent,
    notes: wire.notes,
    ...(wire.cites ? { cites: wire.cites } : {}),
  };
}

export function unpackSegments(
  wire: Record<string, WireSegment>,
  texts: WireText[],
  baseId: string,
): Record<string, ReaderSegment> {
  const out: Record<string, ReaderSegment> = {};
  for (const [id, segment] of Object.entries(wire)) out[id] = unpackSegment(segment, texts, baseId);
  return out;
}

/** A segment with the detail that was not sent put back. */
export function withDetail(segment: ReaderSegment, detail: SegmentDetail): ReaderSegment {
  const sites = segment.collation.sites.map((site) => ({
    ...site,
    readings: site.readings.map((reading, k) => ({
      ...reading,
      units: detail.units[site.index]?.[k] ?? reading.units,
    })),
  }));
  return { ...segment, collation: { ...segment.collation, sites }, aligned: detail.aligned };
}

/** The page data as the page uses it, from what was sent: the segments unpacked, the list of texts they named no longer needed. */
export function unpackReader<T extends ReaderWireData>(
  data: T,
): Omit<T, 'segments' | 'texts' | 'baseId'> & { segments: Record<string, ReaderSegment> } {
  const { segments, texts, baseId, ...rest } = data;
  return { ...rest, segments: unpackSegments(segments, texts, baseId) };
}
