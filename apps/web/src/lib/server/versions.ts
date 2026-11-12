/**
 * The versions of transcriptions and editions (docs/design.md, section
 * 3.11): which a record has, whether it has one that is not withdrawn (which
 * is what makes it public), the snapshot a version is read from, and the list
 * of changes since the version before. Publishing and withdrawing are
 * publish.ts.
 */

import {
  alignmentConstraints,
  bibliographyItems,
  changesets,
  citations,
  conjectures,
  editionAdoptions,
  editionSigla,
  editionSiteKinds,
  editions,
  notes,
  persons,
  reportedReadings,
  segments,
  transcriptions,
  users,
  versions,
  zones,
  type Database,
  type DocumentKind,
  type EditionSnapshot,
  type Stored,
  type TranscriptionSnapshot,
  type Version,
  type VersionChanges,
} from '@varians/db';
import type { Stream } from '@varians/core';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { withoutLatin } from '../edition/conventions.ts';
import { changesBetween } from '../history/changes.ts';
import { documentAt, loadDocument } from './documents/service.ts';

/**
 * Whether the record in `column` has a version that is not withdrawn: one
 * EXISTS subquery, for the lists that ask it of every row.
 */
export function hasVersionSql(kind: DocumentKind, column: AnyPgColumn) {
  return sql<boolean>`exists (select 1 from ${versions} where ${versions.documentKind} = ${kind} and ${versions.documentId} = ${column} and ${versions.withdrawnAt} is null)`;
}

/** The number of the latest version of the record in `column` that is not withdrawn, or null: one subquery, for the lists. */
export function latestVersionSql(kind: DocumentKind, column: AnyPgColumn) {
  return sql<
    number | null
  >`(select max(${versions.number}) from ${versions} where ${versions.documentKind} = ${kind} and ${versions.documentId} = ${column} and ${versions.withdrawnAt} is null)`;
}

/** Whether a record has a version that is not withdrawn. */
export async function hasVersion(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(
      and(
        eq(versions.documentKind, kind),
        eq(versions.documentId, documentId),
        isNull(versions.withdrawnAt),
      ),
    )
    .limit(1);
  return !!row;
}

/** Of some records, those that have a version not withdrawn. */
export async function withVersions(
  db: Database,
  kind: DocumentKind,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: versions.documentId })
    .from(versions)
    .where(
      and(
        eq(versions.documentKind, kind),
        inArray(versions.documentId, [...new Set(ids)]),
        isNull(versions.withdrawnAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** A version as it is listed: everything but its snapshot, with the names of who published and who withdrew it. */
export interface VersionSummary {
  id: string;
  number: number;
  /** The changeset version of the document at the publication. */
  version: number;
  momentId: string | null;
  at: Date;
  note: string | null;
  personId: string | null;
  personName: string | null;
  withdrawn: {
    at: Date;
    personId: string | null;
    personName: string | null;
    note: string | null;
  } | null;
  changes: VersionChanges;
}

/** All the versions of a record, newest first, withdrawn ones among them. */
export async function versionsOf(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<VersionSummary[]> {
  const rows = await db
    .select({
      id: versions.id,
      number: versions.number,
      version: versions.version,
      momentId: versions.momentId,
      at: versions.at,
      note: versions.note,
      personId: versions.personId,
      withdrawnAt: versions.withdrawnAt,
      withdrawnBy: versions.withdrawnBy,
      withdrawalNote: versions.withdrawalNote,
      changes: versions.changes,
    })
    .from(versions)
    .where(and(eq(versions.documentKind, kind), eq(versions.documentId, documentId)))
    .orderBy(desc(versions.number));
  const ids = [
    ...new Set(rows.flatMap((r) => [r.personId, r.withdrawnBy]).filter((id): id is string => !!id)),
  ];
  const names = new Map(
    ids.length
      ? (
          await db
            .select({ id: persons.id, name: persons.name })
            .from(persons)
            .where(inArray(persons.id, ids))
        ).map((p) => [p.id, p.name] as const)
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    version: r.version,
    momentId: r.momentId,
    at: r.at,
    note: r.note,
    personId: r.personId,
    personName: r.personId ? (names.get(r.personId) ?? null) : null,
    withdrawn: r.withdrawnAt
      ? {
          at: r.withdrawnAt,
          personId: r.withdrawnBy,
          personName: r.withdrawnBy ? (names.get(r.withdrawnBy) ?? null) : null,
          note: r.withdrawalNote,
        }
      : null,
    changes: r.changes,
  }));
}

/** The latest version of a record that is not withdrawn, without its snapshot; null when it has none. */
export async function latestVersion(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<VersionSummary | null> {
  return (await versionsOf(db, kind, documentId)).find((v) => !v.withdrawn) ?? null;
}

/** Snapshots read, by version id: a version's snapshot is never written again, so what was read is handed out again. */
const snapshots = new Map<string, { snapshot: Version['snapshot']; items: number }>();
let snapshotItems = 0;
/** About twenty megabytes of parsed snapshots. */
const SNAPSHOT_ITEMS = 100_000;

function inTransaction(db: Database): boolean {
  return typeof (db as unknown as { rollback?: unknown }).rollback === 'function';
}

function keepSnapshot(id: string, snapshot: Version['snapshot']): void {
  const items = snapshot.content.items.length;
  snapshots.delete(id);
  snapshots.set(id, { snapshot, items });
  snapshotItems += items;
  for (const [oldest, entry] of snapshots) {
    if (snapshotItems <= SNAPSHOT_ITEMS || snapshots.size <= 1) break;
    snapshots.delete(oldest);
    snapshotItems -= entry.items;
  }
}

/** Forget the snapshots read, for tests. */
export function forgetSnapshots(): void {
  snapshots.clear();
  snapshotItems = 0;
}

/** A version with its snapshot, by its number; null when there is none so numbered. */
export async function versionByNumber(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  number: number,
): Promise<Version | null> {
  const { snapshot: _snapshot, ...columns } = versionColumns();
  const [row] = await db
    .select(columns)
    .from(versions)
    .where(
      and(
        eq(versions.documentKind, kind),
        eq(versions.documentId, documentId),
        eq(versions.number, number),
      ),
    );
  if (!row) return null;
  return { ...row, snapshot: await snapshotOf(db, row.id) };
}

/** The latest version not withdrawn with its snapshot; null when there is none. */
export async function latestVersionWithSnapshot(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<Version | null> {
  const latest = await latestVersion(db, kind, documentId);
  return latest ? versionByNumber(db, kind, documentId, latest.number) : null;
}

function versionColumns() {
  return {
    id: versions.id,
    documentKind: versions.documentKind,
    documentId: versions.documentId,
    number: versions.number,
    version: versions.version,
    momentId: versions.momentId,
    note: versions.note,
    createdBy: versions.createdBy,
    personId: versions.personId,
    at: versions.at,
    withdrawnAt: versions.withdrawnAt,
    withdrawnBy: versions.withdrawnBy,
    withdrawalNote: versions.withdrawalNote,
    snapshot: versions.snapshot,
    changes: versions.changes,
  };
}

async function snapshotOf(db: Database, versionId: string): Promise<Version['snapshot']> {
  const kept = snapshots.get(versionId);
  if (kept) {
    snapshots.delete(versionId);
    snapshots.set(versionId, kept);
    return kept.snapshot;
  }
  const [row] = await db
    .select({ snapshot: versions.snapshot })
    .from(versions)
    .where(eq(versions.id, versionId));
  if (!row) throw new Error(`no version ${versionId}`);
  if (!inTransaction(db)) keepSnapshot(versionId, row.snapshot);
  return row.snapshot;
}

/** The snapshots of some transcript versions, by transcription id, from a map of transcription id to version number. */
export async function transcriptionVersions(
  db: Database,
  numbers: Record<string, number>,
): Promise<Map<string, { version: Version; snapshot: TranscriptionSnapshot }>> {
  const out = new Map<string, { version: Version; snapshot: TranscriptionSnapshot }>();
  for (const [id, number] of Object.entries(numbers)) {
    const found = await versionByNumber(db, 'transcription', id, number);
    if (found) out.set(id, { version: found, snapshot: found.snapshot as TranscriptionSnapshot });
  }
  return out;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** A row with its times as ISO strings, as a snapshot keeps it. */
export function stored<T extends Record<string, unknown>>(row: T): Stored<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row))
    out[key] = value instanceof Date ? value.toISOString() : value;
  return out as Stored<T>;
}

/** A row from a snapshot with the times named given back as dates. */
export function revived<T extends Record<string, unknown>, K extends keyof T>(
  row: T,
  ...keys: K[]
): Omit<T, K> & { [P in K]: Date } {
  const out: Record<string, unknown> = { ...row };
  for (const key of keys) {
    const value = row[key];
    out[key as string] = typeof value === 'string' ? new Date(value) : new Date(0);
  }
  return out as Omit<T, K> & { [P in K]: Date };
}

/**
 * Everything a reader of the edition needs as it stands, with the version of
 * each transcription compared (`witnessVersions`, which publishing gives).
 * The conjectures and reported readings are those of the work, a commons the
 * version shows all of; the citations those that the edition, its notes and
 * those records make, and the bibliography the works they cite.
 */
export async function editionSnapshot(
  db: Database,
  editionId: string,
  witnessVersions: Record<string, number>,
): Promise<EditionSnapshot> {
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId));
  if (!edition) throw new Error(`no edition ${editionId}`);
  const [sigla, adoptions, noteRows, kindRows, conjectureRows, readingRows, constraintRows] =
    await Promise.all([
      db
        .select()
        .from(editionSigla)
        .where(eq(editionSigla.editionId, editionId))
        .orderBy(asc(editionSigla.position)),
      db
        .select()
        .from(editionAdoptions)
        .where(eq(editionAdoptions.editionId, editionId))
        .orderBy(asc(editionAdoptions.conjectureId)),
      db
        .select({
          id: notes.id,
          segmentId: notes.segmentId,
          tokenIds: notes.tokenIds,
          text: notes.text,
          personId: notes.personId,
          author: users.name,
          createdAt: notes.createdAt,
        })
        .from(notes)
        .leftJoin(users, eq(users.id, notes.authorId))
        .where(eq(notes.editionId, editionId))
        .orderBy(asc(notes.id)),
      db.select().from(editionSiteKinds).where(eq(editionSiteKinds.editionId, editionId)),
      db
        .select()
        .from(conjectures)
        .where(eq(conjectures.workId, edition.workId))
        .orderBy(asc(conjectures.id)),
      db
        .select()
        .from(reportedReadings)
        .where(eq(reportedReadings.workId, edition.workId))
        .orderBy(asc(reportedReadings.id)),
      db
        .select()
        .from(alignmentConstraints)
        .where(eq(alignmentConstraints.editionId, editionId))
        .orderBy(asc(alignmentConstraints.id)),
    ]);
  const conjectureIds = conjectureRows.map((c) => c.id);
  const readingIds = readingRows.map((r) => r.id);
  const noteIds = noteRows.map((n) => n.id);
  const citationRows = await db
    .select()
    .from(citations)
    .where(
      or(
        eq(citations.editionId, editionId),
        conjectureIds.length ? inArray(citations.conjectureId, conjectureIds) : undefined,
        readingIds.length ? inArray(citations.reportedReadingId, readingIds) : undefined,
        noteIds.length ? inArray(citations.noteId, noteIds) : undefined,
      ),
    )
    .orderBy(asc(citations.id));
  const itemIds = [...new Set(citationRows.map((c) => c.itemId))];
  const items = itemIds.length
    ? await db
        .select()
        .from(bibliographyItems)
        .where(inArray(bibliographyItems.id, itemIds))
        .orderBy(asc(bibliographyItems.citationKey))
    : [];
  const personOf = new Map<string, string>();
  const setters = [...new Set(kindRows.map((k) => k.setBy).filter((id): id is string => !!id))];
  if (setters.length)
    for (const p of await db
      .select({ id: persons.id, userId: persons.userId })
      .from(persons)
      .where(inArray(persons.userId, setters)))
      if (p.userId) personOf.set(p.userId, p.id);
  return {
    title: edition.title,
    editors: edition.editors,
    preface: edition.preface,
    sources: edition.sources,
    rightsNote: edition.rightsNote,
    licenceId: edition.licenceId,
    // A setting no longer had (Latin abbreviations) is not kept.
    conventions: withoutLatin(edition.conventions),
    copiedFrom: edition.copiedFrom,
    content: edition.content,
    sigla: sigla.map((s) => ({
      siglum: s.siglum,
      witnessId: s.witnessId,
      transcriptionId: s.transcriptionId,
      states: s.states,
      variantSiglum: s.variantSiglum,
    })),
    witnessVersions,
    adoptions: adoptions.map((a) => ({ conjectureId: a.conjectureId, at: iso(a.createdAt) })),
    notes: noteRows.map((n) => ({ ...n, createdAt: iso(n.createdAt) })),
    siteKinds: kindRows
      .map((k) => ({
        segmentId: k.segmentId,
        siteKey: k.siteKey,
        ...(k.kind ? { kind: k.kind } : {}),
        ...(k.minor ? { minor: true as const } : {}),
        personId: k.setBy ? (personOf.get(k.setBy) ?? k.setBy) : null,
        setAt: iso(k.setAt),
      }))
      .sort((a, b) => a.segmentId.localeCompare(b.segmentId) || a.siteKey.localeCompare(b.siteKey)),
    conjectures: conjectureRows.map(stored),
    readings: readingRows.map(stored),
    citations: citationRows.map(stored),
    bibliography: items.map(stored),
    constraints: constraintRows.map(({ editionId: _editionId, ...c }) => stored(c)),
  };
}

/** Everything a reader of the transcription needs as it stands. */
export async function transcriptionSnapshot(
  db: Database,
  transcriptionId: string,
): Promise<TranscriptionSnapshot> {
  const [t] = await db.select().from(transcriptions).where(eq(transcriptions.id, transcriptionId));
  if (!t) throw new Error(`no transcription ${transcriptionId}`);
  const zoneRows = await db
    .select()
    .from(zones)
    .where(eq(zones.transcriptionId, transcriptionId))
    .orderBy(asc(zones.id));
  return {
    name: t.name,
    witnessId: t.witnessId,
    description: t.description,
    sources: t.sources,
    rightsNote: t.rightsNote,
    licenceId: t.licenceId,
    keepsWrittenForm: t.keepsWrittenForm,
    displayAsWritten: t.displayAsWritten,
    content: t.content,
    zones: zoneRows.map(({ transcriptionId: _t, updatedAt: _u, ...z }) => stored(z)),
  };
}

/**
 * The changes of a document from the changeset version `from` (0: the
 * beginning) to its current version, or to `to`: what the changesets between
 * say of themselves and the words added, changed and removed by segment.
 */
export async function changesSince(
  db: Database,
  kind: DocumentKind,
  documentId: string,
  from: number,
  to?: number,
): Promise<VersionChanges> {
  const doc = await loadDocument(db, kind, documentId);
  const end = Math.min(to ?? doc.version, doc.version);
  const start = Math.min(Math.max(0, from), end);
  const empty: Stream = { items: [] };
  const [before, after] = await Promise.all([
    start === 0 ? empty : documentAt(db, kind, documentId, start),
    end === doc.version ? doc.content : documentAt(db, kind, documentId, end),
  ]);
  const described = await db
    .select({ version: changesets.version, at: changesets.at, message: changesets.message })
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, documentId),
        gt(changesets.version, start),
        lte(changesets.version, end),
        isNotNull(changesets.message),
      ),
    )
    .orderBy(asc(changesets.version));
  const ids = new Set<string>();
  for (const stream of [before, after])
    for (const item of stream.items)
      if (item.kind !== 'break' && item.segment?.segmentId) ids.add(item.segment.segmentId);
  const labels = new Map(
    ids.size
      ? (
          await db
            .select({ id: segments.id, label: segments.label })
            .from(segments)
            .where(inArray(segments.id, [...ids]))
        ).map((s) => [s.id, s.label] as const)
      : [],
  );
  return changesBetween(
    before,
    after,
    start,
    end,
    described.map((c) => ({ version: c.version ?? 0, at: c.at.toISOString(), message: c.message })),
    (id) => labels.get(id) ?? null,
  );
}

/**
 * What Publish… shows: the number the next version will have, and the
 * changes since the version before it (withdrawn or not, being the version
 * before all the same), or since the beginning.
 */
export async function changesSinceLatest(
  db: Database,
  kind: DocumentKind,
  documentId: string,
): Promise<{ number: number; changes: VersionChanges }> {
  const [latest] = await versionsOf(db, kind, documentId);
  return {
    number: (latest?.number ?? 0) + 1,
    changes: await changesSince(db, kind, documentId, latest?.version ?? 0),
  };
}
