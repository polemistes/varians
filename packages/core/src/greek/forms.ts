/**
 * Greek words for the analyser and the dictionaries: the key forms are
 * found by (their letters alone) and the morphological tags the analyses
 * carry (the nine positions of the Ancient Greek Dependency Treebank),
 * spelt out for a reader.
 */

/** A word's letters alone: lower case, no accents, breathings, diaeresis or iota subscript, no punctuation; a final sigma written ς. */
export function looseKey(word: string): string {
  let out = '';
  for (const ch of word.normalize('NFD').toLowerCase()) {
    if ((ch >= 'α' && ch <= 'ω') || ch === 'ϝ') out += ch;
  }
  return out.endsWith('σ') ? `${out.slice(0, -1)}ς` : out;
}

/** A lemma as the dictionaries are keyed by it: NFC, trimmed, without a homograph number, in lower case. */
export function lemmaKey(lemma: string): string {
  return lemma.normalize('NFC').trim().replace(/\d+$/u, '').toLowerCase();
}

/** One analysis of a form: the form as accented, its lemma, its tag, and where it comes from. */
export interface Analysis {
  form: string;
  lemma: string;
  postag: string;
  source: 'treebank' | 'morpheus' | string;
}

/** The analyses packed as the forms table keeps them: a line each, tab-separated. */
export function parseAnalyses(packed: string): Analysis[] {
  const out: Analysis[] = [];
  for (const line of packed.split('\n')) {
    if (!line) continue;
    const [form = '', lemma = '', postag = '', source = ''] = line.split('\t');
    out.push({ form: form.normalize('NFC'), lemma: lemma.normalize('NFC'), postag, source });
  }
  return out;
}

const PARTS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  t: 'participle',
  a: 'adjective',
  d: 'adverb',
  l: 'article',
  g: 'particle',
  c: 'conjunction',
  r: 'preposition',
  p: 'pronoun',
  m: 'numeral',
  i: 'interjection',
  e: 'exclamation',
  u: 'punctuation',
  x: 'irregular',
};
const PERSONS: Record<string, string> = { '1': '1st person', '2': '2nd person', '3': '3rd person' };
const NUMBERS: Record<string, string> = { s: 'singular', p: 'plural', d: 'dual' };
const TENSES: Record<string, string> = {
  p: 'present',
  i: 'imperfect',
  r: 'perfect',
  l: 'pluperfect',
  t: 'future perfect',
  f: 'future',
  a: 'aorist',
};
const MOODS: Record<string, string> = {
  i: 'indicative',
  s: 'subjunctive',
  o: 'optative',
  n: 'infinitive',
  m: 'imperative',
  p: 'participle',
  d: 'gerund',
  g: 'gerundive',
};
const VOICES: Record<string, string> = {
  a: 'active',
  p: 'passive',
  m: 'middle',
  e: 'middle or passive',
};
const GENDERS: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter', c: 'common' };
const CASES: Record<string, string> = {
  n: 'nominative',
  g: 'genitive',
  d: 'dative',
  a: 'accusative',
  v: 'vocative',
  l: 'locative',
};
const DEGREES: Record<string, string> = { p: 'positive', c: 'comparative', s: 'superlative' };

/** A morphological tag spelt out: "verb, 3rd person singular imperfect indicative active". */
export function describePostag(postag: string): string {
  const at = (i: number) => postag[i] ?? '-';
  const part = PARTS[at(0)] ?? '';
  const features = [
    PERSONS[at(1)],
    NUMBERS[at(2)],
    TENSES[at(3)],
    MOODS[at(4)],
    VOICES[at(5)],
    GENDERS[at(6)],
    CASES[at(7)],
    DEGREES[at(8)],
  ].filter((f): f is string => !!f);
  return [part, features.join(' ')].filter((x) => x !== '').join(', ');
}

/** The part of speech of a tag, by its first position. */
export function partOfSpeech(postag: string): string | null {
  return PARTS[postag[0] ?? ''] ?? null;
}

/**
 * How a textual variant stands to the lemma: the same words in another
 * order, another form of the same word (a lemma in common), or another
 * word. Null where it cannot be told: an omission or addition, a different
 * number of words, or a word the analyser does not know.
 */
export type VariantRelation = 'order' | 'form' | 'word';

export function variantRelation(
  lemma: string,
  reading: string,
  lemmasOf: (word: string) => ReadonlySet<string> | undefined,
): VariantRelation | null {
  const words = (text: string) => text.split(/\s+/u).filter((w) => looseKey(w) !== '');
  const a = words(lemma);
  const b = words(reading);
  if (a.length === 0 || b.length === 0) return null;
  const keysA = a.map(looseKey);
  const keysB = b.map(looseKey);
  if (
    keysA.length === keysB.length &&
    keysA.join(' ') !== keysB.join(' ') &&
    [...keysA].sort().join(' ') === [...keysB].sort().join(' ')
  )
    return 'order';
  if (a.length !== b.length) return null;
  let relation: VariantRelation | null = null;
  for (let i = 0; i < a.length; i++) {
    if (keysA[i] === keysB[i]) continue;
    const x = lemmasOf(a[i]!);
    const y = lemmasOf(b[i]!);
    if (!x?.size || !y?.size) return null;
    if ([...x].some((l) => y.has(l))) relation ??= 'form';
    else relation = 'word';
  }
  return relation;
}
