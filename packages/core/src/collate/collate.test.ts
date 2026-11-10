import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../normalize/profile.ts';
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
function text(id: string, siglum: string, words: string): CollationText {
  const units: Unit[] = words
    .split(/\s+/u)
    .filter((w) => w.length > 0)
    .map((w) =>
      w === '[gap]'
        ? { text: '', tokenIds: [], gap: { kind: 'object', id: `g${++counter}`, type: 'gap' } }
        : { text: w, tokenIds: [`${id}-${++counter}`] },
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

const grc = defaultProfile('grc');

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

  it('compares with the work’s fold', () => {
    const c = collate(text('E', 'ed', 'σφῶε θεῶν'), [text('B', 'B', 'σφωε θεῶν')], {
      fold: grc.fold,
    });
    expect(summary(c)).toEqual(['σφῶε ed : σφωε B']);
    const lax = collate(text('E', 'ed', 'σφῶε θεῶν'), [text('B', 'B', 'σφωε θεῶν')], {
      fold: { ...grc.fold, stripDiacritics: true },
    });
    expect(lax.sites).toEqual([]);
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
});
