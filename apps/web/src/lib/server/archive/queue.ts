/**
 * The write-through of the archive. Triggers on every archived
 * table record in `archive_queue` which record changed (migration 0012); this
 * module turns the entries that have been quiet long enough into a plan per
 * work and rewrites those parts of the archive. Commits are not made here:
 * the files are current, the commits mark named moments, publications and
 * the nightly pass.
 */

import {
  archiveQueue,
  citations,
  conjectures,
  editionSigla,
  editions,
  notes,
  reportedReadings,
  transcriptionSegments,
  transcriptions,
  works,
  type Database,
} from '@varians/db';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { eq, inArray, lte, sql } from 'drizzle-orm';
import {
  folderName,
  withWorkLock,
  writeWorkParts,
  type ArchivePlan,
  type ArchiveWriters,
} from './archive.ts';

type QueueEntry = typeof archiveQueue.$inferSelect;

/** Take the entries whose last change is at least `delaySeconds` old off the queue. */
export async function takeQuietEntries(db: Database, delaySeconds: number): Promise<QueueEntry[]> {
  const cutoff = new Date(Date.now() - delaySeconds * 1000);
  return db.delete(archiveQueue).where(lte(archiveQueue.at, cutoff)).returning();
}

/** Put entries back, after a failed write; a newer mark of the same record wins. */
async function requeue(db: Database, entries: QueueEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insert(archiveQueue)
    .values(entries)
    .onConflictDoUpdate({
      target: [archiveQueue.kind, archiveQueue.recordId],
      set: { at: sql`greatest(${archiveQueue.at}, excluded.at)` },
    });
}

/** The works whose archive holds a transcription: those its text is assigned to, and those whose editions name it in a conspectus. */
async function worksOfTranscriptions(
  db: Database,
  ids: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (ids.length === 0) return out;
  const add = (t: string, w: string) => out.set(t, (out.get(t) ?? new Set()).add(w));
  for (const r of await db
    .selectDistinct({ t: transcriptionSegments.transcriptionId, w: transcriptionSegments.workId })
    .from(transcriptionSegments)
    .where(inArray(transcriptionSegments.transcriptionId, ids)))
    add(r.t, r.w);
  for (const r of await db
    .select({ t: editionSigla.transcriptionId, w: editions.workId })
    .from(editionSigla)
    .innerJoin(editions, eq(editions.id, editionSigla.editionId))
    .where(inArray(editionSigla.transcriptionId, ids))) {
    if (r.t) add(r.t, r.w);
  }
  return out;
}

/** Turn queue entries into what to write, per work. */
export async function planEntries(
  db: Database,
  entries: QueueEntry[],
): Promise<Map<string, ArchivePlan>> {
  const plans = new Map<string, ArchivePlan>();
  const plan = (workId: string) => {
    let p = plans.get(workId);
    if (!p) plans.set(workId, (p = {}));
    return p;
  };
  const add = (workId: string, key: 'witnesses' | 'transcriptions' | 'editions', id: string) => {
    const p = plan(workId);
    (p[key] ??= new Set()).add(id);
  };
  const ids = (kind: QueueEntry['kind']) =>
    entries.filter((e) => e.kind === kind).map((e) => e.recordId);
  const existingWorks = new Set((await db.select({ id: works.id }).from(works)).map((w) => w.id));

  for (const id of ids('work-all')) if (existingWorks.has(id)) plan(id).all = true;
  for (const id of ids('work')) if (existingWorks.has(id)) plan(id);
  for (const id of ids('work-editions')) if (existingWorks.has(id)) plan(id).editionsAll = true;

  const schemes = ids('scheme');
  if (schemes.length)
    for (const w of await db
      .select({ id: works.id })
      .from(works)
      .where(inArray(works.schemeId, schemes)))
      plan(w.id).all = true;

  // A bibliography entry is in the archive of every work that cites it.
  const items = ids('bibliography');
  if (items.length) {
    const rows = await db
      .select({
        conjecture: conjectures.workId,
        reported: reportedReadings.workId,
        edition: editions.workId,
        noteEdition: notes.editionId,
      })
      .from(citations)
      .leftJoin(conjectures, eq(conjectures.id, citations.conjectureId))
      .leftJoin(reportedReadings, eq(reportedReadings.id, citations.reportedReadingId))
      .leftJoin(editions, eq(editions.id, citations.editionId))
      .leftJoin(notes, eq(notes.id, citations.noteId))
      .where(inArray(citations.itemId, items));
    for (const r of rows) for (const w of [r.conjecture, r.reported, r.edition]) if (w) plan(w);
  }

  // A witness is in every work that has one of its transcriptions, names it in a conspectus, or reports a reading of it.
  const witnessIds = ids('witness');
  if (witnessIds.length) {
    const ofTranscriptions = await db
      .select({ id: transcriptions.id, witnessId: transcriptions.witnessId })
      .from(transcriptions)
      .where(inArray(transcriptions.witnessId, witnessIds));
    const byTranscription = await worksOfTranscriptions(
      db,
      ofTranscriptions.map((t) => t.id),
    );
    for (const t of ofTranscriptions)
      for (const w of byTranscription.get(t.id) ?? []) add(w, 'witnesses', t.witnessId);
    for (const r of await db
      .select({
        witnessId: editionSigla.witnessId,
        workId: editions.workId,
        editionId: editions.id,
      })
      .from(editionSigla)
      .innerJoin(editions, eq(editions.id, editionSigla.editionId))
      .where(inArray(editionSigla.witnessId, witnessIds))) {
      add(r.workId, 'witnesses', r.witnessId);
      // The witness's name is in the edition's TEI.
      add(r.workId, 'editions', r.editionId);
    }
    for (const r of await db
      .selectDistinct({ witnessId: reportedReadings.witnessId, workId: reportedReadings.workId })
      .from(reportedReadings)
      .where(inArray(reportedReadings.witnessId, witnessIds)))
      add(r.workId, 'witnesses', r.witnessId);
  }

  // A transcription is written in each of its works, and the editions collating it are written again: their apparatus depends on it.
  const transcriptionIds = ids('transcription');
  if (transcriptionIds.length) {
    const byTranscription = await worksOfTranscriptions(db, transcriptionIds);
    for (const [t, ws] of byTranscription) for (const w of ws) add(w, 'transcriptions', t);
    for (const r of await db
      .select({ editionId: editionSigla.editionId, workId: editions.workId })
      .from(editionSigla)
      .innerJoin(editions, eq(editions.id, editionSigla.editionId))
      .where(inArray(editionSigla.transcriptionId, transcriptionIds))) {
      add(r.workId, 'editions', r.editionId);
    }
  }

  const editionIds = ids('edition');
  if (editionIds.length)
    for (const e of await db
      .select({ id: editions.id, workId: editions.workId })
      .from(editions)
      .where(inArray(editions.id, editionIds)))
      add(e.workId, 'editions', e.id);

  return plans;
}

export interface FlushOptions {
  root: string;
  storageRoot?: string;
  /** Seconds a record must be quiet before its files are written. */
  delaySeconds: number;
  log?: (message: string) => void;
}

/**
 * Write the files of every record that has been quiet long enough. Works
 * that were never archived are left to the next commit (nightly, a named
 * moment, a publication), which writes them whole. Returns the work ids
 * written.
 */
export async function flushArchiveQueue(db: Database, options: FlushOptions): Promise<string[]> {
  const entries = await takeQuietEntries(db, options.delaySeconds);
  if (entries.length === 0) return [];
  let plans: Map<string, ArchivePlan>;
  try {
    plans = await planEntries(db, entries);
  } catch (error) {
    await requeue(db, entries);
    throw error;
  }
  const writers: ArchiveWriters = options.storageRoot ? { storageRoot: options.storageRoot } : {};
  const written: string[] = [];
  const failed: string[] = [];
  for (const [workId, plan] of plans) {
    const [work] = await db.select({ slug: works.slug }).from(works).where(eq(works.id, workId));
    if (!work || !existsSync(path.join(options.root, folderName(work.slug, workId), '.git')))
      continue;
    try {
      await withWorkLock(workId, () => writeWorkParts(db, workId, options.root, plan, writers));
      written.push(workId);
    } catch (error) {
      failed.push(workId);
      options.log?.(
        `archive: writing ${work.slug} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // A failed work is tried again whole at the next pass.
  if (failed.length)
    await requeue(
      db,
      failed.map((recordId) => ({ kind: 'work-all' as const, recordId, at: new Date() })),
    );
  return written;
}

/** Start the write-through: look at the queue every few seconds. Returns a function that stops it. */
export function startArchiveWriter(
  db: Database,
  options: FlushOptions & { pollMs?: number },
): () => void {
  const log = options.log ?? ((m: string) => console.log(m));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await flushArchiveQueue(db, { ...options, log });
    } catch (error) {
      log(
        `archive: write-through failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(
    () => void tick(),
    options.pollMs ?? Math.min(10_000, Math.max(1000, options.delaySeconds * 250)),
  );
  timer.unref?.();
  return () => clearInterval(timer);
}
