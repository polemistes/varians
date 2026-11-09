import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@varians/core';
import { createDatabase, eq, sessions, users, type Database } from '@varians/db';
import type pg from 'pg';
import {
  confirmEmail,
  confirmEmailDirectly,
  linkTo,
  makeResetLinkFor,
  requestPasswordReset,
  resetPassword,
  sendResetLink,
  sendVerification,
} from './account-mail';
import { issueEmailToken, TOKEN_TTL_MS } from './email-tokens';
import type { MailMessage, Mailer } from './mail';
import { hashPassword, verifyPassword } from './password';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const email = `Reset-${userId}@Example.org`;
const site = { name: 'Varians Test', origin: 'https://editions.example.org' };

class Outbox implements Mailer {
  messages: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
  /** The token in the link of the last message. */
  token(kind: 'reset' | 'verify'): string {
    const text = this.messages.at(-1)?.text ?? '';
    const match = new RegExp(`${site.origin}/${kind}/([A-Za-z0-9_-]{43})`, 'u').exec(text);
    if (!match) throw new Error(`no ${kind} link in: ${text}`);
    return match[1]!;
  }
}

let outbox: Outbox;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values({ id: userId, email, name: 'Ada Reader', passwordHash: await hashPassword('old password') });
});

beforeEach(() => {
  outbox = new Outbox();
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('links', () => {
  it('are made from the origin, never doubled slashes', () => {
    expect(linkTo(site, 'reset', 'abc')).toBe('https://editions.example.org/reset/abc');
    expect(linkTo({ ...site, origin: 'https://editions.example.org/' }, 'verify', 'abc')).toBe('https://editions.example.org/verify/abc');
  });
});

describe('asking for a new password', () => {
  it('sends a link to the account with the address, whatever its case', async () => {
    await requestPasswordReset(db, outbox, email.toUpperCase(), site);
    expect(outbox.messages).toHaveLength(1);
    const [message] = outbox.messages;
    expect(message!.to).toBe(email);
    expect(message!.subject).toBe('A new password for Varians Test');
    expect(message!.text).toContain('Ada Reader,');
    expect(message!.text).toContain('valid for an hour');
    expect(outbox.token('reset')).toHaveLength(43);
  });

  it('sends nothing, and answers the same, when no account has the address', async () => {
    const answer = await requestPasswordReset(db, outbox, `nobody-${userId}@example.org`, site);
    expect(answer).toBeUndefined();
    expect(outbox.messages).toHaveLength(0);
  });

  it('sets the new password with the link, once, and signs out every session', async () => {
    await db.insert(sessions).values({ id: `s-${userId}`, userId, expiresAt: new Date(Date.now() + 86_400_000) });
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
    await requestPasswordReset(db, outbox, email, site);
    const token = outbox.token('reset');

    expect(await resetPassword(db, token, 'a new password')).toEqual({ userId });
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(await verifyPassword(user!.passwordHash, 'a new password')).toBe(true);
    expect(await verifyPassword(user!.passwordHash, 'old password')).toBe(false);
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);

    expect(await resetPassword(db, token, 'yet another')).toBeNull();
    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(await verifyPassword(after!.passwordHash, 'a new password')).toBe(true);
  });

  it('refuses an expired link, and a confirmation link', async () => {
    const past = new Date(Date.now() - 2 * TOKEN_TTL_MS.reset);
    const expired = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset }, past);
    expect(await resetPassword(db, expired.token, 'never set')).toBeNull();
    const verify = await issueEmailToken(db, { userId, email, purpose: 'verify', ttlMs: TOKEN_TTL_MS.verify });
    expect(await resetPassword(db, verify.token, 'never set')).toBeNull();
  });
});

describe('links from an administrator', () => {
  it('are sent to the account, valid for a day', async () => {
    const sent = await sendResetLink(db, outbox, userId, site);
    expect(sent?.name).toBe('Ada Reader');
    expect(outbox.messages[0]!.text).toContain('An administrator of Varians Test');
    expect(outbox.messages[0]!.text).toContain('valid for a day');
    expect(await resetPassword(db, outbox.token('reset'), 'from the administrator')).toEqual({ userId });
  });

  it('are made for the command line without mail', async () => {
    const made = await makeResetLinkFor(db, email.toLowerCase(), site);
    expect(made?.link).toMatch(/^https:\/\/editions\.example\.org\/reset\/[A-Za-z0-9_-]{43}$/u);
    expect(made!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(await makeResetLinkFor(db, `nobody-${userId}@example.org`, site)).toBeNull();
    expect(await sendResetLink(db, outbox, 'no-such-user', site)).toBeNull();
  });
});

describe('confirming an address', () => {
  it('confirms with the link from the mail, once', async () => {
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
    await sendVerification(db, outbox, { id: userId, email, name: 'Ada Reader' }, site);
    expect(outbox.messages[0]!.subject).toBe('Confirm your address for Varians Test');
    expect(outbox.messages[0]!.text).toContain('valid for a day');
    const token = outbox.token('verify');
    expect(await confirmEmail(db, token)).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(await confirmEmail(db, token)).toBe(false);
  });

  it('does not confirm with a reset link', async () => {
    const reset = await issueEmailToken(db, { userId, email, purpose: 'reset', ttlMs: TOKEN_TTL_MS.reset });
    expect(await confirmEmail(db, reset.token)).toBe(false);
  });

  it('can be done by the operator directly', async () => {
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
    expect(await confirmEmailDirectly(db, email.toUpperCase())).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(await confirmEmailDirectly(db, `nobody-${userId}@example.org`)).toBe(false);
  });
});
