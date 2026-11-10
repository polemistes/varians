/**
 * Collaborators of an edition: the people the owner invites to edit it.
 * Granting reaches the transcriptions the conspectus names and
 * the owner's conjectures on the work; authz derives that from these rows.
 */
import { editionCollaborators, editions, users, type Database } from '@varians/db';
import { and, eq, sql } from 'drizzle-orm';

export interface Collaborator {
  userId: string;
  name: string;
  email: string;
}

export async function listCollaborators(db: Database, editionId: string): Promise<Collaborator[]> {
  return db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(editionCollaborators)
    .innerJoin(users, eq(users.id, editionCollaborators.userId))
    .where(eq(editionCollaborators.editionId, editionId))
    .orderBy(users.name);
}

export type AddResult =
  | { ok: true; collaborator: Collaborator }
  | { ok: false; error: 'no-user' | 'owner' | 'already' };

export async function addCollaborator(
  db: Database,
  editionId: string,
  email: string,
  grantedBy: string,
): Promise<AddResult> {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
  if (!user) return { ok: false, error: 'no-user' };
  const [edition] = await db
    .select({ ownerId: editions.ownerId })
    .from(editions)
    .where(eq(editions.id, editionId));
  if (edition?.ownerId === user.id) return { ok: false, error: 'owner' };
  const inserted = await db
    .insert(editionCollaborators)
    .values({ editionId, userId: user.id, grantedBy })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return { ok: false, error: 'already' };
  return { ok: true, collaborator: { userId: user.id, name: user.name, email: user.email } };
}

export async function removeCollaborator(
  db: Database,
  editionId: string,
  userId: string,
): Promise<boolean> {
  const removed = await db
    .delete(editionCollaborators)
    .where(
      and(eq(editionCollaborators.editionId, editionId), eq(editionCollaborators.userId, userId)),
    )
    .returning();
  return removed.length > 0;
}
