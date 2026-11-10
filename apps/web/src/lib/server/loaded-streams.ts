/**
 * The texts of transcriptions and editions as they were loaded, kept for the
 * next request for as long as the row they came from is unchanged. A page of
 * an edition collates its witnesses, and reading thirty transcripts of ten
 * thousand words each takes a fifth of a second and tens of megabytes of
 * parsing, to be read again by the next request.
 *
 * A row is known to be unchanged by its `xmin`, the transaction that wrote
 * its current version: whatever changes the text, a save, an import, a merge
 * of works, a statement by hand, writes the row again. What is kept is told
 * apart from what is stored before it is used, by one short query, so that
 * two servers on one database cannot disagree. A text is never changed once
 * loaded (an edit makes a new one), which is what lets it be handed out
 * again; the cache is bounded by the number of items it holds. Inside a
 * transaction nothing is kept or handed out: a row it has written twice has
 * one `xmin`, and what it reads is not yet anyone else's.
 */
import type { Stream } from '@varians/core';
import { editions, transcriptions, type Database } from '@varians/db';
import { eq, inArray, sql } from 'drizzle-orm';

interface Kept {
  stamp: string;
  stream: Stream;
  items: number;
}

const kept = new Map<string, Kept>();
let keptItems = 0;

/** About sixty megabytes of parsed text. */
export const KEPT_ITEMS = 300_000;

/** Whether the connection is a transaction's, which has `rollback`. */
function inTransaction(db: Database): boolean {
  return typeof (db as unknown as { rollback?: unknown }).rollback === 'function';
}

function keep(key: string, stamp: string, stream: Stream): void {
  const before = kept.get(key);
  if (before) keptItems -= before.items;
  // Re-set to be the newest.
  kept.delete(key);
  kept.set(key, { stamp, stream, items: stream.items.length });
  keptItems += stream.items.length;
  for (const [oldest, entry] of kept) {
    if (keptItems <= KEPT_ITEMS || kept.size <= 1) break;
    kept.delete(oldest);
    keptItems -= entry.items;
  }
}

function recall(key: string, stamp: string): Stream | undefined {
  const entry = kept.get(key);
  if (!entry || entry.stamp !== stamp) return undefined;
  kept.delete(key);
  kept.set(key, entry);
  return entry.stream;
}

/** Forget everything kept, for tests. */
export function forgetLoadedStreams(): void {
  kept.clear();
  keptItems = 0;
}

export interface LoadedTranscription {
  id: string;
  content: Stream;
  version: number;
  witnessId: string;
}

/** The transcriptions with these ids: their text, version and witness. Ids that name none are left out. */
export async function loadTranscriptions(
  db: Database,
  ids: string[],
): Promise<LoadedTranscription[]> {
  if (ids.length === 0) return [];
  const inside = inTransaction(db);
  const stamps = await db
    .select({
      id: transcriptions.id,
      version: transcriptions.version,
      witnessId: transcriptions.witnessId,
      stamp: sql<string>`xmin::text`,
    })
    .from(transcriptions)
    .where(inArray(transcriptions.id, ids));
  const out: LoadedTranscription[] = [];
  const missing: string[] = [];
  for (const row of stamps) {
    const stream = inside ? undefined : recall(`t:${row.id}`, row.stamp);
    if (stream)
      out.push({ id: row.id, content: stream, version: row.version, witnessId: row.witnessId });
    else missing.push(row.id);
  }
  if (missing.length > 0) {
    // Read together with the version and the stamp it has now, which may be newer than the first query saw.
    const rows = await db
      .select({
        id: transcriptions.id,
        content: transcriptions.content,
        version: transcriptions.version,
        witnessId: transcriptions.witnessId,
        stamp: sql<string>`xmin::text`,
      })
      .from(transcriptions)
      .where(inArray(transcriptions.id, missing));
    for (const row of rows) {
      if (!inside) keep(`t:${row.id}`, row.stamp, row.content);
      out.push({
        id: row.id,
        content: row.content,
        version: row.version,
        witnessId: row.witnessId,
      });
    }
  }
  return out;
}

/** An edition's text and version. */
export async function loadEditionText(
  db: Database,
  editionId: string,
): Promise<{ content: Stream; version: number } | null> {
  const [row] = await db
    .select({ version: editions.version, stamp: sql<string>`xmin::text` })
    .from(editions)
    .where(eq(editions.id, editionId));
  if (!row) return null;
  const inside = inTransaction(db);
  const stream = inside ? undefined : recall(`e:${editionId}`, row.stamp);
  if (stream) return { content: stream, version: row.version };
  const [full] = await db
    .select({
      content: editions.content,
      version: editions.version,
      stamp: sql<string>`xmin::text`,
    })
    .from(editions)
    .where(eq(editions.id, editionId));
  if (!full) return null;
  if (!inside) keep(`e:${editionId}`, full.stamp, full.content);
  return { content: full.content, version: full.version };
}
