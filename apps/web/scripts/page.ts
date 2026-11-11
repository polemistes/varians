/**
 * Set the apparatus Varians derives beside the printed one: for every line of
 * a page that has a printed entry, or for which Varians derives one, the
 * line as a reader gets it, the printed apparatus, and Varians' apparatus in
 * the positive and in the negative form. The page is the one the description
 * file describes (seed it with `cli seed-page`).
 *
 *   pnpm --filter @varians/web exec tsx scripts/page.ts <file> [--json FILE]
 *
 * Reads DATABASE_URL, as the other scripts do, and refuses varians_dev. It
 * changes nothing.
 */

import {
  apparatusEntries,
  formatApparatus,
  segmentIds as segmentIdsOf,
  splitEntries,
  type ApparatusConventions,
} from '@varians/core';
import { createDatabase, editions, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
const { editionView } = await import('../src/lib/server/reader.ts');
const { parseDescription, planPage, readerLine } = await import('../src/lib/server/seed/page.ts');
const { refuseDevelopmentDatabase } = await import('../src/lib/server/seed/stress.ts');
const { DEFAULT_SIGLA } = await import('../src/lib/reader/marks.ts');
const { siglaOrderOf } = await import('../src/lib/reader/sites.ts');

type Form = 'positive' | 'negative';

/**
 * The apparatus of one segment as lines of text, one per entry, in the form
 * asked for, without the line's label (the label stands on its own line). The
 * one place that calls the core's apparatus renderer: change it here when the
 * renderer changes.
 */
function renderApparatus(view: EditionView, segment: SegmentView, form: Form): string[] {
  const conventions: ApparatusConventions = { ...view.apparatus, form };
  const { main, interpretative } = splitEntries(
    apparatusEntries(
      segment.collation,
      '',
      segment.attachments,
      conventions,
      siglaOrderOf(view.sigla),
    ),
    conventions,
  );
  return [
    ...formatApparatus(main, conventions),
    ...formatApparatus(interpretative, conventions).map((l) => `interpretative: ${l}`),
  ];
}

interface LineReport {
  n: string;
  /** The edition's line as a reader gets it. */
  text: string;
  /** What the print has here: the apparatus, and the note on a speaker. */
  print: string[];
  positive: string[];
  negative: string[];
  /** Where witnesses have lines in another order, as Varians states it, for the lines moved. */
  order: string[];
  /** Entries of the description marked as assumed from the apparatus's silence. */
  assumed: string[];
}

interface Unplaced {
  line: string;
  kind: 'conjecture' | 'reported';
  name: string;
  conjectureKind: string | null;
  text: string;
}

const flag = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
  if (!file) throw new Error('usage: page.ts <file> [--json FILE]');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const description = parseDescription(JSON.parse(await readFile(path.resolve(file), 'utf8')));
  const plan = planPage(description);
  const { db, pool } = createDatabase(url);
  try {
    const database = await refuseDevelopmentDatabase(db);
    const [work] = await db
      .select({ id: works.id })
      .from(works)
      .where(eq(works.slug, description.work.slug));
    if (!work)
      throw new Error(
        `no work ${description.work.slug} in ${database}: seed it first (cli seed-page)`,
      );
    const [edition] = await db
      .select({ id: editions.id, slug: editions.slug, ownerId: editions.ownerId })
      .from(editions)
      .where(eq(editions.workId, work.id))
      .orderBy(editions.createdAt);
    if (!edition) throw new Error('the work has no edition');
    const view = await editionView(db, edition.id, null);
    console.log(`${redactUrl(url)}  edition ${edition.slug}  version ${view.edition.version}`);

    // What each line has, printed and derived
    const sigla = view.edition.conventions.sigla ?? DEFAULT_SIGLA;
    const orderRows = new Map<string, string[]>();
    for (const o of view.order) {
      const label = (id: string | null) => (id === null ? 'the start' : (view.labelOf[id] ?? id));
      for (const id of o.moved)
        orderRows.set(view.labelOf[id] ?? id, [
          ...(orderRows.get(view.labelOf[id] ?? id) ?? []),
          `${o.siglum} has ${o.moved.map(label).join(', ')} after ${label(o.after)}`,
        ]);
    }
    const reports: LineReport[] = [];
    for (const segmentId of segmentIdsOf(view.content)) {
      const n = view.labelOf[segmentId] ?? segmentId;
      const segment = view.segments[segmentId];
      if (!segment) continue;
      const print: string[] = [];
      const printed = description.printed[n];
      if (printed) print.push(printed);
      for (const note of description.speakerNotes.filter((x) => x.line === n))
        if (!print.includes(note.printed)) print.push(note.printed);
      reports.push({
        n,
        text: readerLine(view.content, segmentId, sigla),
        print,
        positive: renderApparatus(view, segment, 'positive'),
        negative: renderApparatus(view, segment, 'negative'),
        order: [...new Set(orderRows.get(n) ?? [])],
        assumed: [
          ...new Set(
            description.variants
              .filter((v) => v.line === n && v.assumed)
              .flatMap((v) => v.witnesses),
          ),
        ],
      });
    }
    const shown = reports.filter(
      (r) =>
        r.print.length > 0 || r.positive.length > 0 || r.negative.length > 0 || r.order.length > 0,
    );
    const join = (entries: string[]) => (entries.length > 0 ? entries.join(' | ') : '(none)');
    for (const r of shown) {
      console.log(`\nline ${r.n}`);
      console.log(`  text:      ${r.text}`);
      console.log(`  print:     ${join(r.print)}`);
      console.log(`  varians +: ${join(r.positive)}`);
      console.log(`  varians -: ${join(r.negative)}`);
      if (r.order.length > 0) console.log(`  order:     ${r.order.join('; ')}`);
      if (r.assumed.length > 0)
        console.log(
          `  assumed:   ${r.assumed.join(', ')} given a reading the print does not state`,
        );
    }

    // What found no place
    const unplaced: Unplaced[] = Object.values(view.segments).flatMap((segment) =>
      segment.unplaced.map(
        (a): Unplaced => ({
          line: segment.label,
          kind: a.kind,
          name: a.name,
          conjectureKind: a.conjectureKind ?? null,
          text: a.text,
        }),
      ),
    );
    console.log('\nfound no place');
    if (unplaced.length === 0) console.log('  none');
    for (const u of unplaced)
      console.log(
        `  line ${u.line}: ${u.kind === 'conjecture' ? `conjecture (${u.conjectureKind ?? '?'})` : 'reported reading'} ${u.name}: ${u.text === '' ? '(empty)' : u.text}`,
      );

    // Counts
    const attachments = Object.values(view.segments).flatMap((s) =>
      Object.values(s.attachments).flat(),
    );
    const placed = (kind: 'conjecture' | 'reported') =>
      new Set(attachments.filter((a) => a.kind === kind).map((a) => a.id)).size;
    const withPrint = reports.filter((r) => r.print.length > 0);
    const withVarians = reports.filter((r) => r.positive.length > 0);
    const both = withPrint.filter((r) => r.positive.length > 0);
    const counts = {
      lines: plan.lines.length,
      linesWithPrintedEntry: withPrint.length,
      linesWithEntryDerived: withVarians.length,
      linesWithBoth: both.length,
      linesOnlyPrinted: withPrint.length - both.length,
      linesOnlyDerived: withVarians.length - both.length,
      placesOfVariation: Object.values(view.segments).reduce(
        (n, s) => n + s.collation.sites.length,
        0,
      ),
      entriesDerived: reports.reduce((n, r) => n + r.positive.length, 0),
      conjecturesRegistered: plan.conjectures.length,
      conjecturesAdopted: description.conjectures.filter((c) => c.adopted).length,
      conjecturesWithAPlace: placed('conjecture'),
      conjecturesWithNoPlace: unplaced.filter((u) => u.kind === 'conjecture').length,
      readingsReported: plan.reported.length,
      readingsReportedWithAPlace: placed('reported'),
      readingsReportedWithNoPlace: unplaced.filter((u) => u.kind === 'reported').length,
      orderStatements: view.order.length,
    };
    console.log('\ncounts');
    for (const [name, value] of Object.entries(counts))
      console.log(
        `  ${name
          .replace(/([A-Z])/gu, ' $1')
          .toLowerCase()
          .padEnd(36)} ${value}`,
      );

    const out = flag(args, 'json');
    if (out)
      await writeFile(
        path.resolve(out),
        JSON.stringify({ edition: edition.slug, lines: shown, unplaced, counts }, null, 2),
      );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
