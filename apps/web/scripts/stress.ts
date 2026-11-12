/**
 * Measure how Varians copes with the stress edition (seed it with
 * `cli seed-stress`). It prints a table, and with --json the same as data.
 *
 *   pnpm --filter @varians/web exec tsx scripts/stress.ts --slug stress [--json FILE] [--keep-cache] [--seed N]
 *
 * Reads DATABASE_URL, as the other scripts do, and refuses varians_dev. It
 * changes nothing lasting. Two things are written, both undone:
 *   - the collation cache of the edition is emptied, so that the first view
 *     is cold, and refills as the run goes (it is derived data; --keep-cache
 *     leaves it and says so);
 *   - saves of a one-word change to two transcripts: the transcripts are put
 *     back as they were (content, version, changesets and checkpoints), and
 *     the archive queue is left with the marks those saves made.
 * Archives and packages are written to a temporary directory and removed.
 */

import {
  apparatusEntries,
  collate,
  collatePassages,
  formatApparatus,
  isToken,
  segmentIds,
  splitEntries,
  type Collation,
  type Reading,
  type Stream,
  type Token,
} from '@varians/core';
import {
  changesets,
  checkpoints,
  collationCache,
  conjectures,
  createDatabase,
  editionSigla,
  editions,
  sql,
  transcriptions,
  users,
  works,
  type Database,
} from '@varians/db';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
import type { EditionView, SegmentView } from '../src/lib/server/reader.ts';
import { loadEnv, redactUrl } from './env.ts';

// Some modules of the application ask SvelteKit for its environment ($env/dynamic/private), which only
// the SvelteKit build resolves. Here it is the process environment, and the modules are loaded after
// that is said, since imports are resolved before any code runs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '$env/dynamic/private')
      return { url: 'data:text/javascript,export const env = process.env;', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { planEntries } = await import('../src/lib/server/archive/queue.ts');
const { editionText, writeArchive, writeWorkParts } = await import(
  '../src/lib/server/archive/archive.ts'
);
const { importPackage } = await import('../src/lib/server/archive/import-package.ts');
const { buildPackage } = await import('../src/lib/server/archive/package.ts');
const { inputsFor, loadEditionContext } = await import('../src/lib/server/collation.ts');
const { collateEdition, forgetCollations } = await import('../src/lib/server/passages.ts');
const { documentAt, loadDocument, rebuildSegmentIndex, saveOps } = await import(
  '../src/lib/server/documents/service.ts'
);
const { pageViewsOf } = await import('../src/lib/server/pages.ts');
const { loadReader, readerDetail, readerSites } = await import('../src/lib/server/reader-pages.ts');
const { apparatusConventionsOf, editionOutline, editionView, refreshView } = await import(
  '../src/lib/server/reader.ts'
);
const { OPENING_SEGMENTS } = await import('../src/lib/edition/workspace.ts');
const { resolveId } = await import('../src/lib/server/resolver.ts');
const { refuseDevelopmentDatabase } = await import('../src/lib/server/seed/stress.ts');
const { makeRandom } = await import('../src/lib/server/seed/stress-text.ts');
const { loadWorkbench } = await import('../src/lib/server/workbench.ts');
const { DEFAULT_SIGLA } = await import('../src/lib/reader/marks.ts');
const { plainText, segmentItems, segmentShares } = await import('../src/lib/reader/export.ts');
const { siglaOrderOf } = await import('../src/lib/reader/sites.ts');
const { reader: r } = await import('../src/lib/strings/reader.ts');

// Reporting

interface Row {
  section: string;
  name: string;
  value: number | string;
  unit: string;
  on: string;
}

const rows: Row[] = [];
const data: Record<string, unknown> = {};

function line(row: Row): string {
  const value = typeof row.value === 'number' ? format(row.value) : row.value;
  return `  ${row.name.padEnd(62)} ${value.padStart(12)} ${row.unit.padEnd(6)} ${row.on}`;
}

function format(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

let current = '';
function section(title: string): void {
  current = title;
  console.log(`\n${title}`);
  console.log('-'.repeat(Math.min(110, title.length)));
}

function report(name: string, value: number | string, unit: string, on: string): void {
  const row: Row = { section: current, name, value, unit, on };
  rows.push(row);
  console.log(line(row));
}

function note(text: string): void {
  console.log(`  ${text}`);
  (data.notes as string[] | undefined)?.push(text);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0
    ? 0
    : s.length % 2
      ? s[(s.length - 1) / 2]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** The value below which the share p of the sorted values lie (nearest rank). */
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const mb = (bytes: number) => bytes / 1024 / 1024;
const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await work();
  return { ms: performance.now() - start, result };
}

async function medianOf(times: number, work: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < times; i++) samples.push((await timed(work)).ms);
  return median(samples);
}

// What is measured

interface Transcript {
  id: string;
  witnessId: string;
  siglum: string;
  items: number;
  tokens: number;
  bytes: number;
  stored: number;
  changesets: number;
  content: Stream;
}

interface Context {
  db: Database;
  workId: string;
  slug: string;
  editionId: string;
  editionSlug: string;
  owner: { id: string; role: 'administrator' };
  transcripts: Transcript[];
  work: string;
  seed: number;
}

/** Collation columns hold Maps, which JSON cannot carry: the editor is sent the views without them. */
function lighten(views: Record<string, SegmentView>): Record<string, SegmentView> {
  const out: Record<string, SegmentView> = {};
  for (const [id, view] of Object.entries(views))
    out[id] = { ...view, collation: { ...view.collation, columns: [] } };
  return out;
}

// 1. Sizes

async function sizes(c: Context): Promise<void> {
  section('1. Sizes');
  const total = c.transcripts.reduce((n, t) => n + t.tokens, 0);
  report('transcripts', c.transcripts.length, '', 'conspectus of the edition');
  report('words in all transcripts', total, 'words', 'tokens of each transcript');
  report(
    'bytes of all transcripts (JSON text)',
    mb(c.transcripts.reduce((n, t) => n + t.bytes, 0)),
    'MB',
    'transcriptions.content',
  );
  report(
    'bytes of all transcripts as stored (compressed)',
    mb(c.transcripts.reduce((n, t) => n + t.stored, 0)),
    'MB',
    'pg_column_size',
  );
  const longest = [...c.transcripts].sort((a, b) => b.items - a.items)[0]!;
  report(
    'longest transcript: words',
    longest.tokens,
    'words',
    `${longest.siglum}, ${longest.items} items`,
  );
  report('longest transcript: bytes', longest.bytes / 1024, 'KB', longest.siglum);
  const shortest = [...c.transcripts].sort((a, b) => a.items - b.items)[0]!;
  report('shortest transcript: words', shortest.tokens, 'words', shortest.siglum);
  const [edition] = await c.db
    .select({
      items: sql<number>`jsonb_array_length(${editions.content}->'items')::int`,
      bytes: sql<number>`octet_length(${editions.content}::text)::int`,
      stored: sql<number>`pg_column_size(${editions.content})::int`,
      version: editions.version,
      content: editions.content,
    })
    .from(editions)
    .where(eq(editions.id, c.editionId));
  report(
    'edition: words',
    edition!.content.items.filter(isToken).length,
    'words',
    `edition ${c.editionSlug}`,
  );
  report('edition: bytes (JSON text)', edition!.bytes / 1024, 'KB', 'editions.content');
  report('edition: items', edition!.items, '', 'editions.content');
  const docIds = [c.editionId, ...c.transcripts.map((t) => t.id)];
  const [all] = await c.db
    .select({
      n: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${changesets.ops}::text) + octet_length(${changesets.reverse}::text)), 0)::bigint::float8`,
    })
    .from(changesets)
    .where(inArray(changesets.documentId, docIds));
  report('changesets in all', all!.n, '', 'edition and transcripts');
  report(
    'changesets: bytes of operations and reverses',
    mb(all!.bytes),
    'MB',
    'changesets.ops + reverse',
  );
  const [cps] = await c.db
    .select({
      n: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${checkpoints.content}::text)), 0)::bigint::float8`,
    })
    .from(checkpoints)
    .where(inArray(checkpoints.documentId, docIds));
  report('checkpoints', cps!.n, '', 'full states kept every 50 versions');
  report('checkpoints: bytes', mb(cps!.bytes), 'MB', 'checkpoints.content');
  const most = [...c.transcripts].sort((a, b) => b.changesets - a.changesets)[0]!;
  report('most changesets on one transcript', most.changesets, '', most.siglum);
  report(
    'changesets on the edition',
    (
      await c.db
        .select({ n: sql<number>`count(*)::int` })
        .from(changesets)
        .where(eq(changesets.documentId, c.editionId))
    )[0]!.n,
    '',
    'edition',
  );
  data.sizes = c.transcripts.map(({ content: _content, ...t }) => t);
  console.log('\n  per transcript            items     words   JSON KB  stored KB  changesets');
  for (const t of [...c.transcripts].sort((a, b) => a.siglum.localeCompare(b.siglum)))
    console.log(
      `  ${t.siglum.padEnd(22)} ${String(t.items).padStart(8)} ${String(t.tokens).padStart(9)} ${(t.bytes / 1024).toFixed(0).padStart(9)} ${(t.stored / 1024).toFixed(0).padStart(10)} ${String(t.changesets).padStart(11)}`,
    );
}

// 2. Collation

interface Collated {
  view: EditionView;
  viewMs: number;
}

async function collation(c: Context, keepCache: boolean): Promise<Collated> {
  section('2. Collation');
  if (keepCache)
    note(
      '--keep-cache: the collation cache was not emptied, so the first view below is as warm as the cache is.',
    );
  else {
    await c.db.delete(collationCache).where(eq(collationCache.editionId, c.editionId));
    // What the process remembers of collations goes too, so that the view is cold.
    forgetCollations();
  }
  const cold = await timed(() => editionView(c.db, c.editionId, null));
  report(
    keepCache ? 'editionView, first call (cache as it was)' : 'editionView, cold (cache emptied)',
    cold.ms / 1000,
    's',
    'the whole edition, as the editor',
  );
  const warm = await timed(() => editionView(c.db, c.editionId, null));
  report(
    'editionView, warm (cache filled)',
    warm.ms / 1000,
    's',
    'the whole edition, as the editor',
  );
  const view = cold.result;
  const sites = Object.values(view.segments).flatMap((s) => s.collation.sites);
  report(
    'places of variation in all',
    sites.length,
    '',
    `${Object.keys(view.segments).length} passages of the view`,
  );
  const passages = Object.values(view.segments);
  const lengths = passages.map((p) => p.segments.filter((x) => x.printed).length);
  report(
    'passages of several segments',
    lengths.filter((n) => n > 1).length,
    '',
    `of ${passages.length}; ${lengths.reduce((a, b) => a + b, 0)} segments in all`,
  );
  report('segments in the longest passage', Math.max(...lengths), '', 'the plan of passages');
  report(
    'places across a boundary',
    passages.reduce(
      (n, p) =>
        n + p.collation.sites.filter((x) => (p.siteSegments[x.index] ?? []).length > 1).length,
      0,
    ),
    '',
    'their words in two segments or more',
  );
  report('  textual', sites.filter((s) => s.kind === 'textual' && !s.wanting).length, '', 'sites');
  report(
    '  interpretative',
    sites.filter((s) => s.kind === 'interpretative' && !s.wanting).length,
    '',
    'sites',
  );
  report(
    '  wanting (a witness lacks the segment)',
    sites.filter((s) => s.wanting).length,
    '',
    'sites',
  );

  // The core's collate on each segment's inputs by itself.
  const context = await loadEditionContext(c.db, c.editionId);
  const order = segmentIds(context.edition.content);
  const gather = await timed(async () =>
    order.map((id) => ({ id, inputs: inputsFor(context, id) })),
  );
  report(
    'inputs of all segments gathered (inputsFor)',
    gather.ms / 1000,
    's',
    `${order.length} segments, ${context.sigla.length} sigla`,
  );
  const times: { id: string; ms: number; texts: number; units: number }[] = [];
  for (const { id, inputs } of gather.result) {
    const start = performance.now();
    collate(inputs.base, inputs.witnesses);
    times.push({
      id,
      ms: performance.now() - start,
      texts: inputs.witnesses.length,
      units: inputs.witnesses.reduce((n, w) => n + w.units.length, 0),
    });
  }
  const ms = times.map((t) => t.ms);
  const slowest = [...times].sort((a, b) => b.ms - a.ms)[0]!;
  report(
    'collate of one segment: median',
    median(ms),
    'ms',
    `core collate, ${times.length} segments`,
  );
  report('collate of one segment: 95th percentile', percentile(ms, 0.95), 'ms', 'core collate');
  report(
    'collate of one segment: slowest',
    slowest.ms,
    'ms',
    `segment ${view.labelOf[slowest.id] ?? slowest.id} (${slowest.texts} texts, ${slowest.units} words)`,
  );
  report(
    'collate of all segments, summed',
    ms.reduce((a, b) => a + b, 0) / 1000,
    's',
    'core collate',
  );
  // The whole of it in passages, as the core does it in one go: alone, planned, in passages, linked.
  const streams = context.sigla
    .filter((x) => x.transcriptionId && context.transcriptions.has(x.transcriptionId))
    .map((x) => ({
      id: x.transcriptionId!,
      siglum: x.siglum,
      stream: context.transcriptions.get(x.transcriptionId!)!.content,
    }));
  const whole = await timed(async () =>
    collatePassages(
      { id: context.edition.id, siglum: 'ed.', stream: context.edition.content },
      streams,
      context.segmentKeys ? { segmentKeys: context.segmentKeys } : {},
    ),
  );
  report(
    'collatePassages of the whole text (core, corrected states only)',
    whole.ms / 1000,
    's',
    `${whole.result.passages.length} passages`,
  );
  data.collate = {
    median: median(ms),
    p95: percentile(ms, 0.95),
    slowest: { segment: view.labelOf[slowest.id], ms: slowest.ms },
  };
  return { view, viewMs: cold.ms };
}

// 3. What the editor and the reader are sent

async function sent(c: Context, view: EditionView): Promise<void> {
  section('3. What the editor and the reader are sent');
  report(
    'editor, GET /api/editions/[id]/view (JSON)',
    mb(bytesOf({ ...view, segments: lighten(view.segments) })),
    'MB',
    'the whole view, collation columns left out',
  );
  // The edit page opens on its first segments; the outline of the whole text is asked for once it is open.
  await c.db.delete(collationCache).where(eq(collationCache.editionId, c.editionId));
  // What the process remembers of collations goes too, so that the view is cold.
  forgetCollations();
  const openingCold = await timed(() =>
    editionView(c.db, c.editionId, null, { first: OPENING_SEGMENTS, lines: false }),
  );
  report(
    'editor, edit page load, cold cache: time',
    openingCold.ms / 1000,
    's',
    `the first ${OPENING_SEGMENTS} segments, collation cache emptied`,
  );
  // The reader does not wait for the whole text to be collated: it takes what the cache has and a budget more, and the rest comes as asked.
  const readerCold = await timed(() => loadReader(c.db, c.owner, c.editionSlug, { draft: true }));
  report(
    'reader, the draft: load time, cold cache',
    readerCold.ms / 1000,
    's',
    `loadReader, cache emptied: ${readerCold.result.pending.length} segments left to ask for`,
  );
  report(
    'reader, the draft: JSON, cold cache',
    mb(bytesOf(readerCold.result)),
    'MB',
    'loadReader data',
  );
  const pendingIds = readerCold.result.pending.slice(0, 100);
  const sitesCold = await timed(() =>
    readerSites(c.db, c.owner, c.editionSlug, { draft: true }, pendingIds),
  );
  report(
    'reader, 100 of those segments asked for, cold cache: time',
    sitesCold.ms / 1000,
    's',
    'readerSites',
  );
  const outlineCold = await timed(() => editionOutline(c.db, c.editionId));
  report(
    'editor, the outline of the whole text, cold cache: time',
    outlineCold.ms / 1000,
    's',
    'editionOutline, asked once the editor is open; fills the cache',
  );
  const opening = await timed(() =>
    editionView(c.db, c.editionId, null, { first: OPENING_SEGMENTS, lines: false }),
  );
  const openingMs = await medianOf(5, () =>
    editionView(c.db, c.editionId, null, { first: OPENING_SEGMENTS, lines: false }),
  );
  report(
    'editor, edit page load: time',
    openingMs,
    'ms',
    `the view of the first ${OPENING_SEGMENTS} segments, warm cache, median of 5`,
  );
  report(
    'editor, edit page load: the view (JSON)',
    mb(bytesOf({ ...opening.result, segments: lighten(opening.result.segments) })),
    'MB',
    'what the page is sent: the text, its first segments and what goes with them',
  );
  const outlineMs = await medianOf(3, () => editionOutline(c.db, c.editionId));
  const outline = await editionOutline(c.db, c.editionId);
  report(
    'editor, the outline of the whole text: time',
    outlineMs,
    'ms',
    'editionOutline, warm cache, median of 3',
  );
  report(
    'editor, the outline of the whole text: JSON',
    mb(bytesOf(outline)),
    'MB',
    `${Object.values(outline.outline).reduce((n, o) => n + o.sites.length, 0)} places`,
  );
  const parts: Record<string, number> = {};
  for (const v of Object.values(view.segments))
    for (const [k, x] of Object.entries(lighten({ a: v }).a!))
      parts[k] = (parts[k] ?? 0) + bytesOf(x);
  parts.content = bytesOf(view.content);
  parts.lines = bytesOf(view.lines);
  const biggest = Object.entries(parts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  report(
    '  largest parts of it',
    biggest.map(([k, n]) => `${k} ${mb(n).toFixed(1)}`).join(', '),
    'MB',
    'per segment views summed',
  );
  const order = segmentIds(view.content);
  const window = order.slice(Math.floor(order.length / 2), Math.floor(order.length / 2) + 17);
  const stretch = await timed(() => refreshView(c.db, c.editionId, window));
  const stretchMs = await medianOf(5, () => refreshView(c.db, c.editionId, window));
  report(
    'editor, a stretch of 17 segments (refreshView): time',
    stretchMs,
    'ms',
    'what the editor asks after a change, median of 5',
  );
  report(
    'editor, a stretch of 17 segments: JSON',
    bytesOf({ segments: lighten(stretch.result.segments), order: stretch.result.order }) / 1024,
    'KB',
    'refreshView',
  );
  const reader = await timed(() => loadReader(c.db, c.owner, c.editionSlug, { draft: true }));
  report(
    'reader, the draft: load time',
    reader.ms / 1000,
    's',
    'loadReader: the whole text, the places without the words of each text',
  );
  report('reader, the draft: JSON', mb(bytesOf(reader.result)), 'MB', 'loadReader data');
  const published = await timed(() =>
    loadReader(c.db, null, c.editionSlug, {}).catch((e: unknown) => String(e)),
  );
  if (typeof published.result === 'string')
    note(`reader, published version: not loaded (${published.result.slice(0, 60)})`);
  else {
    report(
      'reader, the published version: load time',
      published.ms / 1000,
      's',
      'loadReader, anonymous visitor',
    );
    report(
      'reader, the published version: JSON',
      mb(bytesOf(published.result)),
      'MB',
      'loadReader data',
    );
  }
  const detailIds = window;
  const detailMs = await medianOf(5, () =>
    readerDetail(c.db, c.owner, c.editionSlug, { draft: true }, detailIds),
  );
  const detail = await readerDetail(c.db, c.owner, c.editionSlug, { draft: true }, detailIds);
  report(
    'reader, the detail of a stretch of 17 segments (readerDetail): time',
    detailMs,
    'ms',
    'what the page asks as it opens a place, median of 5',
  );
  report(
    'reader, the detail of a stretch of 17 segments: JSON',
    bytesOf(detail) / 1024,
    'KB',
    'readerDetail',
  );
  data.sent = { stretchSegments: window.length };
}

// 4. The apparatus, as numbers

function singleWordReadings(
  base: Reading,
  others: Reading[],
): { sigla: string; position: number; word: string }[] {
  const out: { sigla: string; position: number; word: string }[] = [];
  const b = base.fold.split(' ').filter(Boolean);
  for (const reading of others) {
    if (reading.omission || reading.text === '') continue;
    const w = reading.fold.split(' ').filter(Boolean);
    if (w.length !== b.length) continue;
    const at = w.map((x, i) => (x !== b[i] ? i : -1)).filter((i) => i >= 0);
    if (at.length !== 1) continue;
    for (const siglum of reading.sigla)
      out.push({ sigla: siglum, position: at[0]!, word: reading.text.split(/\s+/u)[at[0]!] ?? '' });
  }
  return out;
}

async function apparatus(c: Context, view: EditionView): Promise<void> {
  section('4. The apparatus, as numbers');
  const segs = Object.values(view.segments);
  // A place counts for the segment its words begin in.
  const shares = [...segmentShares(segs)];
  const perLine = shares.map(([, share]) => share.sites.length);
  report('places per line: mean', mean(perLine), '', `${shares.length} lines`);
  report('places per line: 95th percentile', percentile(perLine, 0.95), '', 'lines');
  report(
    'places per line: most',
    Math.max(...perLine),
    '',
    `line ${view.labelOf[shares.find(([, share]) => share.sites.length === Math.max(...perLine))?.[0] ?? '']}`,
  );
  report('lines with no place', perLine.filter((n) => n === 0).length, '', 'lines');
  const readings = segs.flatMap((s) => s.collation.sites.map((site) => site.readings.length));
  report('readings per place: mean', mean(readings), '', 'sites, base reading included');
  report('readings per place: 95th percentile', percentile(readings, 0.95), '', 'sites');
  report('readings per place: most', Math.max(...readings), '', 'sites');

  // The printed apparatus, as the plain-text export of an edition renders it.
  const context = await loadEditionContext(c.db, c.editionId);
  const collated = await collateEdition(c.db, context);
  const conventions = apparatusConventionsOf(view.edition.conventions);
  const siglaOrder = siglaOrderOf(context.sigla);
  const lengths: number[] = [];
  const counts: number[] = [];
  const printedShares = segmentShares(
    collated.map((p) => ({
      segmentId: p.segmentId,
      label: view.labelOf[p.segmentId] ?? p.segmentId,
      segments: p.segments,
      siteSegments: {},
      collation: p.collation,
      baseUnits: p.baseUnits,
      attachments: {},
    })),
  );
  for (const [segmentId, share] of printedShares) {
    const label = view.labelOf[segmentId] ?? segmentId;
    const collation = { ...share.passage.collation, sites: share.sites };
    const { main, interpretative } = splitEntries(
      apparatusEntries(collation as Collation, label, {}, conventions, siglaOrder),
      conventions,
    );
    const printed = [
      ...formatApparatus(main, conventions),
      ...formatApparatus(interpretative, conventions).map((l) => `Interpretative: ${l}`),
    ];
    counts.push(printed.length);
    lengths.push(printed.reduce((n, l) => n + `    ${l}`.length, 0));
  }
  report(
    'printed apparatus per line, in characters: mean',
    mean(lengths),
    'chars',
    'as editionText prints it',
  );
  report(
    'printed apparatus per line, in characters: 95th percentile',
    percentile(lengths, 0.95),
    'chars',
    'lines',
  );
  report('printed apparatus per line, in characters: most', Math.max(...lengths), 'chars', 'lines');
  report('printed apparatus entries per line: mean', mean(counts), '', 'lines');
  report('printed apparatus entries per line: most', Math.max(...counts), '', 'lines');
  const text = await timed(() =>
    editionText(c.db, c.editionId, new Map(Object.entries(view.labelOf))),
  );
  report(
    'plain-text export of the edition (editionText): size',
    text.result.plain.length / 1024,
    'KB',
    'text and apparatus, no conjectures attached',
  );
  report('plain-text export of the edition: time', text.ms / 1000, 's', 'editionText');

  const wanting = segs.flatMap((s) => s.collation.sites.filter((site) => site.wanting));
  report('places that are "wanting"', wanting.length, '', 'a witness lacks a whole segment');
  report(
    'segments with a witness absent (not transcribed there)',
    segs.filter((s) => s.absent.length > 0).length,
    '',
    'segments',
  );
  const unplaced = segs.flatMap((s) => s.unplaced);
  const byKind = new Map<string, number>();
  for (const a of unplaced)
    byKind.set(
      a.kind === 'reported' ? 'reported readings' : `conjectures (${a.conjectureKind ?? '?'})`,
      (byKind.get(
        a.kind === 'reported' ? 'reported readings' : `conjectures (${a.conjectureKind ?? '?'})`,
      ) ?? 0) + 1,
    );
  const [conjectureCount] = await c.db
    .select({ n: sql<number>`count(*)::int` })
    .from(conjectures)
    .where(eq(conjectures.workId, c.workId));
  report(
    'conjectures that no longer attach to a place',
    unplaced.filter((a) => a.kind === 'conjecture').length,
    '',
    `of ${conjectureCount!.n} on the work`,
  );
  for (const [kind, n] of [...byKind].sort())
    report(`  ${kind}`, n, '', 'unplaced at their segment');
  const inEdition = new Set(segs.flatMap((p) => p.segments.map((x) => x.segmentId)));
  const elsewhere = (
    await c.db
      .select({ segmentId: conjectures.segmentId })
      .from(conjectures)
      .where(eq(conjectures.workId, c.workId))
  ).filter((x) => !inEdition.has(x.segmentId));
  report(
    'conjectures at a segment the edition does not have',
    elsewhere.length,
    '',
    'listed nowhere in the view',
  );

  // Wide places that swallow small ones.
  const swallowed: { label: string; lemma: string; readings: string[] }[] = [];
  let wide = 0;
  for (const s of segs) {
    for (const site of s.collation.sites) {
      if (site.wanting) continue;
      const base = site.readings.find((x) => x.base);
      if (!base || base.text.split(/\s+/u).filter(Boolean).length < 4) continue;
      wide++;
      const small = singleWordReadings(
        base,
        site.readings.filter((x) => !x.base),
      );
      const positions = new Set(small.map((x) => x.position));
      if (new Set(small.map((x) => x.sigla)).size >= 2 && positions.size >= 2)
        swallowed.push({
          label: s.label,
          lemma: base.text,
          readings: site.readings
            .filter((x) => !x.base)
            .map((x) => `${x.sigla.join(' ')}: ${x.text === '' ? '(none)' : x.text}`),
        });
    }
  }
  report('places whose lemma is four words or more', wide, '', 'sites');
  report(
    'wide places that swallow small ones',
    swallowed.length,
    '',
    'two or more witnesses differ in one word each, at different words',
  );
  data.wide = { wide, swallowed: swallowed.length, examples: swallowed.slice(0, 5) };
  console.log('\n  examples:');
  for (const e of swallowed.slice(0, 5)) {
    console.log(`    ${e.label}  ${e.lemma}`);
    for (const x of e.readings) console.log(`        ${x}`);
  }
  data.apparatus = {
    placesPerLine: {
      mean: mean(perLine),
      p95: percentile(perLine, 0.95),
      max: Math.max(...perLine),
    },
  };
}

// 5. The apparatus, to read

function readable(c: Context, view: EditionView): void {
  section(
    '5. The apparatus, to read: fifteen lines as a reader gets them (the plain-text download, the draft)',
  );
  const order = segmentIds(view.content);
  const shares = segmentShares(Object.values(view.segments));
  const sitesOf = (id: string) => shares.get(id)?.sites.length ?? 0;
  const passageOf = new Map(
    Object.values(view.segments).flatMap((p) => p.segments.map((x) => [x.segmentId, p] as const)),
  );
  const first = order.slice(0, 5);
  const most = [...order]
    .filter((id) => !first.includes(id))
    .sort((a, b) => sitesOf(b) - sitesOf(a) || order.indexOf(a) - order.indexOf(b))
    .slice(0, 5);
  const rng = makeRandom(c.seed);
  const rest = order.filter((id) => !first.includes(id) && !most.includes(id));
  const random = rng.shuffle(rest).slice(0, 5);
  const items = new Map(segmentItems(view.content).map((s) => [s.segmentId, s.items] as const));
  const out: { why: string; label: string; text: string }[] = [];
  const render = (id: string, why: string) => {
    const text = plainText({
      heading: [],
      content: { items: items.get(id) ?? [] },
      segments: passageOf.has(id) ? { [id]: passageOf.get(id)! } : {},
      labelOf: view.labelOf,
      conventions: view.apparatus,
      siglaOrder: siglaOrderOf(view.sigla),
      sigla: view.edition.conventions.sigla ?? DEFAULT_SIGLA,
      noteWord: r.plain.note,
      interpretativeWord: r.plain.interpretative,
    });
    out.push({ why, label: view.labelOf[id] ?? id, text });
    console.log(`\n  [${why}, ${sitesOf(id)} places]`);
    for (const l of text.trimEnd().split('\n')) console.log(`  ${l}`);
  };
  for (const id of first) render(id, 'one of the first five');
  for (const id of most) render(id, 'one of the five with most places');
  for (const id of random) render(id, `at random, seed ${c.seed}`);
  const legend = view.sigla
    .map(
      (s) =>
        `${s.siglum}${s.states.length ? ` (${s.states.map((x) => x.siglum).join(', ')})` : ''}${s.variantSiglum ? ` [${s.variantSiglum}]` : ''}`,
    )
    .join('  ');
  console.log(`\n  sigla: ${legend}`);
  data.readable = out;
}

// 6. Working in a transcript

/** Put a transcript back as it was: content, version, and the changesets and checkpoints made since. */
async function putBack(
  db: Database,
  id: string,
  snapshot: { version: number; content: Stream },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(changesets)
      .where(
        and(
          eq(changesets.documentKind, 'transcription'),
          eq(changesets.documentId, id),
          gt(changesets.version, snapshot.version),
        ),
      );
    await tx
      .delete(checkpoints)
      .where(
        and(
          eq(checkpoints.documentKind, 'transcription'),
          eq(checkpoints.documentId, id),
          gt(checkpoints.version, snapshot.version),
        ),
      );
    await tx
      .update(transcriptions)
      .set({ content: snapshot.content, version: snapshot.version })
      .where(eq(transcriptions.id, id));
  });
  await rebuildSegmentIndex(db, id, snapshot.content);
}

async function working(c: Context): Promise<void> {
  section('6. Working in a transcript');
  const byLength = [...c.transcripts].sort((a, b) => b.items - a.items);
  const longest = byLength[0]!;
  const long =
    c.transcripts
      .filter((t) => t.changesets >= 100)
      .sort((a, b) => b.changesets - a.changesets || b.items - a.items)
      .find((t) => t.id !== longest.id) ??
    [...c.transcripts].sort((a, b) => b.changesets - a.changesets)[0]!;
  const wb = await timed(() => loadWorkbench(c.db, c.owner, longest.id));
  const wbMs = await medianOf(3, () => loadWorkbench(c.db, c.owner, longest.id));
  report(
    'loadWorkbench for the longest transcript',
    wbMs,
    'ms',
    `${longest.siglum}, ${longest.tokens} words, median of 3`,
  );
  report('  what it sends (JSON)', bytesOf(wb.result) / 1024, 'KB', 'WorkbenchData');

  for (const [what, t] of [
    ['the longest transcript', longest],
    [`the transcript with ${long.changesets} changesets`, long],
  ] as const) {
    const snapshot = await loadDocument(c.db, 'transcription', t.id);
    const tokens = snapshot.content.items.filter((i): i is Token => isToken(i) && !i.marks?.length);
    const token = tokens[Math.floor(tokens.length / 2)]!;
    let version = snapshot.version;
    const samples: number[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const form = `${token.form}${'ʹ'.repeat(i + 1)}`;
        const { ms, result } = await timed(() =>
          saveOps(
            c.db,
            'transcription',
            t.id,
            c.owner.id,
            version,
            [{ t: 'set', id: token.id, fields: { form } }],
            'measured',
          ),
        );
        version = result.version;
        samples.push(ms);
      }
    } finally {
      await putBack(c.db, t.id, snapshot);
    }
    report(
      `saveOps of a one-word change on ${what}: median of 20`,
      median(samples),
      'ms',
      `${t.siglum}, ${t.tokens} words, version ${snapshot.version}`,
    );
    report('  95th percentile', percentile(samples, 0.95), 'ms', 'of 20');
    data[`save ${t.siglum}`] = samples;
  }
  note(
    'The saves were undone: the transcripts are as they were (content, version, changesets, checkpoints); the archive queue keeps the marks.',
  );

  // A past version rebuilt.
  const current = (await loadDocument(c.db, 'transcription', long.id)).version;
  const cps = await c.db
    .select({ version: checkpoints.version })
    .from(checkpoints)
    .where(and(eq(checkpoints.documentKind, 'transcription'), eq(checkpoints.documentId, long.id)));
  for (const [label, v] of [
    ['early', Math.max(1, Math.round(current * 0.1))],
    ['middle', Math.round(current * 0.5)],
    ['late', Math.round(current * 0.9)],
  ] as const) {
    const below = Math.max(0, ...cps.map((x) => x.version).filter((x) => x <= v));
    const replay = below > 0 ? v - below : current - v;
    const { ms } = await timed(() => documentAt(c.db, 'transcription', long.id, v));
    report(
      `documentAt, version ${v} of ${current} (${label})`,
      ms,
      'ms',
      `${long.siglum}; ${below > 0 ? `from checkpoint ${below}, ${replay} changesets forward` : `no checkpoint below: ${replay} reverses back from the current text`}`,
    );
  }

  // The function behind GET /api/witnesses/[id]/pages.
  const pagesMs = await medianOf(5, () => pageViewsOf(c.db, longest.witnessId));
  report(
    "pageViewsOf, the pages endpoint, for the longest transcript's witness",
    pagesMs,
    'ms',
    `${longest.siglum}, median of 5`,
  );
  const each: number[] = [];
  for (const t of c.transcripts) each.push((await timed(() => pageViewsOf(c.db, t.witnessId))).ms);
  report('pageViewsOf over every witness: median', median(each), 'ms', `${each.length} witnesses`);
  report(
    'pageViewsOf over every witness: slowest',
    Math.max(...each),
    'ms',
    `${each.length} witnesses`,
  );
  note(
    'The endpoint reads every transcript of the witness to count the words on each page (referenceCounts); here a witness has one transcript.',
  );
}

// 7. The archive

async function filesIn(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = await filesIn(p);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files++;
      bytes += (await stat(p)).size;
    }
  }
  return { files, bytes };
}

async function archive(c: Context): Promise<void> {
  section('7. The archive');
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-stress-archive-'));
  try {
    const full = await timed(() => writeArchive(c.db, c.workId, tmp));
    const size = await filesIn(full.result);
    report(
      'full write of the work (writeArchive): time',
      full.ms / 1000,
      's',
      'TEI, JSON, text, all records',
    );
    report('  files', size.files, '', 'written');
    report('  bytes', mb(size.bytes), 'MB', 'written');
    const changed = c.transcripts[Math.floor(c.transcripts.length / 2)]!;
    const alone = await timed(() =>
      writeWorkParts(c.db, c.workId, tmp, { transcriptions: new Set([changed.id]) }),
    );
    report(
      'write after one transcript changed, its own files only',
      alone.ms / 1000,
      's',
      `${changed.siglum}, writeWorkParts`,
    );
    const plan = (
      await planEntries(c.db, [{ kind: 'transcription', recordId: changed.id, at: new Date() }])
    ).get(c.workId)!;
    const queued = await timed(() => writeWorkParts(c.db, c.workId, tmp, plan));
    report(
      'write after one transcript changed, as the archive queue plans it',
      queued.ms / 1000,
      's',
      `${changed.siglum}: the transcript and ${plan.editions?.size ?? 0} edition(s) that name it`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  const built = await timed(() =>
    buildPackage(c.db, c.owner, [{ kind: 'edition', editionId: c.editionId }], {}),
  );
  try {
    const bytes = (await stat(built.result.file)).size;
    report('package of the edition built: time', built.ms / 1000, 's', 'buildPackage, BagIt zip');
    report('package of the edition: size', mb(bytes), 'MB', 'zip');
    const dry = await timed(() =>
      importPackage(c.db, built.result.file, c.owner.id, { dryRun: true }),
    );
    report(
      'that package imported as a dry run: time',
      dry.ms / 1000,
      's',
      'importPackage, rolled back',
    );
    const results = new Map<string, number>();
    for (const w of dry.result.works)
      for (const d of w.documents) results.set(d.result, (results.get(d.result) ?? 0) + 1);
    report(
      '  its report',
      dry.result.refused ?? [...results].map(([k, n]) => `${n} ${k}`).join(', '),
      '',
      `${dry.result.works.reduce((n, w) => n + w.documents.length, 0)} documents${dry.result.problems.length ? `, ${dry.result.problems.length} files that break the format` : ''}`,
    );
  } finally {
    await built.result.cleanup();
  }
}

// 8. An address

async function address(c: Context): Promise<void> {
  section('8. An address');
  const longest = [...c.transcripts].sort((a, b) => b.items - a.items)[0]!;
  const tokens = longest.content.items.filter(isToken);
  const id = tokens[Math.floor(tokens.length / 2)]!.id;
  const first = await timed(() => resolveId(c.db, id));
  const second = await medianOf(5, () => resolveId(c.db, id));
  report(
    'resolveId of a word in the middle of the longest transcript: first',
    first.ms,
    'ms',
    `${longest.siglum}: ${first.result?.kind ?? 'not found'}`,
  );
  report('resolveId of that word: median of 5', second, 'ms', 'resolveId');
  const miss = await medianOf(3, () => resolveId(c.db, '01ZZZZZZZZZZZZZZZZZZZZZZZZ'));
  report(
    'resolveId of an id nothing has (every table, every text): median of 3',
    miss,
    'ms',
    'resolveId',
  );
}

// The run

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const slug = flag('slug') ?? 'stress';
  const jsonFile = flag('json');
  const seed = Number(flag('seed') ?? 1);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, pool } = createDatabase(url);
  try {
    const name = await refuseDevelopmentDatabase(db);
    console.log(
      `Varians stress measurements: work "${slug}" in ${name} (${redactUrl(url)}), ${new Date().toISOString()}`,
    );
    // Timings mean little on a machine that is busy with something else.
    const load = () =>
      os
        .loadavg()
        .map((x) => x.toFixed(1))
        .join(' ');
    console.log(`Machine: ${os.cpus().length} cores, load average at the start ${load()}`);
    data.notes = [];
    data.machine = { cores: os.cpus().length, loadAtStart: os.loadavg() };
    const [work] = await db
      .select({ id: works.id, title: works.title })
      .from(works)
      .where(eq(works.slug, slug));
    if (!work)
      throw new Error(`no work with slug ${slug}: seed it with cli seed-stress --slug ${slug}`);
    const [edition] = await db.select().from(editions).where(eq(editions.workId, work.id));
    if (!edition) throw new Error(`the work ${slug} has no edition`);
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, edition.ownerId));
    const sigla = await db
      .select({
        transcriptionId: editionSigla.transcriptionId,
        witnessId: editionSigla.witnessId,
        siglum: editionSigla.siglum,
      })
      .from(editionSigla)
      .where(eq(editionSigla.editionId, edition.id));
    const ids = sigla.map((s) => s.transcriptionId).filter((x): x is string => x !== null);
    const sizeRows = await db
      .select({
        id: transcriptions.id,
        items: sql<number>`jsonb_array_length(${transcriptions.content}->'items')::int`,
        bytes: sql<number>`octet_length(${transcriptions.content}::text)::int`,
        stored: sql<number>`pg_column_size(${transcriptions.content})::int`,
        content: transcriptions.content,
      })
      .from(transcriptions)
      .where(inArray(transcriptions.id, ids));
    const counts = await db
      .select({ id: changesets.documentId, n: sql<number>`count(*)::int` })
      .from(changesets)
      .where(inArray(changesets.documentId, ids))
      .groupBy(changesets.documentId);
    const changesetsOf = new Map(counts.map((x) => [x.id, x.n] as const));
    const transcripts: Transcript[] = sizeRows.map((row) => {
      const s = sigla.find((x) => x.transcriptionId === row.id)!;
      return {
        id: row.id,
        witnessId: s.witnessId,
        siglum: s.siglum,
        items: row.items,
        tokens: row.content.items.filter(isToken).length,
        bytes: row.bytes,
        stored: row.stored,
        changesets: changesetsOf.get(row.id) ?? 0,
        content: row.content,
      };
    });
    const c: Context = {
      db,
      workId: work.id,
      slug,
      editionId: edition.id,
      editionSlug: edition.slug,
      owner: { id: owner!.id, role: 'administrator' },
      transcripts,
      work: work.title,
      seed,
    };
    await sizes(c);
    const { view } = await collation(c, args.includes('--keep-cache'));
    await sent(c, view);
    await apparatus(c, view);
    readable(c, view);
    await working(c);
    await archive(c);
    await address(c);
    console.log(`\nLoad average at the end ${load()}`);
    (data.machine as Record<string, unknown>).loadAtEnd = os.loadavg();
    if (jsonFile) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        jsonFile,
        JSON.stringify({ database: name, slug, at: new Date().toISOString(), rows, data }, null, 2),
      );
      console.log(`wrote ${jsonFile}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
