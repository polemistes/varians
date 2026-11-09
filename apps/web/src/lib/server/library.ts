/**
 * The library's queries: what a user owns, what is shared with them, the
 * registry with its search, and the published editions.
 */
import {
  alias,
  and,
  desc,
  editionCollaborators,
  editions,
  eq,
  exists,
  ilike,
  inArray,
  ne,
  or,
  sql,
  transcriptions,
  users,
  witnesses,
  workMaintainers,
  works,
  type Database,
  type SQL,
} from '@varians/db';
import { isSiteEditor, type Actor, type Grants } from './authz';

export interface EditionRow {
  id: string;
  slug: string;
  title: string;
  workTitle: string;
  workSlug: string;
  workAuthor: string | null;
  editors: string[];
  ownerName: string;
  visibility: 'draft' | 'published';
  updatedAt: string;
}

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
  visibility: 'public' | 'private';
  createdByName: string | null;
  createdAt: string;
}

export interface WitnessRow {
  id: string;
  slug: string;
  name: string;
  siglum: string;
  category: string;
  repository: string | null;
  settlement: string | null;
  shelfmark: string | null;
  createdByName: string | null;
  createdAt: string;
}

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

/** The works a user may see: public ones, and private ones they created, maintain or reach through an edition. */
function visibleWorks(user: Actor | null): SQL | undefined {
  if (isSiteEditor(user)) return undefined;
  const isPublic = eq(works.visibility, 'public');
  if (!user) return isPublic;
  const maintains = exists(
    sql`(select 1 from ${workMaintainers}
         where ${workMaintainers.workId} = ${works.id} and ${workMaintainers.userId} = ${user.id})`,
  );
  const collaborates = exists(
    sql`(select 1 from ${editions}
         left join ${editionCollaborators} on ${editionCollaborators.editionId} = ${editions.id}
         where ${editions.workId} = ${works.id}
           and (${editions.ownerId} = ${user.id} or ${editionCollaborators.userId} = ${user.id}))`,
  );
  return or(isPublic, eq(works.createdBy, user.id), maintains, collaborates);
}

export async function searchWorks(
  db: Database,
  user: Actor | null,
  query: string,
): Promise<WorkRow[]> {
  const creator = alias(users, 'creator');
  const pattern = query ? likePattern(query) : null;
  const matches = pattern
    ? or(ilike(works.title, pattern), ilike(works.author, pattern))
    : undefined;
  const rows = await db
    .select({
      id: works.id,
      slug: works.slug,
      title: works.title,
      author: works.author,
      language: works.language,
      visibility: works.visibility,
      createdByName: creator.name,
      createdAt: works.createdAt,
    })
    .from(works)
    .leftJoin(creator, eq(creator.id, works.createdBy))
    .where(and(visibleWorks(user), matches))
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

/** Published editions of the works the user may see: a private work's editions are not listed to others. */
export function publishedEditions(db: Database, user: Actor | null = null): Promise<EditionRow[]> {
  return selectEditions(db, and(eq(editions.visibility, 'published'), visibleWorks(user)));
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

/** Published editions the user may see, matching a query on the edition's title, the work's title or its author. */
export function searchPublishedEditions(db: Database, user: Actor | null, query: string): Promise<EditionRow[]> {
  const pattern = query.trim() ? likePattern(query) : null;
  const matches = pattern ? or(ilike(editions.title, pattern), ilike(works.title, pattern), ilike(works.author, pattern)) : undefined;
  return selectEditions(db, and(eq(editions.visibility, 'published'), visibleWorks(user), matches));
}

export type RecentItem =
  | ({ kind: 'edition'; shared: boolean } & EditionRow)
  | ({ kind: 'transcription'; shared: boolean } & TranscriptionRow);

/** The user's own and shared editions and transcriptions, the most recently changed first. */
export async function recentWork(db: Database, user: Actor, grants: Grants, limit = 4): Promise<{ items: RecentItem[]; total: number }> {
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
    searchWorks(db, user, q),
    searchWitnesses(db, q),
    publishedEditions(db, user),
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
