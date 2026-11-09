/**
 * The routes of the mail flows, with nodemailer replaced by a collector:
 * the answers to a request for a new password, the limits on it, the
 * confirmation at registration and at login, and the fallbacks without mail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@varians/core';
import { createDatabase, eq, inArray, sql, users, type Database } from '@varians/db';
import type pg from 'pg';

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  sent: [] as { from: string; to: string; subject: string; text: string }[],
  fail: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { from: string; to: string; subject: string; text: string }) => {
        if (state.fail) throw new Error('connection refused');
        state.sent.push(message);
      },
    }),
  },
}));

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
state.env.DATABASE_URL = url;

const reset = await import('../../routes/(public)/reset/+page.server');
const resetToken = await import('../../routes/(public)/reset/[token]/+page.server');
const login = await import('../../routes/(public)/login/+page.server');
const register = await import('../../routes/(public)/register/+page.server');
const { hashPassword } = await import('./password');
const { senderOf, assertHeaderSafe, mailConfigured } = await import('./mail');

let db: Database;
let pool: pg.Pool;
const run = newId().toLowerCase();
const known = `known-${run}@example.org`;
const unconfirmed = `unconfirmed-${run}@example.org`;
const registered = [`new-${run}@example.org`, `plain-${run}@example.org`];

function withMail(): void {
  state.env.SMTP_URL = 'smtp://mail.example.org:587';
  state.env.ORIGIN = 'https://editions.example.org';
  state.env.MAIL_FROM = 'Varians Test <noreply@editions.example.org>';
}

function withoutMail(): void {
  delete state.env.SMTP_URL;
  state.env.ORIGIN = 'https://editions.example.org';
}

function form(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request('https://editions.example.org/form', { method: 'POST', body, headers: { origin: 'https://editions.example.org' } });
}

function cookies() {
  const set = new Map<string, string>();
  return { set: (name: string, value: string) => set.set(name, value), get: (name: string) => set.get(name), delete: () => undefined, jar: set };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (event: any) => Promise<any>;

async function act(action: AnyAction, fields: Record<string, string>, extra: Record<string, unknown> = {}) {
  const jar = cookies();
  const event = {
    request: form(fields),
    url: new URL('https://editions.example.org/form'),
    locals: { db, user: null },
    cookies: jar,
    getClientAddress: () => (extra.address as string) ?? '203.0.113.7',
    params: extra.params ?? {},
  };
  try {
    return { result: await action(event), jar };
  } catch (thrown) {
    // redirect() throws.
    return { thrown, jar };
  }
}

/** The answer of an action without its status, as the page sees it. */
function data(outcome: { result?: unknown }): unknown {
  const result = outcome.result as { data?: unknown } | undefined;
  return result && typeof result === 'object' && 'data' in result ? result.data : result;
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  const passwordHash = await hashPassword('the right password');
  await db.insert(users).values([
    { id: newId(), email: known, name: 'Known Reader', passwordHash, emailVerifiedAt: new Date() },
    { id: newId(), email: unconfirmed, name: 'Unconfirmed Reader', passwordHash },
  ]);
});

beforeEach(() => {
  state.sent.length = 0;
  state.fail = false;
  withMail();
});

afterAll(async () => {
  await db.delete(users).where(inArray(sql`lower(${users.email})`, [known, unconfirmed, ...registered]));
  await pool.end();
});

async function settle(): Promise<void> {
  // The reset mail is sent after the answer.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

describe('the settings of mail', () => {
  it('needs both SMTP_URL and ORIGIN', () => {
    expect(mailConfigured()).toBe(true);
    delete state.env.ORIGIN;
    expect(mailConfigured()).toBe(false);
    withoutMail();
    expect(mailConfigured()).toBe(false);
  });

  it('sends from MAIL_FROM, or from noreply at the host of ORIGIN', () => {
    expect(senderOf('Edition <e@example.org>', 'https://x.example.org', 'Varians')).toBe('Edition <e@example.org>');
    expect(senderOf(undefined, 'https://editions.example.org', 'Varians')).toBe('Varians <noreply@editions.example.org>');
    expect(senderOf('', 'not a url', 'A "quoted" <name>')).toBe('A quoted name <noreply@localhost>');
  });

  it('refuses a header with a line break', () => {
    expect(() => assertHeaderSafe('a@example.org\r\nBcc: b@example.org')).toThrow();
    expect(assertHeaderSafe('a@example.org')).toBe('a@example.org');
  });
});

describe('asking for a new password', () => {
  it('answers the same whether or not an account has the address, and mails only the account', async () => {
    const forKnown = await act(reset.actions.default as AnyAction, { email: known.toUpperCase() }, { address: '198.51.100.1' });
    const forNobody = await act(reset.actions.default as AnyAction, { email: `nobody-${run}@example.org` }, { address: '198.51.100.1' });
    expect(data(forKnown)).toEqual({ sent: true });
    expect(data(forNobody)).toEqual(data(forKnown));
    await settle();
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.to).toBe(known);
    expect(state.sent[0]!.from).toBe('Varians Test <noreply@editions.example.org>');
    expect(state.sent[0]!.text).toMatch(/https:\/\/editions\.example\.org\/reset\/[A-Za-z0-9_-]{43}/u);
  });

  it('answers the same when the mail cannot be sent', async () => {
    state.fail = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await act(reset.actions.default as AnyAction, { email: unconfirmed }, { address: '198.51.100.2' });
    expect(data(outcome)).toEqual({ sent: true });
    await settle();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('sends at most three messages an hour to one account, answering the same', async () => {
    const target = `limited-${run}@example.org`;
    await db.insert(users).values({ id: newId(), email: target, name: 'Limited', passwordHash: 'x' });
    try {
      for (let i = 0; i < 5; i++) {
        const outcome = await act(reset.actions.default as AnyAction, { email: target }, { address: `198.51.100.${10 + i}` });
        expect(data(outcome)).toEqual({ sent: true });
      }
      await settle();
      expect(state.sent.filter((m) => m.to === target)).toHaveLength(3);
    } finally {
      await db.delete(users).where(eq(users.email, target));
    }
  });

  it('refuses many requests from one address', async () => {
    let last: { result?: unknown } = {};
    for (let i = 0; i < 21; i++) last = await act(reset.actions.default as AnyAction, { email: `x${i}-${run}@example.org` }, { address: '192.0.2.99' });
    expect((last.result as { status: number }).status).toBe(429);
  });

  it('refuses an address that is not one', async () => {
    const outcome = await act(reset.actions.default as AnyAction, { email: 'not an address' });
    expect((outcome.result as { status: number }).status).toBe(400);
  });

  it('without mail, sends nothing and says to ask the administrator', async () => {
    withoutMail();
    const outcome = await act(reset.actions.default as AnyAction, { email: known });
    expect((outcome.result as { status: number }).status).toBe(404);
    expect(JSON.stringify(data(outcome))).toContain('administrator');
    const page = await (reset.load as AnyAction)({ locals: { user: null } });
    expect(page.mail).toBe(false);
    await settle();
    expect(state.sent).toHaveLength(0);
  });
});

describe('setting the password with the link', () => {
  it('checks the link on opening, sets the password once, and signs in', async () => {
    await act(reset.actions.default as AnyAction, { email: known }, { address: '198.51.100.50' });
    await settle();
    const token = /\/reset\/([A-Za-z0-9_-]{43})/u.exec(state.sent.at(-1)!.text)![1]!;
    const headers: Record<string, string> = {};
    const opened = await (resetToken.load as AnyAction)({ params: { token }, locals: { db }, setHeaders: (h: Record<string, string>) => Object.assign(headers, h) });
    expect(opened.valid).toBe(true);
    expect(headers['referrer-policy']).toBe('no-referrer');

    const differ = await act(resetToken.actions.default as AnyAction, { password: 'a fresh password', repeat: 'another one' }, { params: { token } });
    expect((differ.result as { status: number }).status).toBe(400);

    const done = await act(resetToken.actions.default as AnyAction, { password: 'a fresh password', repeat: 'a fresh password' }, { params: { token } });
    expect((done.thrown as { status: number }).status).toBe(303);
    expect(done.jar.jar.get('varians_session')).toBeTruthy();

    const again = await act(resetToken.actions.default as AnyAction, { password: 'a third password', repeat: 'a third password' }, { params: { token } });
    expect((again.result as { status: number }).status).toBe(400);
    expect((await (resetToken.load as AnyAction)({ params: { token }, locals: { db }, setHeaders: () => undefined })).valid).toBe(false);

    const loggedIn = await act(login.actions.default as AnyAction, { email: known, password: 'a fresh password' }, { address: '198.51.100.51' });
    expect((loggedIn.thrown as { status: number }).status).toBe(303);
  });
});

describe('confirming the address', () => {
  it('at registration with mail: no session, a link to confirm instead', async () => {
    const outcome = await act(register.actions.default as AnyAction, { name: 'New Reader', email: registered[0]!, password: 'long enough', terms: 'accepted' }, { address: '198.51.100.60' });
    expect(data(outcome)).toEqual({ confirm: { email: registered[0], sent: true } });
    expect(outcome.jar.jar.size).toBe(0);
    expect(state.sent[0]!.to).toBe(registered[0]);
    expect(state.sent[0]!.text).toMatch(/https:\/\/editions\.example\.org\/verify\/[A-Za-z0-9_-]{43}/u);
  });

  it('at registration without mail: signed in at once', async () => {
    withoutMail();
    const outcome = await act(register.actions.default as AnyAction, { name: 'Plain Reader', email: registered[1]!, password: 'long enough', terms: 'accepted' }, { address: '198.51.100.61' });
    expect((outcome.thrown as { status: number }).status).toBe(303);
    expect(outcome.jar.jar.get('varians_session')).toBeTruthy();
    expect(state.sent).toHaveLength(0);
  });

  it('at login: a wrong password says nothing of confirmation; the right one sends a new link', async () => {
    const wrong = await act(login.actions.default as AnyAction, { email: unconfirmed, password: 'wrong password' }, { address: '198.51.100.70' });
    expect((wrong.result as { status: number }).status).toBe(400);
    expect((data(wrong) as { errors: { form: string } }).errors.form).toBe('The email or password is wrong.');
    expect(state.sent).toHaveLength(0);

    const right = await act(login.actions.default as AnyAction, { email: unconfirmed, password: 'the right password' }, { address: '198.51.100.70' });
    expect((right.result as { status: number }).status).toBe(403);
    expect(right.jar.jar.size).toBe(0);
    expect(state.sent).toHaveLength(1);
    const token = /\/verify\/([A-Za-z0-9_-]{43})/u.exec(state.sent[0]!.text)![1]!;

    const verify = await import('../../routes/(public)/verify/[token]/+page.server');
    const page = await (verify.load as AnyAction)({ params: { token }, locals: { db, user: null }, setHeaders: () => undefined });
    expect(page.confirmed).toBe(true);

    const after = await act(login.actions.default as AnyAction, { email: unconfirmed, password: 'the right password' }, { address: '198.51.100.70' });
    expect((after.thrown as { status: number }).status).toBe(303);
  });

  it('at login without mail: an unconfirmed account logs in', async () => {
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.email, unconfirmed));
    withoutMail();
    const outcome = await act(login.actions.default as AnyAction, { email: unconfirmed, password: 'the right password' }, { address: '198.51.100.71' });
    expect((outcome.thrown as { status: number }).status).toBe(303);
  });
});
