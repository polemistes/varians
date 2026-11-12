import { describe, expect, it } from 'vitest';
import {
  applyOps,
  defaultProfile,
  fromText,
  NormalizationMemory,
  sequentialIds,
  type Op,
  type Token,
} from '@varians/core';
import {
  autoConfirmOps,
  confirmTokens,
  distinctPairs,
  dropWrittenFormOps,
  keepWrittenFormOps,
  typedReadForms,
  uncheckedIn,
} from './normalization.ts';

const wire = (ops: Op[]): Op[] => JSON.parse(JSON.stringify(ops)) as Op[];

describe('typed read forms', () => {
  it('reads the pairs set operations leave and drops cleared ones', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ', { lang: 'grc', ids: sequentialIds() });
    const ops: Op[] = [
      { t: 'set', id: 't1', fields: { norm: 'μῆνιν' } },
      { t: 'set', id: 't2', fields: { norm: undefined } },
    ];
    const after = applyOps(s, ops).stream;
    expect(typedReadForms(ops, after)).toEqual([
      { tokenId: 't1', pair: { form: 'ΜΗΝΙΝ', norm: 'μῆνιν' } },
      { tokenId: 't2', pair: null },
    ]);
    expect(typedReadForms([{ t: 'set', id: 't1', fields: { form: 'x' } }], after)).toEqual([]);
  });

  it('removes repeated pairs', () => {
    expect(
      distinctPairs([
        { form: 'a', norm: 'b' },
        { form: 'a', norm: 'b' },
        { form: 'a', norm: 'c' },
      ]),
    ).toHaveLength(2);
  });
});

describe('confirming', () => {
  function unchecked() {
    const s = fromText('ΜΗΝΙΝ ΑΛΓΕΑ', { lang: 'grc', ids: sequentialIds() });
    Object.assign(s.items[0] as Token, { norm: 'μῆνιν', unchecked: true });
    Object.assign(s.items[1] as Token, { norm: 'ἄλγε᾽', unchecked: true });
    return s;
  }

  it('clears the check marks of the chosen words and teaches the memory', () => {
    const s = unchecked();
    const memory = new NormalizationMemory();
    const { ops, pairs } = confirmTokens(s, ['t2'], memory);
    const after = applyOps(s, wire(ops)).stream;
    expect(uncheckedIn(after).map((t) => t.id)).toEqual(['t1']);
    expect(pairs).toEqual([{ form: 'ΑΛΓΕΑ', norm: 'ἄλγε᾽' }]);
    expect(memory.propose('ΑΛΓΕΑ')).toBe('ἄλγε᾽');
  });

  it('confirms by itself a word whose forms agree under the fold', () => {
    const s = unchecked();
    const ops = autoConfirmOps(s, ['t1', 't2'], defaultProfile('grc'));
    expect(ops).toEqual([{ t: 'set', id: 't1', fields: { unchecked: null } }]);
  });
});

describe('switching the written form', () => {
  it('on: the text becomes the read form and the written form a copy', () => {
    const s = fromText('μῆνιν ἄειδε', { lang: 'grc', ids: sequentialIds() });
    (s.items[1] as Token).norm = 'ἀείδε';
    const after = applyOps(s, wire(keepWrittenFormOps(s))).stream;
    expect(after.items.map((t) => [(t as Token).form, (t as Token).norm])).toEqual([
      ['μῆνιν', 'μῆνιν'],
      ['ἄειδε', 'ἀείδε'],
    ]);
  });

  it('off: the read form becomes the only form, ranged marks cover the word', () => {
    const s = fromText('ΜΗΝΙΝ ΘΕΑ', { lang: 'grc', ids: sequentialIds() });
    Object.assign(s.items[0] as Token, {
      norm: 'μῆνιν',
      unchecked: true,
      marks: [{ kind: 'unclear', from: 1, to: 2 }],
    });
    const after = applyOps(s, wire(dropWrittenFormOps(s))).stream;
    expect(after.items[0]).toEqual({
      kind: 'token',
      id: 't1',
      lang: 'grc',
      form: 'μῆνιν',
      marks: [{ kind: 'unclear' }],
    });
    expect(after.items[1]).toEqual({ kind: 'token', id: 't2', lang: 'grc', form: 'ΘΕΑ' });
  });
});

describe('the rules of each word', () => {
  it('confirms by itself a word whose forms agree under the fold of its own language', () => {
    // virum read as uirum agrees in Latin, which reads v as u, and not by the general rules.
    const s = fromText('virum virum', { lang: 'la', ids: sequentialIds() });
    delete (s.items[1] as Token).lang;
    for (const item of s.items) {
      (item as Token).norm = 'uirum';
      (item as Token).unchecked = true;
    }
    expect(autoConfirmOps(s, ['t1', 't2'])).toEqual([
      { t: 'set', id: 't1', fields: { unchecked: null } },
    ]);
  });
});
