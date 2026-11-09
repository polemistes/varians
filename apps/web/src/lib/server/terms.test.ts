import { describe, expect, it } from 'vitest';
import { hasAcceptedTerms, parseTerms, safeNext, terms, termsGate, TERMS_VERSION } from './terms.ts';

describe('the terms of contribution', () => {
  it('read their version from the front matter of docs/terms.md', () => {
    expect(TERMS_VERSION).toBeGreaterThanOrEqual(1);
    expect(terms.rendered.html).toContain('<h1 id="terms-of-contribution">Terms of contribution</h1>');
    expect(parseTerms('---\nversion: 3\n---\n# T\n')).toEqual({ version: 3, body: '# T\n' });
    expect(() => parseTerms('# No version\n')).toThrow();
  });

  it('let an account without them read, sign out and accept, and stop its changes', () => {
    expect(termsGate('GET', '/works/iliad')).toBeNull();
    expect(termsGate('POST', '/terms')).toBeNull();
    expect(termsGate('POST', '/logout')).toBeNull();
    expect(termsGate('POST', '/api/documents/edition/x/ops')).toBe('api');
    expect(termsGate('POST', '/works/new')).toBe('page');
    expect(termsGate('GET', '/editions/iliad-1/edit')).toBe('page');
    expect(hasAcceptedTerms({ termsVersion: TERMS_VERSION })).toBe(true);
    expect(hasAcceptedTerms({ termsVersion: null })).toBe(false);
  });

  it('go back only to a path on this site', () => {
    expect(safeNext('/editions/a/edit')).toBe('/editions/a/edit');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
