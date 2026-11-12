/**
 * The shapes the registry pages receive: rows the server loads and the
 * components show. Types only, so that both sides can import them.
 */
import type { ConjectureKind } from '@varians/db';

/** The number of a record's latest version that is not withdrawn; null while it has none, and only its editors see it. */
export type LatestVersion = number | null;

/** What a row of an owned record may be used for by the current user. */
export interface RowRights {
  edit: boolean;
  delete: boolean;
}

export interface SearchHit {
  id: string;
  slug: string;
  /** The work's title or the witness's name. */
  title: string;
  /** A work's author. */
  author: string | null;
  /** A witness's siglum. */
  siglum: string | null;
  /** A witness's shelfmark, and the place it is kept. */
  shelfmark: string | null;
  settlement: string | null;
}

export interface Maintainer {
  id: string;
  name: string;
  email: string;
  isCreator: boolean;
}

/** A work as a page links to it. */
export interface WorkRef {
  id: string;
  slug: string;
  title: string;
}

export interface EditionRef {
  slug: string;
  title: string;
}

/**
 * What other people have that depends on an entry; any of it refuses a
 * deletion. The editions are those the person asking may see, named; the
 * rest are another person's drafts, counted and never named.
 */
export interface Dependents {
  editions: EditionRef[];
  hiddenEditions: number;
  transcriptions: number;
  records: number;
}

export interface WorkTranscriptionRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  latestVersion: LatestVersion;
  witnessId: string;
  witnessSlug: string;
  witnessName: string;
  witnessSiglum: string;
  /** How many of the work's segments the transcription assigns text to. */
  segmentCount: number;
  updatedAt: string;
}

export interface WitnessTranscriptionRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  latestVersion: LatestVersion;
  updatedAt: string;
  /** The works its text is assigned to, with the number of segments of each. */
  assigned: (WorkRef & { segmentCount: number })[];
}

export interface WitnessWorkRow extends WorkRef {
  author: string | null;
  transcriptionCount: number;
  segmentCount: number;
  readingCount: number;
}

export interface WorkEditionRow {
  id: string;
  slug: string;
  title: string;
  editors: string[];
  ownerId: string;
  ownerName: string;
  latestVersion: LatestVersion;
  updatedAt: string;
  collaboratorIds: string[];
}

/** A work a record cites, as the bibliography's CitationView gives it. */
export interface Cited {
  itemId: string;
  label: string;
  prenote: string | null;
  postnote: string | null;
  /** "cf. West 1998, 45" */
  text: string;
}

export interface ConjectureRow {
  id: string;
  workId: string;
  segmentId: string;
  label: string;
  kind: ConjectureKind;
  lemma: string;
  reading: string;
  extent: string | null;
  proposer: string | null;
  note: string | null;
  ownerId: string;
  ownerName: string;
}

export interface ReadingRow {
  id: string;
  workId: string;
  work: WorkRef;
  segmentId: string;
  label: string;
  witnessId: string;
  witnessSlug: string;
  witnessName: string;
  witnessSiglum: string;
  lemma: string;
  reading: string;
  source: string | null;
  note: string | null;
  ownerId: string;
  ownerName: string;
}

export interface PageRow {
  id: string;
  label: string;
  hasImage: boolean;
}

export interface WitnessOption {
  id: string;
  name: string;
  siglum: string;
}

export interface WorkOption {
  id: string;
  title: string;
  author: string | null;
}

export interface TranscriptionOption {
  id: string;
  name: string;
  witnessName: string;
  witnessSiglum: string;
  ownerName: string;
}

/** What a form action answers when it fails: errors by field, or one message for the whole form. */
export interface ActionFailure {
  errors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
  error?: string;
}
