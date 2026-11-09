import { describe, expect, it } from 'vitest';
import { normalizeOrcid, orcidCheckCharacter, orcidUrl } from './orcid.ts';

describe('ORCID iDs', () => {
  it('accepts the forms people type and gives the 19-character form', () => {
    expect(normalizeOrcid('0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
    expect(normalizeOrcid('https://orcid.org/0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
    expect(normalizeOrcid(' 0000 0002 1825 0097 ')).toBe('0000-0002-1825-0097');
    expect(normalizeOrcid('000000021694233x')).toBe('0000-0002-1694-233X');
  });
  it('refuses a wrong check character and what is not an iD', () => {
    expect(normalizeOrcid('0000-0002-1825-0098')).toBeNull();
    expect(normalizeOrcid('0000-0002-1825')).toBeNull();
    expect(normalizeOrcid('orcid')).toBeNull();
    expect(orcidCheckCharacter('000000021825009')).toBe('7');
    expect(orcidUrl('0000-0002-1825-0097')).toBe('https://orcid.org/0000-0002-1825-0097');
  });
});
