import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./db', () => ({ db: {}, pool: {} }));

const { canChangeRole } = await import('./admin');

describe('canChangeRole', () => {
  it('never demotes the only administrator', () => {
    expect(canChangeRole({ role: 'administrator' }, 'member', 1)).toBe(false);
    expect(canChangeRole({ role: 'administrator' }, 'editor', 1)).toBe(false);
    expect(canChangeRole({ role: 'administrator' }, 'administrator', 1)).toBe(true);
  });

  it('demotes an administrator when another remains', () => {
    expect(canChangeRole({ role: 'administrator' }, 'member', 2)).toBe(true);
  });

  it('lets members and editors change freely', () => {
    expect(canChangeRole({ role: 'member' }, 'administrator', 0)).toBe(true);
    expect(canChangeRole({ role: 'editor' }, 'member', 1)).toBe(true);
  });
});
