/**
 * Accounts and sessions.
 *
 * A session token is 32 random bytes as base64url; the database keeps only
 * its SHA-256, so a leaked table cannot be replayed. The cookie is
 * varians_session: HttpOnly, SameSite=Lax, Secure when ORIGIN is https,
 * valid for 30 days and extended while in use.
 */
import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { newId } from '@varians/core';
import { and, count, eq, ne, sessions, sql, users, type Database, type User } from '@varians/db';
import { normalizePreferences } from '$lib/preferences';
import type { CurrentUser, Preferences } from '$lib/types';
import { db } from './db';
import { hashPassword, verifyPassword } from './password';

export { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './password';

export const SESSION_COOKIE = 'varians_session';
export const SESSION_DAYS = 30;
export const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** A session that was last extended more than this long ago is extended again. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** Anything that can run queries: the client or a transaction. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

// Pure parts

/** 32 random bytes, base64url: the value the cookie carries. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** What the sessions table stores for a token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/**
 * Sliding expiry: the expiry was set to now + 30 days when the session was
 * made or last extended; extend again once a day of that has passed.
 */
export function needsRefresh(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS;
}

export function isSecureOrigin(origin: string | undefined): boolean {
  return typeof origin === 'string' && origin.trim().toLowerCase().startsWith('https://');
}

export interface SessionCookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  expires: Date;
}

export function sessionCookieOptions(
  origin: string | undefined,
  now: Date = new Date(),
): SessionCookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureOrigin(origin),
    expires: sessionExpiry(now),
  };
}

/** The cookie options for this installation, from ORIGIN. */
export function cookieOptions(): SessionCookieOptions {
  return sessionCookieOptions(env.ORIGIN);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** What pages and the shell see of a user: never the password hash. */
export function toCurrentUser(user: User): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    preferences: normalizePreferences(user.preferences),
  };
}

// Sessions

export async function createSession(
  userId: string,
  executor: Executor = db,
  now: Date = new Date(),
): Promise<string> {
  const token = generateToken();
  await executor
    .insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt: sessionExpiry(now) });
  return token;
}

export interface SessionUser {
  user: CurrentUser;
  /** True when the expiry was extended, so that the cookie should be set again. */
  refreshed: boolean;
}

/** The user behind a cookie token, or null. Drops expired sessions; extends live ones. */
export async function getSessionUser(
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({ expiresAt: sessions.expiresAt, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let refreshed = false;
  if (needsRefresh(row.expiresAt, now)) {
    await db
      .update(sessions)
      .set({ expiresAt: sessionExpiry(now) })
      .where(eq(sessions.id, id));
    refreshed = true;
  }
  return { user: toCurrentUser(row.user), refreshed };
}

export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Ends every session of a user, for instance after a password change elsewhere. */
export async function logoutEverywhere(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// Accounts

export type RegisterResult =
  { ok: true; user: CurrentUser; token: string } | { ok: false; error: 'email-taken' };

/** Creates an account and a session. The first account on an installation is its administrator. */
export async function register(
  email: string,
  name: string,
  password: string,
): Promise<RegisterResult> {
  const passwordHash = await hashPassword(password);
  const normalized = normalizeEmail(email);
  return db.transaction(async (tx) => {
    // Two first registrations at once must not both become administrator.
    await tx.execute(sql`lock table ${users} in share row exclusive mode`);
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, normalized))
      .limit(1);
    if (existing.length > 0) return { ok: false, error: 'email-taken' } as const;
    const [{ total }] = await tx.select({ total: count() }).from(users);
    const role = total === 0 ? 'administrator' : 'member';
    const [user] = await tx
      .insert(users)
      .values({ id: newId(), email: email.trim(), name: name.trim(), passwordHash, role })
      .returning();
    if (!user) throw new Error('insert returned no row');
    const token = await createSession(user.id, tx);
    return { ok: true, user: toCurrentUser(user), token } as const;
  });
}

export type LoginResult =
  { ok: true; user: CurrentUser; token: string } | { ok: false; error: 'invalid-credentials' };

let decoyHash: Promise<string> | undefined;
/** A hash to verify against when no account matches, so that timing does not reveal which emails exist. */
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(generateToken(16));
  return decoyHash;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizeEmail(email)))
    .limit(1);
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await decoy(), password), false);
  if (!user || !valid) return { ok: false, error: 'invalid-credentials' };
  const token = await createSession(user.id);
  return { ok: true, user: toCurrentUser(user), token };
}

export async function updateName(userId: string, name: string): Promise<void> {
  await db.update(users).set({ name: name.trim() }).where(eq(users.id, userId));
}

export type ChangePasswordResult =
  { ok: true } | { ok: false; error: 'wrong-password' | 'not-found' };

/**
 * Changes the password. Every other session of the account ends with it, so
 * that a new password locks out whoever knew the old one; the session the
 * change was made in (its token given) stays.
 */
export async function changePassword(
  userId: string,
  current: string,
  next: string,
  keepToken?: string,
): Promise<ChangePasswordResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, error: 'not-found' };
  if (!(await verifyPassword(user.passwordHash, current)))
    return { ok: false, error: 'wrong-password' };
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, userId));
  await db
    .delete(sessions)
    .where(keepToken ? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(keepToken))) : eq(sessions.userId, userId));
  return { ok: true };
}

export async function updatePreferences(userId: string, preferences: Preferences): Promise<void> {
  await db.update(users).set({ preferences }).where(eq(users.id, userId));
}
