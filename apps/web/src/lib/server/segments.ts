/**
 * Segments of a work: found or created by label through the work's scheme.
 */

import { formatLabel, newId, parseLabel, sortKey, type Address, type Scheme } from '@varians/core';
import { referenceSchemes, segments, works, type Database, type Segment } from '@varians/db';
import { and, eq } from 'drizzle-orm';

export interface WorkScheme {
  workId: string;
  scheme: Scheme;
}

export async function schemeOfWork(db: Database, workId: string): Promise<WorkScheme> {
  const [row] = await db
    .select({ levels: referenceSchemes.levels })
    .from(works)
    .innerJoin(referenceSchemes, eq(referenceSchemes.id, works.schemeId))
    .where(eq(works.id, workId));
  if (!row) throw new Error(`no work ${workId}`);
  return { workId, scheme: { levels: row.levels } };
}

/** The segment with this label, created if it does not exist. Null when the label does not fit the scheme. */
export async function resolveSegment(
  db: Database,
  work: WorkScheme,
  label: string,
): Promise<Segment | null> {
  const address = parseLabel(work.scheme, label);
  if (!address) return null;
  return resolveAddress(db, work, address);
}

export async function resolveAddress(
  db: Database,
  work: WorkScheme,
  address: Address,
): Promise<Segment> {
  const label = formatLabel(work.scheme, address);
  const [existing] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.workId, work.workId), eq(segments.label, label)));
  if (existing) return existing;
  const [created] = await db
    .insert(segments)
    .values({
      id: newId(),
      workId: work.workId,
      address,
      label,
      sortKey: sortKey(work.scheme, address),
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.workId, work.workId), eq(segments.label, label)));
  return raced!;
}

/** Resolve many labels at once, returning a map from label to segment (labels that do not parse are left out). */
export async function resolveLabels(
  db: Database,
  work: WorkScheme,
  labels: string[],
): Promise<Map<string, Segment>> {
  const out = new Map<string, Segment>();
  for (const label of [...new Set(labels)]) {
    const segment = await resolveSegment(db, work, label);
    if (segment) out.set(label, segment);
  }
  return out;
}

/** All segments of a work in the order of the work. */
export async function segmentsOfWork(db: Database, workId: string): Promise<Segment[]> {
  return db.select().from(segments).where(eq(segments.workId, workId)).orderBy(segments.sortKey);
}
