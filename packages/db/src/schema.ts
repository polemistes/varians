/**
 * The PostgreSQL schema of Varians. Column names are snake_case through the
 * client's casing setting; keys here are camelCase.
 *
 * Two tiers: the shared registry (works, witnesses, schemes, bibliography,
 * each with maintainers) and owned records (transcriptions, conjectures,
 * reported readings, editions). Documents (transcriptions and editions)
 * keep their stream as JSONB with a version; every save is a changeset.
 */

import type {
  Address,
  Changeset as CoreChangeset,
  Item,
  Level,
  MemoryEntry,
  NormalizationProfile,
  Op,
  Stream,
  TokenSource,
  ZoneGeometry,
} from '@varians/core';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => text().primaryKey();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const ROLES = ['member', 'editor', 'administrator'] as const;
export type Role = (typeof ROLES)[number];
export const VISIBILITIES = ['draft', 'published'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const WORK_VISIBILITIES = ['public', 'private'] as const;
/** What a witness's carrier is. The material (papyrus, parchment, paper) and the format (codex, roll) are fields of their own. */
export const WITNESS_CATEGORIES = [
  'manuscript',
  'inscription',
  'edition',
  'indirect',
  'other',
] as const;
/** The physical format of a manuscript. */
export const WITNESS_FORMATS = ['codex', 'roll', 'sheet', 'unknown'] as const;
export type WitnessFormat = (typeof WITNESS_FORMATS)[number];
export const CONJECTURE_KINDS = [
  'substitution',
  'deletion',
  'addition',
  'lacuna',
  'supplement',
  'transposition',
] as const;
export type ConjectureKind = (typeof CONJECTURE_KINDS)[number];
export const DOCUMENT_KINDS = ['transcription', 'edition'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// People

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    role: text({ enum: ROLES }).notNull().default('member'),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    /** The version of the terms of contribution the person accepted, and when. */
    termsVersion: integer(),
    termsAcceptedAt: timestamp({ withTimezone: true }),
    preferences: jsonb()
      .$type<{ font?: string; theme?: 'light' | 'dark' | 'system' }>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`)],
);

/**
 * A person who made or did something recorded here: authorship
 * points at persons, who may have an ORCID and need not have an account.
 * Every account has a person whose id is the account's id (made by a trigger,
 * migration 0013); persons from imports may have none.
 */
export const persons = pgTable(
  'persons',
  {
    id: id(),
    name: text().notNull(),
    /** The 19-character form, checked by its ISO 7064 MOD 11-2 digit. */
    orcid: text(),
    userId: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('persons_orcid_idx')
      .on(t.orcid)
      .where(sql`${t.orcid} is not null`),
    uniqueIndex('persons_user_idx')
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

/** A canonical identifier of a work or witness. */
export const IDENTIFIER_SCHEMES = [
  'cts',
  'diktyon',
  'trismegistos',
  'wikidata',
  'viaf',
  'url',
  'other',
] as const;
export type IdentifierScheme = (typeof IDENTIFIER_SCHEMES)[number];
export interface CanonicalIdentifier {
  scheme: IdentifierScheme;
  value: string;
}

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** What a mailed link is for: confirming an address, or setting a new password. */
export const EMAIL_TOKEN_PURPOSES = ['verify', 'reset'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

/**
 * The links sent by mail (or printed for an administrator). Like sessions,
 * only the SHA-256 of the token is kept. A token is good for one use, until
 * it expires, and only while the account still has the address it was made
 * for. Transient: not archived.
 */
export const emailTokens = pgTable(
  'email_tokens',
  {
    /** SHA-256 of the token. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text({ enum: EMAIL_TOKEN_PURPOSES }).notNull(),
    /** The address the link was made for. */
    email: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId, t.purpose)],
);

// The shared registry

export const referenceSchemes = pgTable('reference_schemes', {
  id: id(),
  name: text().notNull(),
  levels: jsonb().$type<Level[]>().notNull(),
  createdBy: text().references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const works = pgTable(
  'works',
  {
    id: id(),
    slug: text().notNull(),
    title: text().notNull(),
    author: text(),
    language: text().notNull().default('grc'),
    /** The primary canonical identifier, a CTS URN, where one exists. */
    identifier: text(),
    /** Further canonical identifiers, typed. */
    identifiers: jsonb().$type<CanonicalIdentifier[]>().notNull().default([]),
    description: text(),
    schemeId: text()
      .notNull()
      .references(() => referenceSchemes.id),
    profile: jsonb().$type<NormalizationProfile>().notNull(),
    visibility: text({ enum: WORK_VISIBILITIES }).notNull().default('public'),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('works_slug_idx').on(t.slug), index('works_title_idx').on(t.title)],
);

export const workMaintainers = pgTable(
  'work_maintainers',
  {
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workId, t.userId] })],
);

export const segments = pgTable(
  'segments',
  {
    id: id(),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    address: jsonb().$type<Address>().notNull(),
    label: text().notNull(),
    sortKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('segments_work_label_idx').on(t.workId, t.label),
    index('segments_work_sort_idx').on(t.workId, t.sortKey),
  ],
);

/** A hand of a witness, as the catalogues cite it; `main` marks the scribe of the text. */
export interface WitnessHand {
  /** Stable: the marks of corrections in transcripts refer to it. */
  id: string;
  label: string;
  description: string | null;
  main: boolean;
}

export const witnesses = pgTable(
  'witnesses',
  {
    id: id(),
    slug: text().notNull(),
    /** The siglum proposed when the witness enters a conspectus; each edition may use another. */
    siglum: text().notNull(),
    name: text().notNull(),
    category: text({ enum: WITNESS_CATEGORIES }).notNull().default('manuscript'),
    /** For a manuscript: codex, roll, single sheet, or not known. */
    format: text({ enum: WITNESS_FORMATS }),
    /** For an indirect source: the author and work that quote or report the text (the passage goes with each reading). */
    sourceAuthor: text(),
    sourceWork: text(),
    repository: text(),
    settlement: text(),
    shelfmark: text(),
    /** A catalogue number or other identifier. */
    identifier: text(),
    /** Canonical identifiers, typed: Diktyon, Trismegistos, Wikidata and the like. */
    identifiers: jsonb().$type<CanonicalIdentifier[]>().notNull().default([]),
    dateText: text(),
    material: text(),
    extent: text(),
    /** The hands that wrote and corrected the witness; corrections in its transcripts may name them. */
    hands: jsonb().$type<WitnessHand[]>().notNull().default([]),
    provenance: text(),
    description: text(),
    /** The IIIF manifest the pages were imported from, when they were. */
    iiifManifest: text(),
    /** The rights statement and credit line new pages of the witness get. */
    imageRights: text(),
    imageAttribution: text(),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('witnesses_slug_idx').on(t.slug), index('witnesses_name_idx').on(t.name)],
);

export const witnessMaintainers = pgTable(
  'witness_maintainers',
  {
    witnessId: text()
      .notNull()
      .references(() => witnesses.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.witnessId, t.userId] })],
);

export const IMAGE_KINDS = ['upload', 'iiif'] as const;

export const pages = pgTable(
  'pages',
  {
    id: id(),
    witnessId: text()
      .notNull()
      .references(() => witnesses.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    position: doublePrecision().notNull(),
    imageKind: text({ enum: IMAGE_KINDS }),
    /** Path of the uploaded original under the storage directory. */
    imagePath: text(),
    /** Base URL of a IIIF Image API resource (without /info.json). */
    imageIiif: text(),
    imageWidth: integer(),
    imageHeight: integer(),
    /** Path of the Deep Zoom descriptor for an uploaded image, once tiled. */
    tilesPath: text(),
    /** The image's rights statement: a Creative Commons or RightsStatements.org address. */
    rights: text(),
    /** The credit line the rights holder asks for. */
    attribution: text(),
    /** Where the image was obtained. */
    imageSource: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pages_witness_idx').on(t.witnessId, t.position)],
);

export const bibliographyItems = pgTable(
  'bibliography_items',
  {
    id: id(),
    entryType: text().notNull(),
    citationKey: text().notNull(),
    fields: jsonb().$type<Record<string, string>>().notNull(),
    label: text().notNull(),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bibliography_key_idx').on(t.citationKey),
    index('bibliography_label_idx').on(t.label),
  ],
);

// Owned records

export const transcriptions = pgTable(
  'transcriptions',
  {
    id: id(),
    witnessId: text()
      .notNull()
      .references(() => witnesses.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    visibility: text({ enum: VISIBILITIES }).notNull().default('draft'),
    content: jsonb().$type<Stream>().notNull().default({ items: [] }),
    version: integer().notNull().default(0),
    /** Whether the editor keeps a written form apart from the read form. */
    keepsWrittenForm: boolean().notNull().default(false),
    /** Show the written form without word divisions (scriptio continua). */
    displayAsWritten: boolean().notNull().default(false),
    /** Overrides of the work's normalization profile, or null. */
    profile: jsonb().$type<Partial<NormalizationProfile>>(),
    memory: jsonb().$type<MemoryEntry[]>().notNull().default([]),
    /** A free note on the transcription: source, conventions, state. */
    description: text(),
    /** What the transcription rests on or was made from, as its maker states it; printed with the other sources. */
    sources: text(),
    /** The data licence fixed at publication, an SPDX identifier; never edited. */
    licenceId: text(),
    /** A note on rights the maker adds, shown with the licence. */
    rightsNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transcriptions_witness_idx').on(t.witnessId),
    index('transcriptions_owner_idx').on(t.ownerId),
  ],
);

/** Derived from a transcription's content on every save: which segments it has, and the fold text of each run. */
/**
 * The works a transcription is for, in order: chosen by its owner, so that
 * a transcription without text yet is listed with its works and offered
 * their segment labels. The works its text is actually assigned to are in
 * transcription_segments; a transcription's works are both together.
 */
export const transcriptionWorks = pgTable(
  'transcription_works',
  {
    transcriptionId: text()
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.transcriptionId, t.workId] }),
    index('transcription_works_work_idx').on(t.workId),
  ],
);

export const transcriptionSegments = pgTable(
  'transcription_segments',
  {
    transcriptionId: text()
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    part: integer().notNull().default(1),
    firstItemId: text().notNull(),
    unitCount: integer().notNull(),
    foldText: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transcriptionId, t.segmentId, t.part] }),
    index('transcription_segments_segment_idx').on(t.segmentId),
    index('transcription_segments_work_idx').on(t.workId, t.transcriptionId),
  ],
);

// Greek forms and dictionaries (built from their sources by apps/web/scripts/lexicon.ts; see docs/lexicon.md)

/** The analyses of Greek word forms, keyed by their letters alone (lower case, no diacritics, final ς). */
export const greekForms = pgTable('greek_forms', {
  formKey: text().primaryKey(),
  /** One analysis a line: form, lemma, morphological tag (AGDT), source (treebank or morpheus), tab-separated. */
  analyses: text().notNull(),
});

/** A dictionary, with where it comes from and its licence. */
export const lexicons = pgTable('lexicons', {
  id: text().primaryKey(),
  title: text().notNull(),
  source: text().notNull(),
  licence: text().notNull(),
  position: integer().notNull().default(0),
});

/** A dictionary entry; its body is HTML of p, b, i and span with classes. */
export const lexiconEntries = pgTable(
  'lexicon_entries',
  {
    id: integer().primaryKey(),
    lexiconId: text()
      .notNull()
      .references(() => lexicons.id, { onDelete: 'cascade' }),
    headword: text().notNull(),
    homograph: integer().notNull().default(0),
    /** The headword as a lemma is written, with diacritics. */
    lemmaKey: text().notNull(),
    /** The headword's letters alone, as greek_forms keys them. */
    looseKey: text().notNull(),
    html: text().notNull(),
  },
  (t) => [
    index('lexicon_entries_lemma_idx').on(t.lemmaKey),
    index('lexicon_entries_loose_idx').on(t.looseKey),
  ],
);

export const zones = pgTable(
  'zones',
  {
    id: id(),
    transcriptionId: text()
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    tokenIds: jsonb().$type<string[]>().notNull().default([]),
    geometry: jsonb().$type<ZoneGeometry>().notNull(),
    /** A non-textual feature the zone marks, when it has no tokens. */
    feature: jsonb().$type<{ kind: string; description?: string }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('zones_transcription_page_idx').on(t.transcriptionId, t.pageId)],
);

export const conjectures = pgTable(
  'conjectures',
  {
    id: id(),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    kind: text({ enum: CONJECTURE_KINDS }).notNull().default('substitution'),
    /** The words the conjecture concerns, as text. */
    lemma: text().notNull().default(''),
    /** The proposed reading; empty for a deletion or a lacuna. */
    reading: text().notNull().default(''),
    /** Free description of a lacuna's extent. */
    extent: text(),
    proposer: text(),
    note: text(),
    /** The proposed sequence of segment ids, for a transposition. */
    sequence: jsonb().$type<string[]>(),
    /** The lacuna this supplement fills. */
    supplementsId: text(),
    /** A witness-token anchor recorded when registered from a text. */
    anchor: jsonb().$type<
      { transcriptionId: string; tokenIds: string[] } | { editionId: string; tokenIds: string[] }
    >(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    visibility: text({ enum: VISIBILITIES }).notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conjectures_segment_idx').on(t.segmentId),
    index('conjectures_work_idx').on(t.workId),
  ],
);

export const reportedReadings = pgTable(
  'reported_readings',
  {
    id: id(),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    witnessId: text()
      .notNull()
      .references(() => witnesses.id, { onDelete: 'cascade' }),
    lemma: text().notNull().default(''),
    reading: text().notNull().default(''),
    /** Where the report comes from: an edition's apparatus, a collation, a catalogue. */
    source: text(),
    note: text(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    visibility: text({ enum: VISIBILITIES }).notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reported_readings_segment_idx').on(t.segmentId),
    index('reported_readings_witness_idx').on(t.witnessId),
  ],
);

export interface EditionConventions {
  apparatus: 'positive' | 'negative';
  /** Latin abbreviations (om., add., del.) or full words. */
  latin: boolean;
  lineation: 'verse' | 'prose';
  /** Print a segment label every n lines in verse. */
  numberEvery: number;
  speakerDisplay: 'inline' | 'margin' | 'own-line';
  /**
   * Interpretative variants (the same letters read otherwise: accents,
   * punctuation, word division): in the apparatus, in a list of their own
   * under it, or not printed. Absent in editions made before: a list of their own.
   */
  interpretative?: 'apparatus' | 'separate' | 'none';
  /**
   * Sigla that stand for several witnesses of the conspectus together (a
   * family, the agreement of two manuscripts): the apparatus prints one for
   * its members wherever all of them have a reading.
   */
  groups?: { siglum: string; members: string[]; note?: string }[];
  /** The word the apparatus prints for "the other witnesses" ("cett.", "rell."); absent or empty, every witness is named. */
  rest?: string;
  /** The word the apparatus prints for "all the witnesses" ("codd."); absent or empty, they are named. */
  all?: string;
  /** Brackets for supplements, deletions and lacunae. */
  sigla: { supplied: [string, string]; deleted: [string, string]; lacuna: string; crux: string };
}

/** Where a copied edition came from, kept as it was when copied: the original may change or go. */
export interface EditionOrigin {
  editionId: string;
  title: string;
  editors: string[];
  /** The version copied: a published one, or the draft's version when an editor copied it. */
  version: number;
  published: boolean;
  /** The published version's number, as readers cite it; null for a draft. */
  number: number | null;
}

export const editions = pgTable(
  'editions',
  {
    id: id(),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    slug: text().notNull(),
    title: text().notNull(),
    /** The editors' names, as printed. */
    editors: jsonb().$type<string[]>().notNull().default([]),
    preface: text(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    visibility: text({ enum: VISIBILITIES }).notNull().default('draft'),
    content: jsonb().$type<Stream>().notNull().default({ items: [] }),
    version: integer().notNull().default(0),
    /** The version readers see; null while never published. */
    publishedVersion: integer(),
    conventions: jsonb().$type<EditionConventions>().notNull(),
    /** The edition this one was copied from, as it was then; null for an edition made afresh. */
    copiedFrom: jsonb().$type<EditionOrigin>(),
    /** What the edition rests on, as its editors state it; printed with the other sources. */
    sources: text(),
    /** The data licence fixed at publication, an SPDX identifier; never edited. */
    licenceId: text(),
    /** A note on rights the maker adds, shown with the licence. */
    rightsNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('editions_slug_idx').on(t.slug),
    index('editions_work_idx').on(t.workId),
    index('editions_owner_idx').on(t.ownerId),
  ],
);

/** A further state of a witness that an edition collates under a siglum of its own: as first written, after a stage of correction, or with the corrections of one hand. */
export type SiglumState =
  | { kind: 'original'; siglum: string }
  | { kind: 'stage'; stage: number; siglum: string }
  | { kind: 'hand'; hand: string; siglum: string };

/** The conspectus: each siglum of an edition, the witness behind it and the transcription used. */
export const editionSigla = pgTable(
  'edition_sigla',
  {
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    witnessId: text()
      .notNull()
      .references(() => witnesses.id, { onDelete: 'cascade' }),
    /** Null for a witness that enters only through reported readings. */
    transcriptionId: text().references(() => transcriptions.id, { onDelete: 'set null' }),
    siglum: text().notNull(),
    position: integer().notNull().default(0),
    /** Further states of the witness collated under sigla of their own: before correction, after a stage, with one hand's corrections. */
    states: jsonb().$type<SiglumState[]>().notNull().default([]),
    /** The siglum of the variants the manuscript notes in its margins or between its lines, collated as a text of their own (A v.l.). */
    variantSiglum: text(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.witnessId] })],
);

export const editionAdoptions = pgTable(
  'edition_adoptions',
  {
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    conjectureId: text()
      .notNull()
      .references(() => conjectures.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.conjectureId] })],
);

/** Which sites an editor has looked at, keyed by the edition tokens the site covers. */
export const editionSiteReviews = pgTable(
  'edition_site_reviews',
  {
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    siteKey: text().notNull(),
    reviewedBy: text().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.segmentId, t.siteKey] })],
);

/** What an editor may say of a place of variation: its kind over the letters', or that it is not reported. */
export const SITE_KIND_MARKS = ['textual', 'interpretative', 'unreported'] as const;
export type SiteKindMark = (typeof SITE_KIND_MARKS)[number];

/** An editor's word on a place of variation: its kind over the classification by letters, or that it is not reported. */
export const editionSiteKinds = pgTable(
  'edition_site_kinds',
  {
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    siteKey: text().notNull(),
    // The kind the editor gives the place over what its letters say, or that the place is not reported.
    kind: text({ enum: SITE_KIND_MARKS }).notNull(),
    setBy: text().references(() => users.id, { onDelete: 'set null' }),
    setAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.segmentId, t.siteKey] })],
);

export const alignmentConstraints = pgTable(
  'alignment_constraints',
  {
    id: id(),
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    baseTokenIds: jsonb().$type<string[]>().notNull(),
    transcriptionId: text()
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    witnessTokenIds: jsonb().$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('alignment_constraints_edition_segment_idx').on(t.editionId, t.segmentId)],
);

export const notes = pgTable(
  'notes',
  {
    id: id(),
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    /** The edition tokens the note is about; empty for the whole segment. */
    tokenIds: jsonb().$type<string[]>().notNull().default([]),
    text: text().notNull(),
    /** The account that wrote it, for the permission checks; authorship is personId. */
    authorId: text().references(() => users.id, { onDelete: 'set null' }),
    personId: text().references(() => persons.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('notes_edition_segment_idx').on(t.editionId, t.segmentId)],
);

export const citations = pgTable(
  'citations',
  {
    id: id(),
    itemId: text()
      .notNull()
      .references(() => bibliographyItems.id, { onDelete: 'restrict' }),
    conjectureId: text().references(() => conjectures.id, { onDelete: 'cascade' }),
    reportedReadingId: text().references(() => reportedReadings.id, { onDelete: 'cascade' }),
    noteId: text().references(() => notes.id, { onDelete: 'cascade' }),
    editionId: text().references(() => editions.id, { onDelete: 'cascade' }),
    segmentId: text().references(() => segments.id, { onDelete: 'cascade' }),
    prenote: text(),
    postnote: text(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('citations_item_idx').on(t.itemId),
    index('citations_conjecture_idx').on(t.conjectureId),
  ],
);

export const editionCollaborators = pgTable(
  'edition_collaborators',
  {
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantedBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.userId] })],
);

export const ownershipOffers = pgTable(
  'ownership_offers',
  {
    id: id(),
    kind: text({ enum: DOCUMENT_KINDS }).notNull(),
    recordId: text().notNull(),
    fromUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text({ enum: ['open', 'accepted', 'declined', 'withdrawn'] as const })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    settledAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('ownership_offers_to_idx').on(t.toUserId, t.status)],
);

// History

export const changesets = pgTable(
  'changesets',
  {
    id: id(),
    documentKind: text({ enum: DOCUMENT_KINDS }).notNull(),
    documentId: text().notNull(),
    /** This installation's applied order; null for a changeset kept for its provenance and never applied here. */
    version: integer(),
    /** The changeset this one was made on; null for a document's first. */
    parentId: text(),
    /** For a merge: the incoming changesets it brings in. */
    merged: jsonb().$type<string[]>(),
    /** The account that saved it, for the permission checks; authorship is personId. */
    userId: text().references(() => users.id, { onDelete: 'set null' }),
    personId: text().references(() => persons.id, { onDelete: 'set null' }),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ops: jsonb().$type<Op[]>().notNull(),
    reverse: jsonb().$type<Op[]>().notNull(),
    message: text(),
  },
  (t) => [
    uniqueIndex('changesets_document_version_idx').on(t.documentKind, t.documentId, t.version),
    index('changesets_parent_idx').on(t.parentId),
  ],
);

export const checkpoints = pgTable(
  'checkpoints',
  {
    documentKind: text({ enum: DOCUMENT_KINDS }).notNull(),
    documentId: text().notNull(),
    version: integer().notNull(),
    content: jsonb().$type<Stream>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.documentKind, t.documentId, t.version] })],
);

export const MOMENT_KINDS = ['named', 'published'] as const;

/** The conspectus of an edition and the versions of its transcriptions at a publication. */
export interface MomentBasis {
  sigla: {
    siglum: string;
    witnessId: string;
    transcriptionId: string | null;
    states?: SiglumState[];
    /** Bases published before states: the siglum of the state before correction. */
    originalSiglum?: string | null;
    variantSiglum?: string | null;
  }[];
  /** Transcription id to the version the apparatus was collated against. */
  versions: Record<string, number>;
  /**
   * The editors' word on places of variation as it stood at the publication:
   * a kind over the letters' or that the place is not reported. A basis from
   * before it was recorded lacks it; the marks set before the publication stand.
   */
  siteKinds?: { segmentId: string; siteKey: string; kind: SiteKindMark }[];
}

export const moments = pgTable(
  'moments',
  {
    id: id(),
    documentKind: text({ enum: DOCUMENT_KINDS }).notNull(),
    documentId: text().notNull(),
    version: integer().notNull(),
    name: text().notNull(),
    kind: text({ enum: MOMENT_KINDS }).notNull().default('named'),
    /** For a published moment: the number shown to readers (1, 2, 3...). */
    number: integer(),
    /** For a published edition: what its apparatus was collated against, so that the version stays as it was published. */
    basis: jsonb().$type<MomentBasis>(),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    personId: text().references(() => persons.id, { onDelete: 'set null' }),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('moments_document_idx').on(t.documentKind, t.documentId, t.version)],
);

export const reviewState = pgTable(
  'review_state',
  {
    documentKind: text({ enum: DOCUMENT_KINDS }).notNull(),
    documentId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The version the person reviews from. */
    fromVersion: integer().notNull().default(0),
    /** Changeset ids accepted since. */
    accepted: jsonb().$type<string[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.documentKind, t.documentId, t.userId] })],
);

export const archiveCommits = pgTable(
  'archive_commits',
  {
    id: id(),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    commitHash: text().notNull(),
    reason: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('archive_commits_work_idx').on(t.workId, t.at)],
);

/** A token for another installation or a script to act as an account: accepted by the sync and import endpoints only. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    /** SHA-256 of the token; the token itself is shown once. */
    tokenHash: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('api_tokens_hash_idx').on(t.tokenHash),
    index('api_tokens_user_idx').on(t.userId),
  ],
);

/** Another installation's copy of a work, to pull from and push to. */
export const workRemotes = pgTable(
  'work_remotes',
  {
    id: id(),
    workId: text()
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    /** The other installation's address (https://example.org), and the work's id there. */
    origin: text().notNull(),
    remoteWorkId: text().notNull(),
    /** The work's slug there, for its addresses. */
    remoteSlug: text().notNull(),
    /** A token of an account there, encrypted with SECRET_KEY (AES-256-GCM); null for a public work pulled without one. */
    token: text(),
    /** Pull every so many hours; null for by hand only. */
    pullEveryHours: integer(),
    lastPulledAt: timestamp({ withTimezone: true }),
    /** What the last pull or push did, as shown to the maintainers. */
    lastReport: jsonb().$type<unknown>(),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('work_remotes_work_idx').on(t.workId)],
);

/** What an archive queue entry names: which records' files to rewrite. */
export const ARCHIVE_QUEUE_KINDS = [
  'work-all',
  'work',
  'work-editions',
  'scheme',
  'bibliography',
  'witness',
  'transcription',
  'edition',
  'person',
] as const;

/** A registry entry merged into another: its id still resolves, and imports naming it land on the survivor. */
export const registryMerges = pgTable(
  'registry_merges',
  {
    oldId: text().primaryKey(),
    kind: text({ enum: ['work', 'witness'] }).notNull(),
    survivorId: text().notNull(),
    /** What the merged entry was called, for the record. */
    label: text().notNull(),
    mergedBy: text().references(() => users.id, { onDelete: 'set null' }),
    mergedAt: createdAt(),
  },
  (t) => [index('registry_merges_survivor_idx').on(t.survivorId)],
);

/**
 * Records whose archive files are out of date, filled by triggers on every
 * archived table (migration 0012) and emptied by the archive writer once the
 * record has been quiet for ARCHIVE_WRITE_DELAY_SECONDS. Transient.
 */
export const archiveQueue = pgTable(
  'archive_queue',
  {
    kind: text({ enum: ARCHIVE_QUEUE_KINDS }).notNull(),
    recordId: text().notNull(),
    /** The last change; the entry waits until it is old enough. */
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.recordId] }), index('archive_queue_at_idx').on(t.at)],
);

export const collationCache = pgTable(
  'collation_cache',
  {
    editionId: text()
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    segmentId: text()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    inputHash: text().notNull(),
    result: jsonb().$type<unknown>().notNull(),
    computedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.segmentId] })],
);

// Relations (for the relational query API)

export const usersRelations = relations(users, ({ many }) => ({
  transcriptions: many(transcriptions),
  editions: many(editions),
}));

export const worksRelations = relations(works, ({ one, many }) => ({
  scheme: one(referenceSchemes, { fields: [works.schemeId], references: [referenceSchemes.id] }),
  segments: many(segments),
  editions: many(editions),
  conjectures: many(conjectures),
  maintainers: many(workMaintainers),
}));

export const workMaintainersRelations = relations(workMaintainers, ({ one }) => ({
  work: one(works, { fields: [workMaintainers.workId], references: [works.id] }),
  user: one(users, { fields: [workMaintainers.userId], references: [users.id] }),
}));

export const segmentsRelations = relations(segments, ({ one }) => ({
  work: one(works, { fields: [segments.workId], references: [works.id] }),
}));

export const witnessesRelations = relations(witnesses, ({ many }) => ({
  pages: many(pages),
  transcriptions: many(transcriptions),
  maintainers: many(witnessMaintainers),
}));

export const witnessMaintainersRelations = relations(witnessMaintainers, ({ one }) => ({
  witness: one(witnesses, { fields: [witnessMaintainers.witnessId], references: [witnesses.id] }),
  user: one(users, { fields: [witnessMaintainers.userId], references: [users.id] }),
}));

export const pagesRelations = relations(pages, ({ one }) => ({
  witness: one(witnesses, { fields: [pages.witnessId], references: [witnesses.id] }),
}));

export const transcriptionsRelations = relations(transcriptions, ({ one, many }) => ({
  witness: one(witnesses, { fields: [transcriptions.witnessId], references: [witnesses.id] }),
  owner: one(users, { fields: [transcriptions.ownerId], references: [users.id] }),
  zones: many(zones),
  segments: many(transcriptionSegments),
  works: many(transcriptionWorks),
}));

export const transcriptionWorksRelations = relations(transcriptionWorks, ({ one }) => ({
  transcription: one(transcriptions, {
    fields: [transcriptionWorks.transcriptionId],
    references: [transcriptions.id],
  }),
  work: one(works, { fields: [transcriptionWorks.workId], references: [works.id] }),
}));

export const transcriptionSegmentsRelations = relations(transcriptionSegments, ({ one }) => ({
  transcription: one(transcriptions, {
    fields: [transcriptionSegments.transcriptionId],
    references: [transcriptions.id],
  }),
  segment: one(segments, { fields: [transcriptionSegments.segmentId], references: [segments.id] }),
}));

export const zonesRelations = relations(zones, ({ one }) => ({
  transcription: one(transcriptions, {
    fields: [zones.transcriptionId],
    references: [transcriptions.id],
  }),
  page: one(pages, { fields: [zones.pageId], references: [pages.id] }),
}));

export const conjecturesRelations = relations(conjectures, ({ one, many }) => ({
  work: one(works, { fields: [conjectures.workId], references: [works.id] }),
  segment: one(segments, { fields: [conjectures.segmentId], references: [segments.id] }),
  owner: one(users, { fields: [conjectures.ownerId], references: [users.id] }),
  citations: many(citations),
}));

export const reportedReadingsRelations = relations(reportedReadings, ({ one, many }) => ({
  segment: one(segments, { fields: [reportedReadings.segmentId], references: [segments.id] }),
  witness: one(witnesses, { fields: [reportedReadings.witnessId], references: [witnesses.id] }),
  citations: many(citations),
}));

export const editionsRelations = relations(editions, ({ one, many }) => ({
  work: one(works, { fields: [editions.workId], references: [works.id] }),
  owner: one(users, { fields: [editions.ownerId], references: [users.id] }),
  sigla: many(editionSigla),
  adoptions: many(editionAdoptions),
  collaborators: many(editionCollaborators),
  notes: many(notes),
}));

export const editionSiglaRelations = relations(editionSigla, ({ one }) => ({
  edition: one(editions, { fields: [editionSigla.editionId], references: [editions.id] }),
  witness: one(witnesses, { fields: [editionSigla.witnessId], references: [witnesses.id] }),
  transcription: one(transcriptions, {
    fields: [editionSigla.transcriptionId],
    references: [transcriptions.id],
  }),
}));

export const editionAdoptionsRelations = relations(editionAdoptions, ({ one }) => ({
  edition: one(editions, { fields: [editionAdoptions.editionId], references: [editions.id] }),
  conjecture: one(conjectures, {
    fields: [editionAdoptions.conjectureId],
    references: [conjectures.id],
  }),
}));

export const editionCollaboratorsRelations = relations(editionCollaborators, ({ one }) => ({
  edition: one(editions, { fields: [editionCollaborators.editionId], references: [editions.id] }),
  user: one(users, { fields: [editionCollaborators.userId], references: [users.id] }),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  edition: one(editions, { fields: [notes.editionId], references: [editions.id] }),
  segment: one(segments, { fields: [notes.segmentId], references: [segments.id] }),
  author: one(users, { fields: [notes.authorId], references: [users.id] }),
  citations: many(citations),
}));

export const citationsRelations = relations(citations, ({ one }) => ({
  item: one(bibliographyItems, { fields: [citations.itemId], references: [bibliographyItems.id] }),
  conjecture: one(conjectures, { fields: [citations.conjectureId], references: [conjectures.id] }),
  reportedReading: one(reportedReadings, {
    fields: [citations.reportedReadingId],
    references: [reportedReadings.id],
  }),
  note: one(notes, { fields: [citations.noteId], references: [notes.id] }),
}));

export const bibliographyItemsRelations = relations(bibliographyItems, ({ many }) => ({
  citations: many(citations),
}));

// Row types

export type User = typeof users.$inferSelect;
export type Person = typeof persons.$inferSelect;
export type Work = typeof works.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type Witness = typeof witnesses.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type Transcription = typeof transcriptions.$inferSelect;
export type Zone = typeof zones.$inferSelect;
export type Conjecture = typeof conjectures.$inferSelect;
export type ReportedReading = typeof reportedReadings.$inferSelect;
export type Edition = typeof editions.$inferSelect;
export type EditionSiglum = typeof editionSigla.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type BibliographyItem = typeof bibliographyItems.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type ChangesetRow = typeof changesets.$inferSelect;
export type Moment = typeof moments.$inferSelect;
export type ReferenceScheme = typeof referenceSchemes.$inferSelect;

/** The core changeset type, re-exported so that server code needs one import. */
export type Changeset = CoreChangeset;
export type { Item, TokenSource };
