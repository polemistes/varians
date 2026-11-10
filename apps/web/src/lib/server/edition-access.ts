/**
 * Loading an edition with what a request needs to authorize against it.
 */
import {
  editionCollaborators,
  editions,
  workMaintainers,
  works,
  type Database,
  type Edition,
} from '@varians/db';
import { eq, or } from 'drizzle-orm';
import {
  canEditEdition,
  canPublishEdition,
  canViewEdition,
  canViewWork,
  grantsFor,
  type Actor,
} from './authz';

export interface EditionAccess {
  edition: Edition;
  collaboratorIds: string[];
  canView: boolean;
  canEdit: boolean;
  canPublish: boolean;
}

/** The edition by id or slug, with the current user's rights; null when there is no such edition. */
export async function loadEditionAccess(
  db: Database,
  user: Actor | null,
  idOrSlug: string,
): Promise<EditionAccess | null> {
  const [edition] = await db
    .select()
    .from(editions)
    .where(or(eq(editions.id, idOrSlug), eq(editions.slug, idOrSlug)))
    .limit(1);
  if (!edition) return null;
  const collaboratorIds = (
    await db
      .select({ userId: editionCollaborators.userId })
      .from(editionCollaborators)
      .where(eq(editionCollaborators.editionId, edition.id))
  ).map((c) => c.userId);
  const canEdit = canEditEdition(user, edition, collaboratorIds);
  let canView = canViewEdition(user, edition, collaboratorIds);
  // An edition of a private work is seen only by those who see the work, published or not.
  if (canView && !canEdit) canView = await seesWork(db, user, edition.workId);
  return {
    edition,
    collaboratorIds,
    canView,
    canEdit,
    canPublish: canPublishEdition(user, edition),
  };
}

/** Whether the user sees a work: always for a public one. */
export async function seesWork(db: Database, user: Actor | null, workId: string): Promise<boolean> {
  const [work] = await db
    .select({ id: works.id, visibility: works.visibility, createdBy: works.createdBy })
    .from(works)
    .where(eq(works.id, workId));
  if (!work) return false;
  if (work.visibility === 'public') return true;
  const maintainerIds = (
    await db
      .select({ id: workMaintainers.userId })
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, workId))
  ).map((m) => m.id);
  return canViewWork(user, work, maintainerIds, await grantsFor(db, user));
}
