/**
 * Every table of the schema under one of three heads (PLAN-2 A1). The test
 * beside this file fails when a table is added without being classified here.
 */

/** Tables whose rows the archive holds: the preservation record. */
export const ARCHIVED_TABLES = [
  'works',
  'work_maintainers',
  'reference_schemes',
  'segments',
  'witnesses',
  'witness_maintainers',
  'pages',
  'bibliography_items',
  'citations',
  'transcriptions',
  'transcription_works',
  'zones',
  'conjectures',
  'reported_readings',
  'editions',
  'edition_sigla',
  'edition_adoptions',
  'edition_site_kinds',
  'edition_site_reviews',
  'alignment_constraints',
  'notes',
  'edition_collaborators',
  'changesets',
  'moments',
  'review_state',
] as const;

/** Tables rebuilt from archived data. */
export const DERIVED_TABLES = ['transcription_segments', 'collation_cache', 'checkpoints', 'archive_commits'] as const;

/**
 * Transient state and reference data: sessions, offers, accounts (their names
 * reach the archive with the records), the archive's own queue, and the
 * dictionaries, a dataset with its own documentation (docs/lexicon.md) and licence.
 */
export const TRANSIENT_TABLES = ['sessions', 'ownership_offers', 'users', 'archive_queue', 'greek_forms', 'lexicons', 'lexicon_entries'] as const;

export type ArchivedTable = (typeof ARCHIVED_TABLES)[number];
