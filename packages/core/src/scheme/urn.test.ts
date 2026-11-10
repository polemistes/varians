import { describe, expect, it } from 'vitest';
import { isCtsWorkUrn, passageUrn } from './urn.ts';

const levels = [
  { key: 'book', label: 'Book', type: 'number' as const, separator: '' },
  { key: 'line', label: 'Line', type: 'number' as const, separator: '.' },
];

describe('passage URNs', () => {
  it('joins the address values by full stops after the work URN', () => {
    expect(passageUrn('urn:cts:greekLit:tlg0012.tlg001', { book: '1', line: '5' }, levels)).toBe(
      'urn:cts:greekLit:tlg0012.tlg001:1.5',
    );
  });
  it('stops at the first level without a value', () => {
    expect(passageUrn('urn:cts:greekLit:tlg0012.tlg001', { book: '2' }, levels)).toBe(
      'urn:cts:greekLit:tlg0012.tlg001:2',
    );
  });
  it('gives nothing without a CTS URN of a work', () => {
    expect(passageUrn(null, { book: '1', line: '5' }, levels)).toBeNull();
    expect(passageUrn('https://example.org/iliad', { book: '1' }, levels)).toBeNull();
    expect(passageUrn('urn:cts:greekLit:tlg0012.tlg001:1.1', { book: '1' }, levels)).toBeNull();
    expect(isCtsWorkUrn('urn:cts:latinLit:phi0690.phi003')).toBe(true);
  });
});
