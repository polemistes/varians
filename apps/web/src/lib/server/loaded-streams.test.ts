/**
 * The kept texts against a real PostgreSQL: a text is handed out again while
 * its row is unchanged, and read anew once anything has written the row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type Token } from '@varians/core';
import {
  createDatabase,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { loadEditionContext } from './collation.ts';
import { forgetLoadedStreams, loadEditionText, loadTranscriptions } from './loaded-streams.ts';
import { seedSample } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
let editionId: string;
let ids: string[];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Kept', passwordHash: 'x' });
  editionId = (await seedSample(db, userId)).editionId;
  ids = [...(await loadEditionContext(db, editionId)).transcriptions.keys()];
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('loaded transcriptions', () => {
  it('hands out the same text again while the row is unchanged, with its version and witness', async () => {
    forgetLoadedStreams();
    const first = await loadTranscriptions(db, ids);
    expect(first.map((t) => t.id).sort()).toEqual([...ids].sort());
    const again = await loadTranscriptions(db, ids);
    for (const t of first) {
      const other = again.find((x) => x.id === t.id)!;
      expect(other.content).toBe(t.content);
      expect([other.version, other.witnessId]).toEqual([t.version, t.witnessId]);
    }
    // Ids that name nothing are left out.
    expect(await loadTranscriptions(db, ['nothing'])).toEqual([]);
    expect(await loadTranscriptions(db, [])).toEqual([]);
  });

  it('reads the text anew once the row has been written, however it was written', async () => {
    const [id] = ids;
    const before = (await loadTranscriptions(db, [id!]))[0]!;
    const changed = structuredClone(before.content);
    (changed.items.find((i) => i.kind === 'token') as Token).form = 'ἄλλο';
    // Written by hand, with the version as it was.
    await db.update(transcriptions).set({ content: changed }).where(eq(transcriptions.id, id!));
    const after = (await loadTranscriptions(db, [id!]))[0]!;
    expect(after.content).not.toBe(before.content);
    expect((after.content.items.find((i) => i.kind === 'token') as Token).form).toBe('ἄλλο');
    // And handed out again from there.
    expect((await loadTranscriptions(db, [id!]))[0]!.content).toBe(after.content);
    await db
      .update(transcriptions)
      .set({ content: before.content })
      .where(eq(transcriptions.id, id!));
    const back = (await loadTranscriptions(db, [id!]))[0]!;
    expect(back.content).toEqual(before.content);
  });

  it('keeps nothing inside a transaction, and hands out nothing kept to it', async () => {
    forgetLoadedStreams();
    const outside = (await loadTranscriptions(db, ids))[0]!;
    await db.transaction(async (tx) => {
      const inside = (await loadTranscriptions(tx as unknown as Database, [outside.id]))[0]!;
      expect(inside.content).not.toBe(outside.content);
      expect(inside.content).toEqual(outside.content);
    });
    // What was kept outside is still the kept.
    expect((await loadTranscriptions(db, [outside.id]))[0]!.content).toBe(outside.content);
  });
});

describe('loaded edition text', () => {
  it('is handed out again until the edition is written, and not after', async () => {
    forgetLoadedStreams();
    const first = (await loadEditionText(db, editionId))!;
    expect((await loadEditionText(db, editionId))!.content).toBe(first.content);
    await db
      .update(editions)
      .set({ content: structuredClone(first.content) })
      .where(eq(editions.id, editionId));
    const after = (await loadEditionText(db, editionId))!;
    expect(after.content).not.toBe(first.content);
    expect(after.content).toEqual(first.content);
    expect(await loadEditionText(db, 'nothing')).toBeNull();
  });
});
