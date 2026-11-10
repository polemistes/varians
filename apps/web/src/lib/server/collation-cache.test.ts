/**
 * The collation cache against a real PostgreSQL: every segment collated
 * alone is written once and read back, with each passage of several
 * segments under its first; a segment whose inputs changed is collated
 * again with its passage, and the others are not; and the passages that hold
 * some segments can be asked for by themselves.
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
import { loadEditionContext, segmentOrderOf, serializeCollation } from './collation.ts';
import {
  collateEdition,
  collatePassagesFor,
  collateSegment,
  forgetCollations,
  type PassageResult,
} from './passages.ts';
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

/** A passage as data, for comparing two collations of it. */
const plain = (p: PassageResult) => ({
  segmentId: p.segmentId,
  segments: p.segments,
  baseUnits: p.baseUnits,
  collation: serializeCollation(p.collation),
});

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

describe('the collation cache', () => {
  it('writes every segment alone, and every passage of several under its first, once, and reads them back as they were', async () => {
    await db.delete(collationCache).where(eq(collationCache.editionId, editionId));
    forgetCollations();
    const context = await loadEditionContext(db, editionId);
    const first = await collateEdition(db, context);
    const written = await cacheRows();
    expect(written.map((r) => r.segmentId).sort()).toEqual(
      [...segmentOrderOf(context.edition.content)].sort(),
    );
    expect(first.length).toBeGreaterThan(3);
    // A passage of several segments is kept with its first; one of one segment is its collation alone.
    for (const p of first) {
      const row = written.find((r) => r.segmentId === p.segmentId)!;
      expect('passage' in (row.result as object)).toBe(p.segments.length > 1);
    }
    expect(first.some((p) => p.segments.length > 1)).toBe(true);
    const second = await collateEdition(db, await loadEditionContext(db, editionId));
    expect(second.map(plain)).toEqual(first.map(plain));
    // Nothing was collated or written the second time.
    expect((await cacheRows()).map((r) => [r.segmentId, r.inputHash, r.computedAt])).toEqual(
      written.map((r) => [r.segmentId, r.inputHash, r.computedAt]),
    );
  });

  it('collates again the segment whose inputs changed, with its passage, and no other', async () => {
    const before = await cacheRows();
    const context = await loadEditionContext(db, editionId);
    const passages = await collateEdition(db, context);
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
    const passage = passages.find((p) => p.segments.some((s) => s.segmentId === segmentId))!;
    await saveOps(db, 'transcription', transcription!.id, userId, transcription!.version, [
      { t: 'set', id: token.id, fields: { form: 'ξξξ', norm: 'ξξξ' } },
    ]);
    await collateEdition(db, await loadEditionContext(db, editionId));
    const after = await cacheRows();
    expect(after.map((r) => r.segmentId)).toEqual(before.map((r) => r.segmentId));
    const changed = after.filter((r, i) => r.inputHash !== before[i]!.inputHash);
    expect(changed.map((r) => r.segmentId)).toEqual([segmentId]);
    // The others were not written again: only the segment and the row its passage is kept in.
    const rewritten = after
      .filter((r, i) => r.computedAt.getTime() !== before[i]!.computedAt.getTime())
      .map((r) => r.segmentId)
      .sort();
    expect(rewritten).toEqual(
      [...new Set([segmentId, ...(passage.segments.length > 1 ? [passage.segmentId] : [])])].sort(),
    );
  });

  it('gives the passages that hold some segments, in the order of the text, as the whole collation gives them', async () => {
    const context = await loadEditionContext(db, editionId);
    const whole = await collateEdition(db, context);
    const order = segmentOrderOf(context.edition.content);
    const asked = [order[3]!, order[0]!, order[3]!, order[2]!];
    const { passages: some, pending } = await collatePassagesFor(db, context, asked);
    expect(pending).toEqual([]);
    const holding = whole.filter((p) => p.segments.some((s) => asked.includes(s.segmentId)));
    expect(some.map(plain)).toEqual(holding.map(plain));
    expect((await collatePassagesFor(db, context, [])).passages).toEqual([]);
    // A segment collated alone, as the plan reads it.
    const alone = await collateSegment(db, context, order[1]!);
    expect(alone.baseId).toBe(context.edition.id);
  });

  it('collates a segment whose cache row is gone', async () => {
    const context = await loadEditionContext(db, editionId);
    const [row] = await cacheRows();
    await db.delete(collationCache).where(eq(collationCache.segmentId, row!.segmentId));
    forgetCollations();
    const again = await collateSegment(db, context, row!.segmentId);
    expect(again.sites.length).toBeGreaterThanOrEqual(0);
    expect((await cacheRows()).map((r) => r.segmentId)).toContain(row!.segmentId);
    // And the passage it is in comes again whole.
    const whole = await collateEdition(db, context);
    expect(
      whole.flatMap((p) => p.segments.filter((s) => s.printed).map((s) => s.segmentId)),
    ).toEqual(segmentOrderOf(context.edition.content));
  });
});

describe('the collation cache with a budget', () => {
  it('collates the budget of segments nearest the one named, makes the passages they settle, and leaves the others for later', async () => {
    const context = await loadEditionContext(db, editionId);
    const whole = await collateEdition(db, context);
    const order = segmentOrderOf(context.edition.content);
    expect(order.length).toBeGreaterThan(6);
    await db.delete(collationCache).where(eq(collationCache.editionId, editionId));
    forgetCollations();
    const near = order[5]!;
    const first = await collatePassagesFor(db, context, null, { budget: 5, near });
    // Five segments alone, nearest the one named.
    expect((await cacheRows()).length).toBe(5);
    const made = first.passages.flatMap((p) => p.segments.map((s) => s.segmentId));
    for (const p of first.passages)
      expect(plain(p)).toEqual(plain(whole.find((w) => w.segmentId === p.segmentId)!));
    expect(new Set([...made, ...first.pending])).toEqual(
      new Set(whole.flatMap((p) => p.segments.map((s) => s.segmentId))),
    );
    // What is cached is given besides the budget's worth more.
    const second = await collatePassagesFor(db, context, null, { budget: 2, near });
    expect(second.pending.length).toBeLessThanOrEqual(first.pending.length);
    // A budget the lacking fit in gives everything, as without one.
    const all = await collatePassagesFor(db, context, null, { budget: 100 });
    expect(all.pending).toEqual([]);
    expect(all.passages.map(plain)).toEqual(whole.map(plain));
  });
});
