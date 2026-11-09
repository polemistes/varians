/**
 * The forms table: one row per word key (the letters alone), with every
 * analysis of the forms that share it packed as lines of form, lemma, tag
 * and source, tab-separated, as @varians/core's parseAnalyses reads them.
 * Made as the Anagnosis pipeline makes it (forms.py): the treebank's
 * hand-checked analyses first, then Morpheus's, each lemma and tag once.
 */
import { lemmaKey, looseKey } from '@varians/core';
import type { RawAnalysis } from './treebank.ts';

interface Kept {
  form: string;
  lemma: string;
  lemmaKey: string;
  postag: string;
  source: 'treebank' | 'morpheus';
}

export interface PackedForms {
  /** The packed analyses by word key. */
  rows: Map<string, string>;
  /** How many analyses each source gave. */
  counts: { treebank: number; morpheus: number };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function packForms(
  treebank: Iterable<RawAnalysis>,
  morpheus: Iterable<RawAnalysis>,
): PackedForms {
  const table = new Map<string, Map<string, Kept>>();
  const add = (analyses: Iterable<RawAnalysis>, source: Kept['source']): number => {
    let n = 0;
    for (const a of analyses) {
      const key = looseKey(a.form);
      if (!key) continue;
      const lemma = lemmaKey(a.lemma);
      const id = `${lemma}\t${a.postag}\t${source}`;
      let byId = table.get(key);
      if (!byId) table.set(key, (byId = new Map()));
      // The first form and lemma seen for a lemma, tag and source are kept.
      if (!byId.has(id))
        byId.set(id, { form: a.form, lemma: a.lemma, lemmaKey: lemma, postag: a.postag, source });
      n++;
    }
    return n;
  };
  const counts = { morpheus: add(morpheus, 'morpheus'), treebank: add(treebank, 'treebank') };
  const rows = new Map<string, string>();
  for (const [key, byId] of table) {
    const sorted = [...byId.values()].sort(
      (a, b) =>
        Number(a.source !== 'treebank') - Number(b.source !== 'treebank') ||
        compare(a.lemmaKey, b.lemmaKey) ||
        compare(a.postag, b.postag),
    );
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const a of sorted) {
      const id = `${a.lemmaKey}\t${a.postag}`;
      if (seen.has(id)) continue;
      seen.add(id);
      lines.push(`${a.form}\t${a.lemma}\t${a.postag}\t${a.source}`);
    }
    rows.set(key, lines.join('\n'));
  }
  return { rows, counts };
}
