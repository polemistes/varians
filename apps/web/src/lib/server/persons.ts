/**
 * Persons: who made or did something recorded here. Every
 * account has one, under the account's id; persons from imports may have
 * none, and are claimed by the account that gives their ORCID iD.
 */

import { normalizeOrcid } from '@varians/core';
import { changesets, moments, notes, persons, type Database, type Person } from '@varians/db';
import { and, eq, isNull, ne } from 'drizzle-orm';

/** The person of an account, made when it is missing. */
export async function personOfAccount(db: Database, userId: string, name?: string): Promise<Person> {
  const [found] = await db.select().from(persons).where(eq(persons.userId, userId));
  if (found) return found;
  const [made] = await db.insert(persons).values({ id: userId, name: name ?? 'Unnamed', userId }).onConflictDoUpdate({ target: persons.id, set: { userId } }).returning();
  return made!;
}

export type SetOrcidResult = { ok: true; orcid: string | null; claimed: string | null } | { ok: false; error: 'invalid' | 'taken' };

/**
 * Set or clear an account's ORCID iD. An iD another account has is refused;
 * one a person without an account has claims that person: what they made
 * becomes the account's person's, and the duplicate goes.
 */
export async function setOrcid(db: Database, userId: string, input: string): Promise<SetOrcidResult> {
  const own = await personOfAccount(db, userId);
  if (input.trim() === '') {
    await db.update(persons).set({ orcid: null }).where(eq(persons.id, own.id));
    return { ok: true, orcid: null, claimed: null };
  }
  const orcid = normalizeOrcid(input);
  if (!orcid) return { ok: false, error: 'invalid' };
  return db.transaction(async (tx) => {
    const [holder] = await tx.select().from(persons).where(and(eq(persons.orcid, orcid), ne(persons.id, own.id)));
    if (holder?.userId) return { ok: false, error: 'taken' } as const;
    let claimed: string | null = null;
    if (holder) {
      await tx.update(changesets).set({ personId: own.id }).where(eq(changesets.personId, holder.id));
      await tx.update(moments).set({ personId: own.id }).where(eq(moments.personId, holder.id));
      await tx.update(notes).set({ personId: own.id }).where(eq(notes.personId, holder.id));
      await tx.delete(persons).where(and(eq(persons.id, holder.id), isNull(persons.userId)));
      claimed = holder.name;
    }
    await tx.update(persons).set({ orcid }).where(eq(persons.id, own.id));
    return { ok: true, orcid, claimed } as const;
  });
}
