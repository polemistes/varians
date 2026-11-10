import { describe, expect, it } from 'vitest';
import { describePostag, lemmaKey, looseKey, parseAnalyses } from './forms.ts';

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
    expect(describePostag('v3siia---')).toBe(
      'verb, 3rd person singular imperfect indicative active',
    );
    expect(describePostag('n-s---mn-')).toBe('noun, singular masculine nominative');
    expect(describePostag('c--------')).toBe('conjunction');
  });
});
