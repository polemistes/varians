/**
 * The works of a transcription: those its text is assigned to. A
 * transcription of a miscellany may have many.
 */
import { segmentIds, type Stream } from '@varians/core';
import { segments, transcriptions, type Database } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The works a transcription's text is assigned to, in the order they first
 * occur in its text. A transcription has no other works.
 */
export async function worksOfTranscription(
  db: Database | Tx,
  transcriptionId: string,
): Promise<string[]> {
  const [row] = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  return row ? worksOfContent(db, row.content) : [];
}

/** The works the segment starts of a text name, in the order they first occur. */
export async function worksOfContent(db: Database | Tx, content: Stream): Promise<string[]> {
  const named = segmentIds(content);
  if (named.length === 0) return [];
  const rows = await db
    .select({ id: segments.id, workId: segments.workId })
    .from(segments)
    .where(inArray(segments.id, named));
  const workOf = new Map(rows.map((r) => [r.id, r.workId] as const));
  return [
    ...new Set(named.map((id) => workOf.get(id)).filter((w): w is string => w !== undefined)),
  ];
}
