/**
 * The shapes the registry pages receive: rows the server loads and the
 * components show. Types only, so that both sides can import them.
 */
import type { ConjectureKind } from '@varians/db';

export type WorkVisibility = 'public' | 'private';
export type RecordVisibility = 'draft' | 'published';

/** What a row of an owned record may be used for by the current user. */
export interface RowRights {
  edit: boolean;
  delete: boolean;
  publish: boolean;
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

/** A work as a page links to it, with what deciding its visibility needs. */
export interface WorkRef {
  id: string;
  slug: string;
  title: string;
  visibility: WorkVisibility;
  createdBy: string | null;
}

export interface EditionRef {
  slug: string;
  title: string;
}

/** What other people have that depends on an entry; any of it refuses a deletion. */
export interface Dependents {
  editions: (EditionRef & { ownerName: string })[];
  transcriptions: number;
  records: number;
}

export interface WorkTranscriptionRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  visibility: RecordVisibility;
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
  visibility: RecordVisibility;
  updatedAt: string;
  /** The works it is for, in order. */
  works: WorkRef[];
  /** The works it assigns text to, with the number of segments of each. */
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
  visibility: RecordVisibility;
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
  visibility: RecordVisibility;
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
  visibility: RecordVisibility;
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
