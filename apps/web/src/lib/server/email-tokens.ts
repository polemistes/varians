/**
 * The tokens of mailed links (email_tokens). A token is 32 random bytes as
 * base64url, sent once and never stored: the table keeps its SHA-256, as
 * the sessions table does. A token serves one purpose, once, until it
 * expires, and only while its account still has the address it was made
 * for. Making a new token for an account and purpose retires the earlier
 * ones, so that only the newest link works.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, emailTokens, eq, gt, isNull, lt, sql, users, type Database, type EmailTokenPurpose } from '@varians/db';

export type TokenExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

const HOUR = 60 * 60 * 1000;

/** How long a link is valid. */
export const TOKEN_TTL_MS = {
  /** Confirming an address: a day. */
  verify: 24 * HOUR,
  /** A new password asked for by its owner: an hour. */
  reset: HOUR,
  /** A new password sent or made by an administrator: a day, since it may be passed on by hand. */
  resetByAdministrator: 24 * HOUR,
} as const;

/** Expired or used tokens are deleted once they are this old. */
const PRUNE_AFTER_MS = 7 * 24 * HOUR;

export function newEmailToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether a string could be a token at all, before the database is asked. */
export function isTokenShaped(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(token);
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/** Makes a token for an account and purpose, retiring that account's earlier tokens of the purpose. */
export async function issueEmailToken(
  db: TokenExecutor,
  input: { userId: string; email: string; purpose: EmailTokenPurpose; ttlMs: number },
  now: Date = new Date(),
): Promise<IssuedToken> {
  const token = newEmailToken();
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  await db.delete(emailTokens).where(and(eq(emailTokens.userId, input.userId), eq(emailTokens.purpose, input.purpose)));
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, new Date(now.getTime() - PRUNE_AFTER_MS)));
  await db.insert(emailTokens).values({
    id: hashEmailToken(token),
    userId: input.userId,
    email: input.email,
    purpose: input.purpose,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface ValidToken {
  userId: string;
  email: string;
  name: string;
}

/** The conditions under which a token may be used now. */
function usable(token: string, purpose: EmailTokenPurpose, now: Date) {
  return and(
    eq(emailTokens.id, hashEmailToken(token)),
    eq(emailTokens.purpose, purpose),
    isNull(emailTokens.usedAt),
    gt(emailTokens.expiresAt, now),
  );
}

/** The account behind a token that may be used now, without using it; null otherwise. */
export async function findEmailToken(
  db: TokenExecutor,
  token: string,
  purpose: EmailTokenPurpose,
  now: Date = new Date(),
): Promise<ValidToken | null> {
  if (!isTokenShaped(token)) return null;
  const [row] = await db
    .select({ userId: emailTokens.userId, email: emailTokens.email, name: users.name, current: users.email })
    .from(emailTokens)
    .innerJoin(users, eq(users.id, emailTokens.userId))
    .where(usable(token, purpose, now))
    .limit(1);
  if (!row || row.current.toLowerCase() !== row.email.toLowerCase()) return null;
  return { userId: row.userId, email: row.email, name: row.name };
}

/**
 * Uses a token: marks it used and answers its account, in one statement, so
 * that two requests with the same link cannot both succeed. Null when the
 * token is unknown, used, expired, of another purpose, or made for an
 * address the account no longer has.
 */
export async function consumeEmailToken(
  db: TokenExecutor,
  token: string,
  purpose: EmailTokenPurpose,
  now: Date = new Date(),
): Promise<ValidToken | null> {
  if (!isTokenShaped(token)) return null;
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(
      and(
        usable(token, purpose, now),
        sql`exists (select 1 from ${users} where ${users.id} = ${emailTokens.userId} and lower(${users.email}) = lower(${emailTokens.email}))`,
      ),
    )
    .returning({ userId: emailTokens.userId, email: emailTokens.email });
  if (!row) return null;
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1);
  return { userId: row.userId, email: row.email, name: user?.name ?? '' };
}

/** Retires every unused token of an account for a purpose, for instance once its password is set. */
export async function retireEmailTokens(db: TokenExecutor, userId: string, purpose: EmailTokenPurpose, now: Date = new Date()): Promise<void> {
  await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)));
}
