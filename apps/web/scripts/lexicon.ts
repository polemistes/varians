/**
 * The Greek forms and dictionaries of the reader and the workbench, in the
 * database (docs/lexicon.md). They are built once, from their sources, and
 * imported everywhere else as one file:
 *
 *   varians lexicon                       import the lexicon published for this Varians
 *   varians lexicon import FILE|URL [--sha256 HEX]
 *                                         import a lexicon exported by `varians lexicon export`
 *   varians lexicon export FILE           write the lexicon in the database to FILE (gzip-compressed JSON lines)
 *   varians lexicon build [--sources DIR] [--morpheus FILE] [--without-morpheus]
 *                                         build it from its sources: the LSJ and the Middle Liddell of the
 *                                         Perseus Digital Library, the Ancient Greek Dependency Treebank, and
 *                                         the analyses of Morpheus. DIR is apps/web/lexicon-sources in a
 *                                         checkout, else a temporary directory; what is missing is downloaded.
 *
 * In a checkout: pnpm --filter @varians/web lexicon <the same>. Each command
 * replaces what was loaded before, in one transaction. DATABASE_URL from
 * the environment, VARIANS_ENV_FILE or apps/web/.env.
 */
import { createDatabase } from '@varians/db';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnv } from './env.ts';
import { buildLexicon, loadLexicon } from './lexicon/build.ts';
import { DownloadError, download } from './lexicon/download.ts';
import { LexiconFileError, exportLexicon, readLexiconFile } from './lexicon/export.ts';
import { MORPHEUS_FILE, PUBLISHED_LEXICON, defaultSourcesDir } from './lexicon/sources.ts';
import { XmlError } from './lexicon/xml.ts';

class Usage extends Error {}

/** The options of a command: --name value, and the flags given. */
function options(
  args: string[],
  withValue: string[],
  flags: string[] = [],
): { values: Record<string, string>; flags: Set<string>; rest: string[] } {
  const values: Record<string, string> = {};
  const given = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (flags.includes(name)) given.add(name);
    else if (withValue.includes(name)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--'))
        throw new Usage(`--${name} takes a value.`);
      values[name] = value;
    } else throw new Usage(`Unknown option ${arg}.`);
  }
  return { values, flags: given, rest };
}

const log = (line: string) => console.log(line);

function megabytes(file: string): string {
  return `${(statSync(file).size / 1e6).toFixed(1)} MB`;
}

async function withTemporaryDir<T>(use: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'varians-lexicon-'));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args.shift()! : 'default';
  if (!['default', 'import', 'export', 'build'].includes(command))
    throw new Usage(`Unknown command ${command}; the commands are import, export and build.`);
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Usage('DATABASE_URL is not set.');
  const { db, pool } = createDatabase(databaseUrl);
  const started = Date.now();
  const seconds = () => `${Math.round((Date.now() - started) / 1000)} s`;
  try {
    if (command === 'export') {
      const { rest } = options(args, []);
      const file = rest[0];
      if (!file || rest.length > 1) throw new Usage('usage: lexicon export FILE');
      const header = await exportLexicon(db, path.resolve(file));
      log(
        `Wrote ${header.counts.entries} entries and ${header.counts.forms} word keys of ${header.dictionaries.map((d) => d.id).join(', ')} to ${file} (${megabytes(file)}) in ${seconds()}.`,
      );
      return 0;
    }
    if (command === 'build') {
      const { values, flags, rest } = options(args, ['sources', 'morpheus'], ['without-morpheus']);
      if (rest.length) throw new Usage(`Unexpected argument ${rest[0]}; build takes only options.`);
      const build = async (sources: string) => {
        let morpheus: string | null = null;
        if (!flags.has('without-morpheus')) {
          morpheus = values.morpheus
            ? path.resolve(values.morpheus)
            : path.join(sources, MORPHEUS_FILE);
          if (!existsSync(morpheus)) {
            throw new Usage(
              `No Morpheus analyses at ${morpheus}. Put the file there, give --morpheus FILE, or build with --without-morpheus from the treebank's analyses alone (docs/lexicon.md).`,
            );
          }
        }
        const summary = await buildLexicon(db, { sources, morpheus, log });
        const entries = Object.entries(summary.entries)
          .map(([id, n]) => `${id} ${n}`)
          .join(', ');
        log(
          `Built and loaded ${entries} entries and ${summary.formKeys} word keys (${summary.analyses.treebank} treebank and ${summary.analyses.morpheus} Morpheus analyses) in ${seconds()}.`,
        );
      };
      const sources = values.sources ? path.resolve(values.sources) : defaultSourcesDir();
      if (sources) {
        await build(sources);
        log(`The sources are in ${sources}.`);
      } else await withTemporaryDir(build);
      return 0;
    }
    // import, or the default: the published lexicon
    const { values, rest } = options(args, ['sha256']);
    let given: string | undefined;
    let sha256: string | undefined;
    if (command === 'import') {
      given = rest[0];
      sha256 = values.sha256;
      if (!given || rest.length > 1)
        throw new Usage('usage: lexicon import FILE|URL [--sha256 HEX]');
    } else {
      if (rest.length || values.sha256)
        throw new Usage(
          'usage: lexicon [import FILE|URL [--sha256 HEX] | export FILE | build [options]]',
        );
      if (!PUBLISHED_LEXICON) {
        throw new Usage(
          'No built lexicon is published for this Varians yet. Import one with `lexicon import FILE|URL [--sha256 HEX]`, or build it from its sources with `lexicon build` (docs/lexicon.md).',
        );
      }
      given = PUBLISHED_LEXICON.url;
      sha256 = PUBLISHED_LEXICON.sha256;
    }
    const load = async (file: string) => {
      const { header, data } = await readLexiconFile(file);
      log(
        `Read ${header.counts.entries} entries and ${header.counts.forms} word keys of ${header.dictionaries.map((d) => d.id).join(', ')}, made ${header.made}.`,
      );
      log('loading the database');
      await loadLexicon(db, data);
      log(`Loaded in ${seconds()}.`);
    };
    if (/^https?:\/\//iu.test(given)) {
      await withTemporaryDir(async (dir) => {
        const file = path.join(dir, 'lexicon.jsonl.gz');
        log(`downloading ${given}`);
        await download(given!, file, { sha256 });
        await load(file);
      });
    } else {
      const file = path.resolve(given);
      if (!existsSync(file)) throw new Usage(`No file at ${file}.`);
      if (sha256) {
        const { checksumGiven, sha256OfFile } = await import('./lexicon/download.ts');
        const expected = checksumGiven(sha256);
        const actual = await sha256OfFile(file);
        if (actual !== expected)
          throw new Usage(
            `The file's SHA-256 is ${actual}, not the ${expected} given; nothing was loaded.`,
          );
      }
      await load(file);
    }
    return 0;
  } finally {
    await pool.end();
  }
}

try {
  process.exit(await main());
} catch (error) {
  if (
    error instanceof Usage ||
    error instanceof DownloadError ||
    error instanceof LexiconFileError ||
    error instanceof XmlError
  )
    console.error(error.message);
  else console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  console.error('Nothing was changed.');
  process.exit(1);
}
