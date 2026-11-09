import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { createDatabase, emailTokens, eq, users, type Database } from '@varians/db';
import type pg from 'pg';
import {
  TOKEN_TTL_MS,
  consumeEmailToken,
  findEmailToken,
  hashEmailToken,
  isTokenShaped,
  issueEmailToken,
  newEmailToken,
  retireEmailTokens,
} from './email-tokens';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const email = `Tokens-${userId}@Example.org`;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values({ id: userId, email, name: 'Token Holder', passwordHash: 'x' });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('token values', () => {
  it('are 32 random bytes as base64url, stored only as their SHA-256', () => {
    const token = newEmailToken();
    expect(isTokenShaped(token)).toBe(true);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(newEmailToken()).not.toBe(token);
    expect(hashEmailToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('are refused without a query when they cannot be tokens', async () => {
    expect(isTokenShaped('short')).toBe(false);
    expect(isTokenShaped(`${'a'.repeat(42)}/`)).toBe(false);
    expect(await findEmailToken(db, '../../etc/passwd', 'reset')).toBeNull();
    expect(await consumeEmailToken(db, "' or 1=1 --", 'reset')).toBeNull();
  });

  it('live as long as their purpose allows', () => {
    expect(TOKEN_TTL_MS.verify).toBe(24 * 3_600_000);
    expect(TOKEN_TTL_MS.reset).toBe(3_600_000);
    expect(TOKEN_TTL_MS.resetByAdministrator).toBe(24 * 3_600_000);
  });
});

describe('issuing and using a token', () => {
  it('keeps only the hash in the table', async () => {
    const { token } = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    const rows = await db.select().from(emailTokens).where(eq(emailTokens.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(hashEmailToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('finds a valid token without using it, and uses it once only', async () => {
    const { token } = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    expect(await findEmailToken(db, token, 'reset')).toEqual({ userId, email, name: 'Token Holder' });
    expect(await findEmailToken(db, token, 'reset')).not.toBeNull();
    expect(await consumeEmailToken(db, token, 'reset')).toEqual({ userId, email, name: 'Token Holder' });
    expect(await consumeEmailToken(db, token, 'reset')).toBeNull();
    expect(await findEmailToken(db, token, 'reset')).toBeNull();
  });

  it('lets only one of two simultaneous uses succeed', async () => {
    const { token } = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    const results = await Promise.all([consumeEmailToken(db, token, 'reset'), consumeEmailToken(db, token, 'reset'), consumeEmailToken(db, token, 'reset')]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('serves only its own purpose', async () => {
    const { token } = await issueEmailToken(db, { userId, email, purpose: 'verify', ttlMs: TOKEN_TTL_MS.verify });
    expect(await consumeEmailToken(db, token, 'reset')).toBeNull();
    expect(await consumeEmailToken(db, token, 'verify')).not.toBeNull();
  });

  it('expires', async () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const { token, expiresAt } = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset }, now);
    expect(expiresAt.toISOString()).toBe('2026-11-09T13:00:00.000Z');
    const justBefore = new Date('2026-11-09T12:59:59Z');
    const atExpiry = new Date('2026-11-09T13:00:00Z');
    expect(await findEmailToken(db, token, 'reset', justBefore)).not.toBeNull();
    expect(await findEmailToken(db, token, 'reset', atExpiry)).toBeNull();
    expect(await consumeEmailToken(db, token, 'reset', atExpiry)).toBeNull();
    expect(await consumeEmailToken(db, token, 'reset', justBefore)).not.toBeNull();
  });

  it('retires the earlier tokens of the same purpose when a new one is made', async () => {
    const first = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    const verify = await issueEmailToken(db, { userId, email, purpose: 'verify', ttlMs: TOKEN_TTL_MS.verify });
    const second = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    expect(await findEmailToken(db, first.token, 'reset')).toBeNull();
    expect(await findEmailToken(db, second.token, 'reset')).not.toBeNull();
    expect(await findEmailToken(db, verify.token, 'verify')).not.toBeNull();
  });

  it('can be retired on purpose', async () => {
    const { token } = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    await retireEmailTokens(db, userId, 'reset');
    expect(await consumeEmailToken(db, token, 'reset')).toBeNull();
  });

  it('stops working when the account no longer has the address, and works regardless of its case', async () => {
    const { token } = await issueEmailToken(db, { userId, email: email.toLowerCase(), purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    expect(await findEmailToken(db, token, 'reset')).not.toBeNull();
    await db.update(users).set({ email: `other-${userId}@example.org` }).where(eq(users.id, userId));
    expect(await findEmailToken(db, token, 'reset')).toBeNull();
    expect(await consumeEmailToken(db, token, 'reset')).toBeNull();
    await db.update(users).set({ email }).where(eq(users.id, userId));
    expect(await consumeEmailToken(db, token, 'reset')).not.toBeNull();
  });

  it('is deleted with its account', async () => {
    const other = newId();
    await db.insert(users).values({ id: other, email: `${other}@example.org`, name: 'Gone', passwordHash: 'x' });
    await issueEmailToken(db, { userId: other, email: `${other}@example.org`, purpose: 'verify', ttlMs: TOKEN_TTL_MS.verify });
    await db.delete(users).where(eq(users.id, other));
    expect(await db.select().from(emailTokens).where(eq(emailTokens.userId, other))).toHaveLength(0);
  });
});
