import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds } from '@varians/core';
import { parseOps } from './ops-schema.ts';

describe('parseOps', () => {
  it('accepts what the editors send', () => {
    const items = fromText('μῆνιν ἄειδε\nθεὰ', { lang: 'grc', ids: sequentialIds() }).items;
    const result = parseOps([
      { t: 'insert', after: null, items },
      {
        t: 'set',
        id: 't1',
        fields: {
          norm: 'μῆνιν',
          unchecked: null,
          segment: { segmentId: 's1' },
          marks: [{ kind: 'unclear', from: 0, to: 2 }],
        },
      },
      { t: 'delete', ids: ['t2'] },
      { t: 'move', ids: ['t4'], after: null },
      { t: 'split', id: 't1', at: 2, newId: 'n1', join: true },
      { t: 'join', id: 't1' },
      {
        t: 'replace',
        ids: ['t1'],
        items: [{ kind: 'object', id: 'g1', type: 'gap', attrs: { reason: 'lost', quantity: 3 } }],
      },
      {
        t: 'set',
        id: 't5',
        fields: { source: { kind: 'witness', transcriptionId: 'x', tokenIds: ['a'] } },
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it('takes a word with a language or, for now, without one, and a set of its language', () => {
    const word = { kind: 'token', id: 'w', form: 'arma' };
    expect(parseOps([{ t: 'insert', after: null, items: [word] }]).ok).toBe(true);
    expect(parseOps([{ t: 'insert', after: null, items: [{ ...word, lang: 'la' }] }]).ok).toBe(
      true,
    );
    expect(parseOps([{ t: 'replace', ids: ['x'], items: [{ ...word, lang: 'la' }] }]).ok).toBe(
      true,
    );
    expect(parseOps([{ t: 'set', id: 'w', fields: { lang: 'grc' } }]).ok).toBe(true);
    expect(parseOps([{ t: 'set', id: 'w', fields: { lang: 3 } }]).ok).toBe(false);
    expect(parseOps([{ t: 'insert', after: null, items: [{ ...word, lang: '' }] }]).ok).toBe(false);
  });

  it('refuses unknown fields, malformed items and unknown operations', () => {
    expect(parseOps([{ t: 'set', id: 'a', fields: { kind: 'object' } }]).ok).toBe(false);
    expect(parseOps([{ t: 'set', id: 'a', fields: { toString: 'x', constructor: 'y' } }]).ok).toBe(
      false,
    );
    expect(parseOps([{ t: 'set', id: 'a', fields: { form: 42 } }]).ok).toBe(false);
    expect(parseOps([{ t: 'insert', after: null, items: [{ kind: 'token', id: 'a' }] }]).ok).toBe(
      false,
    );
    expect(
      parseOps([
        { t: 'insert', after: null, items: [{ kind: 'token', id: 'a', form: 'x', evil: true }] },
      ]).ok,
    ).toBe(false);
    expect(parseOps([{ t: 'drop', ids: ['a'] }]).ok).toBe(false);
    expect(
      parseOps([{ t: 'set', id: 'a', fields: { marks: [{ kind: 'unclear', colour: 'red' }] } }]).ok,
    ).toBe(false);
    expect(
      parseOps([
        { t: 'insert', after: null, items: [{ kind: 'token', id: 'a', form: 'x'.repeat(5000) }] },
      ]).ok,
    ).toBe(false);
    const result = parseOps([{ t: 'set', id: 'a', fields: { kind: 'object' } }]);
    expect(result.ok ? '' : result.message).toMatch(/cannot be set/);
  });
});
