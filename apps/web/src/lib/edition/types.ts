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
  Stream,
  Unit,
  VariantRelation,
} from '@varians/core';
import type { EditionConventions } from '@varians/db';

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
  /** How each reading of a textual place stands to the edition's words, by site index and reading index (Greek works). */
  relations?: Record<number, (VariantRelation | null)[]>;
}

export interface SiglumClient {
  siglum: string;
  witnessId: string;
  witnessName: string;
  transcriptionId: string | null;
  description: string | null;
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
