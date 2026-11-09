/**
 * Zones: regions of page images linked to tokens of a transcription.
 */
import { newId, type ZoneGeometry } from '@varians/core';
import { pages, zones, type Database, type Zone } from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';

export async function zonesOf(db: Database, transcriptionId: string, pageId?: string): Promise<Zone[]> {
  const where = pageId ? and(eq(zones.transcriptionId, transcriptionId), eq(zones.pageId, pageId)) : eq(zones.transcriptionId, transcriptionId);
  return db.select().from(zones).where(where);
}

/** Zones of the given tokens, with the page each stands on. */
export async function zonesOfTokens(db: Database, transcriptionId: string, tokenIds: string[]): Promise<Zone[]> {
  if (tokenIds.length === 0) return [];
  const all = await db.select().from(zones).where(eq(zones.transcriptionId, transcriptionId));
  const wanted = new Set(tokenIds);
  return all.filter((z) => z.tokenIds.some((id) => wanted.has(id)));
}

export interface NewZone {
  /** The id of a zone brought back by an undo; a new one otherwise. */
  id?: string;
  pageId: string;
  geometry: ZoneGeometry;
  tokenIds: string[];
  feature?: { kind: string; description?: string } | null;
}

/** Create zones; the page must belong to the transcription's witness. An id already taken fails the whole call. */
export async function createZones(db: Database, transcriptionId: string, witnessId: string, inputs: NewZone[]): Promise<Zone[]> {
  if (inputs.length === 0) return [];
  const pageIds = [...new Set(inputs.map((z) => z.pageId))];
  const known = await db.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, pageIds), eq(pages.witnessId, witnessId)));
  const allowed = new Set(known.map((p) => p.id));
  for (const z of inputs) if (!allowed.has(z.pageId)) throw new Error('page does not belong to this witness');
  const rows = inputs.map((z) => ({ id: z.id ?? newId(), transcriptionId, pageId: z.pageId, geometry: z.geometry, tokenIds: z.tokenIds, feature: z.feature ?? null }));
  return db.insert(zones).values(rows).returning();
}

export async function updateZone(db: Database, transcriptionId: string, zoneId: string, fields: Partial<Pick<NewZone, 'geometry' | 'tokenIds' | 'feature'>>): Promise<Zone | null> {
  const set: Record<string, unknown> = {};
  if (fields.geometry) set.geometry = fields.geometry;
  if (fields.tokenIds) set.tokenIds = fields.tokenIds;
  if (fields.feature !== undefined) set.feature = fields.feature;
  if (Object.keys(set).length === 0) return (await db.select().from(zones).where(and(eq(zones.id, zoneId), eq(zones.transcriptionId, transcriptionId))))[0] ?? null;
  const [row] = await db
    .update(zones)
    .set(set)
    .where(and(eq(zones.id, zoneId), eq(zones.transcriptionId, transcriptionId)))
    .returning();
  return row ?? null;
}

/**
 * New shapes for several zones of a transcription at once, all or none:
 * boxes moved or resized together. Returns the zones changed; ids not of
 * this transcription change nothing.
 */
export async function updateZoneGeometries(db: Database, transcriptionId: string, changes: { id: string; geometry: ZoneGeometry }[]): Promise<Zone[]> {
  if (changes.length === 0) return [];
  return db.transaction(async (tx) => {
    const out: Zone[] = [];
    for (const change of changes) {
      const [row] = await tx
        .update(zones)
        .set({ geometry: change.geometry })
        .where(and(eq(zones.id, change.id), eq(zones.transcriptionId, transcriptionId)))
        .returning();
      if (row) out.push(row);
    }
    return out;
  });
}

export async function deleteZones(db: Database, transcriptionId: string, zoneIds: string[]): Promise<number> {
  if (zoneIds.length === 0) return 0;
  const rows = await db
    .delete(zones)
    .where(and(eq(zones.transcriptionId, transcriptionId), inArray(zones.id, zoneIds)))
    .returning({ id: zones.id });
  return rows.length;
}

/** Drop token ids that no longer exist in the stream from every zone; remove zones left without tokens and without a feature. */
export async function pruneZones(db: Database, transcriptionId: string, liveTokenIds: Set<string>): Promise<{ updated: number; removed: number }> {
  const all = await db.select().from(zones).where(eq(zones.transcriptionId, transcriptionId));
  let updated = 0;
  let removed = 0;
  for (const z of all) {
    const kept = z.tokenIds.filter((id) => liveTokenIds.has(id));
    if (kept.length === z.tokenIds.length) continue;
    if (kept.length === 0 && !z.feature) {
      await db.delete(zones).where(eq(zones.id, z.id));
      removed++;
    } else {
      await db.update(zones).set({ tokenIds: kept }).where(eq(zones.id, z.id));
      updated++;
    }
  }
  return { updated, removed };
}
