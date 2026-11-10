import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isObj, isToken, type Obj, type Token } from '../stream/items.ts';
import { toText } from '../stream/text.ts';
import { words } from '../stream/words.ts';
import { fromLeiden, toLeiden } from './leiden.ts';

function read(text: string) {
  return fromLeiden(text, { ids: sequentialIds() });
}

function tokens(text: string): Token[] {
  return read(text).stream.items.filter(isToken);
}

function objects(text: string): Obj[] {
  return read(text).stream.items.filter(isObj);
}

describe('fromLeiden', () => {
  it('marks supplied letters, whole words and parts of words', () => {
    const [kai, tou, demou] = tokens('[καὶ] το[ῦ] δήμου');
    expect(kai).toMatchObject({
      form: 'καὶ',
      marks: [{ kind: 'supplied', attrs: { reason: 'lost' } }],
    });
    expect(tou).toMatchObject({
      form: 'τοῦ',
      marks: [{ kind: 'supplied', attrs: { reason: 'lost' }, from: 2, to: 3 }],
    });
    expect(demou?.marks).toBeUndefined();
  });

  it('marks every word a bracket spans', () => {
    const [a, b, c] = tokens('[καὶ τοῦ] δήμου');
    expect(a?.marks).toEqual([{ kind: 'supplied', attrs: { reason: 'lost' } }]);
    expect(b?.marks).toEqual([{ kind: 'supplied', attrs: { reason: 'lost' } }]);
    expect(c?.marks).toBeUndefined();
  });

  it('reads the gap forms', () => {
    expect(objects('[---] [...] [ca. 5] [5] [+++] [ ]').map((o) => o.attrs)).toEqual([
      { reason: 'lost', unit: 'character', extent: 'unknown' },
      { reason: 'lost', unit: 'character', quantity: 3 },
      { reason: 'lost', unit: 'character', quantity: 5, precision: 'low' },
      { reason: 'lost', unit: 'character', quantity: 5 },
      { reason: 'lost', unit: 'character', quantity: 3 },
      { reason: 'lost', unit: 'character', extent: 'unknown' },
    ]);
  });

  it('reads standalone dots as illegible letters, also inside a word', () => {
    const { stream } = read('καὶ ... τ..ῦ . . δήμου.');
    expect(
      stream.items.map((i) =>
        isToken(i) ? i.form : isObj(i) ? `gap${i.attrs?.quantity}` : i.kind,
      ),
    ).toEqual(['καὶ', 'gap3', 'τ', 'gap2', 'ῦ', 'gap2', 'δήμου.']);
    expect((stream.items[1] as Obj).attrs).toEqual({
      reason: 'illegible',
      unit: 'character',
      quantity: 3,
    });
  });

  it('reads surplus, deletion, addition and correction', () => {
    const [surplus, del, add, corr] = tokens('{καὶ} ⟦καὶ⟧ \\καὶ/ <καὶ>');
    expect(surplus?.marks).toEqual([{ kind: 'surplus' }]);
    expect(del?.marks).toEqual([{ kind: 'del' }]);
    expect(add?.marks).toEqual([{ kind: 'add', attrs: { place: 'above' } }]);
    expect(corr?.marks).toEqual([{ kind: 'corr' }]);
    expect(tokens('[[καὶ]]')[0]?.marks).toEqual([{ kind: 'del' }]);
  });

  it('expands abbreviations', () => {
    const [imp, caes, bf] = tokens('Imp(erator) Caes(ar)i b(ene)f(iciarius)');
    expect(imp).toMatchObject({
      form: 'Imp',
      marks: [{ kind: 'abbr', attrs: { expan: 'Imperator' } }],
    });
    expect(caes).toMatchObject({
      form: 'Caesi',
      marks: [{ kind: 'abbr', attrs: { expan: 'Caesari' } }],
    });
    expect(bf).toMatchObject({
      form: 'bf',
      marks: [{ kind: 'abbr', attrs: { expan: 'beneficiarius' } }],
    });
  });

  it('reads underdots and underscores as unclear', () => {
    const [dotted, latin, underscored, accented] = tokens('α̣β̣γ ạb _δέ_ ά̣');
    expect(dotted).toMatchObject({ form: 'αβγ', marks: [{ kind: 'unclear', from: 0, to: 2 }] });
    expect(latin).toMatchObject({ form: 'ab', marks: [{ kind: 'unclear', from: 0, to: 1 }] });
    expect(underscored).toMatchObject({ form: 'δέ', marks: [{ kind: 'unclear' }] });
    expect(accented).toMatchObject({ form: 'ά', marks: [{ kind: 'unclear' }] });
  });

  it('combines marks on one word', () => {
    const [token] = tokens('[κ]α̣ὶ');
    expect(token?.form).toBe('καὶ');
    expect(token?.marks).toEqual([
      { kind: 'supplied', attrs: { reason: 'lost' }, from: 0, to: 1 },
      { kind: 'unclear', from: 1, to: 2 },
    ]);
  });

  it('reads | as a line break and || as a line break with a warning', () => {
    const { stream, warnings } = read('μῆνιν ἄειδε | θεὰ || Πηληϊάδεω\nἈχιλῆος');
    expect(toText(stream)).toBe('μῆνιν ἄειδε\nθεὰ\nΠηληϊάδεω\nἈχιλῆος');
    expect(warnings).toEqual(['"||" on line 1 read as a line break.']);
  });

  it('joins a word divided by a hyphen at a line end', () => {
    const { stream } = read('ἄνδ-|ρα μοι ἔννε-\nπε');
    expect(stream.items[0]).toMatchObject({ form: 'ἄνδ', joinNext: true });
    expect(words(stream).map((w) => w.form)).toEqual(['ἄνδρα', 'μοι', 'ἔννεπε']);
  });

  it('reads vacat as a space object', () => {
    const items = read('καὶ vac. 3 τοῦ (vacat) δήμου vac.').stream.items;
    expect(items.map((i) => (isToken(i) ? i.form : i.type))).toEqual([
      'καὶ',
      'space',
      'τοῦ',
      'space',
      'δήμου',
      'space',
    ]);
    expect((items[1] as Obj).attrs).toEqual({ unit: 'character', quantity: 3 });
    expect((items[3] as Obj).attrs).toBeUndefined();
  });

  it('keeps unbalanced brackets as text and warns', () => {
    const { stream, warnings } = read('[καὶ τοῦ\nδήμου ⟦τε');
    expect(stream.items.filter(isToken).map((t) => t.form)).toEqual([
      '[καὶ',
      'τοῦ',
      'δήμου',
      '⟦τε',
    ]);
    expect(stream.items.filter(isToken).every((t) => t.marks === undefined)).toBe(true);
    expect(warnings).toEqual([
      'Unbalanced "[" on line 1, kept as text.',
      'Unbalanced "⟦" on line 2, kept as text.',
    ]);

    const stray = read('καὶ] τοῦ');
    expect(stray.stream.items.filter(isToken).map((t) => t.form)).toEqual(['καὶ]', 'τοῦ']);
    expect(stray.warnings).toEqual(['Unbalanced "]" on line 1, kept as text.']);

    const spanning = tokens('[καὶ τοῦ\nδήμου]');
    expect(spanning.map((t) => t.marks?.[0]?.kind)).toEqual(['supplied', 'supplied', 'supplied']);
  });

  it('drops (?) with a warning and uses the expansion when nothing is abbreviated', () => {
    const { stream, warnings } = read('καὶ(?) (καὶ)');
    expect(stream.items.filter(isToken).map((t) => t.form)).toEqual(['καὶ', 'καὶ']);
    expect(warnings).toEqual([
      '"(?)" on line 1 dropped: uncertainty of a reading is not recorded.',
      '"(καὶ)" has no abbreviated letters before it; the expansion is used as the form.',
    ]);
  });
});

describe('toLeiden', () => {
  it('writes the marks back as brackets, underdots and expansions', () => {
    const text = '[καὶ] το[ῦ] ⟦δήμου⟧ \\ἄνω/ {περ} <κορ> Imp(erator) α̣β̣γ [κ]α̣ὶ';
    expect(toLeiden(read(text).stream)).toBe(text);
  });

  it('writes gaps, spaces and line ends, with the hyphen of a divided word', () => {
    expect(toLeiden(read('[---] [...] [ca. 5] [5] vac. 2 ... || τοῦ').stream)).toBe(
      '[---] [...] [ca. 5] [.....] vac. 2 ... | τοῦ',
    );
    expect(toLeiden(read('ἄνδ-|ρα μοι | θεὰ').stream)).toBe('ἄνδ-|ρα μοι | θεὰ');
  });

  it('places the expansion where the written letters stop', () => {
    const stream = {
      items: [
        {
          kind: 'token' as const,
          id: 'a',
          form: 'ΚΣ',
          marks: [{ kind: 'abbr', attrs: { expan: 'Κύριος' } }],
        },
        {
          kind: 'token' as const,
          id: 'b',
          form: 'ς',
          marks: [{ kind: 'abbr', attrs: { expan: 'ος' } }],
        },
        {
          kind: 'token' as const,
          id: 'c',
          form: 'δέ',
          marks: [{ kind: 'supplied', attrs: { reason: 'omitted' } }],
        },
      ],
    };
    expect(toLeiden(stream)).toBe('ΚΣ(Κύριος) (ο)ς <δέ>');
  });
});
