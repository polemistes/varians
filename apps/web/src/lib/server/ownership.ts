/**
 * Handing an edition or a transcription to another user: the
 * owner offers it, the user named accepts or declines. Only the user named
 * can accept; an administrator cannot accept on their behalf.
 */
import { newId } from '@varians/core';
import {
  editionCollaborators,
  editions,
  ownershipOffers,
  transcriptions,
  users,
  type Database,
  type DocumentKind,
} from '@varians/db';
import { and, eq, sql } from 'drizzle-orm';
import { canViewEdition, type Actor } from './authz.ts';
import { hasVersionSql } from './versions.ts';

export interface OfferView {
  id: string;
  kind: DocumentKind;
  recordId: string;
  title: string;
  /** Where the name leads: an edition's reader, when the person may see it; a transcription's workbench. */
  href: string | null;
  fromName: string;
  toName: string;
  createdAt: Date;
}

export type OfferResult =
  | { ok: true; offerId: string }
  | { ok: false; error: 'no-user' | 'self' | 'open-offer' | 'not-owner' };

async function ownerOf(db: Database, kind: DocumentKind, recordId: string): Promise<string | null> {
  if (kind === 'edition') {
    const [row] = await db
      .select({ ownerId: editions.ownerId })
      .from(editions)
      .where(eq(editions.id, recordId));
    return row?.ownerId ?? null;
  }
  const [row] = await db
    .select({ ownerId: transcriptions.ownerId })
    .from(transcriptions)
    .where(eq(transcriptions.id, recordId));
  return row?.ownerId ?? null;
}

export async function offerOwnership(
  db: Database,
  kind: DocumentKind,
  recordId: string,
  fromUserId: string,
  toEmail: string,
): Promise<OfferResult> {
  if ((await ownerOf(db, kind, recordId)) !== fromUserId) return { ok: false, error: 'not-owner' };
  const [to] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, toEmail.trim().toLowerCase()));
  if (!to) return { ok: false, error: 'no-user' };
  if (to.id === fromUserId) return { ok: false, error: 'self' };
  const [open] = await db
    .select({ id: ownershipOffers.id })
    .from(ownershipOffers)
    .where(
      and(
        eq(ownershipOffers.kind, kind),
        eq(ownershipOffers.recordId, recordId),
        eq(ownershipOffers.status, 'open'),
      ),
    );
  if (open) return { ok: false, error: 'open-offer' };
  const id = newId();
  await db.insert(ownershipOffers).values({ id, kind, recordId, fromUserId, toUserId: to.id });
  return { ok: true, offerId: id };
}

/** The open offer of a record, with the name of the person it is made to; null when there is none. */
export async function openOfferOf(
  db: Database,
  kind: DocumentKind,
  recordId: string,
): Promise<{ id: string; toName: string } | null> {
  const [row] = await db
    .select({ id: ownershipOffers.id, toName: users.name })
    .from(ownershipOffers)
    .innerJoin(users, eq(users.id, ownershipOffers.toUserId))
    .where(
      and(
        eq(ownershipOffers.kind, kind),
        eq(ownershipOffers.recordId, recordId),
        eq(ownershipOffers.status, 'open'),
      ),
    );
  return row ?? null;
}

/** Offers waiting for this user, and those this user made that are still open. */
export async function offersOf(
  db: Database,
  user: Actor,
): Promise<{ incoming: OfferView[]; outgoing: OfferView[] }> {
  const userId = user.id;
  const rows = await db
    .select()
    .from(ownershipOffers)
    .where(
      and(
        eq(ownershipOffers.status, 'open'),
        sql`(${ownershipOffers.toUserId} = ${userId} or ${ownershipOffers.fromUserId} = ${userId})`,
      ),
    );
  const people = new Map(
    (await db.select({ id: users.id, name: users.name }).from(users)).map(
      (u) => [u.id, u.name] as const,
    ),
  );
  const views: (OfferView & { toUserId: string })[] = [];
  for (const row of rows) {
    let title = '';
    let href: string | null = null;
    if (row.kind === 'edition') {
      const [edition] = await db
        .select({
          id: editions.id,
          title: editions.title,
          slug: editions.slug,
          ownerId: editions.ownerId,
          hasVersion: hasVersionSql('edition', editions.id),
        })
        .from(editions)
        .where(eq(editions.id, row.recordId));
      if (!edition) continue;
      title = edition.title;
      const collaboratorIds = (
        await db
          .select({ userId: editionCollaborators.userId })
          .from(editionCollaborators)
          .where(eq(editionCollaborators.editionId, edition.id))
      ).map((c) => c.userId);
      if (canViewEdition(user, edition, collaboratorIds))
        href = `/editions/${encodeURIComponent(edition.slug)}`;
    } else {
      const [transcription] = await db
        .select({ name: transcriptions.name })
        .from(transcriptions)
        .where(eq(transcriptions.id, row.recordId));
      if (!transcription) continue;
      title = transcription.name;
      href = `/transcriptions/${row.recordId}`;
    }
    views.push({
      id: row.id,
      kind: row.kind,
      recordId: row.recordId,
      title,
      href,
      fromName: people.get(row.fromUserId) ?? '',
      toName: people.get(row.toUserId) ?? '',
      createdAt: row.createdAt,
      toUserId: row.toUserId,
    });
  }
  const strip = ({ toUserId: _to, ...view }: OfferView & { toUserId: string }) => view;
  return {
    incoming: views.filter((v) => v.toUserId === userId).map(strip),
    outgoing: views.filter((v) => v.toUserId !== userId).map(strip),
  };
}

/** Settle an offer. Accepting moves ownership; the former owner of an edition stays on as a collaborator. */
export async function answerOffer(
  db: Database,
  offerId: string,
  userId: string,
  answer: 'accept' | 'decline' | 'withdraw',
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(ownershipOffers)
      .where(eq(ownershipOffers.id, offerId))
      .for('update');
    if (!offer || offer.status !== 'open') return false;
    if (answer === 'withdraw' ? offer.fromUserId !== userId : offer.toUserId !== userId)
      return false;
    if (answer === 'accept') {
      // The offer stands only while the one who made it still owns the record; otherwise it lapses.
      const [record] =
        offer.kind === 'edition'
          ? await tx
              .select({ ownerId: editions.ownerId })
              .from(editions)
              .where(eq(editions.id, offer.recordId))
              .for('update')
          : await tx
              .select({ ownerId: transcriptions.ownerId })
              .from(transcriptions)
              .where(eq(transcriptions.id, offer.recordId))
              .for('update');
      if (!record || record.ownerId !== offer.fromUserId) {
        await tx
          .update(ownershipOffers)
          .set({ status: 'withdrawn', settledAt: new Date() })
          .where(eq(ownershipOffers.id, offerId));
        return false;
      }
      if (offer.kind === 'edition') {
        await tx
          .update(editions)
          .set({ ownerId: offer.toUserId })
          .where(eq(editions.id, offer.recordId));
        await tx
          .delete(editionCollaborators)
          .where(
            and(
              eq(editionCollaborators.editionId, offer.recordId),
              eq(editionCollaborators.userId, offer.toUserId),
            ),
          );
        await tx
          .insert(editionCollaborators)
          .values({
            editionId: offer.recordId,
            userId: offer.fromUserId,
            grantedBy: offer.toUserId,
          })
          .onConflictDoNothing();
      } else {
        await tx
          .update(transcriptions)
          .set({ ownerId: offer.toUserId })
          .where(eq(transcriptions.id, offer.recordId));
      }
    }
    const status =
      answer === 'accept' ? 'accepted' : answer === 'decline' ? 'declined' : 'withdrawn';
    await tx
      .update(ownershipOffers)
      .set({ status, settledAt: new Date() })
      .where(eq(ownershipOffers.id, offerId));
    return true;
  });
}
