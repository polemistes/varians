/**
 * The built lexicon as one file, so that it is built once and imported
 * everywhere: gzip-compressed JSON lines, a header first (the format, the
 * dictionaries with their sources and licences, when it was made, and the
 * counts), then one line per entry and per word key. The import reads the
 * whole file before it writes anything, and refuses a file whose counts do
 * not match its header, so a truncated download changes nothing.
 */
import { greekForms, lexiconEntries, lexicons, type Database } from '@varians/db';
import { asc } from 'drizzle-orm';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { EntryRow, LexiconData } from './build.ts';
import type { Dictionary } from './sources.ts';

export const LEXICON_FORMAT = 'varians-lexicon';
export const LEXICON_FORMAT_VERSION = 1;

export interface LexiconFileHeader {
  format: typeof LEXICON_FORMAT;
  version: typeof LEXICON_FORMAT_VERSION;
  /** When the file was made, ISO 8601. */
  made: string;
  dictionaries: Dictionary[];
  counts: { entries: number; forms: number };
}

export class LexiconFileError extends Error {}

/** What the export reads: the database, or a transaction of it. */
export type Reader = Pick<Database, 'select'>;

type EntryLine = ['e', string, string, number, string, string, string];
type FormLine = ['f', string, string];

/** Writes the lexicon in the database to the file (beside it as .part first), and returns the header written. */
export async function exportLexicon(db: Reader, file: string): Promise<LexiconFileHeader> {
  const dictionaries = (await db.select().from(lexicons).orderBy(asc(lexicons.position))).map(
    (d): Dictionary => ({
      id: d.id as Dictionary['id'],
      title: d.title,
      source: d.source,
      licence: d.licence,
    }),
  );
  const entries = await db.select().from(lexiconEntries).orderBy(asc(lexiconEntries.id));
  const forms = await db.select().from(greekForms).orderBy(asc(greekForms.formKey));
  const header: LexiconFileHeader = {
    format: LEXICON_FORMAT,
    version: LEXICON_FORMAT_VERSION,
    made: new Date().toISOString(),
    dictionaries,
    counts: { entries: entries.length, forms: forms.length },
  };
  const lines = (function* () {
    yield `${JSON.stringify(header)}\n`;
    for (const e of entries)
      yield `${JSON.stringify(['e', e.lexiconId, e.headword, e.homograph, e.lemmaKey, e.looseKey, e.html] satisfies EntryLine)}\n`;
    for (const f of forms)
      yield `${JSON.stringify(['f', f.formKey, f.analyses] satisfies FormLine)}\n`;
  })();
  const part = `${file}.part`;
  try {
    await pipeline(Readable.from(lines), createGzip({ level: 9 }), createWriteStream(part));
    await rename(part, file);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
  return header;
}

function headerOf(line: string | undefined): LexiconFileHeader {
  let parsed: unknown;
  try {
    parsed = line === undefined ? undefined : JSON.parse(line);
  } catch {
    parsed = undefined;
  }
  const h = parsed as Partial<LexiconFileHeader> | undefined;
  if (!h || typeof h !== 'object' || h.format !== LEXICON_FORMAT)
    throw new LexiconFileError('This is not a lexicon exported by Varians.');
  if (h.version !== LEXICON_FORMAT_VERSION)
    throw new LexiconFileError(
      `The lexicon file is of version ${String(h.version)}; this Varians reads version ${LEXICON_FORMAT_VERSION}.`,
    );
  if (
    !Array.isArray(h.dictionaries) ||
    !h.counts ||
    typeof h.counts.entries !== 'number' ||
    typeof h.counts.forms !== 'number' ||
    typeof h.made !== 'string'
  ) {
    throw new LexiconFileError('The lexicon file has no complete header.');
  }
  for (const d of h.dictionaries) {
    if (
      typeof d.id !== 'string' ||
      typeof d.title !== 'string' ||
      typeof d.source !== 'string' ||
      typeof d.licence !== 'string'
    ) {
      throw new LexiconFileError('The lexicon file names a dictionary incompletely.');
    }
  }
  return h as LexiconFileHeader;
}

/** Reads an exported lexicon whole, checking it against its header. */
export async function readLexiconFile(
  file: string,
): Promise<{ header: LexiconFileHeader; data: LexiconData }> {
  const input = readline.createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let header: LexiconFileHeader | undefined;
  const entries: EntryRow[] = [];
  const forms: [string, string][] = [];
  try {
    for await (const line of input) {
      if (!header) {
        header = headerOf(line);
        continue;
      }
      if (line === '') continue;
      const row = JSON.parse(line) as EntryLine | FormLine;
      if (row[0] === 'e')
        entries.push({
          lexiconId: row[1],
          headword: row[2],
          homograph: row[3],
          lemmaKey: row[4],
          looseKey: row[5],
          html: row[6],
        });
      else if (row[0] === 'f') forms.push([row[1], row[2]]);
      else throw new LexiconFileError('The lexicon file has a line of an unknown kind.');
    }
  } catch (error) {
    if (error instanceof LexiconFileError) throw error;
    throw new LexiconFileError(
      `The lexicon file cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!header) throw new LexiconFileError('The lexicon file is empty.');
  if (entries.length !== header.counts.entries || forms.length !== header.counts.forms) {
    throw new LexiconFileError(
      `The lexicon file is incomplete: ${entries.length} of ${header.counts.entries} entries and ${forms.length} of ${header.counts.forms} word keys.`,
    );
  }
  const ids = new Set(header.dictionaries.map((d) => d.id));
  if (entries.some((e) => !ids.has(e.lexiconId as Dictionary['id'])))
    throw new LexiconFileError('The lexicon file has entries of a dictionary it does not name.');
  return { header, data: { dictionaries: header.dictionaries, entries, forms } };
}
