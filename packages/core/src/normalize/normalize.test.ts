import { describe, expect, it } from 'vitest';
import { differOnlyInFold, fold, greekLower, isAllCaps, stripDiacritics } from './fold.ts';
import { NormalizationMemory, agreeUnderFold, defaultProfile, proposeReadForm } from './profile.ts';

const greek = defaultProfile('grc');

describe('fold', () => {
  it('ignores case, final sigma and punctuation by default', () => {
    expect(fold('Μῆνιν,')).toBe(fold('μῆνιν'));
    expect(fold('ΜΗΝΙΣ')).toBe(fold('μηνισ'));
    expect(fold('θεός·')).toBe('θεόσ');
    expect(fold('ἄλγε᾽')).toBe('ἄλγε');
    expect(fold("ἄλγε'")).toBe('ἄλγε');
  });

  it('keeps accents unless told to strip them', () => {
    expect(fold('σφωε')).not.toBe(fold('σφῶε'));
    expect(fold('σφωε', { ...greek.fold, stripDiacritics: true })).toBe(fold('σφῶε', { ...greek.fold, stripDiacritics: true }));
  });

  it('compares composed and decomposed Greek as equal', () => {
    expect(fold('ἐκ')).toBe(fold('ἐκ'));
  });

  it('folds Latin u and v when asked', () => {
    const latin = defaultProfile('la');
    expect(fold('Virtus', latin.fold)).toBe('uirtus');
    expect(fold('iam', latin.fold)).toBe(fold('jam', latin.fold));
  });

  it('tells orthographic differences from real ones', () => {
    expect(differOnlyInFold('ἄλγε᾽', 'ἄλγε', greek.fold)).toBe(true);
    expect(differOnlyInFold('ἄλγεα', 'ἄλγε', greek.fold)).toBe(false);
  });

  it('strips diacritics and places final sigma', () => {
    expect(stripDiacritics('Ἀχιλῆος')).toBe('Αχιληος');
    expect(greekLower('ΑΧΙΛΗΟΣ ΟΥΛΟΜΕΝΗΝ')).toBe('αχιληος ουλομενην');
    expect(isAllCaps('ΜΗΝΙΝ')).toBe(true);
    expect(isAllCaps('Μῆνιν')).toBe(false);
    expect(isAllCaps('123')).toBe(false);
  });
});

describe('proposeReadForm', () => {
  it('lowercases majuscule Greek with the final sigma, and nothing else', () => {
    expect(proposeReadForm('ΑΧΙΛΗΟΣ', undefined, greek)).toBe('αχιληος');
    expect(proposeReadForm('Μῆνιν', undefined, greek)).toBeUndefined();
    expect(proposeReadForm('μηνιν', undefined, greek)).toBeUndefined();
  });

  it('expands an abbreviation', () => {
    expect(proposeReadForm('ΚΣ', [{ kind: 'abbr', attrs: { expan: 'Κύριος' } }], greek)).toBe('Κύριος');
    expect(proposeReadForm('ΙΗΣ', [{ kind: 'abbr', attrs: { expan: 'ΙΗΣΟΥΣ' }, from: 0, to: 3 }], greek)).toBe('ιησους');
  });

  it('reads Latin v and j as u and i', () => {
    expect(proposeReadForm('VIRTVS', undefined, defaultProfile('la'))).toBe('uirtus');
  });
});

describe('agreeUnderFold', () => {
  it('confirms ΜΗΝΙΝ against μῆνιν and not ΜΗΝΗΝ', () => {
    expect(agreeUnderFold('ΜΗΝΙΝ', 'μῆνιν', greek)).toBe(true);
    expect(agreeUnderFold('ΜΗΝΗΝ', 'μῆνιν', greek)).toBe(false);
  });
});

describe('NormalizationMemory', () => {
  it('remembers confirmed pairs and proposes them', () => {
    const memory = new NormalizationMemory();
    memory.remember('ΜΗΝΗΝ', 'μῆνιν');
    memory.remember('ΜΗΝΗΝ', 'μῆνιν');
    memory.remember('ΑΕΙΔΕ', 'ἄειδε');
    expect(memory.propose('ΜΗΝΗΝ')).toBe('μῆνιν');
    expect(memory.propose('ΘΕΑ')).toBeUndefined();
    expect(memory.toJSON()[0]).toEqual({ form: 'ΜΗΝΗΝ', norm: 'μῆνιν', count: 2 });
    memory.forget('ΜΗΝΗΝ');
    expect(memory.propose('ΜΗΝΗΝ')).toBeUndefined();
  });
});
