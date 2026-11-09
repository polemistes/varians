import { describe, expect, it } from 'vitest';
import {
  SCHEME_PRESETS,
  compareAddresses,
  formatLabel,
  nextLabel,
  parseLabel,
  sortKey,
  validateScheme,
  type Scheme,
} from './scheme.ts';

const epic = SCHEME_PRESETS[0]!.scheme;
const stephanus = SCHEME_PRESETS[2]!.scheme;
const bekker = SCHEME_PRESETS[3]!.scheme;
const drama = SCHEME_PRESETS[1]!.scheme;

describe('formatLabel and parseLabel', () => {
  it('formats and parses book and line', () => {
    expect(formatLabel(epic, { book: '1', line: '5' })).toBe('1.5');
    expect(parseLabel(epic, '1.5')).toEqual({ book: '1', line: '5' });
    expect(parseLabel(epic, '24.804a')).toEqual({ book: '24', line: '804a' });
  });

  it('divides adjacent levels with no separator by type', () => {
    expect(parseLabel(stephanus, '17a')).toEqual({ page: '17', section: 'a' });
    expect(parseLabel(stephanus, '327b')).toEqual({ page: '327', section: 'b' });
    expect(parseLabel(bekker, '1094a1')).toEqual({ page: '1094', column: 'a', line: '1' });
    expect(formatLabel(bekker, { page: '1094', column: 'a', line: '1' })).toBe('1094a1');
  });

  it('accepts free text in a numeric level', () => {
    expect(parseLabel(drama, '45a')).toEqual({ line: '45a' });
    expect(parseLabel(drama, '80A')).toEqual({ line: '80A' });
    expect(parseLabel(drama, '45bis')).toEqual({ line: '45bis' });
  });

  it('returns null for a label the scheme cannot divide', () => {
    expect(parseLabel(epic, '15')).toBeNull();
    expect(parseLabel(stephanus, '17')).toBeNull();
    expect(parseLabel(epic, '')).toBeNull();
  });
});

describe('sortKey', () => {
  it('sorts numbers by value with suffixes after the bare number', () => {
    const order = ['4', '4A', '4a', '5', '10', '100'].map((line) => ({ line }));
    const shuffled = [...order].reverse();
    shuffled.sort((a, b) => compareAddresses(drama, a, b));
    expect(shuffled.map((a) => a.line)).toEqual(['4', '4A', '4a', '5', '10', '100']);
  });

  it('sorts stephanus pages and sections', () => {
    const labels = ['17b', '17a', '18a', '172a', '17e'];
    const sorted = labels
      .map((l) => parseLabel(stephanus, l)!)
      .sort((a, b) => compareAddresses(stephanus, a, b))
      .map((a) => formatLabel(stephanus, a));
    expect(sorted).toEqual(['17a', '17b', '17e', '18a', '172a']);
    expect(sortKey(epic, { book: '1', line: '5' })).toBe('00000001.00000005');
  });
});

describe('nextLabel', () => {
  it('proposes the next line, letter or section', () => {
    expect(nextLabel(epic, '1.5')).toBe('1.6');
    expect(nextLabel(drama, '45a')).toBe('45b');
    expect(nextLabel(drama, '45')).toBe('46');
    expect(nextLabel(drama, '09')).toBe('10');
    expect(nextLabel(stephanus, '17a')).toBe('17b');
    expect(nextLabel(stephanus, '17e')).toBe('17f');
    expect(nextLabel(bekker, '1094a1')).toBe('1094a2');
    expect(nextLabel(drama, '45z')).toBeNull();
  });
});

describe('validateScheme', () => {
  it('refuses two same-typed levels without a separator', () => {
    const bad: Scheme = {
      levels: [
        { key: 'a', label: 'A', type: 'number', separator: '' },
        { key: 'b', label: 'B', type: 'number', separator: '' },
      ],
    };
    expect(validateScheme(bad)).toHaveLength(1);
    expect(validateScheme(epic)).toEqual([]);
    expect(validateScheme({ levels: [] })).toHaveLength(1);
  });
});

describe('number levels', () => {
  it('begin with a digit, and may carry a letter for an inserted line', () => {
    expect(parseLabel(epic, 'abc.def')).toBeNull();
    expect(parseLabel(epic, '1.x')).toBeNull();
    expect(parseLabel(epic, '1.5a')).toEqual({ book: '1', line: '5a' });
  });
});
