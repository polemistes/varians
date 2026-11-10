import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, segmentIds, toText } from '@varians/core';
import {
  transcriptions,
  createDatabase,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { grantsFor } from './authz.ts';
import { candidateWitnesses, createEdition } from './editions.ts';
import { loadEditionContext } from './collation.ts';
import { seedSample } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('createEdition', () => {
  it('lists the candidate witnesses and starts an edition from one for a range of segments', async () => {
    const sample = await seedSample(db, userId);
    const owner = { id: userId, role: 'member' as const };
    const candidates = await candidateWitnesses(
      db,
      sample.workId,
      owner,
      await grantsFor(db, owner),
    );
    expect(candidates.map((c) => c.siglum)).toEqual(['A', 'B', 'C']);
    expect(candidates.find((c) => c.siglum === 'B')!.segments).toBe(9);
    const base = candidates.find((c) => c.siglum === 'B')!;
    const allSegments = await db.query.segments.findMany({
      where: (t, { eq }) => eq(t.workId, sample.workId),
    });
    const chosen = allSegments
      .filter((s) => ['1.1', '1.2', '1.3'].includes(s.label))
      .map((s) => s.id);
    const edition = await createEdition(
      db,
      {
        workId: sample.workId,
        title: 'Iliad 1, a working edition',
        baseTranscriptionId: base.transcriptionId,
        segmentIds: chosen,
        sigla: candidates.map((c) => ({
          witnessId: c.witnessId,
          transcriptionId: c.transcriptionId,
          siglum: c.siglum,
        })),
        conventions: { lineation: 'verse' },
      },
      userId,
    );
    expect(edition.slug.startsWith('iliad-1-a-working-edition')).toBe(true);
    const context = await loadEditionContext(db, edition.id);
    expect(segmentIds(context.edition.content)).toHaveLength(3);
    expect(toText(context.edition.content).split('\n')[1]).toBe(
      'οὐλομένην, ἣ μυρία Ἀχαιοῖς ἄλγεα θῆκε,',
    );
    expect(context.sigla.map((s) => s.siglum)).toEqual(['A', 'B', 'C']);
    expect(context.edition.version).toBe(1);
  });

  it("never offers another person's draft transcription as a witness", async () => {
    const sample = await seedSample(db, userId);
    const stranger = { id: newId(), role: 'member' as const };
    await db.insert(users).values({
      id: stranger.id,
      email: `${stranger.id}@test`,
      name: 'Stranger',
      passwordHash: 'x',
    });
    try {
      await db
        .update(transcriptions)
        .set({ visibility: 'draft' })
        .where(eq(transcriptions.ownerId, userId));
      expect(
        await candidateWitnesses(db, sample.workId, stranger, await grantsFor(db, stranger)),
      ).toEqual([]);
      const [a] = await db.select().from(witnesses).where(eq(witnesses.slug, 'venetus-a'));
      await db
        .update(transcriptions)
        .set({ visibility: 'published' })
        .where(eq(transcriptions.witnessId, a!.id));
      expect(
        (await candidateWitnesses(db, sample.workId, stranger, await grantsFor(db, stranger))).map(
          (c) => c.siglum,
        ),
      ).toEqual(['A']);
    } finally {
      await db.delete(users).where(eq(users.id, stranger.id));
    }
  });
});
