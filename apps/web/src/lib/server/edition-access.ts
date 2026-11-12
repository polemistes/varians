/**
 * Loading an edition with what a request needs to authorize against it.
 */
import { editionCollaborators, editions, type Database, type Edition } from '@varians/db';
import { eq, or } from 'drizzle-orm';
import { canEditEdition, canPublishEdition, canViewEdition, type Actor } from './authz';
import { hasVersionSql } from './versions';

export interface EditionAccess {
  /** The edition, with whether it has a version that is not withdrawn. */
  edition: Edition & { hasVersion: boolean };
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
  const [row] = await db
    .select({ edition: editions, hasVersion: hasVersionSql('edition', editions.id) })
    .from(editions)
    .where(or(eq(editions.id, idOrSlug), eq(editions.slug, idOrSlug)))
    .limit(1);
  if (!row) return null;
  const edition = { ...row.edition, hasVersion: row.hasVersion };
  const collaboratorIds = (
    await db
      .select({ userId: editionCollaborators.userId })
      .from(editionCollaborators)
      .where(eq(editionCollaborators.editionId, edition.id))
  ).map((c) => c.userId);
  const canEdit = canEditEdition(user, edition, collaboratorIds);
  return {
    edition,
    collaboratorIds,
    canView: canViewEdition(user, edition, collaboratorIds),
    canEdit,
    canPublish: canPublishEdition(user, edition),
  };
}
