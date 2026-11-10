/**
 * API tokens: an account's token lets another installation or a
 * script use the sync and import endpoints as that account, and nothing
 * else. A token is shown once; only its hash is kept. Tokens of accounts on
 * other installations, kept for the remotes of a work, are encrypted with
 * SECRET_KEY.
 */

import { newId } from '@varians/core';
import { apiTokens, type Database } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Make a token for an account; the token is returned this once. */
export async function createToken(db: Database, userId: string, name: string, expiresAt: Date | null = null): Promise<{ id: string; token: string }> {
  const token = `vt_${randomBytes(32).toString('base64url')}`;
  const id = newId();
  await db.insert(apiTokens).values({ id, tokenHash: hashToken(token), userId, name: name.trim().slice(0, 100) || 'Token', expiresAt });
  return { id, token };
}

export async function tokensOf(db: Database, userId: string) {
  return db
    .select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, expiresAt: apiTokens.expiresAt })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(apiTokens.createdAt);
}

export async function revokeToken(db: Database, userId: string, id: string): Promise<boolean> {
  const removed = await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId))).returning({ id: apiTokens.id });
  return removed.length > 0;
}

/** Paths where a bearer token is accepted: the sync state, the packages, and the import endpoint. */
export function acceptsBearer(method: string, pathname: string): boolean {
  if (method === 'GET') return /^\/works\/[^/]+\/(sync\.json|package\.zip)$/u.test(pathname) || /^\/editions\/[^/]+\/package\.zip$/u.test(pathname);
  return method === 'POST' && pathname === '/api/import';
}

function key(secret: string | undefined): Buffer {
  if (!secret || secret.trim().length < 16) throw new Error('SECRET_KEY must be set (at least 16 characters) to keep tokens of other installations');
  return createHash('sha256').update(secret.trim()).digest();
}

/** Encrypt a secret with SECRET_KEY: base64 of iv, tag and ciphertext. */
export function encryptSecret(plain: string, secret: string | undefined = process.env.SECRET_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptSecret(blob: string, secret: string | undefined = process.env.SECRET_KEY): string {
  const data = Buffer.from(blob, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
