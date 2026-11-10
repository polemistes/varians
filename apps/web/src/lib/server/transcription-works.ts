/**
 * The works of a transcription: those its owner chose it for
 * (transcription_works, in order) and those its text is assigned to
 * (transcription_segments). A transcription of a miscellany may have many.
 */
import { transcriptionSegments, transcriptionWorks, type Database } from '@varians/db';
import { asc, eq, inArray } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The works a transcription is for, in the order its owner gave them. */
export async function chosenWorks(db: Database | Tx, transcriptionId: string): Promise<string[]> {
  const rows = await db
    .select({ workId: transcriptionWorks.workId })
    .from(transcriptionWorks)
    .where(eq(transcriptionWorks.transcriptionId, transcriptionId))
    .orderBy(asc(transcriptionWorks.position));
  return rows.map((r) => r.workId);
}

/** The chosen works of several transcriptions at once. */
export async function chosenWorksOf(
  db: Database | Tx,
  transcriptionIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (transcriptionIds.length === 0) return out;
  const rows = await db
    .select({
      transcriptionId: transcriptionWorks.transcriptionId,
      workId: transcriptionWorks.workId,
    })
    .from(transcriptionWorks)
    .where(inArray(transcriptionWorks.transcriptionId, transcriptionIds))
    .orderBy(asc(transcriptionWorks.position));
  for (const row of rows)
    out.set(row.transcriptionId, [...(out.get(row.transcriptionId) ?? []), row.workId]);
  return out;
}

/** All the works of a transcription: the chosen ones first, then those its text is assigned to. */
export async function worksOfTranscription(
  db: Database | Tx,
  transcriptionId: string,
): Promise<string[]> {
  const chosen = await chosenWorks(db, transcriptionId);
  const assigned = await db
    .selectDistinct({ workId: transcriptionSegments.workId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.transcriptionId, transcriptionId));
  return [...new Set([...chosen, ...assigned.map((r) => r.workId)])];
}

/** Set the works a transcription is for, in order; duplicates are dropped. */
export async function setChosenWorks(
  db: Database | Tx,
  transcriptionId: string,
  workIds: string[],
): Promise<void> {
  const ids = [...new Set(workIds)];
  await db
    .delete(transcriptionWorks)
    .where(eq(transcriptionWorks.transcriptionId, transcriptionId));
  if (ids.length)
    await db
      .insert(transcriptionWorks)
      .values(ids.map((workId, position) => ({ transcriptionId, workId, position })));
}
