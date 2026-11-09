import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { createDatabase, pages, transcriptions, users, witnesses, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { createZones, deleteZones, pruneZones, updateZone, updateZoneGeometries, zonesOf, zonesOfTokens } from './zones.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = { user: newId(), witness: newId(), other: newId(), transcription: newId(), page: newId(), otherPage: newId() };

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values({ id: ids.user, email: `${ids.user}@test`, name: 'Z', passwordHash: 'x' });
  await db.insert(witnesses).values([
    { id: ids.witness, slug: `w-${ids.witness}`, siglum: 'A', name: 'A' },
    { id: ids.other, slug: `w-${ids.other}`, siglum: 'B', name: 'B' },
  ]);
  await db.insert(pages).values([
    { id: ids.page, witnessId: ids.witness, label: '1r', position: 1 },
    { id: ids.otherPage, witnessId: ids.other, label: '1r', position: 1 },
  ]);
  await db.insert(transcriptions).values({ id: ids.transcription, witnessId: ids.witness, name: 'T', ownerId: ids.user });
});

afterAll(async () => {
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(witnesses).where(eq(witnesses.id, ids.other));
  await db.delete(users).where(eq(users.id, ids.user));
  await pool.end();
});

describe('zones', () => {
  it('creates, finds by token, updates, prunes and deletes', async () => {
    const created = await createZones(db, ids.transcription, ids.witness, [
      { pageId: ids.page, geometry: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } }, tokenIds: ['t1', 't2'] },
      { pageId: ids.page, geometry: { polygon: [[0, 0], [0.1, 0], [0.1, 0.1]] }, tokenIds: [], feature: { kind: 'figure', description: 'an initial' } },
    ]);
    expect(created).toHaveLength(2);
    expect((await zonesOf(db, ids.transcription, ids.page)).length).toBe(2);
    expect((await zonesOfTokens(db, ids.transcription, ['t2'])).map((z) => z.id)).toEqual([created[0]!.id]);
    const updated = await updateZone(db, ids.transcription, created[0]!.id, { geometry: { rect: { x: 0.2, y: 0.1, w: 0.2, h: 0.05 } } });
    expect(updated?.geometry.rect?.x).toBe(0.2);
    const pruned = await pruneZones(db, ids.transcription, new Set(['t1']));
    expect(pruned).toEqual({ updated: 1, removed: 0 });
    expect((await zonesOfTokens(db, ids.transcription, ['t2'])).length).toBe(0);
    const gone = await pruneZones(db, ids.transcription, new Set());
    expect(gone).toEqual({ updated: 0, removed: 1 });
    expect(await deleteZones(db, ids.transcription, [created[1]!.id])).toBe(1);
  });

  it('changes several shapes at once, only of its own transcription', async () => {
    const made = await createZones(db, ids.transcription, ids.witness, [
      { pageId: ids.page, geometry: { rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 } }, tokenIds: ['a'] },
      { pageId: ids.page, geometry: { rect: { x: 0.2, y: 0.1, w: 0.1, h: 0.05 } }, tokenIds: ['b'] },
    ]);
    const changed = await updateZoneGeometries(db, ids.transcription, [
      { id: made[0]!.id, geometry: { rect: { x: 0.15, y: 0.1, w: 0.1, h: 0.05 } } },
      { id: made[1]!.id, geometry: { rect: { x: 0.25, y: 0.1, w: 0.1, h: 0.05 } } },
      { id: 'not-a-zone', geometry: { rect: { x: 0, y: 0, w: 0.1, h: 0.1 } } },
    ]);
    expect(changed.map((z) => z.geometry.rect?.x).sort()).toEqual([0.15, 0.25]);
    expect(await updateZoneGeometries(db, newId(), [{ id: made[0]!.id, geometry: { rect: { x: 0, y: 0, w: 0.1, h: 0.1 } } }])).toEqual([]);
    await deleteZones(db, ids.transcription, made.map((z) => z.id));
  });

  it('brings a deleted zone back under its id, and refuses an id taken', async () => {
    const [made] = await createZones(db, ids.transcription, ids.witness, [
      { pageId: ids.page, geometry: { rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 } }, tokenIds: ['a'] },
    ]);
    await deleteZones(db, ids.transcription, [made!.id]);
    const [back] = await createZones(db, ids.transcription, ids.witness, [
      { id: made!.id, pageId: ids.page, geometry: made!.geometry, tokenIds: ['a'] },
    ]);
    expect(back!.id).toBe(made!.id);
    await expect(
      createZones(db, ids.transcription, ids.witness, [{ id: made!.id, pageId: ids.page, geometry: made!.geometry, tokenIds: ['a'] }]),
    ).rejects.toThrow();
    await deleteZones(db, ids.transcription, [made!.id]);
  });

  it('refuses a page of another witness', async () => {
    await expect(createZones(db, ids.transcription, ids.witness, [{ pageId: ids.otherPage, geometry: { rect: { x: 0, y: 0, w: 1, h: 1 } }, tokenIds: [] }])).rejects.toThrow(/witness/);
  });
});
