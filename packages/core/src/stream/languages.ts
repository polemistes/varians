/**
 * The languages of a text: every word carries its own (`Token.lang`), and a
 * text has those its words have.
 */

import type { Item, Token } from './items.ts';

/**
 * The languages the words have, those of more words first, the one met first
 * where two have as many. Words without a language are not counted.
 */
export function languagesOf(items: Iterable<Item | Token>): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== 'token' || item.lang === undefined) continue;
    counts.set(item.lang, (counts.get(item.lang) ?? 0) + 1);
  }
  // A Map keeps the order in which its keys were first set, and the sort is stable.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}
