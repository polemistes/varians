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
import type { ReaderSiglumState } from '$lib/reader/types';

export interface SegmentViewClient {
  segmentId: string;
  label: string;
  collation: Collation;
  baseUnits: Unit[];
  entries: ApparatusEntry[];
  attachments: Record<number, Attachment[]>;
  unplaced: Attachment[];
  absent: string[];
  notes: {
    id: string;
    tokenIds: string[];
    text: string;
    author: string | null;
    cites?: string[];
  }[];
  /** What attached conjectures and reported readings cite, by attachment id. */
  cites?: Record<string, string[]>;
  /** Words taken from a witness that now reads otherwise there; `now` is empty when it no longer has them. */
  drift?: { tokenId: string; siglum: string; transcriptionId: string; now: string }[];
  /** A segment the edition does not print and witnesses have: its variant stands after the edition's segment `after`. */
  unprinted?: { after: string };
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
  segments: Record<string, SegmentViewClient>;
  labelOf: Record<string, string>;
  /** Witnesses that order whole segments otherwise than the edition. */
  order: { siglum: string; moved: string[]; after: string | null }[];
  /** The same as variants: over a stretch of the edition's segments, the segments in each order, the edition's first. */
  orderVariants: OrderVariant[];
  /** The segments the edition does not print that witnesses have, in the work's order, each after the edition's segment it follows. */
  unprinted: { segmentId: string; after: string }[];
  atVersion: number | null;
}

/** Which site the editor is looking at. */
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
