/**
 * Client-side shapes of the edition editor: what the server's edition view
 * carries, named here so that components never import server modules.
 */
import type {
  ApparatusConventions,
  ApparatusEntry,
  Attachment,
  Collation,
  LayoutLine,
  OrderVariant,
  Stream,
  Unit,
} from '@varians/core';
import type { EditionConventions } from '@varians/db';
import type { PassagePart, ReaderSiglumState } from '$lib/reader/types';

/**
 * A passage of the edition as the editor has it: one segment, or several
 * collated together, known by its first.
 */
export interface SegmentViewClient {
  /** The passage's first segment. */
  segmentId: string;
  /** That segment's label. */
  label: string;
  /** The segments of the passage in order, each with the edition's units it holds; one the edition does not print holds none. */
  segments: PassagePart[];
  collation: Collation;
  /** The edition's units of the passage, each naming the segment its word begins in. */
  baseUnits: Unit[];
  /** The segments each variant's words lie in, by site index, in the order of the passage: the first is where it stands. */
  siteSegments: Record<number, string[]>;
  entries: ApparatusEntry[];
  /** Conjectures and reported readings by site index, each with the segment it names. */
  attachments: Record<number, (Attachment & { segmentId?: string })[]>;
  /** What no variant took, each with the segment it names. */
  unplaced: (Attachment & { segmentId?: string })[];
  absent: string[];
  notes: {
    id: string;
    /** The segment the note is on. */
    segmentId?: string;
    tokenIds: string[];
    text: string;
    author: string | null;
    cites?: string[];
  }[];
  /** What attached conjectures and reported readings cite, by attachment id. */
  cites?: Record<string, string[]>;
  /** Words taken from a witness that now reads otherwise there; `now` is empty when it no longer has them. */
  drift?: { tokenId: string; siglum: string; transcriptionId: string; now: string }[];
}

export interface SiglumClient {
  siglum: string;
  witnessId: string;
  witnessName: string;
  transcriptionId: string | null;
  description: string | null;
  /** The further states of the witness the edition collates under sigla of their own. */
  states?: ReaderSiglumState[];
  /** The siglum of the variants the witness notes ("A v.l."), when the edition collates them. */
  variantSiglum?: string | null;
}

export interface EditionViewClient {
  edition: {
    id: string;
    slug: string;
    title: string;
    editors: string[];
    preface: string | null;
    version: number;
    conventions: EditionConventions;
  };
  apparatus: ApparatusConventions;
  work: { id: string; title: string; author: string | null; language: string };
  content: Stream;
  lines: LayoutLine[];
  sigla: SiglumClient[];
  /** The passages given, by their first segment. */
  segments: Record<string, SegmentViewClient>;
  labelOf: Record<string, string>;
  /** Witnesses that order whole segments otherwise than the edition. */
  order: { siglum: string; moved: string[]; after: string | null }[];
  /** The same as variants: over a stretch of the edition's segments, the segments in each order, the edition's first. */
  orderVariants: OrderVariant[];
  atVersion: number | null;
}

/** Which site the editor is looking at: by its passage's first segment and its index there. */
export interface ActiveSite {
  segmentId: string;
  siteIndex: number;
}

/** What the witness pane fetches for one segment of one transcription. */
export interface WitnessSegment {
  runs: {
    items: import('@varians/core').Item[];
    pageId: string | null;
    read: string;
    written: string;
  }[];
  units: Unit[];
}

/** A collation's columns travel as arrays of pairs; this rebuilds the Maps the core expects. */
export function reviveCollationClient(raw: unknown): Collation {
  const data = raw as Omit<Collation, 'columns'> & {
    columns: (
      | { cells: [string, { unitIndex: number; lacunose?: boolean }][] }
      | { cells: Map<string, { unitIndex: number }> }
    )[];
  };
  return {
    ...data,
    columns: data.columns.map((c) => ({
      cells:
        c.cells instanceof Map
          ? c.cells
          : new Map(c.cells as [string, { unitIndex: number; lacunose?: boolean }][]),
    })),
  };
}
