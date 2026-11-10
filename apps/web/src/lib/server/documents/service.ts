/**
 * Documents: transcriptions and editions as versioned streams.
 *
 * Every save sends operations against the version the client holds. Inside
 * one transaction the row is locked, the version checked, the operations
 * applied through the core, the content and version stored, the changeset
 * recorded with its reverse, a checkpoint written every so often, and for a
 * transcription the derived segment index rebuilt. A version mismatch is
 * answered with the current document, never by overwriting.
 */

import {
  applyOps,
  fold,
  newId,
  segmentRuns,
  units,
  type Changeset,
  type NormalizationProfile,
  type Op,
  type Stream,
} from '@varians/core';
import {
  changesets,
  checkpoints,
  editions,
  moments,
  segments,
  transcriptionSegments,
  transcriptions,
  works,
  type Database,
  type DocumentKind,
} from '@varians/db';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { conformed, transcriptionPageOrder } from '../conform.ts';

export const CHECKPOINT_EVERY = 50;

export class VersionConflict extends Error {
  constructor(
    public readonly current: { version: number; content: Stream },
    public readonly since: Changeset[],
  ) {
    super('document changed since this version');
    this.name = 'VersionConflict';
  }
}

export interface SaveResult {
  version: number;
  content: Stream;
  changesetId: string;
}

function table(kind: DocumentKind) {
  return kind === 'transcription' ? transcriptions : editions;
}

/** Save operations against a document, or throw VersionConflict with what changed since. */
export async function saveOps(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  userId: string | null,
  fromVersion: number,
  ops: Op[],
  message?: string,
): Promise<SaveResult> {
  if (ops.length === 0) {
    const row = await loadDocument(db, kind, documentId);
    return { version: row.version, content: row.content, changesetId: '' };
  }
  return db.transaction(async (tx) => {
    const t = table(kind);
    const [row] = await tx
      .select({ version: t.version, content: t.content })
      .from(t)
      .where(eq(t.id, documentId))
      .for('update');
    if (!row) throw new Error(`no ${kind} ${documentId}`);
    if (row.version !== fromVersion) {
      const since = await tx
        .select()
        .from(changesets)
        .where(
          and(
            eq(changesets.documentKind, kind),
            eq(changesets.documentId, documentId),
            gt(changesets.version, fromVersion),
          ),
        )
        .orderBy(changesets.version);
      throw new VersionConflict(
        { version: row.version, content: row.content },
        since.map((c) => ({
          id: c.id,
          documentId: c.documentId,
          version: c.version ?? 0,
          parentId: c.parentId,
          userId: c.userId ?? '',
          at: c.at.toISOString(),
          ops: c.ops,
          reverse: c.reverse,
          ...(c.message ? { message: c.message } : {}),
        })),
      );
    }
    const applied = applyOps(row.content, ops);
    const version = row.version + 1;
    await tx.update(t).set({ content: applied.stream, version }).where(eq(t.id, documentId));
    const changesetId = newId();
    await tx.insert(changesets).values({
      id: changesetId,
      documentKind: kind,
      documentId,
      version,
      userId,
      ops,
      reverse: applied.reverse,
      ...(message ? { message } : {}),
    });
    if (version % CHECKPOINT_EVERY === 0) {
      await tx
        .insert(checkpoints)
        .values({ documentKind: kind, documentId, version, content: applied.stream })
        .onConflictDoNothing();
    }
    if (kind === 'transcription') await rebuildSegmentIndex(tx, documentId, applied.stream);
    return { version, content: applied.stream, changesetId };
  });
}

/** Replace a document's whole content (an import), as one changeset. A transcript's content is conformed to its witness's pages first. */
export async function replaceContent(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  userId: string | null,
  fromVersion: number,
  content: Stream,
  message = 'import',
): Promise<SaveResult> {
  const current = await loadDocument(db, kind, documentId);
  if (kind === 'transcription')
    content = conformed(content, await transcriptionPageOrder(db, documentId));
  const ops: Op[] = [];
  if (current.content.items.length > 0)
    ops.push({ t: 'delete', ids: current.content.items.map((i) => i.id) });
  if (content.items.length > 0) ops.push({ t: 'insert', after: null, items: content.items });
  return saveOps(db, kind, documentId, userId, fromVersion, ops, message);
}

export async function loadDocument(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<{ version: number; content: Stream }> {
  const t = table(kind);
  const [row] = await db
    .select({ version: t.version, content: t.content })
    .from(t)
    .where(eq(t.id, documentId));
  if (!row) throw new Error(`no ${kind} ${documentId}`);
  return row;
}

/** The document as it stood at a version: the nearest checkpoint at or below, then the changesets up to it. */
/**
 * Past versions never change, and readers ask for the same published
 * versions again and again: the last few rebuilt are kept. Treat what comes
 * back as read-only.
 */
const pastVersions = new Map<string, Stream>();
const PAST_VERSIONS_KEPT = 24;

function keepPastVersion(key: string, stream: Stream): void {
  pastVersions.delete(key);
  pastVersions.set(key, stream);
  if (pastVersions.size > PAST_VERSIONS_KEPT)
    pastVersions.delete(pastVersions.keys().next().value!);
}

/** Forgets the kept past versions of a document, after its stored history was rewritten (a merge of works moves segment ids). */
export function forgetPastVersions(kind: DocumentKind, documentId: string): void {
  const prefix = `${kind}:${documentId}:`;
  for (const key of [...pastVersions.keys()]) if (key.startsWith(prefix)) pastVersions.delete(key);
}

export async function documentAt(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  version: number,
): Promise<Stream> {
  const current = await loadDocument(db, kind, documentId);
  if (version >= current.version) return current.content;
  const key = `${kind}:${documentId}:${version}`;
  const kept = pastVersions.get(key);
  if (kept) {
    keepPastVersion(key, kept);
    return kept;
  }
  const rebuilt = await rebuildVersion(db, kind, documentId, version, current.content);
  keepPastVersion(key, rebuilt);
  return rebuilt;
}

async function rebuildVersion(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  version: number,
  currentContent: Stream,
): Promise<Stream> {
  const [checkpoint] = await db
    .select()
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.documentKind, kind),
        eq(checkpoints.documentId, documentId),
        lte(checkpoints.version, version),
      ),
    )
    .orderBy(desc(checkpoints.version))
    .limit(1);
  if (checkpoint) {
    const forward = await db
      .select()
      .from(changesets)
      .where(
        and(
          eq(changesets.documentKind, kind),
          eq(changesets.documentId, documentId),
          gt(changesets.version, checkpoint.version),
          lte(changesets.version, version),
        ),
      )
      .orderBy(changesets.version);
    let stream = checkpoint.content;
    for (const c of forward) stream = applyOps(stream, c.ops).stream;
    return stream;
  }
  // No checkpoint below: walk back from the current content through the reverses.
  const backward = await db
    .select()
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, documentId),
        gt(changesets.version, version),
      ),
    )
    .orderBy(desc(changesets.version));
  let stream = currentContent;
  for (const c of backward) stream = applyOps(stream, c.reverse).stream;
  return stream;
}

/** The changesets of a document, newest first, optionally only after a version. */
export async function history(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  afterVersion = 0,
  limit = 500,
): Promise<Changeset[]> {
  const rows = await db
    .select()
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, documentId),
        gt(changesets.version, afterVersion),
      ),
    )
    .orderBy(desc(changesets.version))
    .limit(limit);
  return rows.map((c) => ({
    id: c.id,
    documentId: c.documentId,
    version: c.version ?? 0,
    parentId: c.parentId,
    userId: c.userId ?? '',
    at: c.at.toISOString(),
    ops: c.ops,
    reverse: c.reverse,
    ...(c.message ? { message: c.message } : {}),
  }));
}

/** Name a moment of a document's history. */
export async function nameMoment(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  version: number,
  name: string,
  userId: string | null,
  momentKind: 'named' | 'published' = 'named',
  number?: number,
): Promise<string> {
  const id = newId();
  await db.insert(moments).values({
    id,
    documentKind: kind,
    documentId,
    version,
    name,
    kind: momentKind,
    createdBy: userId,
    ...(number !== undefined ? { number } : {}),
  });
  return id;
}

/**
 * Rebuild the derived index of a transcription: one row per segment run,
 * with the fold text of its units under the work's profile.
 */
export async function rebuildSegmentIndex(
  db: Database,
  transcriptionId: string,
  content: Stream,
): Promise<void> {
  const runs = segmentRuns(content).filter((r) => r.segmentId !== null);
  await db
    .delete(transcriptionSegments)
    .where(eq(transcriptionSegments.transcriptionId, transcriptionId));
  if (runs.length === 0) return;
  const segmentIds = [...new Set(runs.map((r) => r.segmentId!))];
  const segmentRows = await db
    .select({ id: segments.id, workId: segments.workId, profile: works.profile })
    .from(segments)
    .innerJoin(works, eq(works.id, segments.workId))
    .where(inArray(segments.id, segmentIds));
  const bySegment = new Map(segmentRows.map((s) => [s.id, s] as const));
  const rows = runs
    .filter((run) => bySegment.has(run.segmentId!))
    .map((run) => {
      const seg = bySegment.get(run.segmentId!)!;
      const profile = seg.profile as NormalizationProfile;
      const runUnits = units(content, run.from, run.to);
      const first = content.items[run.from]!;
      return {
        transcriptionId,
        segmentId: run.segmentId!,
        workId: seg.workId,
        part: run.part,
        firstItemId: first.id,
        unitCount: runUnits.length,
        foldText: runUnits.map((u) => (u.gap ? '[...]' : fold(u.text, profile.fold))).join(' '),
      };
    });
  // Two runs with the same part number (older data, or a numbering slip) keep the first.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.segmentId}:${r.part}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length) await db.insert(transcriptionSegments).values(unique);
}

/** Which transcriptions assign text to a segment, with the part count. */
export async function transcriptionsOfSegment(
  db: Database,
  segmentId: string,
): Promise<{ transcriptionId: string; parts: number }[]> {
  return db
    .select({
      transcriptionId: transcriptionSegments.transcriptionId,
      parts: sql<number>`count(*)::int`,
    })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.segmentId, segmentId))
    .groupBy(transcriptionSegments.transcriptionId);
}
