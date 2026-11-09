/**
 * The analyses Morpheus gives the word forms of the open Perseus corpus,
 * from the file the Anagnosis pipeline writes (morpheus-analyses.tsv.gz:
 * form, lemma, tag, dialects, the form with its vowel length, one analysis
 * a line, the lines of a form together). Read as that pipeline reads them
 * (forms.py): where a form has an analysis valid in Attic, Epic or Ionic,
 * or in every dialect, those valid only in other dialects are left out;
 * the macrons and breves Morpheus writes come off the form.
 */
import type { RawAnalysis } from './treebank.ts';

const MAIN_DIALECTS = new Set(['attic', 'epic', 'ionic', 'homeric']);

interface Line {
  form: string;
  lemma: string;
  postag: string;
  dialects: string[];
}

function withoutLengthMarks(s: string): string {
  return [...s.normalize('NFD')].filter((c) => c !== '̄' && c !== '̆').join('');
}

function* chosen(group: Line[]): Generator<RawAnalysis> {
  const main = group.filter(
    (line) => line.dialects.length === 0 || line.dialects.some((d) => MAIN_DIALECTS.has(d)),
  );
  for (const line of main.length ? main : group) {
    yield {
      form: withoutLengthMarks(line.form).normalize('NFC'),
      lemma: line.lemma.normalize('NFC'),
      postag: line.postag,
    };
  }
}

export function* morpheusAnalyses(lines: Iterable<string>): Generator<RawAnalysis> {
  let group: Line[] = [];
  for (const raw of lines) {
    if (raw === '') continue;
    const [form = '', lemma = '', postag = '', dialects = ''] = raw.split('\t');
    if (group.length && group[0]!.form !== form) {
      yield* chosen(group);
      group = [];
    }
    group.push({ form, lemma, postag, dialects: dialects.split(/\s+/u).filter((d) => d !== '') });
  }
  if (group.length) yield* chosen(group);
}
