import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { ORIGIN: 'https://varians.example' } }));
vi.mock('./db', () => ({ db: {}, pool: {} }));

const auth = await import('./auth');
const {
  SESSION_TTL_MS,
  SESSION_REFRESH_AFTER_MS,
  generateToken,
  hashToken,
  sessionExpiry,
  needsRefresh,
  isSecureOrigin,
  sessionCookieOptions,
  cookieOptions,
  normalizeEmail,
  toCurrentUser,
  hashPassword,
  verifyPassword,
} = auth;

describe('session tokens', () => {
  it('are 32 random bytes as base64url', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateToken()).not.toBe(token);
  });

  it('are stored as their SHA-256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abd')).not.toBe(hashToken('abc'));
  });
});

describe('sliding expiry', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('expires 30 days after now', () => {
    expect(sessionExpiry(now).toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(SESSION_TTL_MS).toBe(30 * 86_400_000);
  });

  it('does not refresh a session extended within the last day', () => {
    const fresh = sessionExpiry(now);
    expect(needsRefresh(fresh, now)).toBe(false);
    const sixHoursLater = new Date(now.getTime() + 6 * 3_600_000);
    expect(needsRefresh(fresh, sixHoursLater)).toBe(false);
  });

  it('refreshes a session extended more than a day ago', () => {
    const fresh = sessionExpiry(now);
    const later = new Date(now.getTime() + SESSION_REFRESH_AFTER_MS + 1);
    expect(needsRefresh(fresh, later)).toBe(true);
  });
});

describe('cookie options', () => {
  it('are HttpOnly, SameSite=Lax, path / and 30 days', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const options = sessionCookieOptions('http://localhost:5173', now);
    expect(options).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax', secure: false });
    expect(options.expires.getTime() - now.getTime()).toBe(SESSION_TTL_MS);
  });

  it('are Secure only when the origin is https', () => {
    expect(isSecureOrigin('https://varians.example')).toBe(true);
    expect(isSecureOrigin('HTTPS://varians.example')).toBe(true);
    expect(isSecureOrigin('http://localhost:5173')).toBe(false);
    expect(isSecureOrigin(undefined)).toBe(false);
    expect(sessionCookieOptions('https://varians.example').secure).toBe(true);
    expect(cookieOptions().secure).toBe(true);
  });
});

describe('emails and users', () => {
  it('normalizes emails for lookup', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
  });

  it('strips the password hash and completes the preferences', () => {
    const now = new Date();
    const current = toCurrentUser({
      id: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: 'secret',
      role: 'member',
      emailVerifiedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
      preferences: { font: 'cardo' },
      createdAt: now,
      updatedAt: now,
    });
    expect(current).toEqual({
      id: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'member',
      preferences: { font: 'cardo', theme: 'system' },
    });
    expect('passwordHash' in current).toBe(false);
  });
});

describe('passwords', () => {
  it('hash with argon2id and verify', async () => {
    const hashed = await hashPassword('correct horse battery staple');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hashed, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong')).toBe(false);
  });

  it('treat an unreadable hash as a wrong password', async () => {
    expect(await verifyPassword('not a hash', 'anything')).toBe(false);
  });
});
