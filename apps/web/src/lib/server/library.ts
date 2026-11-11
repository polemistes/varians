/**
 * The library's queries: what a user owns, what is shared with them, the
 * registry with its search, and the published editions.
 */
import {
  alias,
  and,
  desc,
  editions,
  eq,
  ilike,
  inArray,
  ne,
  or,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
  type SQL,
} from '@varians/db';
import type { EditionRights } from '$lib/edition/actions';
import type { WitnessRights } from '$lib/witness/actions';
import type { WorkRights } from '$lib/work/actions';
import {
  editionRightsFromGrants,
  witnessRightsFromGrants,
  workRightsFromGrants,
  type Actor,
  type Grants,
} from './authz';
import { identifierMatches } from './identifier-search.ts';

export interface EditionRow {
  id: string;
  slug: string;
  title: string;
  workTitle: string;
  workSlug: string;
  workAuthor: string | null;
  editors: string[];
  ownerId: string;
  ownerName: string;
  visibility: 'draft' | 'published';
  updatedAt: string;
}

/** An edition in a list, with what the viewer may do with it. */
export type EditionListRow<T extends EditionRow = EditionRow> = T & { can: EditionRights };

export interface TranscriptionRow {
  id: string;
  name: string;
  witnessName: string;
  witnessSlug: string;
  ownerName: string;
  visibility: 'draft' | 'published';
  updatedAt: string;
}

export interface WorkRow {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  language: string;
  /** Who added it, for the rights of a list; never sent to the browser. */
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** A work in a list, with what the viewer may do with it. */
export type WorkListRow = Omit<WorkRow, 'createdBy'> & { can: WorkRights };

export interface WitnessRow {
  id: string;
  slug: string;
  name: string;
  siglum: string;
  category: string;
  repository: string | null;
  settlement: string | null;
  shelfmark: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** A witness in a list, with what the viewer may do with it. */
export type WitnessListRow = Omit<WitnessRow, 'createdBy'> & { can: WitnessRights };

export interface Library {
  query: string;
  /** Only for a signed-in user. */
  yours: {
    editions: EditionRow[];
    transcriptions: TranscriptionRow[];
    shared: { editions: EditionRow[]; transcriptions: TranscriptionRow[] };
  } | null;
  works: WorkRow[];
  witnesses: WitnessRow[];
  publishedEditions: EditionRow[];
}

const LIMIT = 50;

/** Escapes the wildcards of LIKE so that a query matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function likePattern(query: string): string {
  return `%${escapeLike(query.trim())}%`;
}

const owner = alias(users, 'owner');

function editionColumns() {
  return {
    id: editions.id,
    slug: editions.slug,
    title: editions.title,
    workTitle: works.title,
    workSlug: works.slug,
    workAuthor: works.author,
    editors: editions.editors,
    ownerId: editions.ownerId,
    ownerName: owner.name,
    visibility: editions.visibility,
    updatedAt: editions.updatedAt,
  };
}

function transcriptionColumns() {
  return {
    id: transcriptions.id,
    name: transcriptions.name,
    witnessName: witnesses.name,
    witnessSlug: witnesses.slug,
    ownerName: owner.name,
    visibility: transcriptions.visibility,
    updatedAt: transcriptions.updatedAt,
  };
}

type EditionSelect = Omit<EditionRow, 'updatedAt'> & { updatedAt: Date };
type TranscriptionSelect = Omit<TranscriptionRow, 'updatedAt'> & { updatedAt: Date };

const withIso = <T extends { updatedAt: Date }>(row: T) => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});
const withIsoCreated = <T extends { createdAt: Date }>(row: T) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

async function selectEditions(db: Database, where: SQL | undefined): Promise<EditionRow[]> {
  const rows: EditionSelect[] = await db
    .select(editionColumns())
    .from(editions)
    .innerJoin(works, eq(works.id, editions.workId))
    .innerJoin(owner, eq(owner.id, editions.ownerId))
    .where(where)
    .orderBy(desc(editions.updatedAt))
    .limit(LIMIT);
  return rows.map(withIso);
}

async function selectTranscriptions(
  db: Database,
  where: SQL | undefined,
): Promise<TranscriptionRow[]> {
  const rows: TranscriptionSelect[] = await db
    .select(transcriptionColumns())
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .innerJoin(owner, eq(owner.id, transcriptions.ownerId))
    .where(where)
    .orderBy(desc(transcriptions.updatedAt))
    .limit(LIMIT);
  return rows.map(withIso);
}

export async function searchWorks(db: Database, query: string): Promise<WorkRow[]> {
  const creator = alias(users, 'creator');
  const pattern = query ? likePattern(query) : null;
  const matches = pattern
    ? or(ilike(works.title, pattern), ilike(works.author, pattern), identifierMatches(works, query))
    : undefined;
  const rows = await db
    .select({
      id: works.id,
      slug: works.slug,
      title: works.title,
      author: works.author,
      language: works.language,
      createdBy: works.createdBy,
      createdByName: creator.name,
      createdAt: works.createdAt,
    })
    .from(works)
    .leftJoin(creator, eq(creator.id, works.createdBy))
    .where(matches)
    .orderBy(works.author, works.title)
    .limit(LIMIT);
  return rows.map(withIsoCreated);
}

export async function searchWitnesses(db: Database, query: string): Promise<WitnessRow[]> {
  const creator = alias(users, 'creator');
  const pattern = query ? likePattern(query) : null;
  const matches = pattern
    ? or(
        ilike(witnesses.name, pattern),
        ilike(witnesses.siglum, pattern),
        ilike(witnesses.shelfmark, pattern),
        identifierMatches(witnesses, query),
      )
    : undefined;
  const rows = await db
    .select({
      id: witnesses.id,
      slug: witnesses.slug,
      name: witnesses.name,
      siglum: witnesses.siglum,
      category: witnesses.category,
      repository: witnesses.repository,
      settlement: witnesses.settlement,
      shelfmark: witnesses.shelfmark,
      createdBy: witnesses.createdBy,
      createdByName: creator.name,
      createdAt: witnesses.createdAt,
    })
    .from(witnesses)
    .leftJoin(creator, eq(creator.id, witnesses.createdBy))
    .where(matches)
    .orderBy(witnesses.name)
    .limit(LIMIT);
  return rows.map(withIsoCreated);
}

/** The editions of a list with the viewer's rights on each, from the grants loaded once for the page. */
export function withEditionRights<T extends EditionRow>(
  rows: T[],
  user: Actor | null,
  grants: Grants,
): EditionListRow<T>[] {
  return rows.map((row) => ({ ...row, can: editionRightsFromGrants(user, row, grants) }));
}

/** The works of a list with the viewer's rights on each, from the grants loaded once for the page. */
export function withWorkRights(rows: WorkRow[], user: Actor | null, grants: Grants): WorkListRow[] {
  return rows.map(({ createdBy, ...row }) => ({
    ...row,
    can: workRightsFromGrants(user, { id: row.id, createdBy }, grants),
  }));
}

/** The witnesses of a list with the viewer's rights on each, from the grants loaded once for the page. */
export function withWitnessRights(
  rows: WitnessRow[],
  user: Actor | null,
  grants: Grants,
): WitnessListRow[] {
  return rows.map(({ createdBy, ...row }) => ({
    ...row,
    can: witnessRightsFromGrants(user, { id: row.id, createdBy }, grants),
  }));
}

/** Published editions. A draft is listed only to those who may edit it, on their own pages. */
export function publishedEditions(db: Database): Promise<EditionRow[]> {
  return selectEditions(db, eq(editions.visibility, 'published'));
}

export function editionsOwnedBy(db: Database, userId: string): Promise<EditionRow[]> {
  return selectEditions(db, eq(editions.ownerId, userId));
}

export function transcriptionsOwnedBy(db: Database, userId: string): Promise<TranscriptionRow[]> {
  return selectTranscriptions(db, eq(transcriptions.ownerId, userId));
}

/** Editions the user collaborates on, and transcriptions reached through them, owned by others. */
export async function sharedWith(
  db: Database,
  user: Actor,
  grants: Grants,
): Promise<{ editions: EditionRow[]; transcriptions: TranscriptionRow[] }> {
  const editionIds = [...grants.collaboratingEditionIds];
  const transcriptionIds = [...grants.transcriptionIds];
  const [sharedEditions, sharedTranscriptions] = await Promise.all([
    editionIds.length
      ? selectEditions(db, and(inArray(editions.id, editionIds), ne(editions.ownerId, user.id)))
      : [],
    transcriptionIds.length
      ? selectTranscriptions(
          db,
          and(inArray(transcriptions.id, transcriptionIds), ne(transcriptions.ownerId, user.id)),
        )
      : [],
  ]);
  return { editions: sharedEditions, transcriptions: sharedTranscriptions };
}

/** Published editions matching a query on the edition's title, the work's title or its author. */
export function searchPublishedEditions(db: Database, query: string): Promise<EditionRow[]> {
  const pattern = query.trim() ? likePattern(query) : null;
  const matches = pattern
    ? or(ilike(editions.title, pattern), ilike(works.title, pattern), ilike(works.author, pattern))
    : undefined;
  return selectEditions(db, and(eq(editions.visibility, 'published'), matches));
}

export type RecentItem =
  | ({ kind: 'edition'; shared: boolean } & EditionRow)
  | ({ kind: 'transcription'; shared: boolean } & TranscriptionRow);

/** The user's own and shared editions and transcriptions, the most recently changed first. */
export async function recentWork(
  db: Database,
  user: Actor,
  grants: Grants,
  limit = 4,
): Promise<{ items: RecentItem[]; total: number }> {
  const [ownEditions, ownTranscriptions, shared] = await Promise.all([
    editionsOwnedBy(db, user.id),
    transcriptionsOwnedBy(db, user.id),
    sharedWith(db, user, grants),
  ]);
  const items: RecentItem[] = [
    ...ownEditions.map((e) => ({ ...e, kind: 'edition' as const, shared: false })),
    ...shared.editions.map((e) => ({ ...e, kind: 'edition' as const, shared: true })),
    ...ownTranscriptions.map((t) => ({ ...t, kind: 'transcription' as const, shared: false })),
    ...shared.transcriptions.map((t) => ({ ...t, kind: 'transcription' as const, shared: true })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items: items.slice(0, limit), total: items.length };
}

/** Everything the library page shows, for a visitor or a user. */
export async function loadLibrary(
  db: Database,
  user: Actor | null,
  grants: Grants,
  query: string,
): Promise<Library> {
  const q = query.trim();
  const [worksFound, witnessesFound, published, yours] = await Promise.all([
    searchWorks(db, q),
    searchWitnesses(db, q),
    publishedEditions(db),
    user
      ? Promise.all([
          editionsOwnedBy(db, user.id),
          transcriptionsOwnedBy(db, user.id),
          sharedWith(db, user, grants),
        ]).then(([ownedEditions, ownedTranscriptions, shared]) => ({
          editions: ownedEditions,
          transcriptions: ownedTranscriptions,
          shared,
        }))
      : null,
  ]);
  return {
    query: q,
    yours,
    works: worksFound,
    witnesses: witnessesFound,
    publishedEditions: published,
  };
}
