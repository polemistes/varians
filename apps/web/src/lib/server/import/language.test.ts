import { describe, expect, it } from 'vitest';
import type { Stream } from '@varians/core';
import { withWordLanguages } from '../archive/import.ts';
import { LanguageMissing, languageTag, withLanguage } from './language.ts';

const words = (...langs: (string | undefined)[]): Stream => ({
  items: langs.map((lang, i) => ({
    kind: 'token',
    id: `t${i}`,
    ...(lang ? { lang } : {}),
    form: 'x',
  })),
});
const langs = (s: Stream) => s.items.map((i) => (i.kind === 'token' ? i.lang : null));

describe('the language of imported words', () => {
  it('gives the words the file leaves without one the language given, and keeps the others', () => {
    expect(langs(withLanguage(words(undefined, 'la'), 'grc'))).toEqual(['grc', 'la']);
  });

  it('gives the language chosen to the words in the language the file declares for the text', () => {
    expect(langs(withLanguage(words('grc', 'la', 'grc'), 'el', 'grc'))).toEqual(['el', 'la', 'el']);
  });

  it('refuses an import that would leave a word without a language', () => {
    expect(() => withLanguage(words(undefined), null)).toThrow(LanguageMissing);
    expect(langs(withLanguage(words('la'), null))).toEqual(['la']);
  });

  it('reads a language tag from a request, and nothing that is not one', () => {
    expect(languageTag(' grc ')).toBe('grc');
    expect(languageTag('grc-x-doric')).toBe('grc-x-doric');
    expect(languageTag('')).toBeNull();
    expect(languageTag('1x')).toBeNull();
    expect(languageTag(null)).toBeNull();
  });
});

describe('the words of an archive written before every word had a language', () => {
  it('take the language of the work, and a foreign mark gives its word its language and goes', () => {
    const old: Stream = {
      items: [
        { kind: 'token', id: 'a', form: 'μῆνιν' },
        {
          kind: 'token',
          id: 'b',
          form: 'arma',
          marks: [{ kind: 'foreign', attrs: { lang: 'la' } }, { kind: 'unclear' }],
        },
        {
          kind: 'token',
          id: 'c',
          form: 'nil',
          marks: [{ kind: 'foreign', attrs: { lang: 'la' } }],
        },
        { kind: 'token', id: 'd', lang: 'cop', form: 'x' },
      ],
    };
    const read = withWordLanguages(old, 'grc');
    expect(langs(read)).toEqual(['grc', 'la', 'la', 'cop']);
    expect(read.items[1]).toMatchObject({ marks: [{ kind: 'unclear' }] });
    expect(read.items[2]).not.toHaveProperty('marks');
  });

  it('leave words without a language as they are where the work gives none', () => {
    const now = words(undefined, 'la');
    expect(withWordLanguages(now, undefined)).toBe(now);
  });
});
