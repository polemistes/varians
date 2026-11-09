/**
 * The analyses of the Ancient Greek Dependency Treebank: each word of its
 * texts with the lemma and the nine-position tag given by hand. Read as
 * the Anagnosis pipeline reads them (forms.py): the words themselves, not
 * the artificial nodes or insertions; an elision written with a combining
 * comma becomes the apostrophe; a homograph number is taken off the lemma.
 */
import { attributesOf } from './xml.ts';

export interface RawAnalysis {
  form: string;
  lemma: string;
  postag: string;
}

/** Whether a token is a word: not a speaker's name in braces, and with a letter in it. */
export function isWord(token: string): boolean {
  return !token.startsWith('{') && /\p{L}/u.test(token);
}

export function* treebankAnalyses(xml: string): Generator<RawAnalysis> {
  for (const m of xml.matchAll(/<word\b([^>]*)>/gu)) {
    const a = attributesOf(m[1]!);
    const form = a.form ?? '';
    const lemma = a.lemma ?? '';
    const postag = a.postag ?? '';
    if (!form || !lemma || !postag || a.artificial || a.insertion_id || !isWord(form)) continue;
    yield {
      form: form.replace(/̓/gu, 'ʼ').normalize('NFC'),
      lemma: lemma.replace(/\d+$/u, '').normalize('NFC'),
      postag,
    };
  }
}
