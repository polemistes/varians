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
  effectiveProfile,
  keepWrittenFormOps,
  profilesByWork,
  typedReadForms,
  uncheckedIn,
} from './normalization.ts';

const wire = (ops: Op[]): Op[] => JSON.parse(JSON.stringify(ops)) as Op[];

describe('effectiveProfile', () => {
  it('lays the transcription overrides over the work profile', () => {
    const work = defaultProfile('grc');
    const profile = effectiveProfile(work, { lowercaseCapitals: false, fold: { stripDiacritics: true } as never });
    expect(profile.lowercaseCapitals).toBe(false);
    expect(profile.finalSigma).toBe(true);
    expect(profile.fold.stripDiacritics).toBe(true);
    expect(profile.fold.caseFold).toBe(work.fold.caseFold);
    expect(effectiveProfile(null, null, 'la').latinUV).toBe(true);
  });
});

describe('typed read forms', () => {
  it('reads the pairs set operations leave and drops cleared ones', () => {
    const s = fromText('ΜΗΝΙΝ ΑΕΙΔΕ', { ids: sequentialIds() });
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
    expect(distinctPairs([{ form: 'a', norm: 'b' }, { form: 'a', norm: 'b' }, { form: 'a', norm: 'c' }])).toHaveLength(2);
  });
});

describe('confirming', () => {
  function unchecked() {
    const s = fromText('ΜΗΝΙΝ ΑΛΓΕΑ', { ids: sequentialIds() });
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
    const s = fromText('μῆνιν ἄειδε', { ids: sequentialIds() });
    (s.items[1] as Token).norm = 'ἀείδε';
    const after = applyOps(s, wire(keepWrittenFormOps(s))).stream;
    expect(after.items.map((t) => [(t as Token).form, (t as Token).norm])).toEqual([
      ['μῆνιν', 'μῆνιν'],
      ['ἄειδε', 'ἀείδε'],
    ]);
  });

  it('off: the read form becomes the only form, ranged marks cover the word', () => {
    const s = fromText('ΜΗΝΙΝ ΘΕΑ', { ids: sequentialIds() });
    Object.assign(s.items[0] as Token, { norm: 'μῆνιν', unchecked: true, marks: [{ kind: 'unclear', from: 1, to: 2 }] });
    const after = applyOps(s, wire(dropWrittenFormOps(s))).stream;
    expect(after.items[0]).toEqual({ kind: 'token', id: 't1', form: 'μῆνιν', marks: [{ kind: 'unclear' }] });
    expect(after.items[1]).toEqual({ kind: 'token', id: 't2', form: 'ΘΕΑ' });
  });
});

describe('profilesByWork', () => {
  // ΛΟΓΟΣ (a Greek work's segment), VIRVM (a Latin work's segment), then words of no work.
  const stream = fromText('ΛΟΓΟΣ VIRVM ΕΡΓΟΝ', { ids: sequentialIds() });
  (stream.items[0] as Token).segment = { segmentId: 'g1' };
  (stream.items[1] as Token).segment = { segmentId: 'l1' };
  (stream.items[2] as Token).segment = { segmentId: null };
  const segments = { g1: { workId: 'greek' }, l1: { workId: 'latin' } };
  const works = [
    { id: 'greek', language: 'grc', profile: null },
    { id: 'latin', language: 'lat', profile: null },
  ];
  const token = (i: number) => stream.items[i] as Token;

  it('reads each word by the work its stretch is assigned to', () => {
    const of = profilesByWork(stream, segments, works, null, 'greek');
    expect(of(token(0)).language).toBe('grc');
    expect(of(token(1)).language).toBe('lat');
    expect(of(token(1)).latinUV).toBe(true);
  });

  it('reads words of no work by the first work the transcription is for', () => {
    expect(profilesByWork(stream, segments, works, null, 'latin')(token(2)).language).toBe('lat');
    expect(profilesByWork(stream, segments, works, null, 'greek')(token(2)).language).toBe('grc');
  });

  it('applies the transcription\'s own settings to every work', () => {
    const of = profilesByWork(stream, segments, works, { lowercaseCapitals: false }, 'greek');
    expect(of(token(0)).lowercaseCapitals).toBe(false);
    expect(of(token(1)).lowercaseCapitals).toBe(false);
  });
});
