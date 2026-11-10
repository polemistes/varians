/**
 * Keeping transcripts in the shape of their witness's pages.
 *
 * A transcript's page breaks name pages of its witness, once each, in the
 * witness's order, without labels. Whatever changes a witness's pages (a
 * removal, a reordering) or writes a transcript's whole content (an import,
 * a revert, an archive) conforms the transcripts concerned with
 * `conformPages`, saving the ops as a changeset like any other, so that the
 * history shows who changed what and why.
 */

import { applyOps, conformPages, isBreak, isToken, type Stream } from '@varians/core';
import { pages, transcriptions, type Database } from '@varians/db';
import { asc, eq } from 'drizzle-orm';
import { saveOps } from './documents/service.ts';

/** The ids of a witness's pages in order. */
export async function witnessPageOrder(db: Database, witnessId: string): Promise<string[]> {
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.witnessId, witnessId))
    .orderBy(asc(pages.position));
  return rows.map((r) => r.id);
}

/** The ids of the pages of a transcript's witness in order; empty for an unknown transcript. */
export async function transcriptionPageOrder(
  db: Database,
  transcriptionId: string,
): Promise<string[]> {
  const [row] = await db
    .select({ witnessId: transcriptions.witnessId })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  return row ? witnessPageOrder(db, row.witnessId) : [];
}

/** A stream conformed without history: for content about to be saved whole. */
export function conformed(stream: Stream, pageOrder: readonly string[]): Stream {
  const ops = conformPages(stream, pageOrder);
  return ops.length === 0 ? stream : applyOps(stream, ops).stream;
}

/** What conforming did to a stream, for the conformance run's report. */
export interface ConformanceReport {
  /** Page breaks removed because they named no page, or a page the witness lacks. */
  orphanBreaks: number;
  /** Words their text sent to Not on a page. */
  wordsUnplaced: number;
  /** Second page breaks of a page, removed; their text joined the page. */
  duplicateBreaks: number;
  /** The pages stood in another order than the witness's. */
  reordered: boolean;
  /** Page breaks that carried a label. */
  labels: number;
}

/** What `conformPages` would do to a stream, counted. */
export function describeConformance(
  stream: Stream,
  pageOrder: readonly string[],
): ConformanceReport {
  const known = new Map(pageOrder.map((id, i) => [id, i] as const));
  const seen = new Set<string>();
  const report: ConformanceReport = {
    orphanBreaks: 0,
    wordsUnplaced: 0,
    duplicateBreaks: 0,
    reordered: false,
    labels: 0,
  };
  let orphan = false;
  let last = -1;
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') {
      if (item.label !== undefined) report.labels++;
      orphan = false;
      if (!item.pageId || !known.has(item.pageId)) {
        report.orphanBreaks++;
        orphan = true;
      } else if (seen.has(item.pageId)) report.duplicateBreaks++;
      else {
        seen.add(item.pageId);
        const at = known.get(item.pageId)!;
        if (at < last) report.reordered = true;
        last = at;
      }
      continue;
    }
    if (orphan && isToken(item)) report.wordsUnplaced++;
  }
  return report;
}

/** How many words stand on a page in a stream. */
export function wordsOnPage(stream: Stream, pageId: string): number {
  let on = false;
  let n = 0;
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') on = item.pageId === pageId;
    else if (on && isToken(item)) n++;
  }
  return n;
}

export interface ConformOutcome {
  transcriptionId: string;
  name: string;
  version: number;
  report: ConformanceReport;
}

/**
 * Conform one transcript to a page order, saving the ops as one changeset
 * of `userId` (null: the system) with `message`. Locks the row first, so
 * that no save comes between the reading and the writing. Null when the
 * transcript was in shape already.
 */
export async function conformTranscription(
  db: Database,
  transcriptionId: string,
  pageOrder: readonly string[],
  userId: string | null,
  message: string,
): Promise<ConformOutcome | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        version: transcriptions.version,
        content: transcriptions.content,
        name: transcriptions.name,
      })
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId))
      .for('update');
    if (!row) return null;
    const ops = conformPages(row.content, pageOrder);
    if (ops.length === 0) return null;
    const report = describeConformance(row.content, pageOrder);
    const saved = await saveOps(
      tx,
      'transcription',
      transcriptionId,
      userId,
      row.version,
      ops,
      message,
    );
    return { transcriptionId, name: row.name, version: saved.version, report };
  });
}

/** Conform every transcript of a witness to its pages as they stand. */
export async function conformWitness(
  db: Database,
  witnessId: string,
  userId: string | null,
  message: string,
): Promise<ConformOutcome[]> {
  const order = await witnessPageOrder(db, witnessId);
  const rows = await db
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .where(eq(transcriptions.witnessId, witnessId))
    .orderBy(asc(transcriptions.id));
  const out: ConformOutcome[] = [];
  for (const row of rows) {
    const outcome = await conformTranscription(db, row.id, order, userId, message);
    if (outcome) out.push(outcome);
  }
  return out;
}

/** Conform one transcript to its witness's pages as they stand. */
export async function conformStored(
  db: Database,
  transcriptionId: string,
  userId: string | null,
  message: string,
): Promise<ConformOutcome | null> {
  return conformTranscription(
    db,
    transcriptionId,
    await transcriptionPageOrder(db, transcriptionId),
    userId,
    message,
  );
}

/** The conformance run over every transcript (B3): what it changed, transcript by transcript. */
export async function conformAll(db: Database, message: string): Promise<ConformOutcome[]> {
  const rows = await db
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .orderBy(asc(transcriptions.id));
  const out: ConformOutcome[] = [];
  for (const row of rows) {
    const outcome = await conformStored(db, row.id, null, message);
    if (outcome) out.push(outcome);
  }
  return out;
}

/** One line of the conformance run's report: the transcript and what moved. */
export function formatConformance(outcome: ConformOutcome): string {
  const r = outcome.report;
  const parts: string[] = [];
  if (r.orphanBreaks)
    parts.push(
      `${r.orphanBreaks} page break${r.orphanBreaks === 1 ? '' : 's'} naming no page of the witness removed, ${r.wordsUnplaced} word${r.wordsUnplaced === 1 ? '' : 's'} now not on a page`,
    );
  if (r.duplicateBreaks)
    parts.push(
      `${r.duplicateBreaks} second page break${r.duplicateBreaks === 1 ? '' : 's'} of a page joined to the first`,
    );
  if (r.reordered) parts.push('pages put in the witness order');
  if (r.labels)
    parts.push(`${r.labels} label${r.labels === 1 ? '' : 's'} removed from page breaks`);
  return `${outcome.name} (${outcome.transcriptionId}), version ${outcome.version}: ${parts.join('; ') || 'conformed'}`;
}
