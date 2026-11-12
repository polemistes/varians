/**
 * The language of imported words (docs/design.md, section 3.3): a word has
 * the language its file declares, and where the file declares none, the
 * language the person importing gives. No import guesses one.
 */

import { isToken, type Stream } from '@varians/core';
import { LANGUAGE_CODE } from '$lib/registry/languages';

/** An import that would leave words without a language: the person importing must say which it is. */
export class LanguageMissing extends Error {
  constructor() {
    super('the language of the text is not given');
    this.name = 'LanguageMissing';
  }
}

/** A language tag as a request gives it, or null where it gives none or one that is no tag. */
export function languageTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.trim();
  return tag.length > 0 && tag.length <= 40 && LANGUAGE_CODE.test(tag) ? tag : null;
}

/**
 * The imported words, each with a language. `language` is the language of
 * the text as the person importing gives it (the import window shows the
 * one the file declares, which they may change): the words the file leaves
 * without one take it, and so do the words in the language the file
 * declares for the whole text (`declared`), where it is given another;
 * words the file marks as another language keep theirs. Throws
 * LanguageMissing where some word would still have none.
 */
export function withLanguage(
  stream: Stream,
  language: string | null | undefined,
  declared?: string | null,
): Stream {
  const takes = (lang: string | undefined) =>
    lang === undefined || (declared !== undefined && declared !== null && lang === declared);
  if (!language) {
    if (stream.items.some((item) => isToken(item) && item.lang === undefined))
      throw new LanguageMissing();
    return stream;
  }
  if (!stream.items.some((item) => isToken(item) && takes(item.lang) && item.lang !== language))
    return stream;
  return {
    items: stream.items.map((item) =>
      isToken(item) && takes(item.lang) ? { ...item, lang: language } : item,
    ),
  };
}
