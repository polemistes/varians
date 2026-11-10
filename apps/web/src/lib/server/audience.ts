/**
 * Who an edition view is for, and which conjectures and reported readings
 * it may show.
 */
import { workMaintainers, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import { canViewConjecture, grantsFor, type Actor } from './authz.ts';

/**
 * Who an edition view is for. Readers see the work's published conjectures
 * and reported readings only; an editor in the editor sees, besides, the
 * drafts the authorization rules let them see.
 */
export type Audience = { kind: 'public' } | { kind: 'editor'; viewer: Actor };

export const PUBLIC: Audience = { kind: 'public' };

/** Segments a refresh may ask for at once. */
export const MAX_REFRESH = 100;

/** Whether a conjecture or reported reading of the work shows in a view for this audience. */
export async function recordFilter(
  db: Database,
  workId: string,
  audience: Audience,
): Promise<(row: { id: string; ownerId: string; workId: string; visibility: string }) => boolean> {
  if (audience.kind === 'public') return (row) => row.visibility === 'published';
  const grants = await grantsFor(db, audience.viewer);
  const workMaintainerIds = (
    await db
      .select({ id: workMaintainers.userId })
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, workId))
  ).map((m) => m.id);
  return (row) =>
    canViewConjecture(audience.viewer, row as Parameters<typeof canViewConjecture>[1], {
      workMaintainerIds,
      grants,
    });
}
