/**
 * The languages of a text in the reader: every word carries its own
 * (docs/design.md, section 3.3).
 */

/** Whether a language tag names Greek, ancient or modern: the dictionary is offered for Greek words. */
export function isGreek(lang: string | null | undefined): boolean {
  const primary = lang?.toLowerCase().split('-')[0];
  return primary === 'grc' || primary === 'el';
}
