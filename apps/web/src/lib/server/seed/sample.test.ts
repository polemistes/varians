import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, toText } from '@varians/core';
import {
  createDatabase,
  referenceSchemes,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { collateEdition, loadEditionContext } from '../collation.ts';
import { apparatusEntries, formatApparatus } from '@varians/core';
import { seedSample } from './sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();

const SAMPLE_WITNESS_SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

async function cleanup() {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SAMPLE_WITNESS_SLUGS));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await cleanup();
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Seeder', passwordHash: 'x' });
});

afterAll(async () => {
  await cleanup();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('seedSample', () => {
  it('builds the Iliad sample and collates it', async () => {
    const result = await seedSample(db, userId);
    expect(result.editionId).not.toBe('');
    const context = await loadEditionContext(db, result.editionId);
    expect(context.sigla.map((s) => s.siglum)).toEqual(['A', 'B', 'C', 'T']);
    expect(toText(context.edition.content).startsWith('μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος')).toBe(
      true,
    );
    const collations = await collateEdition(db, context);
    expect(collations.size).toBe(10);
    const labels = await db.query.segments.findMany({
      where: (t, { eq }) => eq(t.workId, result.workId),
    });
    const labelOf = new Map(labels.map((s) => [s.id, s.label]));
    const lines: string[] = [];
    for (const [segmentId, collation] of collations) {
      lines.push(
        ...formatApparatus(
          apparatusEntries(collation, labelOf.get(segmentId)!, {}, undefined, ['A', 'B', 'C']),
        ),
      );
    }
    expect(lines).toContain('1.2 μυρί᾽ A C : μυρία B');
    expect(lines).toContain('1.2 ἄλγε᾽ ἔθηκε A C : ἄλγεα θῆκε B');
    expect(lines.some((l) => l.startsWith('1.9 Λητοῦς καὶ Διὸς A C : Διὸς καὶ Λητοῦς B'))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith('1.5') && l.includes('lac. C'))).toBe(true);
    // B and C lack line 6 within the stretch they cover: one site over the whole line, which they omit.
    const six = [...collations.entries()].find(([id]) => labelOf.get(id) === '1.6')![1];
    expect(six.absent).toEqual([]);
    expect(lines).toContain('1.6 ἐξ … ἐρίσαντε A : om. B C');
    // The cache answers the second time.
    const again = await collateEdition(db, context);
    expect(again.size).toBe(10);
  });
});
