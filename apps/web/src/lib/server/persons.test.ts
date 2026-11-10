import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { changesets, createDatabase, persons, users, type Database } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { personOfAccount, setOrcid } from './persons.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const a = newId();
const b = newId();
const stranger = newId();
const ORCID = '0000-0002-1825-0097';

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.update(persons).set({ orcid: null }).where(eq(persons.orcid, ORCID));
  await db.insert(users).values([
    { id: a, email: `${a}@test`, name: 'Ann', passwordHash: 'x' },
    { id: b, email: `${b}@test`, name: 'Ben', passwordHash: 'x' },
  ]);
});

afterAll(async () => {
  await db.delete(changesets).where(eq(changesets.documentId, `doc-${a}`));
  await db.delete(persons).where(inArray(persons.id, [stranger]));
  await db.delete(users).where(inArray(users.id, [a, b]));
  await pool.end();
});

describe('persons', () => {
  it('every account is a person, under its id, with its name', async () => {
    const p = await personOfAccount(db, a);
    expect(p.id).toBe(a);
    expect(p.name).toBe('Ann');
    await db.update(users).set({ name: 'Ann Smith' }).where(eq(users.id, a));
    expect((await personOfAccount(db, a)).name).toBe('Ann Smith');
  });

  it('refuses an iD that is not one, and takes the forms people type', async () => {
    expect(await setOrcid(db, a, '0000-0002-1825-0098')).toEqual({ ok: false, error: 'invalid' });
    expect(await setOrcid(db, a, `https://orcid.org/${ORCID}`)).toEqual({
      ok: true,
      orcid: ORCID,
      claimed: null,
    });
    expect(await setOrcid(db, b, ORCID)).toEqual({ ok: false, error: 'taken' });
    expect(await setOrcid(db, a, '')).toEqual({ ok: true, orcid: null, claimed: null });
  });

  it('claims a person without an account who has the iD: their changesets become the account’s', async () => {
    await db.insert(persons).values({ id: stranger, name: 'A. Smith', orcid: ORCID });
    await db.insert(changesets).values({
      id: newId(),
      documentKind: 'transcription',
      documentId: `doc-${a}`,
      version: 1,
      personId: stranger,
      ops: [],
      reverse: [],
    });
    const result = await setOrcid(db, a, ORCID);
    expect(result).toEqual({ ok: true, orcid: ORCID, claimed: 'A. Smith' });
    const [c] = await db
      .select()
      .from(changesets)
      .where(eq(changesets.documentId, `doc-${a}`));
    expect(c!.personId).toBe(a);
    expect(await db.select().from(persons).where(eq(persons.id, stranger))).toEqual([]);
    await setOrcid(db, a, '');
  });
});
