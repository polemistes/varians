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
import { loadEditionContext } from '../collation.ts';
import { collateEdition } from '../passages.ts';
import { segmentsOfSites } from '../reader.ts';
import { labelOfSegments } from '../../reader/sites.ts';
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
    const passages = await collateEdition(db, context);
    expect(passages.flatMap((p) => p.segments.map((s) => s.segmentId))).toHaveLength(10);
    const labels = await db.query.segments.findMany({
      where: (t, { eq }) => eq(t.workId, result.workId),
    });
    const labelOf = Object.fromEntries(labels.map((s) => [s.id, s.label]));
    const lines: string[] = [];
    for (const passage of passages) {
      const of = segmentsOfSites(passage.collation.sites, passage.baseUnits, passage.segments);
      lines.push(
        ...formatApparatus(
          apparatusEntries(passage.collation, '', {}, undefined, ['A', 'B', 'C']).map((e) => ({
            ...e,
            label: labelOfSegments(of[e.siteIndex] ?? [], labelOf),
          })),
        ),
      );
    }
    expect(lines).toContain('1.2 μυρί᾽ A C : μυρία B');
    expect(lines).toContain('1.2 ἄλγε᾽ ἔθηκε A C : ἄλγεα θῆκε B');
    expect(lines.some((l) => l.startsWith('1.9 Λητοῦς καὶ Διὸς A C : Διὸς καὶ Λητοῦς B'))).toBe(
      true,
    );
    // C has lost words of 1.5: it is not there, and the apparatus says nothing of the loss.
    expect(lines.some((l) => l.startsWith('1.5') && / C\b/u.test(l))).toBe(false);
    // B and C are without line 6 within the stretch they cover: one site over the whole line, which is not in them.
    const six = passages.find((p) => p.segments.some((s) => labelOf[s.segmentId] === '1.6'))!;
    expect(six.collation.absent).toEqual([]);
    expect(lines).toContain('1.6 ἐξ … ἐρίσαντε A : om. B C');
    // The cache answers the second time.
    const again = await collateEdition(db, context);
    expect(again.map((p) => p.segments)).toEqual(passages.map((p) => p.segments));
  });
});
