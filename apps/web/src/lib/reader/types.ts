/**
 * What the reader's pages receive from the server: the edition view at the
 * version the visitor may see, trimmed for the browser. Only types here, so
 * that components never import server modules.
 */
import type { Attachment, Collation, LayoutLine, OrderVariant, Unit } from '@varians/core';
import type { EditionConventions } from '@varians/db';
import type { EditionRights } from '$lib/edition/actions';

/** A segment of a passage: its label, and the edition's units it holds, [from, to); one the edition does not print holds none. */
export interface PassagePart {
  segmentId: string;
  label: string;
  from: number;
  to: number;
  printed: boolean;
}

/**
 * A passage of the edition as the reader has it: one segment, or several
 * collated together, known by its first.
 */
export interface ReaderSegment {
  /** The passage's first segment. */
  segmentId: string;
  /** That segment's label. */
  label: string;
  /** The segments of the passage in order. */
  segments: PassagePart[];
  /** The collation with its columns left out: the reader needs the sites only. */
  collation: Collation;
  /** The edition's units of the passage, each naming the segment its word begins in. */
  baseUnits: Unit[];
  /** The segments each variant's words lie in, by site index, in the order of the passage: the first is where it stands. */
  siteSegments: Record<number, string[]>;
  /** Conjectures and reported readings by site index. */
  attachments: Record<number, Attachment[]>;
  /**
   * For each witness text, the index of its unit aligned with each unit of the
   * edition (-1 where none): how a witness's words are found at a site opened
   * for a conjecture on words every witness agrees about. Not sent with the
   * page: it comes with the detail of the segment (`SegmentDetail`).
   */
  aligned?: Record<string, number[]>;
  /** What no variant took, each with the segment it names. */
  unplaced: (Attachment & { segmentId?: string })[];
  /** Sigla of the witnesses without any of the passage. */
  absent: string[];
  notes: ReaderNote[];
  /** What attached conjectures and reported readings cite, by attachment id: "cf. West 1998, 45". */
  cites?: Record<string, string[]>;
}

export interface ReaderNote {
  id: string;
  /** The segment the note is on. */
  segmentId?: string;
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
  lines: LayoutLine[];
  sigla: ReaderSiglum[];
  /** The passages sent, by their first segment. */
  segments: Record<string, ReaderSegment>;
  /** The bibliography of the edition: what its apparatus and notes cite. */
  worksCited: { id: string; key: string; label: string; reference: string }[];
  /** Labels of the segments the edition has, and of those it does not print that witnesses have in the passages sent, by id. */
  labelOf: Record<string, string>;
  /**
   * Where witnesses order the edition's segments otherwise, as variants: over
   * a stretch of the edition's segments, the segments in each order, the
   * edition's first; a block far from its place by the segment it follows.
   */
  orderVariants: OrderVariant[];
  mode: ReaderMode;
  /** Published versions, newest first. */
  versions: ReaderVersion[];
  canEdit: boolean;
  /** The edition is published (whatever state of it is shown). */
  published: boolean;
  /** What the viewer may do with the edition: its buttons and menu. */
  rights: EditionRights;
  /** The edition this one was copied from, as it was then, with a link while it is still published. */
  origin: { title: string; editors: string[]; number: number | null; href: string | null } | null;
  /** The path of this view without a segment: `/editions/slug` or `/editions/slug/v/2`. */
  basePath: string;
  /** The query links within this view keep: `?draft=1` in a preview, else empty. */
  query: string;
  exports: { tei: string; package: string };
  /** Where the detail of some segments is asked for, as a query is added to it: `/editions/slug/detail.json` with the state of the edition kept. */
  detail: string;
  /** Where the places of some segments are asked for (`sites.json`), those in `pending`. */
  sites: string;
  /**
   * Segments of the text whose passages were not sent, because their
   * collation was not at hand and the page did not wait for it: nearest the
   * segment asked for first. The page asks for them as it opens, and is given
   * the passages that hold them.
   */
  pending: string[];
  links: {
    /** The edition as readers see it now. */
    current: string;
    /** The draft preview, for editors of a published edition. */
    preview: string | null;
  };
}

/** The segment a permalink asks for: found, or a label the edition does not have. */
export type ReaderFocus = { segmentId: string; label: string } | { missing: string } | null;

export interface ReaderPageData extends ReaderData {
  focus: ReaderFocus;
}
