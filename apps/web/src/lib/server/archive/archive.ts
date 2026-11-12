/**
 * The archive: a work's records as open files in a git repository, kept
 * current by the server. This module writes
 * the files from the database and commits. Format: docs/formats.
 *
 * The writing is split by level, so that a change to one document rewrites
 * only that document's files: the work's own files (always rewritten, they
 * are small), a witness, a transcription, an edition. A full write is every
 * part. Before writing, the archive is pruned: a directory whose record no
 * longer belongs to the work, or now belongs at another path, goes.
 */

import { withoutLatin } from '$lib/edition/conventions';
import { materialLabel } from '$lib/registry/witness';
import {
  apparatusEntries,
  type Collation,
  splitEntries,
  exportEditionTei,
  shownBreaks,
  exportTranscriptionTei,
  formatApparatus,
  isCopyable,
  licenceInfo,
  newId,
  passageUrn,
  REGISTRY_LICENCE,
  segmentRuns,
  serializeBiblatex,
  toText,
} from '@varians/core';
import {
  alignmentConstraints,
  archiveCommits,
  bibliographyItems,
  changesets,
  citations,
  conjectures,
  editionAdoptions,
  editionCollaborators,
  editionSigla,
  editionSiteKinds,
  editionSiteReviews,
  editions,
  moments,
  notes,
  pages,
  persons,
  referenceSchemes,
  registryMerges,
  reportedReadings,
  reviewState,
  segments,
  transcriptionSegments,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  versions,
  zones,
  type Database,
  type EditionSnapshot,
  type TranscriptionSnapshot,
  type Version,
} from '@varians/db';
import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { editionBibliography, snapshotBibliography } from '../bibliography.ts';
import { hasVersionSql, versionByNumber } from '../versions.ts';
import { collateEdition } from '../passages.ts';
import { segmentShares, teiText } from '../../reader/export.ts';
import { documentAt } from '../documents/service.ts';
import { exportHands, teiForm } from '../witness-format.ts';
import {
  apparatusConventionsOf,
  attachRecords,
  bySegment,
  draftSource,
  passageRecordsOf,
  segmentsOfSites,
  versionSource,
  type EditionSource,
  type PassageRecords,
} from '../reader.ts';
import { labelOfSegments, siglaOrderOf } from '../../reader/sites.ts';
import { safeJoin } from '../images/safe-join.ts';
import { dataLicence, siteName } from '../settings.ts';
import type { Contributor } from '@varians/core';

const run = promisify(execFile);

/** The format the archive is written in, and where its schemas live (docs/formats/specification.md). */
export const FORMAT_VERSION = 2;
export const FORMAT_BASE = `https://varians.eu/formats/${FORMAT_VERSION}/`;

/** A record file's contents, its schema's address first. */
function record(schema: string, data: Record<string, unknown>): Record<string, unknown> {
  return { $schema: `${FORMAT_BASE}${schema}.schema.json`, ...data };
}

/** A list file's contents: the schema's address, then the list under its name. */
function list(schema: string, key: string, items: unknown[]): Record<string, unknown> {
  return record(schema, { [key]: items });
}

/** The id of a document's last applied changeset, up to a version. */
async function headOf(
  db: Database,
  kind: 'transcription' | 'edition',
  documentId: string,
  upTo: number | null,
): Promise<string | null> {
  const [row] = await db
    .select({ id: changesets.id })
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, documentId),
        upTo !== null ? lte(changesets.version, upTo) : undefined,
      ),
    )
    .orderBy(desc(changesets.version))
    .limit(1);
  return row?.id ?? null;
}

/** Options of an export; the archive uses the core exporters by default. */
export interface ArchiveWriters {
  tei?: boolean;
  /** The storage directory, so that uploaded originals are copied into the archive. */
  storageRoot?: string;
  /** Only the records one person may see, for a download; the server's own archive keeps everything. */
  only?: ArchiveFilter;
  /** The installation's address, which the TEI's record prefixes resolve to; ORIGIN by default. */
  origin?: string;
  /** Leave out the files for reading (edition.txt, edition.md, transcription.txt), which need the collation: for a record's JSON alone. */
  readable?: boolean;
}

/** The address the TEI's `tok:` and other prefixes resolve to. */
function originOf(writers: ArchiveWriters): string {
  return (writers.origin ?? process.env.ORIGIN ?? 'http://localhost').replace(/\/+$/u, '');
}

/** A transcription as an export decides by it: its row, and whether it has a version that is not withdrawn. */
export type ArchiveTranscription = typeof transcriptions.$inferSelect & { hasVersion: boolean };
/** An edition likewise. */
export type ArchiveEdition = typeof editions.$inferSelect & { hasVersion: boolean };

/** Which records an export takes. */
export interface ArchiveFilter {
  transcription(row: ArchiveTranscription): boolean;
  edition(row: ArchiveEdition): boolean;
  /** Whether the work's conjectures and reported readings are taken: they are everyone's, but a package of one transcript carries none. */
  records: boolean;
  /**
   * Whether the person sees an edition's draft; otherwise its directory holds
   * its latest version's files, its versions.json and versions/, and no
   * history, reviews or memory (specification 9.3), and an edition with no
   * version is left out.
   */
  editionWorking(row: ArchiveEdition): boolean;
  /** The same of a transcription. */
  transcriptionWorking(row: ArchiveTranscription): boolean;
}

/** Which parts of a work's archive to write. The work's own files are always written. */
export interface ArchivePlan {
  all?: boolean;
  /** Every edition of the work, for changes that reach the apparatus (conjectures, reported readings). */
  editionsAll?: boolean;
  witnesses?: Set<string>;
  transcriptions?: Set<string>;
  editions?: Set<string>;
  /** Write only these parts: no member whose directory is missing is filled in (for a record's JSON alone). */
  only?: boolean;
}

type WorkRow = typeof works.$inferSelect;
type WitnessRow = typeof witnesses.$inferSelect;
type TranscriptionRow = ArchiveTranscription;
type EditionRow = ArchiveEdition;
/** A version as the archive lists it: everything but its snapshot, which is read when its files are written. */
type VersionRow = Omit<Version, 'snapshot'>;
type SiglumRow = typeof editionSigla.$inferSelect;

/** What every writer of one work needs: the work, the records it holds, and where each goes. */
interface WorkContext {
  db: Database;
  work: WorkRow;
  scheme: typeof referenceSchemes.$inferSelect | null;
  dir: string;
  writers: ArchiveWriters;
  userNames: Map<string, string>;
  /** The person of each account (the same id, unless the account has none). */
  personOfUser: Map<string, string>;
  segmentRows: (typeof segments.$inferSelect)[];
  labelOf: Map<string, string>;
  /** The passage URN of each segment, where the work has a CTS URN. */
  urnOf: Map<string, string>;
  conjectureRows: (typeof conjectures.$inferSelect)[];
  reported: (typeof reportedReadings.$inferSelect)[];
  editionRows: EditionRow[];
  siglaRows: SiglumRow[];
  transcriptionRows: TranscriptionRow[];
  witnessRows: WitnessRow[];
  /** Paths relative to the work's directory. */
  witnessPath: Map<string, string>;
  transcriptionPath: Map<string, string>;
  editionPath: Map<string, string>;
  /** The versions of each transcription and edition written, by `kind:id`, in the order of their numbers. */
  versionRows: Map<string, VersionRow[]>;
}

/** Optional string fields of a row as the TEI exporter takes them: nulls left out. */
function defined<T extends Record<string, string | null | undefined>>(
  record: T,
): { [K in keyof T]?: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record))
    if (typeof value === 'string' && value !== '') out[key] = value;
  return out as { [K in keyof T]?: string };
}

/**
 * A slug as a folder name: a plain name of letters, digits, full stops,
 * hyphens and underscores, or else the record's id. Slugs made here are
 * always plain; one from an import is never trusted with a path.
 */
export function folderName(slug: string, id: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u.test(slug) && !slug.includes('..')
    ? slug
    : id.toLowerCase();
}

function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

/** The id a record file names, read from its first bytes: record files put the id near the top, and stream files are large. */
async function recordIdOf(file: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const match = /"id":\s*"([^"]+)"/u.exec(buffer.subarray(0, bytesRead).toString('utf8'));
    return match ? match[1]! : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true, force: true });
  } catch {
    // Not there.
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Load the work and decide which records its archive holds and where. */
async function loadWorkContext(
  db: Database,
  workId: string,
  root: string,
  writers: ArchiveWriters,
): Promise<WorkContext> {
  const [work] = await db.select().from(works).where(eq(works.id, workId));
  if (!work) throw new Error(`no work ${workId}`);
  const [scheme] = await db
    .select()
    .from(referenceSchemes)
    .where(eq(referenceSchemes.id, work.schemeId));
  const only = writers.only;
  const userRows = await db.select({ id: users.id, name: users.name }).from(users);
  const userNames = new Map(userRows.map((u) => [u.id, u.name] as const));
  const accountPersons = await db
    .select({ id: persons.id, userId: persons.userId })
    .from(persons)
    .where(isNotNull(persons.userId));
  const personOfUser = new Map(accountPersons.map((p) => [p.userId!, p.id] as const));
  const segmentRows = await db
    .select()
    .from(segments)
    .where(eq(segments.workId, workId))
    .orderBy(segments.sortKey);
  const labelOf = new Map(segmentRows.map((s) => [s.id, s.label] as const));
  const urnOf = new Map<string, string>();
  for (const s of segmentRows) {
    const urn = passageUrn(work.identifier, s.address, scheme?.levels ?? []);
    if (urn) urnOf.set(s.id, urn);
  }
  // The work's conjectures and reported readings are public records; a package of one transcript leaves them out.
  const withRecords = !only || only.records;
  const conjectureRows = withRecords
    ? await db
        .select()
        .from(conjectures)
        .where(eq(conjectures.workId, workId))
        .orderBy(asc(conjectures.id))
    : [];
  const reported = withRecords
    ? await db
        .select()
        .from(reportedReadings)
        .where(eq(reportedReadings.workId, workId))
        .orderBy(asc(reportedReadings.id))
    : [];

  // An edition someone may not edit is in their export only by its versions.
  const editionRows = (
    await db
      .select({ row: editions, hasVersion: hasVersionSql('edition', editions.id) })
      .from(editions)
      .where(eq(editions.workId, workId))
      .orderBy(asc(editions.id))
  )
    .map((e) => ({ ...e.row, hasVersion: e.hasVersion }))
    .filter((e) => (!only || only.edition(e)) && (!only || only.editionWorking(e) || e.hasVersion));
  const siglaRows = editionRows.length
    ? await db
        .select()
        .from(editionSigla)
        .where(
          inArray(
            editionSigla.editionId,
            editionRows.map((e) => e.id),
          ),
        )
    : [];
  // Transcriptions connected to the work: assigning text to it, or named by a conspectus.
  const assigning = await db
    .selectDistinct({ transcriptionId: transcriptionSegments.transcriptionId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId));
  const transcriptionIds = new Set<string>([
    ...assigning.map((a) => a.transcriptionId),
    ...siglaRows.map((s) => s.transcriptionId).filter((id): id is string => id !== null),
  ]);
  const transcriptionRows = (
    transcriptionIds.size
      ? await db
          .select({
            row: transcriptions,
            hasVersion: hasVersionSql('transcription', transcriptions.id),
          })
          .from(transcriptions)
          .where(inArray(transcriptions.id, [...transcriptionIds]))
      : []
  )
    .map((t) => ({ ...t.row, hasVersion: t.hasVersion }))
    .filter(
      (t) =>
        (!only || only.transcription(t)) && (!only || only.transcriptionWorking(t) || t.hasVersion),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const witnessIds = new Set<string>([
    ...transcriptionRows.map((t) => t.witnessId),
    ...siglaRows.map((s) => s.witnessId),
    ...reported.map((r) => r.witnessId),
  ]);
  const witnessRows = (
    witnessIds.size
      ? await db
          .select()
          .from(witnesses)
          .where(inArray(witnesses.id, [...witnessIds]))
      : []
  ).sort((a, b) => a.slug.localeCompare(b.slug));

  const witnessPath = new Map(
    witnessRows.map((w) => [w.id, path.join('witnesses', folderName(w.slug, w.id))] as const),
  );
  const transcriptionPath = new Map<string, string>();
  const taken = new Set<string>();
  for (const t of transcriptionRows) {
    const base = path.join(witnessPath.get(t.witnessId)!, 'transcriptions', slugify(t.name));
    const target = taken.has(base) ? `${base}-${t.id.slice(-6).toLowerCase()}` : base;
    taken.add(target);
    transcriptionPath.set(t.id, target);
  }
  const editionPath = new Map(
    editionRows.map((e) => [e.id, path.join('editions', folderName(e.slug, e.id))] as const),
  );
  const documentIds = [...transcriptionRows.map((t) => t.id), ...editionRows.map((e) => e.id)];
  const { snapshot: _snapshot, ...versionColumns } = getTableColumns(versions);
  const versionRows = new Map<string, VersionRow[]>();
  if (documentIds.length)
    for (const v of await db
      .select(versionColumns)
      .from(versions)
      .where(inArray(versions.documentId, documentIds))
      .orderBy(asc(versions.number))) {
      const key = `${v.documentKind}:${v.documentId}`;
      versionRows.set(key, [...(versionRows.get(key) ?? []), v]);
    }
  return {
    db,
    work,
    scheme: scheme ?? null,
    dir: path.join(root, folderName(work.slug, work.id)),
    writers,
    userNames,
    personOfUser,
    segmentRows,
    labelOf,
    urnOf,
    conjectureRows,
    reported,
    editionRows,
    siglaRows,
    transcriptionRows,
    witnessRows,
    witnessPath,
    transcriptionPath,
    editionPath,
    versionRows,
  };
}

/**
 * Remove the directories of records that no longer belong to the work, or
 * that belong at another path now (a renamed witness, transcription or
 * edition). Returns the ids of member records whose directory is missing,
 * which the caller must write.
 */
async function pruneArchive(
  ctx: WorkContext,
): Promise<{ witnesses: Set<string>; transcriptions: Set<string>; editions: Set<string> }> {
  const missing = {
    witnesses: new Set<string>(),
    transcriptions: new Set<string>(),
    editions: new Set<string>(),
  };
  const present = {
    witnesses: new Set<string>(),
    transcriptions: new Set<string>(),
    editions: new Set<string>(),
  };
  const expectedAt = (map: Map<string, string>, id: string | null, at: string) =>
    id !== null && map.get(id) === at;
  for (const name of await subdirs(path.join(ctx.dir, 'witnesses'))) {
    const rel = path.join('witnesses', name);
    const id = await recordIdOf(path.join(ctx.dir, rel, 'witness.json'));
    if (!expectedAt(ctx.witnessPath, id, rel)) {
      await rm(path.join(ctx.dir, rel), { recursive: true, force: true });
      continue;
    }
    present.witnesses.add(id!);
    for (const tname of await subdirs(path.join(ctx.dir, rel, 'transcriptions'))) {
      const trel = path.join(rel, 'transcriptions', tname);
      const tid = await recordIdOf(path.join(ctx.dir, trel, 'transcription.json'));
      if (!expectedAt(ctx.transcriptionPath, tid, trel))
        await rm(path.join(ctx.dir, trel), { recursive: true, force: true });
      else present.transcriptions.add(tid!);
    }
  }
  for (const name of await subdirs(path.join(ctx.dir, 'editions'))) {
    const rel = path.join('editions', name);
    const id = await recordIdOf(path.join(ctx.dir, rel, 'edition.json'));
    if (!expectedAt(ctx.editionPath, id, rel))
      await rm(path.join(ctx.dir, rel), { recursive: true, force: true });
    else present.editions.add(id!);
  }
  // Folders left empty go as well, so that the layout is the same as a write into an empty directory.
  for (const name of await subdirs(path.join(ctx.dir, 'witnesses')))
    await removeIfEmpty(path.join(ctx.dir, 'witnesses', name, 'transcriptions'));
  await removeIfEmpty(path.join(ctx.dir, 'witnesses'));
  await removeIfEmpty(path.join(ctx.dir, 'editions'));
  for (const id of ctx.witnessPath.keys())
    if (!present.witnesses.has(id)) missing.witnesses.add(id);
  for (const id of ctx.transcriptionPath.keys())
    if (!present.transcriptions.has(id)) missing.transcriptions.add(id);
  for (const id of ctx.editionPath.keys()) if (!present.editions.has(id)) missing.editions.add(id);
  return missing;
}

async function historyFiles(
  ctx: WorkContext,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
  upTo: number | null = null,
): Promise<void> {
  const { db, userNames } = ctx;
  const rows = await db
    .select()
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, documentId),
        upTo !== null ? lte(changesets.version, upTo) : undefined,
      ),
    )
    .orderBy(asc(changesets.version), asc(changesets.at), asc(changesets.id));
  void userNames;
  const lines = rows.map((c) =>
    JSON.stringify({
      id: c.id,
      parentId: c.parentId,
      ...(c.merged ? { merged: c.merged } : {}),
      version: c.version,
      personId: c.personId,
      at: c.at.toISOString(),
      ops: c.ops,
      reverse: c.reverse,
      message: c.message ?? null,
    }),
  );
  await writeText(path.join(dir, 'history.ndjson'), lines.join('\n') + (lines.length ? '\n' : ''));
  const named = await db
    .select()
    .from(moments)
    .where(
      and(
        eq(moments.documentKind, kind),
        eq(moments.documentId, documentId),
        upTo !== null ? lte(moments.version, upTo) : undefined,
      ),
    )
    .orderBy(asc(moments.version), asc(moments.at), asc(moments.id));
  await writeJson(
    path.join(dir, 'moments.json'),
    list(
      'moments',
      'moments',
      named.map((m) => ({
        id: m.id,
        version: m.version,
        name: m.name,
        kind: m.kind,
        personId: m.personId,
        at: m.at.toISOString(),
      })),
    ),
  );
}

/** Each person's review position on a document: process state, kept in the server's archive and left out of exports for others. */
async function reviewStates(
  ctx: WorkContext,
  kind: 'transcription' | 'edition',
  documentId: string,
) {
  if (ctx.writers.only) return [];
  const rows = await ctx.db
    .select()
    .from(reviewState)
    .where(and(eq(reviewState.documentKind, kind), eq(reviewState.documentId, documentId)))
    .orderBy(asc(reviewState.userId));
  return rows.map((r) => ({
    personId: personOf(ctx, r.userId),
    fromVersion: r.fromVersion,
    accepted: r.accepted,
  }));
}

/** The work's own files: work.json, segments, conjectures, reported readings, bibliography, citations, and the format notes. */
async function writeWorkFiles(ctx: WorkContext): Promise<void> {
  const { db, work, scheme, dir, userNames, labelOf, conjectureRows, reported } = ctx;
  await mkdir(dir, { recursive: true });
  const maintainerRows = await db
    .select()
    .from(workMaintainers)
    .where(eq(workMaintainers.workId, work.id))
    .orderBy(asc(workMaintainers.userId));
  await writeJson(
    path.join(dir, 'work.json'),
    record('work', {
      formatVersion: FORMAT_VERSION,
      id: work.id,
      slug: work.slug,
      title: work.title,
      author: work.author,
      identifier: work.identifier,
      description: work.description,
      scheme: scheme
        ? {
            id: scheme.id,
            name: scheme.name,
            levels: scheme.levels,
            createdBy: scheme.createdBy,
            createdAt: iso(scheme.createdAt),
          }
        : null,
      licence: dataLicence(),
      maintainers: maintainerRows.map((m) => ({
        id: m.userId,
        name: userNames.get(m.userId) ?? null,
        since: iso(m.createdAt),
      })),
      mergedIds: await mergedIdsOf(db, work.id),
      createdBy: work.createdBy,
      createdAt: iso(work.createdAt),
    }),
  );
  await writeJson(
    path.join(dir, 'persons.json'),
    list('persons', 'persons', await personsOfWork(ctx)),
  );
  await writeText(
    path.join(dir, 'segments.tsv'),
    [
      'id\tlabel\tsort_key\taddress\turn\tcreated_at',
      ...ctx.segmentRows.map((s) =>
        [
          s.id,
          s.label,
          s.sortKey,
          JSON.stringify(s.address),
          ctx.urnOf.get(s.id) ?? '',
          iso(s.createdAt),
        ].join('\t'),
      ),
    ].join('\n') + '\n',
  );
  // A conjecture entered in an edition's editor names that edition and its words. The conjecture is public, but a draft
  // edition is not: an export for someone who may not see the edition names neither it nor a transcript they may not see.
  const shownAnchor = (anchor: (typeof conjectureRows)[number]['anchor']) => {
    if (!anchor || !ctx.writers.only) return anchor;
    const known =
      'editionId' in anchor
        ? ctx.editionRows.some((e) => e.id === anchor.editionId)
        : ctx.transcriptionRows.some((t) => t.id === anchor.transcriptionId);
    return known ? anchor : null;
  };
  await writeJson(
    path.join(dir, 'conjectures.json'),
    list(
      'conjectures',
      'conjectures',
      conjectureRows.map((c) => ({
        ...c,
        anchor: shownAnchor(c.anchor),
        segmentLabel: labelOf.get(c.segmentId) ?? null,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      })),
    ),
  );
  await writeJson(
    path.join(dir, 'reported-readings.json'),
    list(
      'reported-readings',
      'readings',
      reported.map((r) => ({
        ...r,
        segmentLabel: labelOf.get(r.segmentId) ?? null,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
    ),
  );

  const all = await citationsOfWork(db, work.id);
  // An export for one person keeps the citations of what it holds, and the entries they cite.
  const shown = {
    conjectures: new Set(conjectureRows.map((c) => c.id)),
    reported: new Set(reported.map((r) => r.id)),
    editions: new Set(ctx.editionRows.map((e) => e.id)),
  };
  const citationRows = (
    ctx.writers.only
      ? all.citations.filter(
          (c) =>
            (!c.conjectureId || shown.conjectures.has(c.conjectureId)) &&
            (!c.reportedReadingId || shown.reported.has(c.reportedReadingId)) &&
            (!c.editionId || shown.editions.has(c.editionId)),
        )
      : all.citations
  ).sort((a, b) => a.id.localeCompare(b.id));
  const citedIds = new Set(citationRows.map((c) => c.itemId));
  const items = all.items
    .filter((i) => citedIds.has(i.id))
    .sort((a, b) => a.citationKey.localeCompare(b.citationKey));
  await writeText(
    path.join(dir, 'bibliography.bib'),
    serializeBiblatex(
      items.map((r) => ({ type: r.entryType, key: r.citationKey, fields: r.fields })),
    ),
  );
  await writeJson(
    path.join(dir, 'bibliography.json'),
    list(
      'bibliography',
      'items',
      items.map((i) => ({ ...i, createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt) })),
    ),
  );
  await writeJson(
    path.join(dir, 'citations.json'),
    list(
      'citations',
      'citations',
      citationRows.map((c) => ({ ...c, createdAt: iso(c.createdAt) })),
    ),
  );
  await writeFormatNotes(dir);
  await writeText(path.join(dir, 'LICENSE.md'), licenceNotes(ctx));
}

/** The TEI's licence statement: the licence by name with its address, and the note on rights. */
function teiRights(
  licenceId: string | null,
  rightsNote: string | null,
): { licence?: string; licenceUrl?: string; rightsNote?: string; authority: string } {
  const info = licenceInfo(licenceId);
  return {
    ...(info ? { licence: info.name, licenceUrl: info.url } : {}),
    ...(rightsNote ? { rightsNote } : {}),
    authority: siteName(),
  };
}

/**
 * The persons responsible for a document, for its TEI header:
 * those whose changesets made its text, and those who wrote its notes.
 */
async function contributorsOf(
  ctx: WorkContext,
  kind: 'transcription' | 'edition',
  documentId: string,
  upTo: number | null,
  /** For a version of an edition: the persons of its notes, as its snapshot has them. */
  notePersons?: (string | null)[],
): Promise<Contributor[]> {
  const { db } = ctx;
  const authors = await db
    .selectDistinct({ id: persons.id, name: persons.name, orcid: persons.orcid })
    .from(changesets)
    .innerJoin(persons, eq(persons.id, changesets.personId))
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, documentId),
        isNotNull(changesets.version),
        upTo !== null ? lte(changesets.version, upTo) : undefined,
      ),
    )
    .orderBy(asc(persons.name), asc(persons.id));
  const out: Contributor[] = authors.map((p) => ({
    name: p.name,
    resp: kind,
    personId: p.id,
    ...(p.orcid ? { orcid: p.orcid } : {}),
  }));
  if (kind === 'edition') {
    const fixed = notePersons?.filter((id): id is string => !!id);
    const noteAuthors =
      fixed && fixed.length === 0
        ? []
        : await db
            .selectDistinct({ id: persons.id, name: persons.name, orcid: persons.orcid })
            .from(persons)
            .where(
              fixed
                ? inArray(persons.id, fixed)
                : inArray(
                    persons.id,
                    db
                      .select({ id: notes.personId })
                      .from(notes)
                      .where(and(eq(notes.editionId, documentId), isNotNull(notes.personId))),
                  ),
            )
            .orderBy(asc(persons.name), asc(persons.id));
    out.push(
      ...noteAuthors.map((p) => ({
        name: p.name,
        resp: 'notes',
        personId: p.id,
        ...(p.orcid ? { orcid: p.orcid } : {}),
      })),
    );
  }
  return out;
}

/** LICENSE.md: the licence of each kind of file in the archive (Data Format 2, 10.1). */
function licenceNotes(ctx: WorkContext): string {
  const work = licenceInfo(dataLicence())!;
  const used = new Set(
    [
      ...ctx.transcriptionRows.map((t) => t.licenceId),
      ...ctx.editionRows.map((e) => e.licenceId),
    ].filter((id): id is string => !!id),
  );
  const named = [...used]
    .map((id) => licenceInfo(id))
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const registry = licenceInfo(REGISTRY_LICENCE)!;
  return [
    `# Licences of the files in this archive`,
    '',
    `Written by ${siteName()}. The records are licensed by the people who made them, on the terms of contribution of the installation that published them.`,
    '',
    `- **Transcriptions and editions** (transcription.json, edition.json and the files beside them): the licence each names in \`licence\`, fixed when it was first published${named.length ? `: ${named.map((l) => `${l.name} (<${l.url}>)`).join(', ')}` : ''}. One whose \`licence\` is null has not been published under a licence; \`rightsNote\` adds what its maker says about rights.`,
    `- **Conjectures, reported readings and notes**: ${work.name} (<${work.url}>), the licence of the installation's records, named in \`licence\` in work.json.`,
    `- **The registry** (work.json, segments.tsv, witness.json, pages.json, persons.json, bibliography.json, bibliography.bib, citations.json): ${registry.name} (<${registry.url}>).`,
    `- **Images** (witnesses/*/images): each under the rights statement \`rights\` in pages.json, with the credit line \`attribution\` where the rights holder asks for one. Only images whose statement allows copying are in the archive; the others are named by their source.`,
    `- **The format's documents** (README.md, tei-subset.md): CC BY 4.0; **the schemas** (schemas/): BSD-2-Clause. See <https://varians.eu/formats/2/>.`,
    '',
  ].join('\n');
}

/** The archive's README, the TEI notes and the schemas, from docs/formats. */
async function writeFormatNotes(dir: string): Promise<void> {
  const formats = formatsDir();
  if (!formats)
    console.warn('docs/formats not found: the archive gets no README, TEI notes or schemas');
  const readme = formats
    ? await readFile(path.join(formats, 'README.md'), 'utf8').catch(() => null)
    : null;
  await writeText(path.join(dir, 'README.md'), readme ?? '# Varians archive\n');
  const teiDoc = formats
    ? await readFile(path.join(formats, 'tei-subset.md'), 'utf8').catch(() => null)
    : null;
  if (teiDoc) await writeText(path.join(dir, 'tei-subset.md'), teiDoc);
  if (formats) {
    try {
      const schemaDir = path.join(formats, 'schemas');
      for (const name of await readdir(schemaDir)) {
        if (name.endsWith('.json'))
          await writeText(
            path.join(dir, 'schemas', name),
            await readFile(path.join(schemaDir, name), 'utf8'),
          );
      }
    } catch {
      // Schemas are documentation; an archive without them is still complete.
    }
  }
}

/** Copy a file unless the target already has the same size; returns whether the target now exists. */
async function syncFile(from: string, to: string): Promise<boolean> {
  try {
    const source = await stat(from);
    const target = await stat(to).catch(() => null);
    if (!target || target.size !== source.size) {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
    return true;
  } catch {
    // A missing original is left out of the archive rather than failing the whole export.
    return false;
  }
}

/** A witness's own files: witness.json, pages.json and the uploaded images. Its transcriptions are written apart. */
async function writeWitnessFiles(ctx: WorkContext, witness: WitnessRow): Promise<void> {
  const { db, writers, userNames } = ctx;
  const wdir = path.join(ctx.dir, ctx.witnessPath.get(witness.id)!);
  const maintainerRows = await db
    .select()
    .from(witnessMaintainers)
    .where(eq(witnessMaintainers.witnessId, witness.id))
    .orderBy(asc(witnessMaintainers.userId));
  await writeJson(
    path.join(wdir, 'witness.json'),
    record('witness', {
      ...witness,
      maintainers: maintainerRows.map((m) => ({
        id: m.userId,
        name: userNames.get(m.userId) ?? null,
        since: iso(m.createdAt),
      })),
      mergedIds: await mergedIdsOf(db, witness.id),
      createdAt: iso(witness.createdAt),
      updatedAt: iso(witness.updatedAt),
    }),
  );
  const pageRows = await db
    .select()
    .from(pages)
    .where(eq(pages.witnessId, witness.id))
    .orderBy(pages.position, pages.id);
  const imageFiles = new Map<string, string>();
  const imagesDir = path.join(wdir, 'images');
  if (writers.storageRoot) {
    for (const p of pageRows) {
      // Only an image whose rights statement allows copying goes into the archive.
      if (p.imageKind !== 'upload' || !p.imagePath || !isCopyable(p.rights)) continue;
      const ext = path.extname(p.imagePath) || '.jpg';
      const target = path.join('images', `${slugify(p.label)}-${p.id.slice(-6)}${ext}`);
      let source: string;
      try {
        source = safeJoin(writers.storageRoot, p.imagePath);
      } catch {
        continue;
      }
      if (await syncFile(source, path.join(wdir, target))) imageFiles.set(p.id, target);
    }
  }
  // Images of pages that are gone or renamed go too.
  const kept = new Set([...imageFiles.values()].map((f) => path.basename(f)));
  try {
    for (const name of await readdir(imagesDir))
      if (!kept.has(name)) await rm(path.join(imagesDir, name), { force: true });
    if (kept.size === 0) await rm(imagesDir, { recursive: true, force: true });
  } catch {
    // No images directory.
  }
  await writeJson(
    path.join(wdir, 'pages.json'),
    list(
      'pages',
      'pages',
      pageRows.map((p) => ({
        id: p.id,
        label: p.label,
        position: p.position,
        image: p.imageKind
          ? {
              kind: p.imageKind,
              path: p.imagePath,
              file: imageFiles.get(p.id) ?? null,
              iiif: p.imageIiif,
              width: p.imageWidth,
              height: p.imageHeight,
              tiles: p.tilesPath,
              rights: p.rights,
              attribution: p.attribution,
              source: p.imageSource,
            }
          : null,
        createdAt: iso(p.createdAt),
      })),
    ),
  );
}

/** Whether the archive holds a transcription's draft, or only its versions. */
function transcriptionWorking(ctx: WorkContext, t: TranscriptionRow): boolean {
  return !ctx.writers.only || ctx.writers.only.transcriptionWorking(t);
}

/** Whether the archive holds an edition's draft, or only its versions. */
function editionWorking(ctx: WorkContext, e: EditionRow): boolean {
  return !ctx.writers.only || ctx.writers.only.editionWorking(e);
}

/** The latest version of a record that is not withdrawn, as the archive lists it. */
function latestOf(
  ctx: WorkContext,
  kind: 'transcription' | 'edition',
  id: string,
): VersionRow | null {
  const list = ctx.versionRows.get(`${kind}:${id}`) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (!list[i]!.withdrawnAt) return list[i]!;
  return null;
}

/**
 * Empty a record's directory for it to be written afresh, but for its
 * versions: a version's directory is written once and never again.
 */
async function clearRecordDir(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries)
    if (name !== 'versions') await rm(path.join(dir, name), { recursive: true, force: true });
}

/**
 * versions.json, and the directory of each version not yet written. A
 * withdrawal writes versions.json again and leaves the version's directory
 * as it is; the directory of a version that has been deleted is removed.
 */
async function writeVersionFiles(
  ctx: WorkContext,
  dir: string,
  kind: 'transcription' | 'edition',
  id: string,
  write: (dir: string, version: Version) => Promise<void>,
): Promise<void> {
  const rows = ctx.versionRows.get(`${kind}:${id}`) ?? [];
  const numbers = new Set(rows.map((v) => String(v.number)));
  const written = await readdir(path.join(dir, 'versions')).catch(() => [] as string[]);
  for (const name of written)
    if (!numbers.has(name))
      await rm(path.join(dir, 'versions', name), { recursive: true, force: true });
  if (rows.length === 0) {
    await rm(path.join(dir, 'versions.json'), { force: true });
    await rm(path.join(dir, 'versions'), { recursive: true, force: true });
    return;
  }
  await writeJson(
    path.join(dir, 'versions.json'),
    list(
      'versions',
      'versions',
      rows.map((v) => ({
        id: v.id,
        number: v.number,
        version: v.version,
        momentId: v.momentId,
        note: v.note,
        personId: v.personId,
        at: v.at.toISOString(),
        withdrawn: v.withdrawnAt
          ? { at: v.withdrawnAt.toISOString(), personId: v.withdrawnBy, note: v.withdrawalNote }
          : null,
      })),
    ),
  );
  for (const v of rows) {
    const vdir = path.join(dir, 'versions', String(v.number));
    if (existsSync(vdir)) continue;
    const full = await versionByNumber(ctx.db, kind, id, v.number);
    if (full) await write(vdir, full);
  }
}

/** The fields of a transcription that its files give, from its row or from a version's snapshot. */
interface TranscriptionState {
  id: string;
  name: string;
  witnessId: string;
  ownerId: string;
  version: number;
  keepsWrittenForm: boolean;
  displayAsWritten: boolean;
  description: string | null;
  sources: string | null;
  licenceId: string | null;
  rightsNote: string | null;
  createdAt: Date;
  content: TranscriptionSnapshot['content'];
  zones: TranscriptionSnapshot['zones'];
}

/** A transcription's state at a version, from its snapshot. */
function transcriptionAtVersion(t: TranscriptionRow, version: Version): TranscriptionState {
  const snapshot = version.snapshot as TranscriptionSnapshot;
  return {
    id: t.id,
    name: snapshot.name,
    witnessId: snapshot.witnessId,
    ownerId: t.ownerId,
    version: version.version,
    keepsWrittenForm: snapshot.keepsWrittenForm,
    displayAsWritten: snapshot.displayAsWritten,
    description: snapshot.description,
    sources: snapshot.sources,
    licenceId: snapshot.licenceId,
    rightsNote: snapshot.rightsNote,
    createdAt: t.createdAt,
    content: snapshot.content,
    zones: snapshot.zones,
  };
}

/** transcription.json, zones.json, the read text and the TEI of a transcription in one state. */
async function transcriptionStateFiles(
  ctx: WorkContext,
  dir: string,
  t: TranscriptionState,
  upTo: number | null,
  readable: boolean,
): Promise<void> {
  const { db, work, writers, userNames, labelOf } = ctx;
  const witness = ctx.witnessRows.find((w) => w.id === t.witnessId)!;
  await writeJson(
    path.join(dir, 'transcription.json'),
    record('transcription', {
      id: t.id,
      name: t.name,
      witnessId: t.witnessId,
      ownerId: t.ownerId,
      ownerName: userNames.get(t.ownerId) ?? null,
      version: t.version,
      head: await headOf(db, 'transcription', t.id, upTo),
      keepsWrittenForm: t.keepsWrittenForm,
      displayAsWritten: t.displayAsWritten,
      description: t.description,
      sources: t.sources,
      licence: t.licenceId,
      rightsNote: t.rightsNote,
      createdAt: iso(t.createdAt),
      content: t.content,
    }),
  );
  await writeJson(
    path.join(dir, 'zones.json'),
    list(
      'zones',
      'zones',
      t.zones.map((z) => ({
        id: z.id,
        pageId: z.pageId,
        tokenIds: z.tokenIds,
        geometry: z.geometry,
        feature: z.feature,
        createdAt: z.createdAt,
      })),
    ),
  );
  if (readable && writers.readable !== false)
    await writeText(
      path.join(dir, 'transcription.txt'),
      toText(t.content, { form: 'read' }) + '\n',
    );
  if (writers.tei === false) return;
  const pageRows = await db
    .select()
    .from(pages)
    .where(eq(pages.witnessId, witness.id))
    .orderBy(pages.position, pages.id);
  const segmentLabels: Record<string, string> = {};
  for (const [id, label] of labelOf) segmentLabels[id] = label;
  await writeText(
    path.join(dir, 'transcription.tei.xml'),
    exportTranscriptionTei({
      stream: t.content,
      title: `${work.title}: ${witness.name}, ${t.name}`,
      ...(t.sources ? { sources: t.sources } : {}),
      ...teiRights(t.licenceId, t.rightsNote),
      contributors: await contributorsOf(ctx, 'transcription', t.id, upTo),
      witness: {
        ...defined({
          siglum: witness.siglum,
          name: witness.name,
          repository: witness.repository,
          settlement: witness.settlement,
          idno: witness.shelfmark,
          date: witness.dateText,
          material: materialLabel(witness.material),
          extent: witness.extent,
          description: witness.description,
        }),
        ...(witness.hands.length ? { hands: exportHands(witness.hands) } : {}),
        ...(teiForm(witness) ? { form: teiForm(witness)! } : {}),
      },
      pages: pageRows.map((p) => ({
        id: p.id,
        label: p.label,
        ...(p.imageIiif
          ? { imageUrl: `${p.imageIiif}/full/max/0/default.jpg` }
          : p.imagePath
            ? { imageUrl: p.imagePath }
            : {}),
        ...(p.imageWidth ? { width: p.imageWidth } : {}),
        ...(p.imageHeight ? { height: p.imageHeight } : {}),
      })),
      zones: t.zones.map((z) => ({
        id: z.id,
        pageId: z.pageId,
        tokenIds: z.tokenIds,
        geometry: z.geometry,
      })),
      segmentLabels,
      words: true,
      regularizations: true,
      origin: originOf(writers),
    }),
  );
}

/**
 * One transcription's directory, written afresh but for the versions already
 * written: its draft, with its history, memory and reviews; or, for one who
 * may not edit it, its latest version's files and no history. Then its
 * versions.
 */
async function writeTranscriptionFiles(ctx: WorkContext, t: TranscriptionRow): Promise<void> {
  const { db } = ctx;
  const tdir = path.join(ctx.dir, ctx.transcriptionPath.get(t.id)!);
  await clearRecordDir(tdir);
  await mkdir(tdir, { recursive: true });
  if (transcriptionWorking(ctx, t)) {
    const zoneRows = await db
      .select()
      .from(zones)
      .where(eq(zones.transcriptionId, t.id))
      .orderBy(asc(zones.id));
    await transcriptionStateFiles(
      ctx,
      tdir,
      {
        ...t,
        zones: zoneRows.map((z) => ({
          id: z.id,
          pageId: z.pageId,
          tokenIds: z.tokenIds,
          geometry: z.geometry,
          feature: z.feature,
          createdAt: iso(z.createdAt)!,
        })),
      },
      null,
      true,
    );
    await writeJson(path.join(tdir, 'memory.json'), list('memory', 'entries', t.memory));
    const states = await reviewStates(ctx, 'transcription', t.id);
    if (states.length)
      await writeJson(path.join(tdir, 'reviews.json'), record('reviews', { states }));
    await historyFiles(ctx, tdir, 'transcription', t.id);
  } else {
    const latest = latestOf(ctx, 'transcription', t.id);
    const full = latest ? await versionByNumber(db, 'transcription', t.id, latest.number) : null;
    if (full) {
      await transcriptionStateFiles(ctx, tdir, transcriptionAtVersion(t, full), full.version, true);
      await publishedMoments(ctx, tdir, 'transcription', t.id);
    }
  }
  await writeVersionFiles(ctx, tdir, 'transcription', t.id, (dir, version) =>
    transcriptionStateFiles(ctx, dir, transcriptionAtVersion(t, version), version.version, false),
  );
}

/**
 * moments.json with the published moments alone, for one who may not edit
 * the record: the moments that mark its versions, the editors' bookmarks
 * being part of the draft.
 */
async function publishedMoments(
  ctx: WorkContext,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(moments)
    .where(
      and(
        eq(moments.documentKind, kind),
        eq(moments.documentId, documentId),
        eq(moments.kind, 'published'),
      ),
    )
    .orderBy(asc(moments.version), asc(moments.at), asc(moments.id));
  const listed = new Set(
    (ctx.versionRows.get(`${kind}:${documentId}`) ?? []).map((v) => v.momentId),
  );
  await writeJson(
    path.join(dir, 'moments.json'),
    list(
      'moments',
      'moments',
      rows
        .filter((m) => listed.has(m.id))
        .map((m) => ({
          id: m.id,
          version: m.version,
          name: m.name,
          kind: m.kind,
          personId: m.personId,
          at: m.at.toISOString(),
        })),
    ),
  );
}

/**
 * edition.json, the plain text, the Markdown and the TEI of an edition read
 * from a source: its draft, or a version from its snapshot, whose
 * edition.json has besides the transcription versions it compares, the
 * records it shows and the alignment constraints (specification 4.12).
 */
async function editionSourceFiles(
  ctx: WorkContext,
  dir: string,
  edition: EditionRow,
  source: EditionSource,
): Promise<void> {
  const { db, writers, userNames, labelOf } = ctx;
  const snapshot = source.version ? (source.version.snapshot as EditionSnapshot) : null;
  const meta = source.meta;
  const upTo = source.version?.version ?? null;
  const sigla = snapshot
    ? snapshot.sigla
    : ctx.siglaRows
        .filter((s) => s.editionId === edition.id)
        .sort((a, b) => a.position - b.position);
  const adoptions = snapshot
    ? snapshot.adoptions
    : (
        await db
          .select()
          .from(editionAdoptions)
          .where(eq(editionAdoptions.editionId, edition.id))
          .orderBy(asc(editionAdoptions.conjectureId))
      ).map((a) => ({ conjectureId: a.conjectureId, at: iso(a.createdAt) }));
  const noteRows = snapshot
    ? snapshot.notes
    : (
        await db.select().from(notes).where(eq(notes.editionId, edition.id)).orderBy(asc(notes.id))
      ).map((n) => ({ ...n, createdAt: iso(n.createdAt) }));
  const kindRows = snapshot
    ? snapshot.siteKinds
    : (await db.select().from(editionSiteKinds).where(eq(editionSiteKinds.editionId, edition.id)))
        .map((k) => ({
          segmentId: k.segmentId,
          siteKey: k.siteKey,
          ...(k.kind ? { kind: k.kind } : {}),
          ...(k.minor ? { minor: true as const } : {}),
          personId: personOf(ctx, k.setBy),
          setAt: iso(k.setAt),
        }))
        .sort(
          (a, b) => a.segmentId.localeCompare(b.segmentId) || a.siteKey.localeCompare(b.siteKey),
        );
  const collaboratorRows = snapshot
    ? []
    : await db
        .select()
        .from(editionCollaborators)
        .where(eq(editionCollaborators.editionId, edition.id))
        .orderBy(asc(editionCollaborators.userId));
  await writeJson(
    path.join(dir, 'edition.json'),
    record('edition', {
      id: edition.id,
      slug: edition.slug,
      title: meta.title,
      editors: meta.editors,
      preface: meta.preface,
      ownerId: edition.ownerId,
      ownerName: userNames.get(edition.ownerId) ?? null,
      version: source.context.edition.version,
      head: await headOf(db, 'edition', edition.id, upTo),
      conventions: withoutLatin(meta.conventions),
      copiedFrom: meta.copiedFrom,
      sources: meta.sources,
      licence: meta.licenceId,
      rightsNote: meta.rightsNote,
      createdAt: iso(edition.createdAt),
      sigla: sigla.map((s) => ({
        siglum: s.siglum,
        witnessId: s.witnessId,
        transcriptionId: s.transcriptionId,
        states: s.states,
        variantSiglum: s.variantSiglum,
      })),
      adoptions,
      collaborators: collaboratorRows.map((c) => ({
        personId: personOf(ctx, c.userId),
        grantedBy: personOf(ctx, c.grantedBy),
        since: iso(c.createdAt),
      })),
      notes: noteRows.map((n) => ({
        id: n.id,
        segmentId: n.segmentId,
        segmentLabel: labelOf.get(n.segmentId) ?? null,
        tokenIds: n.tokenIds,
        text: n.text,
        personId: n.personId,
        createdAt: n.createdAt,
      })),
      siteKinds: kindRows,
      content: source.context.edition.content,
      ...(snapshot
        ? {
            witnessVersions: snapshot.witnessVersions,
            conjectures: snapshot.conjectures.map((c) => ({
              ...c,
              segmentLabel: labelOf.get(c.segmentId) ?? null,
            })),
            readings: snapshot.readings.map((r) => ({
              ...r,
              segmentLabel: labelOf.get(r.segmentId) ?? null,
            })),
            citations: snapshot.citations,
            bibliography: snapshot.bibliography,
            constraints: snapshot.constraints,
          }
        : {}),
    }),
  );
  if (writers.readable === false && writers.tei === false) return;
  // The conjectures and reported readings laid at the variants: those of the version, or those the archive holds.
  const ownSiglum = new Map(ctx.witnessRows.map((w) => [w.id, w.siglum] as const));
  const siglumOf = (witnessId: string) =>
    sigla.find((s) => s.witnessId === witnessId)?.siglum ?? ownSiglum.get(witnessId) ?? '?';
  const records: PassageRecords = snapshot
    ? await passageRecordsOf(
        source,
        ctx.segmentRows.map((r) => r.id),
        siglumOf,
      )
    : {
        conjecturesAt: bySegment(ctx.conjectureRows),
        reportedAt: bySegment(ctx.reported),
        adopted: new Set(adoptions.map((a) => a.conjectureId)),
        siglumOf,
      };
  const text = await editionTextOf(db, source, labelOf, ctx.urnOf, records);
  if (writers.readable !== false) {
    await writeText(path.join(dir, 'edition.txt'), text.plain);
    await writeText(path.join(dir, 'edition.md'), text.markdown);
  }
  if (writers.tei !== false) {
    const witnessNames = new Map(ctx.witnessRows.map((w) => [w.id, w.name] as const));
    // The works the edition cites, and what the conjectures and reports it shows cite of them.
    const bibliography = snapshot
      ? snapshotBibliography(snapshot)
      : await editionBibliography(db, edition.id, {
          conjectureIds: ctx.conjectureRows.map((c) => c.id),
          reportedIds: ctx.reported.map((r) => r.id),
        });
    await writeText(
      path.join(dir, 'edition.tei.xml'),
      exportEditionTei({
        title: meta.title,
        ...(meta.editors.length ? { editors: meta.editors } : {}),
        ...(meta.preface ? { preface: meta.preface } : {}),
        ...(meta.sources ? { sources: meta.sources } : {}),
        ...teiRights(meta.licenceId, meta.rightsNote),
        contributors: await contributorsOf(
          ctx,
          'edition',
          edition.id,
          upTo,
          snapshot ? noteRows.map((n) => n.personId) : undefined,
        ),
        baseSiglum: 'ed.',
        witnesses: sigla.map((s) => ({
          siglum: s.siglum,
          id: s.witnessId,
          ...(witnessNames.get(s.witnessId) ? { name: witnessNames.get(s.witnessId)! } : {}),
        })),
        ...text.tei,
        bibliography,
        words: true,
        origin: originOf(writers),
      }),
    );
  }
}

/**
 * One edition's directory, written afresh but for the versions already
 * written: its draft, with its alignment, reviews and history; or, for one
 * who may not edit it, its latest version's files and no history. Then its
 * versions.
 */
async function writeEditionFiles(ctx: WorkContext, edition: EditionRow): Promise<void> {
  const { db } = ctx;
  const edir = path.join(ctx.dir, ctx.editionPath.get(edition.id)!);
  await clearRecordDir(edir);
  await mkdir(edir, { recursive: true });
  if (editionWorking(ctx, edition)) {
    await editionSourceFiles(ctx, edir, edition, await draftSource(db, edition.id));
    const constraints = await db
      .select()
      .from(alignmentConstraints)
      .where(eq(alignmentConstraints.editionId, edition.id))
      .orderBy(asc(alignmentConstraints.id));
    await writeJson(
      path.join(edir, 'alignment.json'),
      list(
        'alignment',
        'constraints',
        constraints.map((c) => ({
          id: c.id,
          segmentId: c.segmentId,
          baseTokenIds: c.baseTokenIds,
          transcriptionId: c.transcriptionId,
          witnessTokenIds: c.witnessTokenIds,
          createdAt: iso(c.createdAt),
        })),
      ),
    );
    const sites = await db
      .select()
      .from(editionSiteReviews)
      .where(eq(editionSiteReviews.editionId, edition.id))
      .orderBy(asc(editionSiteReviews.segmentId), asc(editionSiteReviews.siteKey));
    await writeJson(
      path.join(edir, 'reviews.json'),
      record('reviews', {
        sites: sites.map((s) => ({
          segmentId: s.segmentId,
          siteKey: s.siteKey,
          personId: personOf(ctx, s.reviewedBy),
          reviewedAt: iso(s.reviewedAt),
        })),
        states: await reviewStates(ctx, 'edition', edition.id),
      }),
    );
    await historyFiles(ctx, edir, 'edition', edition.id);
  } else {
    const latest = latestOf(ctx, 'edition', edition.id);
    const full = latest ? await versionByNumber(db, 'edition', edition.id, latest.number) : null;
    if (full) {
      await editionSourceFiles(ctx, edir, edition, await versionSource(db, edition, full));
      await publishedMoments(ctx, edir, 'edition', edition.id);
    }
  }
  await writeVersionFiles(ctx, edir, 'edition', edition.id, async (dir, version) =>
    editionSourceFiles(ctx, dir, edition, await versionSource(db, edition, version)),
  );
}

/**
 * Write the given parts of a work's archive, after pruning what no longer
 * belongs. The work's own files are always written; so is any member record
 * whose directory is missing. Returns the work's directory.
 */
export async function writeWorkParts(
  db: Database,
  workId: string,
  root: string,
  plan: ArchivePlan,
  writers: ArchiveWriters = {},
): Promise<string> {
  const ctx = await loadWorkContext(db, workId, root, writers);
  const fresh = !plan.only && !existsSync(path.join(ctx.dir, 'work.json'));
  const pruned = await pruneArchive(ctx);
  const missing = plan.only
    ? {
        witnesses: new Set<string>(),
        transcriptions: new Set<string>(),
        editions: new Set<string>(),
      }
    : pruned;
  const all = plan.all || fresh;
  const wanted = (set: Set<string> | undefined, extra: Set<string>, id: string) =>
    all || set?.has(id) || extra.has(id);
  await writeWorkFiles(ctx);
  for (const witness of ctx.witnessRows) {
    if (wanted(plan.witnesses, missing.witnesses, witness.id))
      await writeWitnessFiles(ctx, witness);
  }
  for (const t of ctx.transcriptionRows) {
    if (wanted(plan.transcriptions, missing.transcriptions, t.id))
      await writeTranscriptionFiles(ctx, t);
  }
  for (const edition of ctx.editionRows) {
    if (plan.editionsAll || wanted(plan.editions, missing.editions, edition.id))
      await writeEditionFiles(ctx, edition);
  }
  return ctx.dir;
}

/** Write a work's whole archive directory from the database. Existing files are replaced; the `.git` directory is kept. */
export async function writeArchive(
  db: Database,
  workId: string,
  root: string,
  writers: ArchiveWriters = {},
): Promise<string> {
  return writeWorkParts(db, workId, root, { all: true }, writers);
}

/**
 * One record of a work as the archive represents it, written for a viewer:
 * the part of the archive that holds it is written into a temporary
 * directory with the viewer's filter, without the files for reading, and the
 * record's JSON file is read back. Returns the directory's contents' root,
 * which the caller removes.
 */
export async function writeRecordPart(
  db: Database,
  workId: string,
  part: { witnesses?: string[]; transcriptions?: string[]; editions?: string[] },
  only: ArchiveFilter | undefined,
): Promise<{
  root: string;
  dir: string;
  paths: {
    witness: Map<string, string>;
    transcription: Map<string, string>;
    edition: Map<string, string>;
  };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'varians-record-'));
  const writers: ArchiveWriters = { tei: false, readable: false, ...(only ? { only } : {}) };
  const plan: ArchivePlan = {
    only: true,
    witnesses: new Set(part.witnesses),
    transcriptions: new Set(part.transcriptions),
    editions: new Set(part.editions),
  };
  const ctx = await loadWorkContext(db, workId, root, writers);
  const dir = await writeWorkParts(db, workId, root, plan, writers);
  return {
    root,
    dir,
    paths: {
      witness: ctx.witnessPath,
      transcription: ctx.transcriptionPath,
      edition: ctx.editionPath,
    },
  };
}

/**
 * The format documentation the archive carries (docs/formats in the
 * repository), found upward from the working directory and from this module,
 * since the built server runs from another depth than the source.
 */
export function formatsDir(): string | null {
  const starts = [
    process.env.VARIANS_FORMATS_DIR
      ? path.dirname(path.dirname(process.env.VARIANS_FORMATS_DIR))
      : null,
    process.cwd(),
    path.dirname(fileURLToPath(import.meta.url)),
  ];
  if (
    process.env.VARIANS_FORMATS_DIR &&
    existsSync(path.join(process.env.VARIANS_FORMATS_DIR, 'README.md'))
  )
    return process.env.VARIANS_FORMATS_DIR;
  for (const start of starts) {
    if (!start) continue;
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'docs', 'formats');
      if (existsSync(path.join(candidate, 'README.md'))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * The critical text with its apparatus under each segment, as plain text,
 * as Markdown, and as the text and passages of the TEI export: of the draft
 * (null), or of the version with this number. The conjectures and reported
 * readings given are laid at its variants, as the reader and the editor have
 * them.
 */
export async function editionText(
  db: Database,
  editionId: string,
  labelOf: Map<string, string>,
  number: number | null = null,
  urnOf: Map<string, string> = new Map(),
  records: PassageRecords | null = null,
): Promise<{
  plain: string;
  markdown: string;
  tei: Pick<Parameters<typeof exportEditionTei>[0], 'runs' | 'passages'>;
}> {
  let source: EditionSource;
  if (number === null) source = await draftSource(db, editionId);
  else {
    const [row] = await db
      .select({ id: editions.id, workId: editions.workId, slug: editions.slug })
      .from(editions)
      .where(eq(editions.id, editionId));
    const version = row ? await versionByNumber(db, 'edition', editionId, number) : null;
    if (!row || !version) throw new Error(`no version ${number} of edition ${editionId}`);
    source = await versionSource(db, row, version);
  }
  return editionTextOf(db, source, labelOf, urnOf, records);
}

/** The same of an edition read from a source: its draft, or a version. */
export async function editionTextOf(
  db: Database,
  source: EditionSource,
  labelOf: Map<string, string>,
  urnOf: Map<string, string> = new Map(),
  records: PassageRecords | null = null,
): Promise<{
  plain: string;
  markdown: string;
  tei: Pick<Parameters<typeof exportEditionTei>[0], 'runs' | 'passages'>;
}> {
  const { context } = source;
  const conventions = apparatusConventionsOf(source.meta.conventions);
  // The text as the edition shows it: the lines of a prose paragraph run on, and a divided word is hyphenated where a shown line ends.
  const shown = shownBreaks(
    context.edition.content.items,
    source.meta.conventions.lineation ?? 'verse',
  );
  const passages = await collateEdition(db, context);
  const labels = Object.fromEntries(labelOf);
  const exported = passages.map((p) => {
    const attached = records ? attachRecords(context, p, records) : null;
    const collation = attached?.collation ?? p.collation;
    return {
      segmentId: p.segmentId,
      label: labelOf.get(p.segmentId) ?? p.segmentId,
      segments: p.segments,
      siteSegments: segmentsOfSites(collation.sites, p.baseUnits, p.segments),
      collation,
      baseUnits: p.baseUnits,
      attachments: attached?.bySite ?? {},
    };
  });
  // The apparatus of the plain text is kept as built, segment by segment; the TEI has every variant where its words stand.
  const shares = segmentShares(exported);
  const plain: string[] = [];
  const markdown: string[] = [];
  const runs = segmentRuns(context.edition.content).filter((r) => r.segmentId !== null);
  const siglaOrder = siglaOrderOf(context.sigla);
  // Runs of one segment are gathered, so that a segment printed in two places is one entry.
  const runsOf = new Map<string, typeof runs>();
  for (const run of runs) runsOf.set(run.segmentId!, [...(runsOf.get(run.segmentId!) ?? []), run]);
  for (const [segmentId, segmentRunsHere] of runsOf) {
    const label = labelOf.get(segmentId) ?? segmentId;
    const items = segmentRunsHere.flatMap((run) =>
      context.edition.content.items.slice(run.from, run.to),
    );
    // The break that ends the segment's last line is the line's own end here.
    const text = toText({ items }, { form: 'read', shown }).trimEnd();
    const share = shares.get(segmentId);
    // A variant stands under the segment its words begin in, labelled by the segments they lie in.
    const entries = share
      ? apparatusEntries(
          { ...share.passage.collation, sites: share.sites } as Collation,
          label,
          share.attachments,
          conventions,
          siglaOrder,
        ).map((entry) => {
          const ids = share.passage.siteSegments[entry.siteIndex] ?? [];
          return ids.length ? { ...entry, label: labelOfSegments(ids, labels) } : entry;
        })
      : [];
    const { main, interpretative } = splitEntries(entries, conventions);
    const app = [
      ...formatApparatus(main, conventions),
      ...formatApparatus(interpretative, conventions).map((line) => `Interpretative: ${line}`),
    ];
    plain.push(`${label}  ${text}`);
    for (const line of app) plain.push(`    ${line}`);
    markdown.push(`**${label}** ${text}  `);
    for (const line of app) markdown.push(`> ${line}  `);
  }
  return {
    plain: plain.join('\n') + '\n',
    markdown: markdown.join('\n') + '\n',
    tei: teiText(context.edition.content, exported, labels, { ids: true, urnOf }),
  };
}

/** The citations made by the work's conjectures, reported readings, editions, notes and segments, and the items they cite. */
export async function citationsOfWork(
  db: Database,
  workId: string,
): Promise<{
  items: (typeof bibliographyItems.$inferSelect)[];
  citations: (typeof citations.$inferSelect)[];
}> {
  const conjectureIds = (
    await db.select({ id: conjectures.id }).from(conjectures).where(eq(conjectures.workId, workId))
  ).map((r) => r.id);
  const reportedIds = (
    await db
      .select({ id: reportedReadings.id })
      .from(reportedReadings)
      .where(eq(reportedReadings.workId, workId))
  ).map((r) => r.id);
  const editionIds = (
    await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))
  ).map((r) => r.id);
  const segmentIds = (
    await db.select({ id: segments.id }).from(segments).where(eq(segments.workId, workId))
  ).map((r) => r.id);
  const conditions = [
    conjectureIds.length ? inArray(citations.conjectureId, conjectureIds) : undefined,
    reportedIds.length ? inArray(citations.reportedReadingId, reportedIds) : undefined,
    editionIds.length ? inArray(citations.editionId, editionIds) : undefined,
    segmentIds.length ? inArray(citations.segmentId, segmentIds) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (conditions.length === 0) return { items: [], citations: [] };
  const rows = await db
    .select()
    .from(citations)
    .where(and(isNotNull(citations.itemId), or(...conditions)));
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const items = itemIds.length
    ? await db.select().from(bibliographyItems).where(inArray(bibliographyItems.id, itemIds))
    : [];
  return { items, citations: rows };
}

/** Every bibliography item cited by the work, as biblatex. */
export async function bibliographyOfWork(db: Database, workId: string): Promise<string> {
  const { items } = await citationsOfWork(db, workId);
  return serializeBiblatex(
    items.map((r) => ({ type: r.entryType, key: r.citationKey, fields: r.fields })),
  );
}

/** Who a commit is by: Varians for the nightly pass, the person for a named moment or a publication. */
export interface ArchiveAuthor {
  name: string;
  email: string;
}

export const VARIANS_AUTHOR: ArchiveAuthor = { name: 'Varians', email: 'varians@localhost' };

/** A person as a commit author, without their address: archives are published, addresses are not. */
export function personAuthor(name: string, id: string): ArchiveAuthor {
  return {
    name: name.replace(/[<>\n]/gu, '').trim() || 'Unnamed',
    email: `${id.toLowerCase()}@persons.invalid`,
  };
}

/** Commit the archive directory, initializing the repository the first time. Returns the commit hash, or null when nothing changed. */
export async function commitArchive(
  dir: string,
  message: string,
  author: ArchiveAuthor = VARIANS_AUTHOR,
): Promise<string | null> {
  const git = (...args: string[]) =>
    run('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(dir)),
      },
    });
  // The archive is a repository of its own. Asking git whether we are inside a repository is not enough:
  // the storage directory may sit inside a checkout, and the commit would land there.
  if (!existsSync(path.join(dir, '.git'))) await git('init', '-q', '-b', 'main');
  const top = (await git('rev-parse', '--show-toplevel')).stdout.trim();
  if (path.resolve(top) !== path.resolve(dir))
    throw new Error(`the archive at ${dir} is not a repository of its own (git found ${top})`);
  await git('add', '-A');
  const status = await git('status', '--porcelain');
  if (status.stdout.trim() === '') return null;
  await git(
    '-c',
    `user.name=${author.name}`,
    '-c',
    `user.email=${author.email}`,
    'commit',
    '-q',
    '-m',
    message,
  );
  const hash = await git('rev-parse', 'HEAD');
  return hash.stdout.trim();
}

/** The person of an account, for the archive's references to people. */
function personOf(ctx: WorkContext, userId: string | null | undefined): string | null {
  return userId ? (ctx.personOfUser.get(userId) ?? null) : null;
}

/**
 * Every person the work's files refer to (Data Format 2, 4.2): the authors of
 * the changesets and moments written, the notes' authors, the collaborators,
 * who reviewed or classed a site, and (in the server's archive) who holds a
 * review position.
 */
async function personsOfWork(
  ctx: WorkContext,
): Promise<{ id: string; name: string; orcid: string | null }[]> {
  const { db } = ctx;
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };
  const documents: { kind: 'transcription' | 'edition'; id: string; upTo: number | null }[] = [
    ...ctx.transcriptionRows.map((t) => ({
      kind: 'transcription' as const,
      id: t.id,
      upTo: transcriptionWorking(ctx, t)
        ? null
        : (latestOf(ctx, 'transcription', t.id)?.version ?? 0),
    })),
    ...ctx.editionRows.map((e) => ({
      kind: 'edition' as const,
      id: e.id,
      upTo: editionWorking(ctx, e) ? null : (latestOf(ctx, 'edition', e.id)?.version ?? 0),
    })),
  ];
  for (const list of ctx.versionRows.values())
    for (const v of list) {
      add(v.personId);
      add(v.withdrawnBy);
    }
  for (const d of documents) {
    const range = and(
      eq(changesets.documentKind, d.kind),
      eq(changesets.documentId, d.id),
      d.upTo !== null ? lte(changesets.version, d.upTo) : undefined,
    );
    for (const r of await db
      .selectDistinct({ id: changesets.personId })
      .from(changesets)
      .where(range))
      add(r.id);
    const momentRange = and(
      eq(moments.documentKind, d.kind),
      eq(moments.documentId, d.id),
      d.upTo !== null ? lte(moments.version, d.upTo) : undefined,
    );
    for (const r of await db
      .selectDistinct({ id: moments.personId })
      .from(moments)
      .where(momentRange))
      add(r.id);
    if (!ctx.writers.only)
      for (const r of await db
        .select({ userId: reviewState.userId })
        .from(reviewState)
        .where(and(eq(reviewState.documentKind, d.kind), eq(reviewState.documentId, d.id))))
        add(personOf(ctx, r.userId));
  }
  const editionIds = ctx.editionRows.map((e) => e.id);
  if (editionIds.length) {
    for (const r of await db
      .selectDistinct({ id: notes.personId })
      .from(notes)
      .where(inArray(notes.editionId, editionIds)))
      add(r.id);
    const working = ctx.editionRows.filter((e) => editionWorking(ctx, e)).map((e) => e.id);
    if (working.length) {
      for (const r of await db
        .select({ a: editionCollaborators.userId, b: editionCollaborators.grantedBy })
        .from(editionCollaborators)
        .where(inArray(editionCollaborators.editionId, working))) {
        add(personOf(ctx, r.a));
        add(personOf(ctx, r.b));
      }
      for (const r of await db
        .selectDistinct({ u: editionSiteReviews.reviewedBy })
        .from(editionSiteReviews)
        .where(inArray(editionSiteReviews.editionId, working)))
        add(personOf(ctx, r.u));
      for (const r of await db
        .selectDistinct({ u: editionSiteKinds.setBy })
        .from(editionSiteKinds)
        .where(inArray(editionSiteKinds.editionId, working)))
        add(personOf(ctx, r.u));
    }
  }
  if (ids.size === 0) return [];
  return db
    .select({ id: persons.id, name: persons.name, orcid: persons.orcid })
    .from(persons)
    .where(inArray(persons.id, [...ids]))
    .orderBy(asc(persons.id));
}

/** The ids merged into a registry entry, so that they keep resolving after an import elsewhere. */
async function mergedIdsOf(db: Database, survivorId: string) {
  const rows = await db
    .select()
    .from(registryMerges)
    .where(eq(registryMerges.survivorId, survivorId))
    .orderBy(asc(registryMerges.oldId));
  return rows.map((r) => ({
    id: r.oldId,
    label: r.label,
    mergedBy: r.mergedBy,
    mergedAt: iso(r.mergedAt),
  }));
}

/** One writer at a time per work directory, within this process: the write-through and a commit must not interleave. */
const locks = new Map<string, Promise<unknown>>();

export function withWorkLock<T>(workId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(workId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const settled = next.catch(() => undefined);
  locks.set(workId, settled);
  void settled.then(() => {
    if (locks.get(workId) === settled) locks.delete(workId);
  });
  return next;
}

/** Write and commit a work's archive; records the commit. */
export async function archiveWork(
  db: Database,
  workId: string,
  root: string,
  reason: string,
  writers: ArchiveWriters = {},
  author: ArchiveAuthor = VARIANS_AUTHOR,
): Promise<string | null> {
  return withWorkLock(workId, async () => {
    const dir = await writeArchive(db, workId, root, writers);
    const hash = await commitArchive(dir, reason, author);
    if (hash)
      await db.insert(archiveCommits).values({ id: newId(), workId, commitHash: hash, reason });
    return hash;
  });
}

/**
 * The archive of a work as one person may see it, for a download: written
 * afresh into a temporary repository with one commit (the server's archive
 * history may hold other people's drafts) and streamed as a zip. The
 * temporary directory goes when the stream ends.
 */
export async function filteredArchiveZip(
  db: Database,
  work: { id: string; slug: string },
  only: ArchiveFilter,
  storageRoot: string,
): Promise<Readable> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-export-'));
  const cleanup = () => void rm(tmp, { recursive: true, force: true });
  try {
    const dir = await writeArchive(db, work.id, tmp, { storageRoot, only });
    await commitArchive(dir, `export of ${work.slug}`);
    const child = spawn(
      'git',
      ['archive', '--format=zip', `--prefix=${folderName(work.slug, work.id)}/`, 'HEAD'],
      { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    child.on('close', cleanup);
    child.on('error', (e) => {
      child.stdout.destroy(e);
      cleanup();
    });
    return child.stdout;
  } catch (e) {
    cleanup();
    throw e;
  }
}
