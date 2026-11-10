import { describe, expect, it } from 'vitest';
import { applySiteKinds, collate, siteKey, type CollationText } from '../collate/collate.ts';
import type { Unit } from '../stream/words.ts';
import {
  apparatusEntries,
  DEFAULT_CONVENTIONS,
  formatApparatus,
  formatEntry,
  printedTextIds,
  splitEntries,
  type ApparatusConventions,
  type Attachment,
} from './render.ts';

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
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ'), [
      text('A', 'A', 'μῆνιν ἄειδε θεά'),
      text('B', 'B', 'μῆνιν ἄειδε θεός'),
    ]);
    const negative = {
      form: 'negative' as const,
      latin: true,
      interpretative: 'separate' as const,
    };
    expect(formatApparatus(apparatusEntries(c, '1.1', {}, negative), negative)).toEqual([
      '1.1 θεὰ : θεός B',
    ]);
  });

  it('prints an adopted conjecture as the lemma’s source and others as variants', () => {
    const c = collate(text('E', 'ed', 'οἰωνοῖσί τε δαῖτα Διὸς'), [
      text('A', 'A', 'οἰωνοῖσί τε πᾶσι Διὸς'),
      text('B', 'B', 'οἰωνοῖσί τε πᾶσι Διὸς'),
    ]);
    const adopted: Attachment = {
      kind: 'conjecture',
      id: 'c1',
      text: 'δαῖτα',
      name: 'Zenodotus',
      source: '(Ath. 1.12e)',
      adopted: true,
      conjectureKind: 'substitution',
    };
    const other: Attachment = {
      kind: 'conjecture',
      id: 'c2',
      text: 'πάντα',
      name: 'Berge',
      conjectureKind: 'substitution',
    };
    const lines = formatApparatus(apparatusEntries(c, '1.5', { 0: [adopted, other] }));
    expect(lines).toEqual(['1.5 δαῖτα Zenodotus (Ath. 1.12e) : πᾶσι A B : πάντα Berge (coni.)']);
  });

  it('prints English words when asked', () => {
    const c = collate(text('E', 'ed', 'a b c'), [text('B', 'B', 'a c')]);
    const english = {
      form: 'positive' as const,
      latin: false,
      interpretative: 'separate' as const,
    };
    expect(formatApparatus(apparatusEntries(c, '2', {}, english), english)).toEqual([
      '2 b : omitted B',
    ]);
  });
});

describe('second states of a witness', () => {
  const units = (text: string) =>
    text.split(' ').map((t, i) => ({ text: t, tokenIds: [`${text}-${i}`] }));
  const base = { id: 'E', siglum: 'ed.', units: units('μῆνιν ἄειδε θεὰ') };

  it('names a witness once where its noted variant agrees with it, and the variant where it differs', () => {
    const collation = collate(base, [
      { id: 'A', siglum: 'A', units: units('μῆνιν ἄειδε θεὰ') },
      { id: 'A:variant', siglum: 'A v.l.', units: units('μῆνιν ἄειδε θεά μοι') },
      { id: 'B', siglum: 'B', units: units('μῆνιν ἄειδε θεὰ') },
    ]);
    const entries = apparatusEntries(
      collation,
      '1.1',
      {},
      { form: 'positive', latin: true, interpretative: 'separate' },
      ['A', 'A v.l.', 'B'],
    );
    const lines = entries.map((e) =>
      formatEntry(e, { form: 'positive', latin: true, interpretative: 'separate' }),
    );
    expect(lines.join(' | ')).toContain('A v.l.');
    expect(lines.every((l) => !/\bA A v\.l\./u.test(l))).toBe(true);
    expect(printedTextIds({ textIds: ['E', 'A', 'A:variant', 'B'] })).toEqual(['E', 'A', 'B']);
    expect(printedTextIds({ textIds: ['A:variant', 'C'] })).toEqual(['A:variant', 'C']);
  });
});

describe('interpretative variants', () => {
  const accents = () =>
    collate(text('E', 'ed', 'ἦ μέγα θαῦμα'), [
      text('A', 'A', 'ἢ μέγα θαῦμα'),
      text('B', 'B', 'ἦ μέγα θαῦμα,'),
    ]);

  it('marks entries of the same letters read otherwise, and lists them apart', () => {
    const entries = apparatusEntries(accents(), '1', {});
    expect(entries.map((e) => e.kind)).toEqual(['interpretative', 'interpretative']);
    const { main, interpretative } = splitEntries(entries, DEFAULT_CONVENTIONS);
    expect(main).toEqual([]);
    expect(interpretative).toHaveLength(2);
    expect(splitEntries(entries, { interpretative: 'apparatus' }).main).toHaveLength(2);
    expect(
      apparatusEntries(accents(), '1', {}, { ...DEFAULT_CONVENTIONS, interpretative: 'none' }),
    ).toEqual([]);
  });

  it('counts a place as textual where a conjecture has other letters', () => {
    const c = accents();
    const other: Attachment = {
      kind: 'conjecture',
      id: 'c',
      text: 'καί',
      name: 'Berge',
      conjectureKind: 'substitution',
    };
    const accented: Attachment = {
      kind: 'conjecture',
      id: 'd',
      text: 'ἥ',
      name: 'Berge',
      conjectureKind: 'substitution',
    };
    expect(apparatusEntries(c, '1', { 0: [other] })[0]!.kind).toBe('textual');
    expect(apparatusEntries(c, '1', { 0: [accented] })[0]!.kind).toBe('interpretative');
  });

  it('takes the editor’s word over the letters', () => {
    const base = text('E', 'ed', 'ἦ μέγα θαῦμα');
    const c = collate(base, [text('A', 'A', 'ἢ μέγα θαῦμα')]);
    const key = siteKey(c.sites[0]!, base.units);
    const set = applySiteKinds(c, base.units, new Map([[key, { kind: 'textual' as const }]]));
    expect(set.sites[0]).toMatchObject({ kind: 'textual', kindByEditor: true });
    expect(
      applySiteKinds(c, base.units, new Map([[key, { kind: 'interpretative' as const }]])).sites[0]!
        .kindByEditor,
    ).toBeUndefined();
    expect(apparatusEntries(set, '1', {})[0]!.kind).toBe('textual');
  });
});

describe('a whole segment a witness lacks', () => {
  const gap = (id: string): CollationText => ({
    id,
    siglum: id,
    units: [{ text: '', tokenIds: [], gap: { kind: 'object', id: `${id}-gap`, type: 'gap' } }],
  });

  it('prints "om." with the first and last word for a long segment, the whole lemma for a short one', () => {
    const long = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος'), [
      text('A', 'A', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος'),
      { ...text('B', 'B', ''), present: true },
      text('C', 'C', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος'),
    ]);
    expect(formatApparatus(apparatusEntries(long, '1.1', {}))).toEqual([
      '1.1 μῆνιν … Ἀχιλῆος A C : om. B',
    ]);
    const short = collate(text('E', 'ed', 'a b c'), [{ ...text('B', 'B', ''), present: true }]);
    expect(formatApparatus(apparatusEntries(short, '2', {}))).toEqual(['2 a b c : om. B']);
  });

  it('says nothing of a loss: a lost passage is no entry, and a witness that has lost the words is not named', () => {
    const lost = collate(text('E', 'ed', 'a b c d'), [text('A', 'A', 'a b c d'), gap('B')]);
    expect(lost.absent).toEqual(['B']);
    expect(formatApparatus(apparatusEntries(lost, '3', {}))).toEqual([]);
    const within: CollationText = {
      id: 'B',
      siglum: 'B',
      units: [{ text: 'a', tokenIds: ['x'] }, ...gap('B').units, { text: 'd', tokenIds: ['y'] }],
    };
    expect(
      formatApparatus(apparatusEntries(collate(text('E', 'ed', 'a b c d'), [within]), '4', {})),
    ).toEqual([]);
    // Beside another witness's variant, the witness that has lost the word is neither named nor among "the others".
    const beside = collate(text('E', 'ed', 'a b c d'), [
      text('A', 'A', 'a x c d'),
      within,
      text('C', 'C', 'a b c d'),
      text('D', 'D', 'a b c d'),
      text('F', 'F', 'a b c d'),
    ]);
    expect(
      formatApparatus(apparatusEntries(beside, '4', {}, { ...DEFAULT_CONVENTIONS, rest: 'cett.' })),
    ).toEqual(['4 b C D F : x A']);
  });

  it('prints the other variants of the segment as entries of their own', () => {
    const c = collate(text('E', 'ed', 'a b c d'), [
      text('A', 'A', 'a x c d'),
      { ...text('B', 'B', ''), present: true },
    ]);
    // The place over the whole line first, as it stands first in the text.
    expect(formatApparatus(apparatusEntries(c, '5', {}))).toEqual([
      '5 a … d A : om. B',
      '5 b : x A',
    ]);
  });
});

describe('how the witnesses are named', () => {
  const negative = { ...DEFAULT_CONVENTIONS, form: 'negative' as const };
  const family = [{ siglum: 'p', members: ['V', 'H'] }];
  const five = (r: string, g: string, v: string, h: string, b: string) => [
    text('R', 'R', r),
    text('G', 'G', g),
    text('V', 'V', v),
    text('H', 'H', h),
    text('B', 'B', b),
  ];
  const order = ['R', 'G', 'V', 'H', 'B'];
  const print = (c: ReturnType<typeof collate>, conventions: ApparatusConventions = negative) =>
    formatApparatus(apparatusEntries(c, '1', {}, conventions, order), conventions);

  it('prints a family by its siglum where all its members have the reading', () => {
    const c = collate(
      text('E', 'ed', 'red fox'),
      five('red fox', 'red dog', 'red dog', 'red dog', 'red fox'),
    );
    expect(print(c, { ...negative, groups: family })).toEqual(['1 fox : dog G p']);
    // Not where one of them reads otherwise.
    const d = collate(
      text('E', 'ed', 'red fox'),
      five('red fox', 'red dog', 'red dog', 'red fox', 'red fox'),
    );
    expect(print(d, { ...negative, groups: family })).toEqual(['1 fox : dog G V']);
    expect(print(c, { ...DEFAULT_CONVENTIONS, groups: family })).toEqual(['1 fox R B : dog G p']);
  });

  it('prints "the others" for the most widely attested reading, and then names the lemma’s witnesses', () => {
    const c = collate(
      text('E', 'ed', 'red fox'),
      five('red fox', 'red dog', 'red dog', 'red dog', 'red dog'),
    );
    expect(print(c, { ...negative, groups: family, rest: 'cett.' })).toEqual([
      '1 fox R : dog cett.',
    ]);
    // Two sigla are as short as the word: they are named.
    const d = collate(
      text('E', 'ed', 'red fox'),
      five('red fox', 'red dog', 'red dog', 'red dog', 'red fox'),
    );
    expect(print(d, { ...negative, groups: family, rest: 'cett.' })).toEqual(['1 fox : dog G p']);
    // Where the lemma is the most widely attested, a positive apparatus prints the word for its witnesses.
    const e = collate(
      text('E', 'ed', 'red fox'),
      five('red fox', 'red fox', 'red fox', 'red fox', 'red dog'),
    );
    expect(print(e, { ...DEFAULT_CONVENTIONS, rest: 'rell.' })).toEqual(['1 fox rell. : dog B']);
    expect(print(e, { ...negative, rest: 'rell.' })).toEqual(['1 fox : dog B']);
  });

  it('prints "all the witnesses" where the lemma is in none of them and they have one reading', () => {
    const c = collate(
      text('E', 'ed', 'red fox'),
      five('red dog', 'red dog', 'red dog', 'red dog', 'red dog'),
    );
    expect(print(c, { ...negative, all: 'codd.', rest: 'cett.' })).toEqual(['1 fox : dog codd.']);
    // Two readings among them: the wider is "the others".
    const d = collate(
      text('E', 'ed', 'red fox'),
      five('red dog', 'red dog', 'red dog', 'red dog', 'red cat'),
    );
    expect(print(d, { ...negative, all: 'codd.', rest: 'cett.' })).toEqual([
      '1 fox : dog cett. : cat B',
    ]);
  });

  it('does not say "the others" at a place inside a stretch that one of them leaves out', () => {
    const c = collate(text('E', 'ed', 'the quick red fox runs'), [
      // R leaves three words out; inside that stretch the others divide over one word.
      text('R', 'R', 'the runs'),
      text('G', 'G', 'the quick red dog runs'),
      text('V', 'V', 'the quick red dog runs'),
      text('H', 'H', 'the quick red dog runs'),
      text('B', 'B', 'the quick red fox runs'),
    ]);
    expect(print(c, { ...negative, rest: 'cett.' })).toEqual([
      '1 quick red fox : om. R',
      '1 fox : dog G V H',
    ]);
  });

  it('names every witness when the conventions have no such words', () => {
    const c = collate(
      text('E', 'ed', 'red fox'),
      five('red dog', 'red dog', 'red dog', 'red dog', 'red dog'),
    );
    expect(print(c)).toEqual(['1 fox : dog R G V H B']);
  });
});

describe('the order and extent of entries', () => {
  const negative = { ...DEFAULT_CONVENTIONS, form: 'negative' as const };

  it('prints the entries in the order of the text, a wide place before those within it', () => {
    const c = collate(text('E', 'ed', 'the quick brown fox jumps over'), [
      text('A', 'A', 'the quick brown fox jumps over'),
      // B leaves four words out; C has another word inside that stretch, D another before it.
      text('B', 'B', 'the over'),
      text('C', 'C', 'the quick red fox jumps over'),
      text('D', 'D', 'a quick brown fox jumps over'),
    ]);
    expect(formatApparatus(apparatusEntries(c, '1', {}, negative), negative)).toEqual([
      '1 the : a D',
      '1 quick … jumps : om. B',
      '1 brown : red C',
    ]);
  });

  it('leaves out a place the editor judges minor, as a printed edition does', () => {
    const base = text('E', 'ed', 'red fox runs');
    const c = collate(base, [text('A', 'A', 'red dog runs'), text('B', 'B', 'red fox walks')]);
    const site = c.sites.find((s) => s.readings.some((r) => r.text === 'dog'))!;
    const marked = applySiteKinds(
      c,
      base.units,
      new Map([[siteKey(site, base.units), { minor: true }]]),
    );
    expect(formatApparatus(apparatusEntries(marked, '1', {}, negative), negative)).toEqual([
      '1 runs : walks B',
    ]);
  });

  it('takes the kind and the grade of a place as two words, each apart from the other', () => {
    const base = text('E', 'ed', 'ἦ μέγα θαῦμα');
    const c = collate(base, [text('A', 'A', 'ἢ μέγα θαῦμα')]);
    const key = siteKey(c.sites[0]!, base.units);
    const both = applySiteKinds(
      c,
      base.units,
      new Map([[key, { kind: 'textual' as const, minor: true }]]),
    );
    expect(both.sites[0]).toMatchObject({ kind: 'textual', kindByEditor: true, minor: true });
    const grade = applySiteKinds(c, base.units, new Map([[key, { minor: true }]]));
    expect(grade.sites[0]).toMatchObject({ kind: 'interpretative', minor: true });
    expect(grade.sites[0]!.kindByEditor).toBeUndefined();
    expect(applySiteKinds(c, base.units, new Map([[key, {}]])).sites[0]!.minor).toBeUndefined();
  });
});
