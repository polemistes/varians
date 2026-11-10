import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultProfile, newId } from '@varians/core';
import {
  createDatabase,
  editionCollaborators,
  editions,
  referenceSchemes,
  users,
  works,
  type Database,
} from '@varians/db';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { answerOffer, offerOwnership, offersOf } from './ownership.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = { owner: newId(), other: newId(), scheme: newId(), work: newId(), edition: newId() };

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values([
    { id: ids.owner, email: `${ids.owner}@test`, name: 'Owner', passwordHash: 'x' },
    { id: ids.other, email: `${ids.other}@test`, name: 'Other', passwordHash: 'x' },
  ]);
  await db.insert(referenceSchemes).values({
    id: ids.scheme,
    name: 'l',
    levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }],
  });
  await db.insert(works).values({
    id: ids.work,
    slug: `w-${ids.work}`,
    title: 'W',
    schemeId: ids.scheme,
    profile: defaultProfile('grc'),
  });
  await db.insert(editions).values({
    id: ids.edition,
    workId: ids.work,
    slug: `e-${ids.edition}`,
    title: 'E',
    ownerId: ids.owner,
    conventions: DEFAULT_CONVENTIONS,
  });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(eq(users.id, ids.owner));
  await db.delete(users).where(eq(users.id, ids.other));
  await pool.end();
});

describe('ownership offers', () => {
  it('offers, refuses a second open offer, and moves ownership on acceptance', async () => {
    expect(
      await offerOwnership(db, 'edition', ids.edition, ids.other, `${ids.owner}@test`),
    ).toEqual({ ok: false, error: 'not-owner' });
    const offered = await offerOwnership(
      db,
      'edition',
      ids.edition,
      ids.owner,
      `${ids.other}@TEST`,
    );
    expect(offered.ok).toBe(true);
    expect(
      (await offerOwnership(db, 'edition', ids.edition, ids.owner, `${ids.other}@test`)).ok,
    ).toBe(false);
    const { incoming } = await offersOf(db, ids.other);
    expect(incoming.map((o) => o.title)).toEqual(['E']);
    expect((await offersOf(db, ids.owner)).outgoing).toHaveLength(1);
    // Only the user named can accept.
    expect(await answerOffer(db, incoming[0]!.id, ids.owner, 'accept')).toBe(false);
    expect(await answerOffer(db, incoming[0]!.id, ids.other, 'accept')).toBe(true);
    const [edition] = await db.select().from(editions).where(eq(editions.id, ids.edition));
    expect(edition!.ownerId).toBe(ids.other);
    const formerOwner = await db
      .select()
      .from(editionCollaborators)
      .where(
        and(
          eq(editionCollaborators.editionId, ids.edition),
          eq(editionCollaborators.userId, ids.owner),
        ),
      );
    expect(formerOwner).toHaveLength(1);
    expect(await answerOffer(db, incoming[0]!.id, ids.other, 'decline')).toBe(false);
  });
});
