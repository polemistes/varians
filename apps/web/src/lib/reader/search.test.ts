import { describe, expect, it } from 'vitest';
import { layoutLines, runOn, type Item } from '@varians/core';
import { findHits, foldQuery, searchIndex } from './search';

const items: Item[] = [
  { kind: 'token', id: 'a', form: 'οἰωνοῖσί' },
  { kind: 'token', id: 'b', form: 'τε' },
  { kind: 'token', id: 'c', form: 'πᾶσι,' },
  { kind: 'token', id: 'd', form: 'Διὸς' },
  { kind: 'break', id: 'x', type: 'line' },
  { kind: 'token', id: 'e', form: 'Ἀτρεΐδης' },
  { kind: 'token', id: 'f', form: 'τε' },
  { kind: 'token', id: 'g', form: 'δῖος', norm: 'δῖος' },
  { kind: 'token', id: 'h', form: 'Ἀχιλ', joinNext: true },
  { kind: 'token', id: 'i', form: 'λεύς.' },
];
const lines = layoutLines({ items }, () => '', {});
const index = searchIndex(lines);

describe('search', () => {
  it('folds case, accents, breathings and punctuation', () => {
    expect(foldQuery('  Διὸς  δ᾽ ')).toBe('διοσ δ');
    expect(index[0]!.text).toBe('οιωνοισι τε πασι διοσ');
  });

  it('finds every line with a match, with the words the matches cover', () => {
    expect(findHits(index, 'διος')).toEqual([
      { line: 0, tokenIds: ['d'] },
      { line: 1, tokenIds: ['g'] },
    ]);
    expect(findHits(index, 'πᾶσι Διός')).toEqual([{ line: 0, tokenIds: ['c', 'd'] }]);
    expect(findHits(index, 'τε')).toEqual([
      { line: 0, tokenIds: ['b'] },
      { line: 1, tokenIds: ['f'] },
    ]);
  });

  it('reads a word divided by a line break of a prose paragraph as one, the break not being shown', () => {
    const prose: Item[] = [
      { kind: 'token', id: 'a', form: 'Ἀχιλ', joinNext: true },
      { kind: 'break', id: 'x', type: 'line' },
      { kind: 'token', id: 'b', form: 'λεύς' },
      { kind: 'break', id: 'y', type: 'line' },
      { kind: 'token', id: 'c', form: 'δῖος' },
    ];
    const shown = runOn(
      { items: prose },
      layoutLines({ items: prose }, () => '', { lineation: 'prose' }),
    );
    expect(shown).toHaveLength(1);
    expect(findHits(searchIndex(shown), 'ἀχιλλευς δίος')).toEqual([
      { line: 0, tokenIds: ['a', 'b', 'c'] },
    ]);
  });

  it('reads a word divided at a line end as one', () => {
    expect(findHits(index, 'ἀχιλλευς')).toEqual([{ line: 1, tokenIds: ['h', 'i'] }]);
  });

  it('finds nothing for an empty query or a missing word', () => {
    expect(findHits(index, '   ')).toEqual([]);
    expect(findHits(index, 'Ζεύς')).toEqual([]);
  });
});
