/**
 * The collation cache against a real PostgreSQL: what is collated is written
 * once and read back, a segment whose inputs changed is collated again and
 * the others are not, and some segments can be asked for by themselves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isToken, newId, segmentAt, type Token } from '@varians/core';
import {
  collationCache,
  createDatabase,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import {
  collateEdition,
  collateSegment,
  collateSegments,
  loadEditionContext,
  serializeCollation,
} from './collation.ts';
import { saveOps } from './documents/service.ts';
import { seedSample } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
let editionId: string;

const cacheRows = async () =>
  (await db.select().from(collationCache).where(eq(collationCache.editionId, editionId))).sort(
    (a, b) => a.segmentId.localeCompare(b.segmentId),
  );

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Cache', passwordHash: 'x' });
  editionId = (await seedSample(db, userId)).editionId;
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('collateSegments', () => {
  it('writes the collation of every segment to the cache once, and reads it back as it was', async () => {
    await db.delete(collationCache).where(eq(collationCache.editionId, editionId));
    const first = await collateEdition(db, await loadEditionContext(db, editionId));
    const written = await cacheRows();
    expect(written.map((r) => r.segmentId).sort()).toEqual([...first.keys()].sort());
    expect(first.size).toBeGreaterThan(5);
    const second = await collateEdition(db, await loadEditionContext(db, editionId));
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [id, collation] of first)
      expect(serializeCollation(second.get(id)!)).toEqual(serializeCollation(collation));
    // Nothing was collated or written the second time.
    expect((await cacheRows()).map((r) => [r.segmentId, r.inputHash, r.computedAt])).toEqual(
      written.map((r) => [r.segmentId, r.inputHash, r.computedAt]),
    );
  });

  it('collates again the segment whose inputs changed, and no other', async () => {
    const before = await cacheRows();
    const context = await loadEditionContext(db, editionId);
    // A word of a witness, in the first segment that witness has.
    const [transcription] = [...context.transcriptions.values()];
    const items = transcription!.content.items;
    const index = items.findIndex(
      (item) =>
        isToken(item) &&
        item.segment?.segmentId &&
        before.some((r) => r.segmentId === item.segment!.segmentId),
    );
    const token = items[index] as Token;
    const segmentId = segmentAt(transcription!.content, index)!.segmentId!;
    await saveOps(db, 'transcription', transcription!.id, userId, transcription!.version, [
      { t: 'set', id: token.id, fields: { form: 'ξξξ', norm: 'ξξξ' } },
    ]);
    await collateEdition(db, await loadEditionContext(db, editionId));
    const after = await cacheRows();
    expect(after.map((r) => r.segmentId)).toEqual(before.map((r) => r.segmentId));
    const changed = after.filter((r, i) => r.inputHash !== before[i]!.inputHash);
    expect(changed.map((r) => r.segmentId)).toEqual([segmentId]);
    // The others were not written again.
    after.forEach((r, i) => {
      if (r.segmentId !== segmentId)
        expect(r.computedAt.getTime()).toBe(before[i]!.computedAt.getTime());
    });
  });

  it('gives some segments by themselves, in the order asked, as the whole collation gives them', async () => {
    const context = await loadEditionContext(db, editionId);
    const whole = await collateEdition(db, context);
    const ids = [...whole.keys()];
    const asked = [ids[3]!, ids[0]!, ids[3]!, ids[2]!];
    const some = await collateSegments(db, context, asked);
    expect([...some.keys()]).toEqual([ids[3], ids[0], ids[2]]);
    for (const [id, collation] of some)
      expect(serializeCollation(collation)).toEqual(serializeCollation(whole.get(id)!));
    expect(serializeCollation(await collateSegment(db, context, ids[1]!))).toEqual(
      serializeCollation(whole.get(ids[1]!)!),
    );
    expect((await collateSegments(db, context, [])).size).toBe(0);
  });

  it('collates a segment whose cache row is gone', async () => {
    const context = await loadEditionContext(db, editionId);
    const [row] = await cacheRows();
    await db.delete(collationCache).where(eq(collationCache.segmentId, row!.segmentId));
    const again = await collateSegment(db, context, row!.segmentId);
    expect(again.sites.length).toBeGreaterThanOrEqual(0);
    expect((await cacheRows()).map((r) => r.segmentId)).toContain(row!.segmentId);
  });
});

describe('collateSegments with a budget', () => {
  it('collates the budget of segments nearest the one named, and leaves the others for later', async () => {
    const context = await loadEditionContext(db, editionId);
    const ids = [...(await collateEdition(db, context)).keys()];
    expect(ids.length).toBeGreaterThan(6);
    await db.delete(collationCache).where(eq(collationCache.editionId, editionId));
    const first = await collateSegments(db, context, ids, { budget: 3, near: ids[5]! });
    expect([...first.keys()].sort()).toEqual([ids[4]!, ids[5]!, ids[6]!].sort());
    expect((await cacheRows()).map((r) => r.segmentId).sort()).toEqual([...first.keys()].sort());
    // What is cached is given besides the budget's worth more.
    const second = await collateSegments(db, context, ids, { budget: 2, near: ids[5]! });
    expect(second.size).toBe(5);
    expect([...first.keys()].every((id) => second.has(id))).toBe(true);
    // A budget the lacking fit in gives everything, as without one.
    const all = await collateSegments(db, context, ids, { budget: 100 });
    expect([...all.keys()]).toEqual(ids);
  });
});
