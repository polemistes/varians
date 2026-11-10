import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { apiTokens, createDatabase, users, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { acceptsBearer, createToken, revokeToken, tokensOf } from './tokens.ts';
import { userForToken } from './token-auth.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const owner = newId();

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db
    .insert(users)
    .values({ id: owner, email: `${owner}@test`, name: 'Token Holder', passwordHash: 'x' });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await pool.end();
});

describe('API tokens', () => {
  it('stand for their account until revoked or expired, and are kept only as a hash', async () => {
    const made = await createToken(db, owner, 'another installation');
    expect(made.token).toMatch(/^vt_/);
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, made.id));
    expect(row!.tokenHash).not.toContain(made.token);
    expect((await userForToken(db, made.token))?.id).toBe(owner);
    expect((await tokensOf(db, owner))[0]!.lastUsedAt).not.toBeNull();
    expect(await userForToken(db, 'vt_notatokenatallnotatokenatall')).toBeNull();
    expect(await revokeToken(db, owner, made.id)).toBe(true);
    expect(await userForToken(db, made.token)).toBeNull();
    const old = await createToken(db, owner, 'old', new Date(Date.now() - 1000));
    expect(await userForToken(db, old.token)).toBeNull();
  });

  it('are accepted by the sync and import endpoints only', () => {
    expect(acceptsBearer('GET', '/works/iliad/sync.json')).toBe(true);
    expect(acceptsBearer('GET', '/works/iliad/package.zip')).toBe(true);
    expect(acceptsBearer('POST', '/api/import')).toBe(true);
    expect(acceptsBearer('POST', '/api/documents/edition/x/ops')).toBe(false);
    expect(acceptsBearer('GET', '/account')).toBe(false);
  });
});
