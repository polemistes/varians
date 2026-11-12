/**
 * The language of words in the editors: which languages a text has, which
 * new words an edit leaves without one, and the operations that give words
 * a language. Pure.
 */

import { isToken, type Id, type Item, type Op, type Stream } from '@varians/core';

/** The languages of a text's words, in the order they first occur. */
export function languagesInOrder(items: readonly Item[]): string[] {
  const seen = new Set<string>();
  for (const item of items) if (isToken(item) && item.lang !== undefined) seen.add(item.lang);
  return [...seen];
}

/** The words operations bring in without a language. */
export function unlanguagedIn(ops: readonly Op[]): Id[] {
  const out: Id[] = [];
  for (const op of ops) {
    if (op.t !== 'insert' && op.t !== 'replace') continue;
    for (const item of op.items) if (isToken(item) && item.lang === undefined) out.push(item.id);
  }
  return out;
}

/** The same operations, with every word they bring in without a language given `lang`. */
export function withLanguage(ops: readonly Op[], lang: string): Op[] {
  return ops.map((op) =>
    op.t === 'insert' || op.t === 'replace'
      ? {
          ...op,
          items: op.items.map((item) =>
            isToken(item) && item.lang === undefined ? { ...item, lang } : item,
          ),
        }
      : op,
  );
}

/** Operations giving words a language: one `set` for each word that has another or none. */
export function languageOps(stream: Stream, ids: readonly Id[], lang: string): Op[] {
  const wanted = new Set(ids);
  const ops: Op[] = [];
  for (const item of stream.items) {
    if (!wanted.has(item.id) || !isToken(item) || item.lang === lang) continue;
    ops.push({ t: 'set', id: item.id, fields: { lang } });
  }
  return ops;
}
