import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds, type Op, type Token } from '@varians/core';
import { languageOps, languagesInOrder, unlanguagedIn, withLanguage } from './language.ts';

function mixed() {
  const s = fromText('arma μῆνιν virumque ἄειδε', { lang: 'la', ids: sequentialIds() });
  (s.items[1] as Token).lang = 'grc';
  (s.items[3] as Token).lang = 'grc';
  return s;
}

describe('languagesInOrder', () => {
  it('lists each language once, in the order it first occurs', () => {
    expect(languagesInOrder(mixed().items)).toEqual(['la', 'grc']);
  });

  it('lists nothing for a text without words', () => {
    expect(languagesInOrder([])).toEqual([]);
  });
});

describe('words without a language', () => {
  const ops: Op[] = [
    {
      t: 'insert',
      after: null,
      items: [
        { kind: 'token', id: 'n1', form: 'et' },
        { kind: 'break', id: 'n2', type: 'line' },
        { kind: 'token', id: 'n3', form: 'cano', lang: 'la' },
      ],
    },
    { t: 'replace', ids: ['t1'], items: [{ kind: 'token', id: 'n4', form: 'arma' }] },
    { t: 'set', id: 't2', fields: { form: 'x' } },
  ];

  it('are named from the inserts and replacements that bring them in', () => {
    expect(unlanguagedIn(ops)).toEqual(['n1', 'n4']);
  });

  it('are given a language, and words that have one keep theirs', () => {
    const given = withLanguage(ops, 'grc');
    expect(unlanguagedIn(given)).toEqual([]);
    const items = given.flatMap((op) => (op.t === 'insert' || op.t === 'replace' ? op.items : []));
    expect(items.map((i) => (i.kind === 'token' ? i.lang : null))).toEqual([
      'grc',
      null,
      'la',
      'grc',
    ]);
    expect(given[2]).toBe(ops[2]);
  });
});

describe('languageOps', () => {
  it('sets the language of the words that have another', () => {
    const s = mixed();
    const ops = languageOps(s, ['t1', 't2', 't3'], 'grc');
    expect(ops).toEqual([
      { t: 'set', id: 't1', fields: { lang: 'grc' } },
      { t: 'set', id: 't3', fields: { lang: 'grc' } },
    ]);
    expect(languagesInOrder(applyOps(s, ops).stream.items)).toEqual(['grc']);
  });
});
