/**
 * Conjectures, reported readings, adoptions and site reviews on the server.
 * The text changes themselves travel as operations through the documents
 * service; these functions keep the records around them.
 */

import { newId } from '@varians/core';
import {
  conjectures,
  editionAdoptions,
  editionSiteReviews,
  reportedReadings,
  type Conjecture,
  type ConjectureKind,
  type Database,
  type ReportedReading,
} from '@varians/db';
import { and, eq } from 'drizzle-orm';

export interface NewConjecture {
  workId: string;
  segmentId: string;
  kind: ConjectureKind;
  lemma: string;
  reading: string;
  proposer?: string | null;
  note?: string | null;
  extent?: string | null;
  sequence?: string[] | null;
  supplementsId?: string | null;
  anchor?:
    | { transcriptionId: string; tokenIds: string[] }
    | { editionId: string; tokenIds: string[] }
    | null;
  visibility?: 'draft' | 'published';
}

/** Record a conjecture in the work's catalogue. */
export async function registerConjecture(
  db: Database,
  input: NewConjecture,
  ownerId: string,
): Promise<Conjecture> {
  const [row] = await db
    .insert(conjectures)
    .values({
      id: newId(),
      workId: input.workId,
      segmentId: input.segmentId,
      kind: input.kind,
      lemma: input.lemma.trim(),
      reading: input.reading.trim(),
      proposer: input.proposer?.trim() || null,
      note: input.note?.trim() || null,
      extent: input.extent?.trim() || null,
      sequence: input.sequence ?? null,
      supplementsId: input.supplementsId ?? null,
      anchor: input.anchor ?? null,
      ownerId,
      visibility: input.visibility ?? 'draft',
    })
    .returning();
  return row!;
}

export async function updateConjecture(
  db: Database,
  id: string,
  fields: Partial<Omit<NewConjecture, 'workId'>>,
): Promise<Conjecture | null> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    set[key] = typeof value === 'string' ? value.trim() || null : value;
  }
  if ('lemma' in set && set.lemma === null) set.lemma = '';
  if ('reading' in set && set.reading === null) set.reading = '';
  if (Object.keys(set).length === 0)
    return (await db.select().from(conjectures).where(eq(conjectures.id, id)))[0] ?? null;
  const [row] = await db.update(conjectures).set(set).where(eq(conjectures.id, id)).returning();
  return row ?? null;
}

export async function deleteConjecture(db: Database, id: string): Promise<void> {
  await db.delete(conjectures).where(eq(conjectures.id, id));
}

/** Record that an edition prints a conjecture. The words themselves are changed through the edition's operations. */
export async function adoptConjecture(
  db: Database,
  editionId: string,
  conjectureId: string,
): Promise<void> {
  await db.insert(editionAdoptions).values({ editionId, conjectureId }).onConflictDoNothing();
}

export async function withdrawAdoption(
  db: Database,
  editionId: string,
  conjectureId: string,
): Promise<void> {
  await db
    .delete(editionAdoptions)
    .where(
      and(
        eq(editionAdoptions.editionId, editionId),
        eq(editionAdoptions.conjectureId, conjectureId),
      ),
    );
}

export async function adoptionsOf(db: Database, editionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: editionAdoptions.conjectureId })
    .from(editionAdoptions)
    .where(eq(editionAdoptions.editionId, editionId));
  return new Set(rows.map((r) => r.id));
}

export interface NewReportedReading {
  workId: string;
  segmentId: string;
  witnessId: string;
  lemma: string;
  reading: string;
  source?: string | null;
  note?: string | null;
  visibility?: 'draft' | 'published';
}

export async function reportReading(
  db: Database,
  input: NewReportedReading,
  ownerId: string,
): Promise<ReportedReading> {
  const [row] = await db
    .insert(reportedReadings)
    .values({
      id: newId(),
      workId: input.workId,
      segmentId: input.segmentId,
      witnessId: input.witnessId,
      lemma: input.lemma.trim(),
      reading: input.reading.trim(),
      source: input.source?.trim() || null,
      note: input.note?.trim() || null,
      ownerId,
      visibility: input.visibility ?? 'draft',
    })
    .returning();
  return row!;
}

export async function deleteReportedReading(db: Database, id: string): Promise<void> {
  await db.delete(reportedReadings).where(eq(reportedReadings.id, id));
}

/** Mark a site as reviewed: the editor adopted something there or chose to keep the text. */
export async function reviewSite(
  db: Database,
  editionId: string,
  segmentId: string,
  siteKey: string,
  userId: string | null,
): Promise<void> {
  await db
    .insert(editionSiteReviews)
    .values({ editionId, segmentId, siteKey, reviewedBy: userId })
    .onConflictDoUpdate({
      target: [
        editionSiteReviews.editionId,
        editionSiteReviews.segmentId,
        editionSiteReviews.siteKey,
      ],
      set: { reviewedBy: userId, reviewedAt: new Date() },
    });
}

export async function unreviewSite(
  db: Database,
  editionId: string,
  segmentId: string,
  siteKey: string,
): Promise<void> {
  await db
    .delete(editionSiteReviews)
    .where(
      and(
        eq(editionSiteReviews.editionId, editionId),
        eq(editionSiteReviews.segmentId, segmentId),
        eq(editionSiteReviews.siteKey, siteKey),
      ),
    );
}

/** The reviewed site keys of an edition, by segment. */
export async function reviewedSites(
  db: Database,
  editionId: string,
): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({ segmentId: editionSiteReviews.segmentId, siteKey: editionSiteReviews.siteKey })
    .from(editionSiteReviews)
    .where(eq(editionSiteReviews.editionId, editionId));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = out.get(r.segmentId) ?? new Set<string>();
    set.add(r.siteKey);
    out.set(r.segmentId, set);
  }
  return out;
}
