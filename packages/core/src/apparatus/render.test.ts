import { describe, expect, it } from 'vitest';
import { applySiteKinds, collate, siteKey, type CollationText } from '../collate/collate.ts';
import type { Unit } from '../stream/words.ts';
import { apparatusEntries, DEFAULT_CONVENTIONS, formatApparatus, formatEntry, printedTextIds, splitEntries, type Attachment } from './render.ts';

let n = 0;
function text(id: string, siglum: string, words: string): CollationText {
  const units: Unit[] = words
    .split(/\s+/u)
    .filter((w) => w.length > 0)
    .map((w) => ({ text: w, tokenIds: [`${id}-${++n}`] }));
  return { id, siglum, units };
}

describe('apparatus', () => {
  it('prints a positive apparatus with omissions and additions', () => {
    const c = collate(text('E', 'ed', 'the quick brown fox'), [
      text('A', 'A', 'the quick brown fox'),
      text('B', 'B', 'the quick fox'),
      text('C', 'C', 'the quick brown red fox'),
    ]);
    const lines = formatApparatus(apparatusEntries(c, '1.1', {}));
    expect(lines).toEqual(['1.1 brown A C : om. B', '1.1 A B : red add. C']);
  });

  it('prints a negative apparatus of different words only', () => {
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ'), [text('A', 'A', 'μῆνιν ἄειδε θεά'), text('B', 'B', 'μῆνιν ἄειδε θεός')]);
    const negative = { form: 'negative' as const, latin: true, interpretative: 'separate' as const };
    expect(formatApparatus(apparatusEntries(c, '1.1', {}, negative), negative)).toEqual(['1.1 θεὰ : θεός B']);
  });

  it('prints an adopted conjecture as the lemma’s source and others as variants', () => {
    const c = collate(text('E', 'ed', 'οἰωνοῖσί τε δαῖτα Διὸς'), [text('A', 'A', 'οἰωνοῖσί τε πᾶσι Διὸς'), text('B', 'B', 'οἰωνοῖσί τε πᾶσι Διὸς')]);
    const adopted: Attachment = { kind: 'conjecture', id: 'c1', text: 'δαῖτα', name: 'Zenodotus', source: '(Ath. 1.12e)', adopted: true, conjectureKind: 'substitution' };
    const other: Attachment = { kind: 'conjecture', id: 'c2', text: 'πάντα', name: 'Berge', conjectureKind: 'substitution' };
    const lines = formatApparatus(apparatusEntries(c, '1.5', { 0: [adopted, other] }));
    expect(lines).toEqual(['1.5 δαῖτα Zenodotus (Ath. 1.12e) : πᾶσι A B : πάντα Berge (coni.)']);
  });

  it('prints English words when asked', () => {
    const c = collate(text('E', 'ed', 'a b c'), [text('B', 'B', 'a c')]);
    const english = { form: 'positive' as const, latin: false, interpretative: 'separate' as const };
    expect(formatApparatus(apparatusEntries(c, '2', {}, english), english)).toEqual(['2 b : omitted B']);
  });
});

describe('second states of a witness', () => {
  const units = (text: string) => text.split(' ').map((t, i) => ({ text: t, tokenIds: [`${text}-${i}`] }));
  const base = { id: 'E', siglum: 'ed.', units: units('μῆνιν ἄειδε θεὰ') };

  it('names a witness once where its noted variant agrees with it, and the variant where it differs', () => {
    const collation = collate(base, [
      { id: 'A', siglum: 'A', units: units('μῆνιν ἄειδε θεὰ') },
      { id: 'A:variant', siglum: 'A v.l.', units: units('μῆνιν ἄειδε θεά μοι') },
      { id: 'B', siglum: 'B', units: units('μῆνιν ἄειδε θεὰ') },
    ]);
    const entries = apparatusEntries(collation, '1.1', {}, { form: 'positive', latin: true, interpretative: 'separate' }, ['A', 'A v.l.', 'B']);
    const lines = entries.map((e) => formatEntry(e, { form: 'positive', latin: true, interpretative: 'separate' }));
    expect(lines.join(' | ')).toContain('A v.l.');
    expect(lines.every((l) => !/\bA A v\.l\./u.test(l))).toBe(true);
    expect(printedTextIds({ textIds: ['E', 'A', 'A:variant', 'B'] })).toEqual(['E', 'A', 'B']);
    expect(printedTextIds({ textIds: ['A:variant', 'C'] })).toEqual(['A:variant', 'C']);
  });
});

describe('interpretative variants', () => {
  const accents = () => collate(text('E', 'ed', 'ἦ μέγα θαῦμα'), [text('A', 'A', 'ἢ μέγα θαῦμα'), text('B', 'B', 'ἦ μέγα θαῦμα,')]);

  it('marks entries of the same letters read otherwise, and lists them apart', () => {
    const entries = apparatusEntries(accents(), '1', {});
    expect(entries.map((e) => e.kind)).toEqual(['interpretative', 'interpretative']);
    const { main, interpretative } = splitEntries(entries, DEFAULT_CONVENTIONS);
    expect(main).toEqual([]);
    expect(interpretative).toHaveLength(2);
    expect(splitEntries(entries, { interpretative: 'apparatus' }).main).toHaveLength(2);
    expect(apparatusEntries(accents(), '1', {}, { ...DEFAULT_CONVENTIONS, interpretative: 'none' })).toEqual([]);
  });

  it('counts a place as textual where a conjecture has other letters', () => {
    const c = accents();
    const other: Attachment = { kind: 'conjecture', id: 'c', text: 'καί', name: 'Berge', conjectureKind: 'substitution' };
    const accented: Attachment = { kind: 'conjecture', id: 'd', text: 'ἥ', name: 'Berge', conjectureKind: 'substitution' };
    expect(apparatusEntries(c, '1', { 0: [other] })[0]!.kind).toBe('textual');
    expect(apparatusEntries(c, '1', { 0: [accented] })[0]!.kind).toBe('interpretative');
  });

  it('takes the editor’s word over the letters', () => {
    const base = text('E', 'ed', 'ἦ μέγα θαῦμα');
    const c = collate(base, [text('A', 'A', 'ἢ μέγα θαῦμα')]);
    const key = siteKey(c.sites[0]!, base.units);
    const set = applySiteKinds(c, base.units, new Map([[key, 'textual' as const]]));
    expect(set.sites[0]).toMatchObject({ kind: 'textual', kindByEditor: true });
    expect(applySiteKinds(c, base.units, new Map([[key, 'interpretative' as const]])).sites[0]!.kindByEditor).toBeUndefined();
    expect(apparatusEntries(set, '1', {})[0]!.kind).toBe('textual');
  });
});
