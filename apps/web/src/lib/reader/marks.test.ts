import { describe, expect, it } from 'vitest';
import type { Item, Token } from '@varians/core';
import { DEFAULT_SIGLA, LEIDEN_SIGLA, plainLine, printLine, tokenParts, type EditionSigla } from './marks';

const t = (id: string, form: string, extra: Partial<Token> = {}): Token => ({ kind: 'token', id, form, ...extra });
const print = (items: Item[], sigla: EditionSigla = DEFAULT_SIGLA) => plainLine(printLine(items, sigla));

describe('printLine', () => {
  it('separates words by spaces, and not a word divided at a line end', () => {
    expect(print([t('a', 'μῆνιν'), t('b', 'ἄει', { joinNext: true }), t('c', 'δε'), t('d', 'θεά')])).toBe('μῆνιν ἄειδε θεά');
  });

  it('brackets a run of supplied words once, in the edition convention', () => {
    const items = [t('a', 'οὐλομένην'), t('b', 'ἣ', { marks: [{ kind: 'supplied' }] }), t('c', 'μυρί᾽', { marks: [{ kind: 'supplied' }] }), t('d', 'Ἀχαιοῖς')];
    expect(print(items)).toBe('οὐλομένην ⟨ἣ μυρί᾽⟩ Ἀχαιοῖς');
    const pieces = printLine(items, DEFAULT_SIGLA);
    expect(pieces[1]).toMatchObject({ kind: 'token', before: '⟨', after: '' });
    expect(pieces[2]).toMatchObject({ kind: 'token', before: '', after: '⟩' });
    expect(print(items, { ...DEFAULT_SIGLA, supplied: ['<', '>'] })).toBe('οὐλομένην <ἣ μυρί᾽> Ἀχαιοῖς');
  });

  it('brackets what the editor deletes, and does not strike it through', () => {
    const items = [t('a', 'καὶ', { marks: [{ kind: 'surplus' }] }), t('b', 'δῖος')];
    expect(print(items)).toBe('[καὶ] δῖος');
    const token = printLine(items)[0]!;
    expect(token.kind === 'token' && token.parts.every((p) => !p.struck)).toBe(true);
  });

  it('puts the crux before one word, and around several', () => {
    expect(print([t('a', 'ἔριδι', { marks: [{ kind: 'crux' }] }), t('b', 'ξυνέηκε')])).toBe('†ἔριδι ξυνέηκε');
    expect(print([t('a', 'ἔριδι', { marks: [{ kind: 'crux' }] }), t('b', 'ξυνέηκε', { marks: [{ kind: 'crux' }] }), t('c', 'μάχεσθαι')])).toBe(
      '†ἔριδι ξυνέηκε† μάχεσθαι',
    );
  });

  it('closes a run at an object between the words', () => {
    const items: Item[] = [
      t('a', 'α', { marks: [{ kind: 'supplied' }] }),
      { kind: 'object', id: 'l', type: 'lacuna', attrs: { extent: 'one line' } },
      t('b', 'β', { marks: [{ kind: 'supplied' }] }),
    ];
    expect(print(items)).toBe('⟨α⟩ *** ⟨β⟩');
    expect(printLine(items)[1]).toMatchObject({ kind: 'lacuna', text: '***', extent: 'one line' });
  });

  it('prints lacunae with the edition sign, gaps, paratext and blank spaces', () => {
    const items: Item[] = [
      { kind: 'object', id: 's', type: 'paratext', attrs: { type: 'speaker' }, text: 'ΧΟ.' },
      t('a', 'ἰώ'),
      { kind: 'object', id: 'l', type: 'lacuna' },
      { kind: 'object', id: 'g', type: 'gap', attrs: { quantity: 6, unit: 'character' } },
      { kind: 'object', id: 'v', type: 'space' },
      { kind: 'object', id: 'f', type: 'figure', text: 'a bird' },
    ];
    const pieces = printLine(items, { ...DEFAULT_SIGLA, lacuna: '<...>' });
    expect(pieces.map((p) => p.kind)).toEqual(['paratext', 'token', 'lacuna', 'gap', 'space']);
    expect(pieces[0]).toMatchObject({ type: 'speaker', text: 'ΧΟ.' });
    expect(pieces[2]).toMatchObject({ text: '<...>', extent: null });
    expect(pieces[3]).toMatchObject({ quantity: 6, unit: 'character' });
    expect(plainLine(pieces)).toBe('ΧΟ. ἰώ <...> […] vac.');
  });
});

describe('tokenParts', () => {
  it('dots every marked letter that is unclear', () => {
    expect(tokenParts(t('a', 'θεά', { marks: [{ kind: 'unclear' }] }))).toEqual([{ text: 'θ̣ε̣ά̣' }]);
    expect(tokenParts(t('a', 'θεά', { marks: [{ kind: 'unclear', from: 1, to: 2 }] }))).toEqual([{ text: 'θε̣ά' }]);
  });

  it('brackets supplied letters inside a word', () => {
    expect(tokenParts(t('a', 'ἄειδε', { marks: [{ kind: 'supplied', from: 3, to: 5 }] }))).toEqual([{ text: 'ἄει⟨δε⟩' }]);
    expect(tokenParts(t('a', 'ἄειδε', { marks: [{ kind: 'supplied', from: 0, to: 2 }] }), LEIDEN_SIGLA)).toEqual([{ text: '[ἄε]ιδε' }]);
  });

  it('strikes through what the scribe deleted', () => {
    expect(tokenParts(t('a', 'ἔθηκε', { marks: [{ kind: 'del', from: 0, to: 1 }] }))).toEqual([{ text: 'ἔ', struck: true }, { text: 'θηκε' }]);
  });

  it('prints the read form, or the written form when asked', () => {
    const token = t('a', 'ΜΗΝΗΝ', { norm: 'μῆνιν', marks: [{ kind: 'unclear', from: 0, to: 1 }] });
    expect(tokenParts(token)).toEqual([{ text: 'μῆνιν' }]);
    expect(tokenParts(token, DEFAULT_SIGLA, 'written')).toEqual([{ text: 'Μ̣ΗΝΗΝ' }]);
  });
});
