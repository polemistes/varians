/**
 * The fold: the comparison key collation uses, derived from a read form so
 * that spellings the editor does not count as variants compare equal.
 * Everything here removes; nothing here supplies.
 */

export interface FoldOptions {
  /** Lowercase, and treat final sigma as sigma. */
  caseFold: boolean;
  stripPunctuation: boolean;
  /** Remove accents, breathings, iota subscript, diaeresis, macrons, Hebrew points, Arabic harakat. */
  stripDiacritics: boolean;
  /** Latin: v as u, j as i. */
  latinUV: boolean;
}

export const DEFAULT_FOLD: FoldOptions = {
  caseFold: true,
  stripPunctuation: true,
  stripDiacritics: false,
  latinUV: false,
};

/** Sensible defaults by language code. */
export function defaultFold(language: string): FoldOptions {
  const base = { ...DEFAULT_FOLD };
  const lang = language.toLowerCase().split('-')[0];
  if (lang === 'la' || lang === 'lat') return { ...base, latinUV: true };
  if (lang === 'he' || lang === 'heb' || lang === 'ar' || lang === 'ara')
    return { ...base, stripDiacritics: true };
  return base;
}

/**
 * Punctuation and marks removed by the fold. Listed by character class and
 * a few explicit points: Greek ano teleia and question mark, the apostrophe
 * and koronis family, quotation marks and dashes, Arabic and Hebrew
 * punctuation, the Devanagari danda.
 */
const PUNCTUATION = /[\p{P}\p{S}··;᾽᾿ʼ’ʹ।॥،؛؟־׀׃׳״]/gu;

/** Characters that mean nothing for comparison: soft hyphen, zero-width joiners and non-joiners, byte-order marks. */
const INVISIBLE = /[­​-‍⁠﻿]/gu;

/** Combining marks; what `stripDiacritics` removes after decomposition. */
const MARKS = /\p{M}/gu;

export function fold(text: string, options: FoldOptions = DEFAULT_FOLD): string {
  let out = text.normalize('NFC').replace(INVISIBLE, '');
  if (options.stripPunctuation) out = out.replace(PUNCTUATION, '');
  if (options.stripDiacritics) out = out.normalize('NFD').replace(MARKS, '').normalize('NFC');
  if (options.caseFold) out = out.toLowerCase().replace(/ς/g, 'σ');
  if (options.latinUV) out = out.replace(/v/g, 'u').replace(/j/g, 'i');
  return out;
}

/** Whether two normalized forms differ only in what the fold removes. */
export function differOnlyInFold(a: string, b: string, options: FoldOptions): boolean {
  return a !== b && fold(a, options) === fold(b, options);
}

/** The marks of elision, in their several characters, which mean one thing. */
const ELISION_MARKS = /[\u02bc\u2019\u1fbd'\u2032]/gu;

/**
 * The key two normalized words agree by: the fold without letter case, with
 * every accent, breathing, mark and punctuation the editor typed, a grave
 * read as an acute (it only marks the word's place before another), and the
 * several characters of elision as one.
 */
export function agreementFold(text: string, options: FoldOptions = DEFAULT_FOLD): string {
  const marks = text
    .normalize('NFD')
    .replace(/\u0300/gu, '\u0301')
    .normalize('NFC')
    .replace(ELISION_MARKS, '\u2019');
  return fold(marks, { ...options, stripPunctuation: false })
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The letters an archetype would have had: capitals only, without accents,
 * breathings, diaeresis, punctuation, spaces or elision marks; an iota
 * subscript written as the iota it stands for; Latin u and v, i and j as one
 * letter each. Readings with the same letters differ only in how they are
 * read: accents, punctuation, word division.
 */
export function archetypeLetters(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\u0345/gu, 'ι')
    .replace(/\p{M}/gu, '')
    .replace(/\u02bc/gu, '')
    .replace(/[^\p{L}]/gu, '')
    .toUpperCase()
    .replace(/ς/gu, 'Σ')
    .replace(/V/gu, 'U')
    .replace(/J/gu, 'I');
}

/** Remove every combining mark: a diplomatic comparison that ignores accents and breathings entirely. */
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').normalize('NFC');
}

export function stripPunctuation(text: string): string {
  return text.normalize('NFC').replace(PUNCTUATION, '');
}

/**
 * Sentence punctuation at the edges of a phrase removed, as an apparatus
 * prints a lemma. Apostrophes and the koronis stay: an elided word keeps its
 * mark. A phrase that is only punctuation stays as it is.
 */
export function trimPunctuation(text: string): string {
  const edge = /^[,.;:!?··;…\-–—()[\]«»“”"]+|[,.;:!?··;…\-–—()[\]«»“”"]+$/gu;
  const trimmed = text.replace(edge, '').trim();
  return trimmed === '' ? text : trimmed;
}

/**
 * `trimPunctuation` for one edge of a phrase: for a word that stands at the
 * start or the end of a phrase, where the punctuation inside the phrase is
 * kept.
 */
export function trimPunctuationAt(text: string, edge: 'start' | 'end'): string {
  const marks =
    edge === 'start' ? /^[,.;:!?··;…\-–—()[\]«»“”"]+/u : /[,.;:!?··;…\-–—()[\]«»“”"]+$/u;
  const cut = text.replace(marks, '');
  const trimmed = edge === 'start' ? cut.trimStart() : cut.trimEnd();
  return trimmed === '' ? text : trimmed;
}

/** Whether a string is entirely in capital letters (and has letters at all). */
export function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return (
    letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
  );
}

/** Greek lowercase with the final sigma in place. */
export function greekLower(text: string): string {
  const lower = text.toLowerCase();
  return lower.replace(/σ(?=[^\p{L}]|$)/gu, 'ς');
}
