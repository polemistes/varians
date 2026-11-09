/**
 * Search within the edition, in the browser: every line's words folded as
 * collation folds them, with accents and breathings removed as well, so that
 * "μηνιν" finds μῆνιν. A match may run across words.
 */
import { fold, type FoldOptions, type LayoutLine } from '@varians/core';

export const SEARCH_FOLD: FoldOptions = { caseFold: true, stripPunctuation: true, stripDiacritics: true, latinUV: false };

export interface SearchLine {
  line: number;
  /** The folded words of the line joined by single spaces. */
  text: string;
  /** Each word's token id and its span in `text`. */
  words: { tokenId: string; from: number; to: number }[];
}

export interface SearchHit {
  line: number;
  tokenIds: string[];
}

export function foldQuery(query: string): string {
  return fold(query, SEARCH_FOLD).replace(/\s+/gu, ' ').trim();
}

/** The folded text of every line, built once per page. */
export function searchIndex(lines: LayoutLine[]): SearchLine[] {
  return lines.map((line, index) => {
    let text = '';
    const words: SearchLine['words'] = [];
    let joined = false;
    for (const item of line.items) {
      if (item.kind !== 'token') {
        joined = false;
        continue;
      }
      const folded = fold(item.norm ?? item.form, SEARCH_FOLD).replace(/\s+/gu, ' ').trim();
      if (folded === '') {
        joined = item.joinNext === true;
        continue;
      }
      if (text !== '' && !joined) text += ' ';
      const from = text.length;
      text += folded;
      words.push({ tokenId: item.id, from, to: text.length });
      joined = item.joinNext === true;
    }
    return { line: index, text, words };
  });
}

/** Every match of a query, in the order of the text; one hit per line, with the words the matches cover. */
export function findHits(index: SearchLine[], query: string): SearchHit[] {
  const needle = foldQuery(query);
  if (needle === '') return [];
  const hits: SearchHit[] = [];
  for (const line of index) {
    if (!line.text.includes(needle)) continue;
    const tokenIds: string[] = [];
    let at = line.text.indexOf(needle);
    while (at >= 0) {
      const end = at + needle.length;
      for (const word of line.words) {
        if (word.from < end && word.to > at && !tokenIds.includes(word.tokenId)) tokenIds.push(word.tokenId);
      }
      at = line.text.indexOf(needle, at + 1);
    }
    hits.push({ line: line.line, tokenIds });
  }
  return hits;
}
