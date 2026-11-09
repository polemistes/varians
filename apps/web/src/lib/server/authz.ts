/**
 * Who may see and do what, after PLAN 4.10.
 *
 * Two tiers. The shared registry (works, witnesses) has maintainers: the
 * creator, whom they add, and site editors. Owned records (transcriptions,
 * conjectures, editions) have an owner; an edition's owner invites
 * collaborators, and the grant reaches the transcriptions the edition names
 * in its conspectus and the conjecture records on its work, where those are
 * owned by the edition's owner. Site roles: member, editor (may edit
 * anything, may not delete, publish or grant), administrator.
 *
 * Every function here is pure over loaded rows and the current user, except
 * grantsFor, which loads in one query the sets the pure functions consult.
 */
import type {
  Conjecture,
  Database,
  Edition,
  Role,
  Transcription,
  Witness,
  Work,
} from '@varians/db';
import { sql } from '@varians/db';

export interface Actor {
  id: string;
  role: Role;
}

export type Maybe<T> = T | null | undefined;

/** What a user reaches through editions and maintainership. */
export interface Grants {
  /** Editions the user owns or collaborates on, with their work and owner. */
  editions: Map<string, { workId: string; ownerId: string }>;
  /** Editions the user collaborates on without owning. */
  collaboratingEditionIds: Set<string>;
  /** Transcriptions named in the conspectus of those editions and owned by the edition's owner. */
  transcriptionIds: Set<string>;
  /** Works of those editions: a private work is visible to the collaborators of its editions. */
  workIds: Set<string>;
  maintainedWorkIds: Set<string>;
  maintainedWitnessIds: Set<string>;
}

export function emptyGrants(): Grants {
  return {
    editions: new Map(),
    collaboratingEditionIds: new Set(),
    transcriptionIds: new Set(),
    workIds: new Set(),
    maintainedWorkIds: new Set(),
    maintainedWitnessIds: new Set(),
  };
}

// Site roles

export function isAdministrator(user: Maybe<Actor>): boolean {
  return user?.role === 'administrator';
}

/** Editors and administrators: may edit anything. */
export function isSiteEditor(user: Maybe<Actor>): boolean {
  return user?.role === 'editor' || user?.role === 'administrator';
}

function has(ids: Iterable<string>, id: string): boolean {
  if (ids instanceof Set) return ids.has(id);
  for (const candidate of ids) if (candidate === id) return true;
  return false;
}

function isOwner(user: Maybe<Actor>, record: { ownerId: string }): boolean {
  return !!user && user.id === record.ownerId;
}

/** Owner or administrator: deleting, publishing and granting. */
function ownsOrAdministers(user: Maybe<Actor>, record: { ownerId: string }): boolean {
  return isOwner(user, record) || isAdministrator(user);
}

// The shared registry

/** Anyone signed in may add to the registry. */
export function canCreateRegistryEntry(user: Maybe<Actor>): boolean {
  return !!user;
}

export function canMaintainWork(
  user: Maybe<Actor>,
  work: Pick<Work, 'id' | 'createdBy'>,
  maintainerIds: Iterable<string>,
): boolean {
  if (!user) return false;
  return isSiteEditor(user) || work.createdBy === user.id || has(maintainerIds, user.id);
}

export function canMaintainWitness(
  user: Maybe<Actor>,
  witness: Pick<Witness, 'id' | 'createdBy'>,
  maintainerIds: Iterable<string>,
): boolean {
  if (!user) return false;
  return isSiteEditor(user) || witness.createdBy === user.id || has(maintainerIds, user.id);
}

/**
 * A public work is visible to everyone. A private work is visible to its
 * creator, its maintainers, site editors, and the owners and collaborators
 * of editions of it.
 */
export function canViewWork(
  user: Maybe<Actor>,
  work: Pick<Work, 'id' | 'visibility' | 'createdBy'>,
  maintainerIds: Iterable<string>,
  grants: Grants,
): boolean {
  if (work.visibility === 'public') return true;
  if (!user) return false;
  return (
    canMaintainWork(user, work, maintainerIds) ||
    grants.maintainedWorkIds.has(work.id) ||
    grants.workIds.has(work.id)
  );
}

/** Witnesses are registry entries without a private state. */
export function canViewWitness(_user: Maybe<Actor>, _witness: Pick<Witness, 'id'>): boolean {
  return true;
}

// Transcriptions

export function canEditTranscription(
  user: Maybe<Actor>,
  transcription: Pick<Transcription, 'id' | 'ownerId'>,
  grants: Grants,
): boolean {
  if (!user) return false;
  return (
    isSiteEditor(user) ||
    isOwner(user, transcription) ||
    grants.transcriptionIds.has(transcription.id)
  );
}

/** Published, or owner, or reached through an edition that names it, or site editor. */
export function canViewTranscription(
  user: Maybe<Actor>,
  transcription: Pick<Transcription, 'id' | 'ownerId' | 'visibility'>,
  grants: Grants,
): boolean {
  if (transcription.visibility === 'published') return true;
  return canEditTranscription(user, transcription, grants);
}

export function canPublishTranscription(
  user: Maybe<Actor>,
  transcription: Pick<Transcription, 'ownerId'>,
): boolean {
  return ownsOrAdministers(user, transcription);
}

export function canDeleteTranscription(
  user: Maybe<Actor>,
  transcription: Pick<Transcription, 'ownerId'>,
): boolean {
  return ownsOrAdministers(user, transcription);
}

// Editions

export function canEditEdition(
  user: Maybe<Actor>,
  edition: Pick<Edition, 'id' | 'ownerId'>,
  collaboratorIds: Iterable<string>,
): boolean {
  if (!user) return false;
  return isSiteEditor(user) || isOwner(user, edition) || has(collaboratorIds, user.id);
}

export function canViewEdition(
  user: Maybe<Actor>,
  edition: Pick<Edition, 'id' | 'ownerId' | 'visibility'>,
  collaboratorIds: Iterable<string>,
): boolean {
  if (edition.visibility === 'published') return true;
  return canEditEdition(user, edition, collaboratorIds);
}

export function canPublishEdition(user: Maybe<Actor>, edition: Pick<Edition, 'ownerId'>): boolean {
  return ownsOrAdministers(user, edition);
}

export function canDeleteEdition(user: Maybe<Actor>, edition: Pick<Edition, 'ownerId'>): boolean {
  return ownsOrAdministers(user, edition);
}

/** Inviting collaborators and offering ownership. */
export function canGrantOnEdition(user: Maybe<Actor>, edition: Pick<Edition, 'ownerId'>): boolean {
  return ownsOrAdministers(user, edition);
}

// Conjectures and reported readings

export interface ConjectureContext {
  /** Maintainers of the conjecture's work. */
  workMaintainerIds: Iterable<string>;
  grants: Grants;
}

/** Whether the user collaborates on an edition of this work owned by the record's owner. */
function reachesThroughEdition(
  grants: Grants,
  record: { workId: string; ownerId: string },
): boolean {
  for (const edition of grants.editions.values()) {
    if (edition.workId === record.workId && edition.ownerId === record.ownerId) return true;
  }
  return false;
}

/**
 * A record is edited by its owner, by the collaborators of the owner's
 * editions of that work, by the work's maintainers and by site editors.
 */
export function canEditConjecture(
  user: Maybe<Actor>,
  conjecture: Pick<Conjecture, 'id' | 'ownerId' | 'workId'>,
  context: ConjectureContext,
): boolean {
  if (!user) return false;
  return (
    isSiteEditor(user) ||
    isOwner(user, conjecture) ||
    has(context.workMaintainerIds, user.id) ||
    context.grants.maintainedWorkIds.has(conjecture.workId) ||
    reachesThroughEdition(context.grants, conjecture)
  );
}

/** Published records are seen by everyone who sees the work (checked by the caller); drafts by those who may edit them. */
export function canViewConjecture(
  user: Maybe<Actor>,
  conjecture: Pick<Conjecture, 'id' | 'ownerId' | 'workId' | 'visibility'>,
  context: ConjectureContext,
): boolean {
  if (conjecture.visibility === 'published') return true;
  return canEditConjecture(user, conjecture, context);
}

export function canPublishConjecture(
  user: Maybe<Actor>,
  conjecture: Pick<Conjecture, 'ownerId'>,
): boolean {
  return ownsOrAdministers(user, conjecture);
}

export function canDeleteConjecture(
  user: Maybe<Actor>,
  conjecture: Pick<Conjecture, 'ownerId'>,
): boolean {
  return ownsOrAdministers(user, conjecture);
}

// The loader

type GrantRow = {
  kind: 'owned' | 'collab' | 'transcription' | 'work' | 'witness';
  a: string;
  b: string | null;
  c: string | null;
};

/** Folds the rows of the grants query into sets. Pure; exported for tests. */
export function foldGrants(rows: GrantRow[]): Grants {
  const grants = emptyGrants();
  for (const row of rows) {
    switch (row.kind) {
      case 'owned':
      case 'collab':
        if (row.b && row.c) {
          grants.editions.set(row.a, { workId: row.b, ownerId: row.c });
          grants.workIds.add(row.b);
          if (row.kind === 'collab') grants.collaboratingEditionIds.add(row.a);
        }
        break;
      case 'transcription':
        grants.transcriptionIds.add(row.a);
        break;
      case 'work':
        grants.maintainedWorkIds.add(row.a);
        break;
      case 'witness':
        grants.maintainedWitnessIds.add(row.a);
        break;
    }
  }
  return grants;
}

/**
 * Everything a user reaches, in one query: the editions they own or
 * collaborate on, the transcriptions those editions name (where owned by the
 * edition's owner), and the works and witnesses they maintain.
 */
export async function grantsFor(db: Database, user: Maybe<Actor>): Promise<Grants> {
  if (!user) return emptyGrants();
  const uid = user.id;
  const result = await db.execute<GrantRow>(sql`
    select 'owned' as kind, e.id as a, e.work_id as b, e.owner_id as c
      from editions e
      where e.owner_id = ${uid}
    union all
    select 'collab', e.id, e.work_id, e.owner_id
      from edition_collaborators ec
      join editions e on e.id = ec.edition_id
      where ec.user_id = ${uid}
    union all
    select 'transcription', s.transcription_id, e.id, null
      from edition_sigla s
      join editions e on e.id = s.edition_id
      join transcriptions t on t.id = s.transcription_id and t.owner_id = e.owner_id
      where e.owner_id = ${uid}
         or exists (select 1 from edition_collaborators ec where ec.edition_id = e.id and ec.user_id = ${uid})
    union all
    select 'work', m.work_id, null, null
      from work_maintainers m
      where m.user_id = ${uid}
    union all
    select 'witness', m.witness_id, null, null
      from witness_maintainers m
      where m.user_id = ${uid}
  `);
  return foldGrants(result.rows);
}
