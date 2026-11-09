/**
 * What the reader's pages receive from the server: the edition view at the
 * version the visitor may see, trimmed for the browser. Only types here, so
 * that components never import server modules.
 */
import type { ApparatusConventions, Attachment, Collation, LayoutLine, Unit, VariantRelation } from '@varians/core';
import type { EditionConventions } from '@varians/db';

export interface ReaderSegment {
  segmentId: string;
  label: string;
  /** The collation with its columns left out: the reader needs the sites only. */
  collation: Collation;
  baseUnits: Unit[];
  /** Conjectures and reported readings by site index. */
  attachments: Record<number, Attachment[]>;
  /**
   * For each witness text, the index of its unit aligned with each unit of the
   * edition (-1 where none): how a witness's words are found at a site opened
   * for a conjecture on words every witness agrees about.
   */
  aligned: Record<string, number[]>;
  unplaced: Attachment[];
  /** Sigla of the witnesses without this segment at all. */
  absent: string[];
  notes: ReaderNote[];
  /** What attached conjectures and reported readings cite, by attachment id: "cf. West 1998, 45". */
  cites?: Record<string, string[]>;
  /** How each reading of a textual place stands to the edition's words, by site index and reading index (Greek works). */
  relations?: Record<number, (VariantRelation | null)[]>;
}

export interface ReaderNote {
  id: string;
  tokenIds: string[];
  text: string;
  author: string | null;
  /** The works the note cites. */
  cites?: string[];
}

/** A state of a witness collated under its own siglum: as first written, after a stage of correction, or with one hand's corrections (the hand by its label). */
export interface ReaderSiglumState {
  kind: 'original' | 'stage' | 'hand';
  siglum: string;
  stage?: number;
  hand?: string;
}

export interface ReaderSiglum {
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

/** Which state of the edition is shown, and why. */
export type ReaderMode =
  /** The published version, to everyone. `number` is null when no published moment names it. */
  | { kind: 'published'; number: number | null; at: string | null }
  /** A draft, to those who may see it. */
  | { kind: 'draft'; version: number }
  /** The current draft of a published edition, to its editors. */
  | { kind: 'preview'; version: number; publishedNumber: number | null }
  /** A published version by its number. */
  | { kind: 'version'; number: number; at: string; isCurrent: boolean };

export interface ReaderVersion {
  number: number;
  at: string;
  href: string;
  current: boolean;
}

export interface ReaderData {
  edition: {
    id: string;
    slug: string;
    title: string;
    editors: string[];
    preface: string | null;
    /** What the edition rests on, as its editors state it, and their note on rights. */
    sources: string | null;
    rightsNote: string | null;
    /** The licence fixed at its first publication; null before. */
    licence: { id: string; name: string; url: string } | null;
    version: number;
    conventions: EditionConventions;
  };
  work: { id: string; title: string; author: string | null; language: string };
  /** The apparatus conventions the edition sets. */
  apparatus: ApparatusConventions;
  lines: LayoutLine[];
  sigla: ReaderSiglum[];
  segments: Record<string, ReaderSegment>;
  /** The bibliography of the edition: what its apparatus and notes cite. */
  worksCited: { id: string; key: string; label: string; reference: string }[];
  /** Labels of the segments the edition has, by id. */
  labelOf: Record<string, string>;
  mode: ReaderMode;
  /** Published versions, newest first. */
  versions: ReaderVersion[];
  canEdit: boolean;
  /** Where a signed-in reader makes a copy of the edition (its editors the draft, others the published version); null when none may be made. */
  copy: string | null;
  /** The edition this one was copied from, as it was then, with a link while it is still published. */
  origin: { title: string; editors: string[]; number: number | null; href: string | null } | null;
  /** The path of this view without a segment: `/editions/slug` or `/editions/slug/v/2`. */
  basePath: string;
  /** The query links within this view keep: `?draft=1` in a preview, else empty. */
  query: string;
  exports: { text: string; tei: string };
  links: {
    /** The edition as readers see it now. */
    current: string;
    /** The draft preview, for editors of a published edition. */
    preview: string | null;
    /** The edition editor, for those who may edit. */
    editor: string | null;
  };
}

/** The segment a permalink asks for: found, or a label the edition does not have. */
export type ReaderFocus = { segmentId: string; label: string } | { missing: string } | null;

export interface ReaderPageData extends ReaderData {
  focus: ReaderFocus;
}
