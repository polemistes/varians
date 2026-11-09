/**
 * Load the Greek forms and dictionaries into the database from a built
 * lexicon.sqlite (the Anagnosis pipeline makes it; see docs/lexicon.md).
 * Everything already loaded is replaced. The data is CC BY-SA: its sources
 * and licences are listed on the page Sources and licences.
 *
 * Run: pnpm --filter @varians/web lexicon:import /path/to/lexicon.sqlite
 * (DATABASE_URL from the environment or apps/web/.env).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createDatabase, greekForms, lexiconEntries, lexicons } from '@varians/db';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Give the path of a lexicon.sqlite.');
  process.exit(1);
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = new URL('../.env', import.meta.url);
  if (existsSync(env)) {
    const line = readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim();
  }
  throw new Error('DATABASE_URL is not set');
}

/** The packed fields are zlib-compressed text, or text already. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  const bytes = value as Uint8Array;
  try {
    return inflateSync(bytes).toString('utf8');
  } catch {
    return Buffer.from(bytes).toString('utf8');
  }
}

const source = new DatabaseSync(file, { readOnly: true });
const { db, pool } = createDatabase(databaseUrl());
const BATCH = 2000;

async function inBatches<T>(rows: Iterable<T>, write: (batch: T[]) => Promise<unknown>): Promise<number> {
  let batch: T[] = [];
  let n = 0;
  for (const row of rows) {
    batch.push(row);
    if (batch.length === BATCH) {
      await write(batch);
      n += batch.length;
      batch = [];
      if (n % 50000 === 0) console.log(`  ${n}`);
    }
  }
  if (batch.length) {
    await write(batch);
    n += batch.length;
  }
  return n;
}

try {
  await db.transaction(async (tx) => {
    await tx.delete(lexiconEntries);
    await tx.delete(lexicons);
    await tx.delete(greekForms);

    const dictionaries = source.prepare('SELECT id, slug, title, source, license FROM lexicons ORDER BY id').all() as {
      id: number;
      slug: string;
      title: string;
      source: string | null;
      license: string | null;
    }[];
    const slugOf = new Map(dictionaries.map((d) => [d.id, d.slug] as const));
    await tx.insert(lexicons).values(
      dictionaries.map((d, position) => ({ id: d.slug, title: d.title, source: d.source ?? '', licence: d.license ?? '', position })),
    );
    console.log(`dictionaries: ${dictionaries.map((d) => d.slug).join(', ')}`);

    const entries = source.prepare('SELECT id, lexicon_id, headword, homograph, lemma_key, loose_key, html FROM lexicon_entries ORDER BY id').iterate() as Iterable<{
      id: number;
      lexicon_id: number;
      headword: string;
      homograph: number;
      lemma_key: string;
      loose_key: string;
      html: unknown;
    }>;
    const mapped = (function* () {
      for (const e of entries) {
        yield { id: e.id, lexiconId: slugOf.get(e.lexicon_id)!, headword: e.headword, homograph: e.homograph, lemmaKey: e.lemma_key, looseKey: e.loose_key, html: text(e.html) };
      }
    })();
    console.log(`entries: ${await inBatches(mapped, (batch) => tx.insert(lexiconEntries).values(batch))}`);

    const forms = source.prepare('SELECT form_key, analyses FROM forms').iterate() as Iterable<{ form_key: string; analyses: unknown }>;
    const formRows = (function* () {
      for (const f of forms) yield { formKey: f.form_key, analyses: text(f.analyses) };
    })();
    console.log(`forms: ${await inBatches(formRows, (batch) => tx.insert(greekForms).values(batch))}`);
  });
} finally {
  source.close();
  await pool.end();
}
