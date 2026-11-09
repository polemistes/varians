/**
 * Keeping the archives current: every work whose documents changed since
 * its last commit is written and committed again, nightly and on request.
 */

import { archiveCommits, changesets, editions, editionSigla, works, type Database } from '@varians/db';
import { desc, eq, inArray, max } from 'drizzle-orm';
import { archiveWork, type ArchiveWriters } from './archive.ts';

export interface SchedulerOptions {
  db: Database;
  root: string;
  storageRoot?: string;
  /** How often to look, in milliseconds; a day by default. */
  intervalMs?: number;
  /** Where to log; console by default. */
  log?: (message: string) => void;
}

/** The latest change time of any document connected to a work, or null when nothing is recorded. */
export async function lastChangeOf(db: Database, workId: string): Promise<Date | null> {
  const editionIds = (await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))).map((e) => e.id);
  const transcriptionIds = editionIds.length
    ? (await db.select({ id: editionSigla.transcriptionId }).from(editionSigla).where(inArray(editionSigla.editionId, editionIds)))
        .map((s) => s.id)
        .filter((id): id is string => id !== null)
    : [];
  const ids = [...editionIds, ...transcriptionIds];
  if (ids.length === 0) return null;
  const [row] = await db.select({ at: max(changesets.at) }).from(changesets).where(inArray(changesets.documentId, ids));
  return row?.at ?? null;
}

/** Archive every work that changed since its last commit. Returns the ids archived. */
export async function archiveChangedWorks(db: Database, root: string, reason: string, writers: ArchiveWriters = {}): Promise<string[]> {
  const archived: string[] = [];
  const all = await db.select({ id: works.id, updatedAt: works.updatedAt }).from(works);
  for (const work of all) {
    const [last] = await db.select({ at: archiveCommits.at }).from(archiveCommits).where(eq(archiveCommits.workId, work.id)).orderBy(desc(archiveCommits.at)).limit(1);
    const changed = await lastChangeOf(db, work.id);
    const newest = [changed, work.updatedAt].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
    if (last && newest && newest.getTime() <= last.at.getTime()) continue;
    const hash = await archiveWork(db, work.id, root, reason, writers);
    if (hash) archived.push(work.id);
  }
  return archived;
}

/** Start the nightly pass. Returns a function that stops it. */
export function startArchiveScheduler(options: SchedulerOptions): () => void {
  const log = options.log ?? ((m: string) => console.log(m));
  const interval = options.intervalMs ?? 24 * 60 * 60 * 1000;
  const writers: ArchiveWriters = options.storageRoot ? { storageRoot: options.storageRoot } : {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const archived = await archiveChangedWorks(options.db, options.root, 'nightly', writers);
      if (archived.length) log(`archive: ${archived.length} work(s) committed`);
    } catch (error) {
      log(`archive: failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), interval);
  timer.unref?.();
  return () => clearInterval(timer);
}
