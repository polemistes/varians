import { describe, expect, it } from 'vitest';
import { loginUrl, safeRedirect } from './guards.ts';

describe('safeRedirect', () => {
  it('keeps local paths with their query and fragment', () => {
    expect(safeRedirect('/works/iliad')).toBe('/works/iliad');
    expect(safeRedirect('/editions/x?draft=1#l5')).toBe('/editions/x?draft=1#l5');
  });

  it('refuses anything a browser would take to another site', () => {
    for (const target of [
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r//evil.example',
      '/%09/evil.example',
      'https://evil.example',
      'evil',
      '',
      null,
      undefined,
      '/ /evil.example',
    ]) {
      const out = safeRedirect(target as string | null | undefined);
      expect(new URL(out, 'http://varians.invalid').origin).toBe('http://varians.invalid');
    }
    expect(safeRedirect('/\t/evil.example')).toBe('/');
    expect(safeRedirect('/\\evil.example')).toBe('/');
    expect(safeRedirect('//evil.example')).toBe('/');
  });

  it('builds login addresses only for local paths', () => {
    expect(loginUrl('/works/iliad')).toBe('/login?redirectTo=%2Fworks%2Filiad');
    expect(loginUrl('//evil.example')).toBe('/login');
    expect(loginUrl()).toBe('/login');
  });
});
