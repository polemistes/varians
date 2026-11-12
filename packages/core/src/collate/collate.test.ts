import { describe, expect, it } from 'vitest';
import type { Unit } from '../stream/words.ts';
import {
  additionIn,
  collate,
  siteKindOf,
  witnessesAt,
  type Collation,
  type CollationText,
} from './collate.ts';

let counter = 0;
function text(id: string, siglum: string, words: string, lang?: string): CollationText {
  const units: Unit[] = words
    .split(/\s+/u)
    .filter((w) => w.length > 0)
    .map((w) =>
      w === '[gap]'
        ? { text: '', tokenIds: [], gap: { kind: 'object', id: `g${++counter}`, type: 'gap' } }
        : { text: w, tokenIds: [`${id}-${++counter}`], ...(lang ? { lang } : {}) },
    );
  return { id, siglum, units };
}

function summary(c: Collation): string[] {
  return c.sites.map((site) =>
    site.readings
      .map(
        (r) =>
          `${r.omission ? 'om.' : r.lacunose && r.text === '' ? 'lac.' : r.text} ${r.sigla.join('')}`,
      )
      .join(' : '),
  );
}

describe('collate', () => {
  it('finds a single-word substitution', () => {
    const c = collate(text('E', 'ed', 'the quick fox'), [
      text('B', 'B', 'the slow fox'),
      text('C', 'C', 'the quick fox'),
    ]);
    expect(summary(c)).toEqual(['quick edC : slow B']);
    expect(c.sites[0]!.baseFrom).toBe(1);
    expect(c.sites[0]!.baseTo).toBe(2);
    expect(c.anchors).toEqual([0, 2]);
  });

  it('reports an omission and an addition', () => {
    const c = collate(text('E', 'ed', 'the quick brown fox'), [
      text('B', 'B', 'the quick fox'),
      text('C', 'C', 'the quick brown red fox'),
    ]);
    expect(summary(c)).toEqual(['brown edC : om. B', 'om. edB : red C']);
    expect(c.sites[1]!.readings[0]!.omission).toBe(true);
    expect(c.sites[1]!.readings[0]!.base).toBe(true);
    expect(c.sites[1]!.baseFrom).toBe(3);
    expect(c.sites[1]!.baseTo).toBe(3);
  });

  it('keeps one word against several as one site', () => {
    const c = collate(text('E', 'ed', 'ἦν τοσοῦτοι ἄνδρες'), [
      text('B', 'B', 'ἦν τὸ δὲ εἶναι ἄνδρες'),
    ]);
    expect(summary(c)).toEqual(['τοσοῦτοι ed : τὸ δὲ εἶναι B']);
  });

  it('reads a word-order variant as one site with both orders', () => {
    const c = collate(text('E', 'ed', 'the swift red fox'), [text('B', 'B', 'the red swift fox')]);
    expect(summary(c)).toEqual(['swift red ed : red swift B']);
    expect(c.sites[0]!.transposition?.textIds).toEqual(['B']);
  });

  it('groups witnesses by fold: case and grave for acute do not count, punctuation does', () => {
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ'), [
      text('A', 'A', 'μῆνιν ἄειδε, θεὰ'),
      text('B', 'B', 'Μῆνιν ἄειδε θεά'),
      text('C', 'C', 'μῆνιν ἄειδε θεός'),
    ]);
    expect(summary(c)).toEqual(['ἄειδε edBC : ἄειδε, A', 'θεὰ edAB : θεός C']);
    // A's comma is a way of reading the same letters; C's word is another word.
    expect(c.sites.map((s) => s.kind)).toEqual(['interpretative', 'textual']);
  });

  it('counts the same letters divided otherwise, or accented otherwise, as interpretative', () => {
    const c = collate(text('E', 'ed', 'ὅτι ἦλθε'), [
      text('A', 'A', 'ὅ τι ἦλθε'),
      text('B', 'B', 'ὅτι ἤλθε'),
    ]);
    expect(c.sites.every((s) => s.kind === 'interpretative')).toBe(true);
    const iota = collate(text('E', 'ed', 'τῇ πόλει'), [text('A', 'A', 'τῆ πόλει')]);
    expect(iota.sites[0]!.kind).toBe('textual');
    const elision = collate(text('E', 'ed', 'δ’ ἐμοί'), [
      text('A', 'A', 'δέ μοι'),
      text('B', 'B', 'δ᾽ ἐμοί'),
    ]);
    expect(elision.sites.map((s) => [s.kind, s.readings.map((r) => r.sigla.join(''))])).toEqual([
      ['interpretative', [['edB'].join(''), 'A']],
    ]);
    // The base's lacuna tells nothing of the letters: where nothing else differs, the place is textual.
    expect(
      siteKindOf([
        { text: 'Διὸς', lacunose: false },
        { text: '', lacunose: true },
      ]),
    ).toBe('textual');
    expect(
      siteKindOf([
        { text: 'ἦ', lacunose: false },
        { text: '', lacunose: true },
        { text: 'ἢ', lacunose: false },
      ]),
    ).toBe('interpretative');
  });

  it('reports words accented differently in the normalized texts as different words', () => {
    const c = collate(text('E', 'ed', 'ἦ μάλα'), [
      text('A', 'A', 'ἤ μάλα'),
      text('B', 'B', 'ἦ μάλα'),
    ]);
    expect(summary(c)).toEqual(['ἦ edB : ἤ A']);
  });

  it('makes no place of a gap, which reaches over the words the witness has nothing for', () => {
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω'), [
      text('P', 'P', 'μῆνιν [gap] Πηληϊάδεω'),
    ]);
    expect(c.sites).toEqual([]);
    // Where P has lost the words it is not there, and the others agree with the base.
    expect(c.anchors).toEqual([0, 1, 2, 3]);
  });

  it('places a near match in the same column as the word it replaces', () => {
    const c = collate(text('E', 'ed', 'οὐλομένην ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε'), [
      text('B', 'B', 'οὐλομένην ἣ μυρία Ἀχαιοῖς ἄλγεα θῆκε'),
    ]);
    expect(summary(c)).toEqual(['μυρί᾽ ed : μυρία B', 'ἄλγε᾽ ἔθηκε ed : ἄλγεα θῆκε B']);
  });

  it('is the same whatever order the witnesses are given in, for agreement', () => {
    const a = collate(text('E', 'ed', 'a b c d'), [
      text('B', 'B', 'a x c d'),
      text('C', 'C', 'a b c'),
    ]);
    const b = collate(text('E', 'ed', 'a b c d'), [
      text('C', 'C', 'a b c'),
      text('B', 'B', 'a x c d'),
    ]);
    expect(summary(a).map((s) => s.split(' : ').sort().join(' : '))).toEqual(
      summary(b).map((s) => s.split(' : ').sort().join(' : ')),
    );
  });

  it('lists a witness without words as absent', () => {
    const c = collate(text('E', 'ed', 'a b'), [text('B', 'B', ''), text('C', 'C', 'a b')]);
    expect(c.absent).toEqual(['B']);
    expect(c.sites).toEqual([]);
  });

  it('leaves an absent witness out of the readings of every site', () => {
    const c = collate(text('E', 'ed', 'a b c'), [text('A', 'A', 'a x c'), text('B', 'B', '')]);
    expect(summary(c)).toEqual(['b ed : x A']);
  });

  it('compares each word by the fold of its own language', () => {
    const c = collate(text('E', 'ed', 'σφῶε θεῶν', 'grc'), [text('B', 'B', 'σφωε θεῶν', 'grc')]);
    expect(summary(c)).toEqual(['σφῶε ed : σφωε B']);
    // Latin reads v as u; the general rules, for a word without a language, do not.
    const latin = collate(text('E', 'ed', 'uirum cano', 'la'), [
      text('B', 'B', 'virum cano', 'la'),
    ]);
    expect(latin.sites).toEqual([]);
    const none = collate(text('E', 'ed', 'uirum cano'), [text('B', 'B', 'virum cano')]);
    expect(summary(none)).toEqual(['uirum ed : virum B']);
    // Hebrew is compared without its points.
    const hebrew = collate(text('E', 'ed', 'שָׁלוֹם', 'he'), [text('B', 'B', 'שלום', 'he')]);
    expect(hebrew.sites).toEqual([]);
  });

  it('reports a whole-line omission as one site', () => {
    const c = collate(text('E', 'ed', 'a b c'), [text('B', 'B', '')], {});
    expect(c.absent).toEqual(['B']);
    const d = collate(text('E', 'ed', 'a b c d e'), [text('B', 'B', 'a e')]);
    expect(summary(d)).toEqual(['b c d ed : om. B']);
  });
});

describe('witnesses that lack a whole segment', () => {
  it('reports a present witness without units as omitting, and an absent one nowhere', () => {
    const empty = { ...text('B', 'B', ''), present: true };
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ'), [
      text('A', 'A', 'μῆνιν ἄειδε θεὰ'),
      empty,
      text('C', 'C', ''),
    ]);
    expect(c.absent).toEqual(['C']);
    expect(c.anchors).toEqual([0, 1, 2]);
    expect(summary(c)).toEqual(['μῆνιν ἄειδε θεὰ edA : om. B']);
  });

  it('lists a witness that has lost the whole segment as absent, like one without it', () => {
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ'), [
      text('A', 'A', 'μῆνιν ἄειδε θεός'),
      text('B', 'B', '[gap]'),
    ]);
    expect(c.absent).toEqual(['B']);
    expect(summary(c)).toEqual(['θεὰ ed : θεός A']);
    expect(c.sites.some((s) => s.wanting)).toBe(false);
  });

  it('stands a witness with half the line with the base at the place over the whole segment', () => {
    const empty = { ...text('B', 'B', ''), present: true };
    const c = collate(text('E', 'ed', 'a b c'), [
      text('A', 'A', 'a x c'),
      empty,
      text('P', 'P', 'a b [gap]'),
    ]);
    expect(summary(c)).toEqual(['b edP : x A', 'a b c edAP : om. B']);
    const whole = c.sites[1]!;
    expect(whole.wanting).toBe(true);
    expect(whole.readings[0]!.units['P']!.map((u) => u.text)).toEqual(['a', 'b']);
  });

  it('keeps the variants of a second witness in sites of their own beside the lacking one', () => {
    const empty = { ...text('B', 'B', ''), present: true };
    const c = collate(text('E', 'ed', 'μῆνιν ἄειδε θεὰ'), [
      text('A', 'A', 'μῆνιν ἄειδε θεός'),
      empty,
    ]);
    expect(summary(c)).toEqual(['θεὰ ed : θεός A', 'μῆνιν ἄειδε θεὰ edA : om. B']);
    expect(c.anchors).toEqual([0, 1]);
    const whole = c.sites[1]!;
    expect(whole).toMatchObject({
      wanting: true,
      baseFrom: 0,
      baseTo: 3,
      columnFrom: 0,
      columnTo: 3,
    });
    expect(whole.readings[1]!.omission).toBe(true);
  });
});

describe('who is there', () => {
  it('leaves a witness with a gap beside another witness’s variant out of it, and makes no place of the loss', () => {
    const c = collate(text('E', 'ed', 'a b c d'), [
      text('A', 'A', 'a x c d'),
      text('P', 'P', 'a [gap] d'),
      text('C', 'C', 'a b c d'),
    ]);
    expect(summary(c)).toEqual(['b edC : x A']);
    expect(witnessesAt(c.sites[0]!, 'E')).toEqual(['C', 'A']);
    expect(witnessesAt(c.sites[0]!, 'E', ['A', 'P', 'C'])).toEqual(['A', 'C']);
  });

  it('makes no place where the only difference is a loss', () => {
    const c = collate(text('E', 'ed', 'a b c'), [
      text('A', 'A', 'a b c'),
      text('P', 'P', 'a [gap] c'),
      text('Q', 'Q', '[gap] b c'),
    ]);
    expect(c.sites).toEqual([]);
  });

  it('leaves a witness that has lost one word of a phrase out of the phrase another has in another order', () => {
    const c = collate(text('E', 'ed', 'a b c d'), [
      text('A', 'A', 'a c b d'),
      text('P', 'P', 'a [gap] c d'),
      text('C', 'C', 'a b c d'),
    ]);
    expect(summary(c)).toEqual(['b c edC : c b A']);
    expect(c.sites[0]!.transposition?.textIds).toEqual(['A']);
  });

  it('leaves a witness out of a point beside its loss, or where it has a gap of its own', () => {
    const c = collate(text('E', 'ed', 'a b c'), [
      text('A', 'A', 'a x b c'),
      text('P', 'P', 'a [gap] c'),
      text('Q', 'Q', '[gap] b c'),
      text('R', 'R', 'a b c'),
    ]);
    // A adds x before b: P has lost b and Q has lost a, so neither is there.
    expect(summary(c)).toEqual(['om. edR : x A']);
    const own = collate(text('E', 'ed', 'a b'), [
      text('A', 'A', 'a y b'),
      text('P', 'P', 'a z [gap] b'),
    ]);
    // P has words and a gap at the same point: it is not there, and its words are not reported.
    expect(summary(own)).toEqual(['om. ed : y A']);
    expect(collate(text('E', 'ed', 'a b'), [text('P', 'P', 'a z [gap] b')]).sites).toEqual([]);
  });

  it('reports words beside a gap where the witness is there', () => {
    const c = collate(text('E', 'ed', 'a b c d'), [text('P', 'P', 'a [gap] x d')]);
    expect(summary(c)).toEqual(['c ed : x P']);
  });

  it('stands a witness with some of the words with the base where the only other reading is that they are not in a witness', () => {
    const c = collate(text('E', 'ed', 'a b c d'), [
      text('A', 'A', 'a d'),
      text('P', 'P', 'a [gap] c d'),
      text('Q', 'Q', 'a [gap] d'),
    ]);
    // P has lost b and has c: it is there. Q has lost both: it is not.
    expect(summary(c)).toEqual(['b c edP : om. A']);
    // Where another witness reads the words otherwise, a witness that has lost some of them is not there.
    const other = collate(text('E', 'ed', 'a b c d'), [
      text('A', 'A', 'a d'),
      text('B', 'B', 'a c b d'),
      text('P', 'P', 'a [gap] c d'),
    ]);
    expect(summary(other)).toEqual(['b c ed : om. A : c b B']);
  });
});

describe('a stretch of several segments', () => {
  it('aligns a text with the base where it has text, and leaves it out where it has none', () => {
    const base = text('E', 'ed', 'a b c d e');
    // W has no text for the base's units 2 to 4 (a segment it has lost); it has `a x` for the rest.
    const w = { ...text('W', 'W', 'a x'), present: true, notThere: [{ from: 2, to: 5 }] };
    const c = collate(base, [w, text('A', 'A', 'a b c y e')]);
    expect(summary(c)).toEqual(['b edA : x W', 'd ed : y A']);
    const without = collate(base, [{ ...text('W', 'W', 'a b'), notThere: [{ from: 0, to: 5 }] }]);
    expect(without.absent).toEqual(['W']);
  });

  it('marks the place over the words of whole segments that a witness is without as wanting', () => {
    const base = text('E', 'ed', 'a b c d e');
    const c = collate(base, [text('A', 'A', 'a b e'), text('B', 'B', 'c d e')], {
      segmentStarts: [0, 2, 4],
    });
    expect(summary(c)).toEqual(['a b edA : om. B', 'c d edB : om. A']);
    expect(c.sites.map((s) => s.wanting ?? false)).toEqual([true, true]);
    // The same words without the segments: only the place over the whole stretch would be.
    const one = collate(base, [text('A', 'A', 'a b e'), text('B', 'B', 'c d e')]);
    expect(one.sites.map((s) => s.wanting ?? false)).toEqual([false, false]);
  });

  it('links a word a witness has in one spot and is without in another only within two dozen words', () => {
    const words = Array.from({ length: 30 }, (_, k) => `w${k}`);
    const near = [...words.slice(1, 20), 'w0', ...words.slice(20)];
    const far = [...words.slice(1), 'w0'];
    const linked = (list: string[], farReach?: number) =>
      collate(
        text('E', 'ed', words.join(' ')),
        [text('B', 'B', list.join(' '))],
        farReach === undefined ? {} : { farReach },
      ).sites.filter((s) => s.transposition).length;
    expect(linked(near)).toBe(2);
    expect(linked(far)).toBe(0);
    expect(linked(far, 40)).toBe(2);
  });
});

describe('a segment the base does not print', () => {
  it('stands a witness whose text runs on without it with the base, and one without it nowhere', () => {
    const runsOn = { ...text('B', 'B', ''), present: true };
    const c = collate(text('E', 'ed', ''), [
      text('A', 'A', 'μῆνιν ἄειδε'),
      runsOn,
      text('C', 'C', ''),
      text('P', 'P', '[gap]'),
      text('D', 'D', 'μῆνιν ἄειδε'),
    ]);
    expect(c.absent).toEqual(['C', 'P']);
    expect(summary(c)).toEqual(['om. edB : μῆνιν ἄειδε AD']);
    const site = c.sites[0]!;
    expect([site.baseFrom, site.baseTo, site.wanting]).toEqual([0, 0, undefined]);
    expect(witnessesAt(site, 'E')).toEqual(['B', 'A', 'D']);
    expect(additionIn(site, 'E', false)).toEqual(['A', 'D']);
  });

  it('keeps a witness without words nowhere where no witness has words either', () => {
    const runsOn = { ...text('B', 'B', ''), present: true };
    const c = collate(text('E', 'ed', ''), [runsOn, text('P', 'P', '[gap]')]);
    expect(c.sites).toEqual([]);
    expect(c.absent).toEqual(['P']);
  });

  it('keeps a witness whose text runs on out of a segment the base marks as lost', () => {
    const runsOn = { ...text('B', 'B', ''), present: true };
    const c = collate(text('E', 'ed', '[gap]'), [text('A', 'A', 'a b'), runsOn]);
    expect(c.sites.flatMap((s) => s.readings.flatMap((r) => r.textIds))).not.toContain('B');
  });
});

describe('addition', () => {
  it('names the witnesses with words where the base has none', () => {
    const c = collate(text('E', 'ed', 'a b'), [
      text('A', 'A', 'a x b'),
      text('B', 'B', 'a b'),
      text('C', 'C', 'a y b'),
    ]);
    expect(additionIn(c.sites[0]!, 'E', false)).toEqual(['A', 'C']);
    expect(additionIn(c.sites[0]!, 'E', true)).toEqual(['A', 'C']);
  });

  it('names the witnesses that have words the edition prints as deleted, and none otherwise', () => {
    const c = collate(text('E', 'ed', 'a b c'), [text('A', 'A', 'a c'), text('B', 'B', 'a b c')]);
    expect(additionIn(c.sites[0]!, 'E', true)).toEqual(['B']);
    expect(additionIn(c.sites[0]!, 'E', false)).toEqual([]);
  });

  it('leaves out a witness that has a word of the segment in another place of it, where it has it', () => {
    const words = 'a b c d e f g h i j';
    const c = collate(text('E', 'ed', words), [
      text('A', 'A', words),
      text('B', 'B', 'b c d e f g h i j a'),
      text('C', 'C', 'b c d e f g h i x j a'),
    ]);
    const point = c.sites.find((s) => s.baseFrom === 10)!;
    const first = c.sites.find((s) => s.baseFrom === 0)!;
    expect(first.transposition?.withSite).toBe(point.index);
    expect(point.transposition?.withSite).toBe(first.index);
    expect(point.transposition?.textIds).toEqual(['B', 'C']);
    // B and C have the edition's word at the end of the segment: they have added nothing there.
    expect(additionIn(point, 'E', false)).toEqual([]);
    // C also adds a word of its own, at a point that no other site names.
    const own = c.sites.find((s) => s.baseFrom === 9 && s.baseTo === 9)!;
    expect(own.transposition).toBeUndefined();
    expect(additionIn(own, 'E', false)).toEqual(['C']);
  });

  it('keeps a witness that adds words at a point where another has a word of its own', () => {
    const point = {
      index: 1,
      baseFrom: 3,
      baseTo: 3,
      transposition: { withSite: 0, textIds: ['B'] },
      readings: [
        { text: '', omission: true, base: true, textIds: ['E', 'A'] },
        { text: 'a', omission: false, base: false, textIds: ['B', 'D'] },
      ],
    };
    expect(additionIn(point as never, 'E', false)).toEqual(['D']);
  });
});
