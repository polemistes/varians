import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds, type Token } from '@varians/core';
import { caseOps, inPlace, normalizeWord, removeMarksOps, takeForms, withoutMarks, type AnalysisLike } from './diacritics';

const a = (form: string, lemma: string, description = 'x'): AnalysisLike => ({ form, lemma, description });

describe('removing marks', () => {
  it('removes one kind of mark at a time', () => {
    expect(withoutMarks('ἄειδε', ['accents'])).toBe('ἀειδε');
    expect(withoutMarks('ἄειδε', ['breathings'])).toBe('άειδε');
    expect(withoutMarks('Πηληϊάδεω', ['diaereses'])).toBe('Πηληιάδεω');
    expect(withoutMarks('τῇ', ['iotaSubscripts'])).toBe('τῆ');
    expect(withoutMarks('ἄειδε θεὰ', ['accents', 'breathings'])).toBe('αειδε θεα');
  });

  it('changes the diplomatic or the normalized form, and only what changes', () => {
    const s = fromText('μῆνιν ἄειδε', { ids: sequentialIds() });
    expect(removeMarksOps(s, ['t1', 't2'], 'form', ['accents'])).toEqual([
      { t: 'set', id: 't1', fields: { form: 'μηνιν' } },
      { t: 'set', id: 't2', fields: { form: 'ἀειδε' } },
    ]);
    // A normalized form equal to the diplomatic one is no form of its own.
    (s.items[0] as Token).form = 'μηνιν';
    (s.items[0] as Token).norm = 'μῆνιν';
    expect(removeMarksOps(s, ['t1'], 'norm', ['accents'])).toEqual([{ t: 'set', id: 't1', fields: { norm: null, unchecked: null } }]);
  });

  it('makes words lower case with a final sigma, or upper case', () => {
    const s = fromText('ΛΟΓΟΣ καὶ', { ids: sequentialIds() });
    const lower = applyOps(s, caseOps(s, ['t1', 't2'], 'form', 'lower')).stream;
    expect((lower.items[0] as Token).form).toBe('λογος');
    expect(caseOps(s, ['t2'], 'form', 'upper')).toEqual([{ t: 'set', id: 't2', fields: { form: 'ΚΑῚ' } }]);
  });
});

describe('the accent in its place', () => {
  it('turns a final acute grave before another word', () => {
    expect(inPlace('θεά', { text: 'Πηληϊάδεω' }, false)).toBe('θεὰ');
    expect(inPlace('θεά', null, false)).toBe('θεά');
    expect(inPlace('θεά', { text: 'Πηληϊάδεω' }, true)).toBe('θεά');
    // Not on an earlier syllable, nor before an enclitic, nor on τίς.
    expect(inPlace('ἄειδε', { text: 'θεά' }, false)).toBe('ἄειδε');
    expect(inPlace('καλός', { text: 'τις' }, false)).toBe('καλός');
    expect(inPlace('τίς', { text: 'ἦλθε' }, false)).toBe('τίς');
  });
});

describe('normalizeWord', () => {
  const base = { diplomatic: null, remembered: null, next: null };

  it('sets the one form the letters can be', () => {
    expect(normalizeWord({ ...base, current: 'μηνιν', analyses: [a('μῆνιν', 'μῆνις')] })).toEqual({ kind: 'set', value: 'μῆνιν' });
  });

  it('keeps the punctuation, the capital and the accent of the place', () => {
    expect(normalizeWord({ ...base, current: 'θεα,', analyses: [a('θεά', 'θεά')], next: { text: 'Πηληϊάδεω' } })).toEqual({ kind: 'set', value: 'θεά,' });
    expect(normalizeWord({ ...base, current: 'θεα', analyses: [a('θεὰ', 'θεά')], next: { text: 'Πηληϊάδεω' } })).toEqual({ kind: 'set', value: 'θεὰ' });
    expect(normalizeWord({ ...base, current: 'Αχιληος', analyses: [a('Ἀχιλῆος', 'Ἀχιλλεύς')] })).toEqual({ kind: 'set', value: 'Ἀχιλῆος' });
  });

  it('leaves several forms to choose, and a word written as one of them as it is', () => {
    const analyses = [a('ἦ', 'εἰμί'), a('ἤ', 'ἤ'), a('ἢ', 'ἤ'), a('ᾖ', 'εἰμί')];
    const outcome = normalizeWord({ ...base, current: 'η', analyses });
    expect(outcome.kind).toBe('choose');
    if (outcome.kind === 'choose') expect(outcome.options.map((o) => o.form)).toEqual(['ἦ', 'ἤ', 'ᾖ']);
    expect(normalizeWord({ ...base, current: 'ἤ', analyses })).toEqual({ kind: 'kept' });
  });

  it('chooses by the accents and breathings the witness writes', () => {
    const analyses = [a('ἦ', 'εἰμί'), a('ἤ', 'ἤ'), a('ᾖ', 'εἰμί')];
    expect(normalizeWord({ ...base, current: 'η', diplomatic: 'ἤ', analyses })).toEqual({ kind: 'set', value: 'ἤ' });
    // The scribe's ὴ agrees with nothing: every option is offered.
    const odd = normalizeWord({ ...base, current: 'η', diplomatic: 'ὴ', analyses });
    expect(odd).toMatchObject({ kind: 'choose', reason: 'disagrees' });
  });

  it('takes the form chosen before for the same diplomatic form', () => {
    const analyses = [a('ἦ', 'εἰμί'), a('ἤ', 'ἤ')];
    expect(normalizeWord({ ...base, current: 'Η', diplomatic: 'Η', analyses, remembered: 'ἤ' })).toEqual({ kind: 'set', value: 'ἤ' });
  });

  it('offers elided forms only for elided words, and crasis only where nothing else fits', () => {
    const analyses = [a('καὶ', 'καί'), a('καῖʼ', 'καίω'), a('καἰ', 'εἰ'), a('καὶ', '???'), a('ʼκαὶ', 'ἀκή')];
    expect(normalizeWord({ ...base, current: 'και', analyses })).toEqual({ kind: 'set', value: 'καί' });
    expect(normalizeWord({ ...base, current: 'καγω', analyses: [a('κἀγώ', 'ἐγώ')] })).toEqual({ kind: 'set', value: 'κἀγώ' });
    // A word in capitals is set in the case of the form found.
    expect(normalizeWord({ ...base, current: 'ΚΑΙ', analyses })).toEqual({ kind: 'set', value: 'καί' });
    expect(normalizeWord({ ...base, current: 'δʼ', analyses: [a('δʼ', 'δέ'), a('δέ', 'δέ')] })).toEqual({ kind: 'kept' });
  });

  it('knows nothing of a word the analyser has not seen', () => {
    expect(normalizeWord({ ...base, current: 'ξυζ', analyses: [] })).toEqual({ kind: 'unknown' });
  });
});

describe('takeForms', () => {
  const units = (words: string, ids: string[]) => words.split(' ').map((text, i) => ({ text, tokenIds: [ids[i]!] }));

  it('takes the other text\'s forms where the letters agree, and leaves the variants', () => {
    const s = fromText('μηνιν αειδε θεα Πηληιαδεω', { ids: sequentialIds() });
    const here = { s1: units('μηνιν αειδε θεα Πηληιαδεω', ['t1', 't2', 't3', 't4']) };
    const there = { s1: units('μῆνιν ἔνεπε θεὰ Πηληϊάδεω', ['x1', 'x2', 'x3', 'x4']) };
    const out = takeForms(s, ['t1', 't2', 't3', 't4'], 'form', false, here, there);
    expect(out.taken).toBe(3);
    expect(out.differing).toBe(1);
    const after = applyOps(s, out.ops).stream.items.filter((i) => i.kind === 'token').map((t) => (t as Token).form);
    // θεὰ keeps its grave: a word follows here too.
    expect(after).toEqual(['μῆνιν', 'αειδε', 'θεὰ', 'Πηληϊάδεω']);
  });

  it('acts only on the words in scope', () => {
    const s = fromText('μηνιν θεα', { ids: sequentialIds() });
    const out = takeForms(s, ['t2'], 'form', false, { s1: units('μηνιν θεα', ['t1', 't2']) }, { s1: units('μῆνιν θεά', ['x1', 'x2']) });
    expect(out.ops).toEqual([{ t: 'set', id: 't2', fields: { form: 'θεά' } }]);
  });
});
