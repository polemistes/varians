/** Bearer tokens on requests (PLAN-2 G2): the account a token stands for. Used by the request hook. */

import { apiTokens, users, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import type { CurrentUser } from '$lib/types';
import { toCurrentUser } from './auth.ts';
import { hashToken } from './tokens.ts';

/** The account a bearer token stands for, or null; notes when it was last used. */
export async function userForToken(db: Database, token: string): Promise<CurrentUser | null> {
  if (!/^vt_[A-Za-z0-9_-]{20,100}$/u.test(token)) return null;
  const [row] = await db.select({ token: apiTokens, user: users }).from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId)).where(eq(apiTokens.tokenHash, hashToken(token)));
  if (!row) return null;
  if (row.token.expiresAt && row.token.expiresAt.getTime() < Date.now()) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.token.id));
  return toCurrentUser(row.user);
}

