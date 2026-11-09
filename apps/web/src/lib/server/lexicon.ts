/**
 * The Greek analyser and dictionaries (built by scripts/lexicon.ts):
 * the analyses of word forms, and the dictionary entries of lemmas. Both
 * are empty until the data is loaded; callers then get nothing, not an error.
 */
import { describePostag, lemmaKey, looseKey, parseAnalyses, type Analysis } from '@varians/core';
import { greekForms, lexiconEntries, lexicons, type Database } from '@varians/db';
import { asc, eq, inArray, or } from 'drizzle-orm';

export interface WordAnalysis extends Analysis {
  /** The tag spelt out. */
  description: string;
}

/** The analyses of each word given, by the word as given: treebank analyses first, each analysis once. */
export async function analyseWords(db: Database, words: string[]): Promise<Record<string, WordAnalysis[]>> {
  const keys = new Map<string, string>();
  for (const word of words) {
    const key = looseKey(word);
    if (key) keys.set(word, key);
  }
  const wanted = [...new Set(keys.values())];
  if (wanted.length === 0) return {};
  const rows = await db.select().from(greekForms).where(inArray(greekForms.formKey, wanted));
  const byKey = new Map(rows.map((r) => [r.formKey, r.analyses] as const));
  const out: Record<string, WordAnalysis[]> = {};
  for (const [word, key] of keys) {
    const packed = byKey.get(key);
    if (!packed) {
      out[word] = [];
      continue;
    }
    const seen = new Set<string>();
    const list: WordAnalysis[] = [];
    for (const a of parseAnalyses(packed)) {
      const id = `${a.form}\t${a.lemma}\t${a.postag}`;
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ ...a, description: describePostag(a.postag) });
    }
    list.sort((a, b) => Number(b.source === 'treebank') - Number(a.source === 'treebank'));
    out[word] = list;
  }
  return out;
}

export interface LexiconEntry {
  lexicon: { id: string; title: string; licence: string };
  headword: string;
  homograph: number;
  /** Safe HTML: p, b, i and span with classes only. */
  html: string;
}

/** The dictionary entries of a lemma, in the dictionaries' order: by the lemma as written (case aside), else by its letters alone. */
export async function entriesFor(db: Database, lemma: string): Promise<LexiconEntry[]> {
  const written = lemmaKey(lemma);
  if (!written) return [];
  const select = () =>
    db
      .select({ entry: lexiconEntries, lexicon: lexicons })
      .from(lexiconEntries)
      .innerJoin(lexicons, eq(lexicons.id, lexiconEntries.lexiconId));
  let rows = await select()
    .where(eq(lexiconEntries.lemmaKey, written))
    .orderBy(asc(lexicons.position), asc(lexiconEntries.homograph));
  if (rows.length === 0) {
    const key = looseKey(written);
    if (key) rows = await select().where(or(eq(lexiconEntries.looseKey, key))).orderBy(asc(lexicons.position), asc(lexiconEntries.homograph)).limit(12);
  }
  return rows.map(({ entry, lexicon }) => ({
    lexicon: { id: lexicon.id, title: lexicon.title, licence: lexicon.licence },
    headword: entry.headword,
    homograph: entry.homograph,
    html: safeEntryHtml(entry.html),
  }));
}

/** The dictionaries loaded, with their sources and licences. */
export async function loadedLexicons(db: Database): Promise<{ id: string; title: string; source: string; licence: string }[]> {
  return db.select({ id: lexicons.id, title: lexicons.title, source: lexicons.source, licence: lexicons.licence }).from(lexicons).orderBy(asc(lexicons.position));
}

/**
 * An entry's HTML made safe: everything is escaped, then exactly the
 * markup the dictionaries use is let through again (p, b, i, and span with
 * a class of plain words). Anything else stays visible as text.
 */
export function safeEntryHtml(html: string): string {
  const escaped = html.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return escaped.replace(/&lt;(\/?)(p|b|i|span)(?: class=&quot;([\w -]{0,80})&quot;)?&gt;/g, (_all, close: string, tag: string, cls?: string) =>
    close ? `</${tag}>` : cls ? `<${tag} class="${cls}">` : `<${tag}>`,
  );
}
