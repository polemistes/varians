/**
 * The words an edition's apparatus may print for "the other witnesses" and
 * for "all the witnesses", as the settings offer them and the conventions
 * store them. Pure: the dialog and the form action share it.
 */
import type { EditionConventions } from '@varians/db';

/** The words for "the other witnesses". */
export const REST_WORDS = ['cett.', 'rell.'] as const;
/** The words for "all the witnesses". */
export const ALL_WORDS = ['codd.'] as const;

/**
 * The conventions with the two words set. An empty word is none: the
 * property is removed, so that an edition that names every witness stores
 * nothing for it.
 */
export function withWords(
  conventions: EditionConventions,
  words: { rest: string; all: string },
): EditionConventions {
  const { rest: _rest, all: _all, ...kept } = conventions;
  return {
    ...kept,
    ...(words.rest ? { rest: words.rest } : {}),
    ...(words.all ? { all: words.all } : {}),
  };
}

/**
 * The conventions without `latin`, the setting for Latin abbreviations that an
 * edition stored before November 2026 may still carry and that nothing reads:
 * the print apparatus always says its words in English. Used wherever
 * conventions are written, so that the member goes the next time they are.
 */
export function withoutLatin<T extends object>(conventions: T): Omit<T, 'latin'> {
  const { latin: _latin, ...kept } = conventions as T & { latin?: unknown };
  return kept;
}
