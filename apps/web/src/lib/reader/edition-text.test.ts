import { describe, expect, it } from 'vitest';
import type { Item, Mark } from '@varians/core';
import { EditionText } from './edition-text';
import { LEIDEN_SIGLA } from './marks';

function word(id: string, form: string, marks: Mark[] = []): Item {
  return { kind: 'token', id, form, ...(marks.length ? { marks } : {}) };
}

const lacuna: Item = { kind: 'object', id: 'lac', type: 'lacuna' };

const text = new EditionText([
  word('w0', 'μῆνιν'),
  word('w1', 'ἄειδε,'),
  word('w2', 'θεὰ,', [{ kind: 'surplus' }]),
  word('w3', 'Πηληϊάδεω', [{ kind: 'surplus' }]),
  word('w4', 'Ἀχιλῆος', [{ kind: 'crux' }]),
  lacuna,
  word('w5', 'οὐλομένην.'),
]);

describe('the edition’s words as printed', () => {
  it('prints a stretch with the edition’s signs, edge punctuation left off', () => {
    expect(text.words(['w1'], false)).toBe('ἄειδε');
    expect(text.words(['w1', 'w2'], false)).toBe('ἄειδε, [θεὰ]');
    expect(text.words(['w2', 'w3'], false)).toBe('[θεὰ, Πηληϊάδεω]');
    expect(text.words(['w4'], false)).toBe('†Ἀχιλῆος');
  });

  it('keeps the punctuation at the edges where a mark may be the difference', () => {
    expect(text.words(['w1'], true)).toBe('ἄειδε,');
    expect(text.words(['w0', 'w1'], true)).toBe('μῆνιν ἄειδε,');
  });

  it('prints a lacuna mark standing within the stretch, in the edition’s sign', () => {
    expect(text.words(['w4', 'w5'], false)).toBe('†Ἀχιλῆος *** οὐλομένην');
    const leiden = new EditionText([word('a', 'λόγος'), lacuna, word('b', 'ἔστιν')], LEIDEN_SIGLA);
    expect(leiden.words(['a', 'b'], false)).toBe('λόγος […] ἔστιν');
  });

  it('knows a word that is not there, and prints nothing for it', () => {
    expect(text.words(['nowhere'], false)).toBe('');
    expect(text.words([], false)).toBe('');
  });

  it('tells whether every word of a stretch is printed as deleted', () => {
    expect(text.deleted(['w2', 'w3'])).toBe(true);
    expect(text.deleted(['w1', 'w2'])).toBe(false);
    expect(text.deleted([])).toBe(false);
  });

  it('finds a lacuna mark between two words, and none at the end of a segment', () => {
    expect(text.lacunaBetween('w4', 'w5')).toBe('***');
    expect(text.lacunaBetween('w0', 'w1')).toBe('');
    expect(text.lacunaBetween(null, 'w0')).toBe('');
    expect(text.lacunaBetween('w5', null)).toBe('');
  });
});
