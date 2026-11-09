/**
 * The flows that go through a mailed link: confirming an address at
 * registration, setting a new password on request, and the link an
 * administrator sends or hands over. Each takes the database, and where it
 * sends, a Mailer (mail.ts), so that the flows can be tested without SMTP.
 *
 * A request for a new password answers nothing about whether the account
 * exists: requestPasswordReset returns nothing, and the route does not wait
 * for it, so that neither the answer nor its timing differs.
 */
import { and, eq, isNull, sessions, sql, users, type Database } from '@varians/db';
import { mail } from '$lib/strings/mail';
import { consumeEmailToken, issueEmailToken, retireEmailTokens, TOKEN_TTL_MS, type IssuedToken } from './email-tokens';
import type { Mailer } from './mail';
import { hashPassword } from './password';

export interface Site {
  /** The installation's name (SITE_NAME). */
  name: string;
  /** The public origin, without a trailing slash (ORIGIN). */
  origin: string;
}

/** The address of a link: /verify/<token> or /reset/<token>. Pure. */
export function linkTo(site: Site, kind: 'verify' | 'reset', token: string): string {
  return `${site.origin.replace(/\/+$/u, '')}/${kind}/${token}`;
}

interface Account {
  id: string;
  email: string;
  name: string;
}

async function accountByEmail(db: Database, email: string): Promise<Account | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

async function accountById(db: Database, userId: string): Promise<Account | null> {
  const [row] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

// Confirming an address

/** Sends the link that confirms an account's address (valid for a day). */
export async function sendVerification(db: Database, mailer: Mailer, account: Account, site: Site): Promise<void> {
  const { token } = await issueEmailToken(db, { userId: account.id, email: account.email, purpose: 'verify', ttlMs: TOKEN_TTL_MS.verify });
  const link = linkTo(site, 'verify', token);
  await mailer.send({
    to: account.email,
    subject: mail.verify.subject(site.name),
    text: mail.verify.text({ site: site.name, link, origin: site.origin }),
  });
}

/** Uses a confirmation link: true when the address is now confirmed. */
export async function confirmEmail(db: Database, token: string, now: Date = new Date()): Promise<boolean> {
  const valid = await consumeEmailToken(db, token, 'verify', now);
  if (!valid) return false;
  await db.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, valid.userId), isNull(users.emailVerifiedAt)));
  return true;
}

/** Confirms an address without a link, for the operator (cli confirm-email). False when there is no such account. */
export async function confirmEmailDirectly(db: Database, email: string, now: Date = new Date()): Promise<boolean> {
  const account = await accountByEmail(db, email);
  if (!account) return false;
  await db.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, account.id), isNull(users.emailVerifiedAt)));
  return true;
}

// New passwords

/**
 * Sends a link to set a new password to the account with this address, if
 * there is one (valid for an hour). Returns nothing either way.
 */
export async function requestPasswordReset(db: Database, mailer: Mailer, email: string, site: Site): Promise<void> {
  const account = await accountByEmail(db, email);
  if (!account) return;
  const { token } = await issueEmailToken(db, { userId: account.id, email: account.email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
  await mailer.send({
    to: account.email,
    subject: mail.reset.subject(site.name),
    text: mail.reset.text({ site: site.name, link: linkTo(site, 'reset', token), origin: site.origin }),
  });
}

export interface AdministratorLink extends IssuedToken {
  link: string;
  account: Account;
}

/** Makes a link to set a new password for an account (valid for a day), for an administrator to send or hand over. */
export async function makeResetLink(db: Database, userId: string, site: Site): Promise<AdministratorLink | null> {
  const account = await accountById(db, userId);
  if (!account) return null;
  const issued = await issueEmailToken(db, { userId: account.id, email: account.email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.resetByAdministrator });
  return { ...issued, link: linkTo(site, 'reset', issued.token), account };
}

/** The same, found by address (cli reset-password). */
export async function makeResetLinkFor(db: Database, email: string, site: Site): Promise<AdministratorLink | null> {
  const account = await accountByEmail(db, email);
  return account ? makeResetLink(db, account.id, site) : null;
}

/** Sends an administrator's reset link to the account's address. Null when there is no such account. */
export async function sendResetLink(db: Database, mailer: Mailer, userId: string, site: Site): Promise<Account | null> {
  const made = await makeResetLink(db, userId, site);
  if (!made) return null;
  await mailer.send({
    to: made.account.email,
    subject: mail.resetByAdministrator.subject(site.name),
    text: mail.resetByAdministrator.text({ site: site.name, link: made.link, origin: site.origin }),
  });
  return made.account;
}

/**
 * Sets a new password with a reset link. The link is used up; every session
 * of the account ends, so that whoever knew the old password is signed out;
 * the account's other reset links stop working; and the address counts as
 * confirmed, since the link reached its owner. Answers the account, or null
 * when the link cannot be used.
 */
export async function resetPassword(db: Database, token: string, password: string, now: Date = new Date()): Promise<{ userId: string } | null> {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const valid = await consumeEmailToken(tx, token, 'reset', now);
    if (!valid) return null;
    await tx
      .update(users)
      .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)` })
      .where(eq(users.id, valid.userId));
    await tx.delete(sessions).where(eq(sessions.userId, valid.userId));
    await retireEmailTokens(tx, valid.userId, 'reset', now);
    return { userId: valid.userId };
  });
}
