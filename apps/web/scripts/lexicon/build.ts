/**
 * The build of the Greek forms and dictionaries: the sources fetched (what
 * is not in the sources directory yet), the lexica rendered entry by entry,
 * the analyses of the treebank and of Morpheus packed by word key, and all
 * of it loaded into the database in one transaction, replacing what was
 * loaded before. Nothing is written until everything has been read, so a
 * source that fails leaves the dictionaries as they were. The same loading
 * serves `varians lexicon import` (export.ts).
 */
import { greekForms, lexiconEntries, lexicons, type Database } from '@varians/db';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { download } from './download.ts';
import { morpheusAnalyses } from './morpheus.ts';
import { packForms, type PackedForms } from './pack-forms.ts';
import {
  DICTIONARIES,
  LSJ_FILES,
  MIDDLE_LIDDELL_FILE,
  TREEBANK_FILES,
  sourceFiles,
  type Dictionary,
  type SourceFile,
} from './sources.ts';
import { entriesOf, type LexiconEntryRow } from './tei.ts';
import { treebankAnalyses, type RawAnalysis } from './treebank.ts';

export type Log = (line: string) => void;

/** What writes the lexicon: the database, or a transaction of it (the tests roll one back). */
export type Writer = Pick<Database, 'transaction'>;

export interface BuildOptions {
  /** The directory of the sources; what is missing is downloaded into it. */
  sources: string;
  /** The Morpheus analyses file, or null to build with the treebank's analyses alone. */
  morpheus: string | null;
  fetch?: typeof fetch;
  log?: Log;
}

export interface BuildSummary {
  /** Entries by dictionary. */
  entries: Record<string, number>;
  formKeys: number;
  analyses: { treebank: number; morpheus: number };
}

/** An entry as the database keeps it. */
export interface EntryRow extends LexiconEntryRow {
  lexiconId: string;
}

/** A lexicon ready to be loaded: built here, or read from an exported file. */
export interface LexiconData {
  dictionaries: Dictionary[];
  entries: Iterable<EntryRow>;
  /** Word key and packed analyses. */
  forms: Iterable<[string, string]>;
}

/** Downloads the source files that are not in the directory yet. */
export async function fetchSources(
  dir: string,
  files: SourceFile[],
  options: { fetch?: typeof fetch; log?: Log } = {},
): Promise<{ found: number; downloaded: number }> {
  const log = options.log ?? (() => undefined);
  let found = 0;
  let downloaded = 0;
  for (const file of files) {
    const dest = path.join(dir, file.name);
    if (existsSync(dest)) {
      found++;
      continue;
    }
    log(`downloading ${file.url}`);
    await download(file.url, dest, { sha256: file.sha256, fetch: options.fetch });
    downloaded++;
  }
  return { found, downloaded };
}

export type Lexica = Record<Dictionary['id'], LexiconEntryRow[]>;

/** The entries of both lexica from the sources directory. */
export function readLexica(dir: string, log: Log = () => undefined): Lexica {
  const lsj: LexiconEntryRow[] = [];
  for (const name of LSJ_FILES) {
    const before = lsj.length;
    for (const row of entriesOf(readFileSync(path.join(dir, 'lsj', name), 'utf8'), 'entryFree'))
      lsj.push(row);
    log(`${name}: ${lsj.length - before} entries`);
  }
  // The mirror of the Middle Liddell writes a few dozen parentheses in their full-width form; Perseus writes them plain.
  const ml = [
    ...entriesOf(
      readFileSync(path.join(dir, MIDDLE_LIDDELL_FILE), 'utf8')
        .replaceAll('（', '(')
        .replaceAll('）', ')'),
      'entry',
    ),
  ];
  log(`${MIDDLE_LIDDELL_FILE}: ${ml.length} entries`);
  return { lsj, ml };
}

function* treebankOf(dir: string, log: Log): Generator<RawAnalysis> {
  for (const name of TREEBANK_FILES) {
    let n = 0;
    for (const a of treebankAnalyses(readFileSync(path.join(dir, 'treebanks', name), 'utf8'))) {
      n++;
      yield a;
    }
    log(`${name}: ${n} analyses`);
  }
}

function* morpheusOf(file: string | null): Generator<RawAnalysis> {
  if (!file) return;
  yield* morpheusAnalyses(gunzipSync(readFileSync(file)).toString('utf8').split('\n'));
}

/** The forms table from the treebank in the sources directory and the Morpheus file. */
export function readForms(
  dir: string,
  morpheus: string | null,
  log: Log = () => undefined,
): PackedForms {
  const packed = packForms(treebankOf(dir, log), morpheusOf(morpheus));
  log(
    `forms: ${packed.rows.size} keys, ${packed.counts.treebank} treebank and ${packed.counts.morpheus} Morpheus analyses`,
  );
  return packed;
}

async function inBatches<T>(
  rows: Iterable<T>,
  size: number,
  write: (batch: T[]) => Promise<unknown>,
): Promise<number> {
  let batch: T[] = [];
  let n = 0;
  for (const row of rows) {
    batch.push(row);
    if (batch.length === size) {
      await write(batch);
      n += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await write(batch);
    n += batch.length;
  }
  return n;
}

/** Replaces the dictionaries and forms in the database with those given, in one transaction. */
export async function loadLexicon(
  db: Writer,
  data: LexiconData,
): Promise<{ entries: number; forms: number }> {
  return db.transaction(async (tx) => {
    await tx.delete(lexiconEntries);
    await tx.delete(lexicons);
    await tx.delete(greekForms);
    await tx.insert(lexicons).values(
      data.dictionaries.map((d, position) => ({
        id: d.id,
        title: d.title,
        source: d.source,
        licence: d.licence,
        position,
      })),
    );
    let id = 0;
    const entryRows = (function* () {
      for (const e of data.entries)
        yield {
          id: ++id,
          lexiconId: e.lexiconId,
          headword: e.headword,
          homograph: e.homograph,
          lemmaKey: e.lemmaKey,
          looseKey: e.looseKey,
          html: e.html,
        };
    })();
    const entries = await inBatches(entryRows, 2000, (batch) =>
      tx.insert(lexiconEntries).values(batch),
    );
    const formRows = (function* () {
      for (const [formKey, analyses] of data.forms) yield { formKey, analyses };
    })();
    const forms = await inBatches(formRows, 2000, (batch) => tx.insert(greekForms).values(batch));
    return { entries, forms };
  });
}

/** The lexicon built from the sources, as data to load or to export. */
export function lexiconData(lexica: Lexica, forms: Map<string, string>): LexiconData {
  return {
    dictionaries: DICTIONARIES,
    entries: (function* () {
      for (const d of DICTIONARIES) for (const e of lexica[d.id]) yield { ...e, lexiconId: d.id };
    })(),
    forms: forms.entries(),
  };
}

export async function buildLexicon(db: Writer, options: BuildOptions): Promise<BuildSummary> {
  const log = options.log ?? (() => undefined);
  const fetched = await fetchSources(options.sources, sourceFiles(), { fetch: options.fetch, log });
  log(`sources: ${fetched.found} found, ${fetched.downloaded} downloaded`);
  const lexica = readLexica(options.sources, log);
  const forms = readForms(options.sources, options.morpheus, log);
  log('loading the database');
  await loadLexicon(db, lexiconData(lexica, forms.rows));
  return {
    entries: Object.fromEntries(DICTIONARIES.map((d) => [d.id, lexica[d.id].length])),
    formKeys: forms.rows.size,
    analyses: forms.counts,
  };
}
