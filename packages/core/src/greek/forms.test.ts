import { describe, expect, it } from 'vitest';
import { describePostag, lemmaKey, looseKey, parseAnalyses, variantRelation } from './forms.ts';

describe('looseKey', () => {
  it('keeps the letters alone, in lower case, with a final sigma', () => {
    expect(looseKey('Ἀχιλῆος')).toBe('αχιληος');
    expect(looseKey('ᾖ')).toBe('η');
    expect(looseKey('Πηληϊάδεω,')).toBe('πηληιαδεω');
    expect(looseKey('ἄλγε᾽')).toBe('αλγε');
    expect(looseKey('ΛΟΓΟΣ')).toBe('λογος');
    expect(looseKey('λόγοσ')).toBe('λογος');
    expect(looseKey('ῥῆμα')).toBe('ρημα');
  });
});

describe('lemmaKey', () => {
  it('lowers the case, drops a homograph number and keeps the diacritics', () => {
    expect(lemmaKey('Ἀχιλλεύς')).toBe('ἀχιλλεύς');
    expect(lemmaKey(' μήν2 ')).toBe('μήν');
    expect(lemmaKey('ΟΔΥΣΣΕΥΣ')).toBe('οδυσσευς');
    expect(lemmaKey('λόγος')).toBe('λόγος');
  });
});

describe('analyses', () => {
  it('reads the packed lines', () => {
    expect(parseAnalyses('ἦ\tεἰμί\tv3siia---\ttreebank\nἤ\tἤ\tc--------\tmorpheus\n')).toEqual([
      { form: 'ἦ', lemma: 'εἰμί', postag: 'v3siia---', source: 'treebank' },
      { form: 'ἤ', lemma: 'ἤ', postag: 'c--------', source: 'morpheus' },
    ]);
  });

  it('spells out a tag', () => {
    expect(describePostag('v3siia---')).toBe('verb, 3rd person singular imperfect indicative active');
    expect(describePostag('n-s---mn-')).toBe('noun, singular masculine nominative');
    expect(describePostag('c--------')).toBe('conjunction');
  });
});

describe('variantRelation', () => {
  const lemmas: Record<string, string[]> = {
    ἑλώρια: ['ἑλώριον'],
    ἕλωρα: ['ἕλωρ'],
    ἔθηκε: ['τίθημι'],
    θῆκε: ['τίθημι'],
    πᾶσι: ['πᾶς'],
    δαῖτα: ['δαίς'],
    κύνεσσιν: ['κύων'],
    κύνεσι: ['κύων'],
  };
  const of = (w: string) => (lemmas[w] ? new Set(lemmas[w]) : undefined);

  it('tells another form of the same word from another word', () => {
    expect(variantRelation('κύνεσσιν', 'κύνεσι', of)).toBe('form');
    expect(variantRelation('ἔθηκε', 'θῆκε', of)).toBe('form');
    expect(variantRelation('πᾶσι', 'δαῖτα', of)).toBe('word');
    expect(variantRelation('ἑλώρια', 'ἕλωρα', of)).toBe('word');
  });

  it('tells the same words in another order', () => {
    expect(variantRelation('πᾶσι δαῖτα', 'δαῖτα πᾶσι,', of)).toBe('order');
  });

  it('says nothing of omissions, unequal lengths and unknown words', () => {
    expect(variantRelation('πᾶσι', '', of)).toBeNull();
    expect(variantRelation('πᾶσι', 'πᾶσι δαῖτα', of)).toBeNull();
    expect(variantRelation('πᾶσι', 'ἄγνωστον', of)).toBeNull();
  });
});
