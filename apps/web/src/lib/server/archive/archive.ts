/**
 * The archive: a work's records as open files in a git repository, kept
 * current by the server (PLAN 4.12, PLAN-2 milestone A). This module writes
 * the files from the database and commits. Format: docs/formats.
 *
 * The writing is split by level, so that a change to one document rewrites
 * only that document's files: the work's own files (always rewritten, they
 * are small), a witness, a transcription, an edition. A full write is every
 * part. Before writing, the archive is pruned: a directory whose record no
 * longer belongs to the work, or now belongs at another path, goes.
 */

import { materialLabel } from '$lib/registry/witness';
import {
  apparatusEntries,
  splitEntries,
  exportEditionTei,
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
  units,
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
  transcriptionWorks,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  zones,
  type Database,
} from '@varians/db';
import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, asc, desc, eq, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { collateEdition } from '../collation.ts';
import { exportHands, teiForm } from '../witness-format.ts';
import { apparatusConventionsOf, contextAt } from '../reader.ts';
import { siglaOrderOf } from '../../reader/sites.ts';
import { chosenWorksOf } from '../transcription-works.ts';
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
async function headOf(db: Database, kind: 'transcription' | 'edition', documentId: string, upTo: number | null): Promise<string | null> {
  const [row] = await db
    .select({ id: changesets.id })
    .from(changesets)
    .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), upTo !== null ? lte(changesets.version, upTo) : undefined))
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
}

/** The address the TEI's `tok:` and other prefixes resolve to. */
function originOf(writers: ArchiveWriters): string {
  return (writers.origin ?? process.env.ORIGIN ?? 'http://localhost').replace(/\/+$/u, '');
}

/** Which records an export takes. */
export interface ArchiveFilter {
  transcription(row: typeof transcriptions.$inferSelect): boolean;
  edition(row: typeof editions.$inferSelect): boolean;
  conjecture(row: typeof conjectures.$inferSelect): boolean;
  reported(row: typeof reportedReadings.$inferSelect): boolean;
  /** Whether the person sees an edition's working state; otherwise the archive holds its published version only. */
  editionWorking(row: typeof editions.$inferSelect): boolean;
}

/** Which parts of a work's archive to write. The work's own files are always written. */
export interface ArchivePlan {
  all?: boolean;
  /** Every edition of the work, for changes that reach the apparatus (conjectures, reported readings). */
  editionsAll?: boolean;
  witnesses?: Set<string>;
  transcriptions?: Set<string>;
  editions?: Set<string>;
}

type WorkRow = typeof works.$inferSelect;
type WitnessRow = typeof witnesses.$inferSelect;
type TranscriptionRow = typeof transcriptions.$inferSelect;
type EditionRow = typeof editions.$inferSelect;
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
}

/** Optional string fields of a row as the TEI exporter takes them: nulls left out. */
function defined<T extends Record<string, string | null | undefined>>(record: T): { [K in keyof T]?: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) if (typeof value === 'string' && value !== '') out[key] = value;
  return out as { [K in keyof T]?: string };
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
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Load the work and decide which records its archive holds and where. */
async function loadWorkContext(db: Database, workId: string, root: string, writers: ArchiveWriters): Promise<WorkContext> {
  const [work] = await db.select().from(works).where(eq(works.id, workId));
  if (!work) throw new Error(`no work ${workId}`);
  const [scheme] = await db.select().from(referenceSchemes).where(eq(referenceSchemes.id, work.schemeId));
  const only = writers.only;
  const userRows = await db.select({ id: users.id, name: users.name }).from(users);
  const userNames = new Map(userRows.map((u) => [u.id, u.name] as const));
  const accountPersons = await db.select({ id: persons.id, userId: persons.userId }).from(persons).where(isNotNull(persons.userId));
  const personOfUser = new Map(accountPersons.map((p) => [p.userId!, p.id] as const));
  const segmentRows = await db.select().from(segments).where(eq(segments.workId, workId)).orderBy(segments.sortKey);
  const labelOf = new Map(segmentRows.map((s) => [s.id, s.label] as const));
  const urnOf = new Map<string, string>();
  for (const s of segmentRows) {
    const urn = passageUrn(work.identifier, s.address, scheme?.levels ?? []);
    if (urn) urnOf.set(s.id, urn);
  }
  const conjectureRows = (await db.select().from(conjectures).where(eq(conjectures.workId, workId)).orderBy(asc(conjectures.id))).filter((c) => !only || only.conjecture(c));
  const reported = (await db.select().from(reportedReadings).where(eq(reportedReadings.workId, workId)).orderBy(asc(reportedReadings.id))).filter((r) => !only || only.reported(r));

  // An edition someone may not edit is in their export only as published.
  const editionRows = (await db.select().from(editions).where(eq(editions.workId, workId)).orderBy(asc(editions.id))).filter(
    (e) => (!only || only.edition(e)) && (!only || only.editionWorking(e) || e.publishedVersion !== null),
  );
  const siglaRows = editionRows.length ? await db.select().from(editionSigla).where(inArray(editionSigla.editionId, editionRows.map((e) => e.id))) : [];
  // Transcriptions connected to the work: chosen for it, assigning text to it, or named by a conspectus.
  const assigning = await db.selectDistinct({ transcriptionId: transcriptionSegments.transcriptionId }).from(transcriptionSegments).where(eq(transcriptionSegments.workId, workId));
  const chosen = await db.select({ transcriptionId: transcriptionWorks.transcriptionId }).from(transcriptionWorks).where(eq(transcriptionWorks.workId, workId));
  const transcriptionIds = new Set<string>([
    ...assigning.map((a) => a.transcriptionId),
    ...chosen.map((a) => a.transcriptionId),
    ...siglaRows.map((s) => s.transcriptionId).filter((id): id is string => id !== null),
  ]);
  const transcriptionRows = (transcriptionIds.size ? await db.select().from(transcriptions).where(inArray(transcriptions.id, [...transcriptionIds])) : [])
    .filter((t) => !only || only.transcription(t))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const witnessIds = new Set<string>([...transcriptionRows.map((t) => t.witnessId), ...siglaRows.map((s) => s.witnessId), ...reported.map((r) => r.witnessId)]);
  const witnessRows = (witnessIds.size ? await db.select().from(witnesses).where(inArray(witnesses.id, [...witnessIds])) : []).sort((a, b) => a.slug.localeCompare(b.slug));

  const witnessPath = new Map(witnessRows.map((w) => [w.id, path.join('witnesses', w.slug)] as const));
  const transcriptionPath = new Map<string, string>();
  const taken = new Set<string>();
  for (const t of transcriptionRows) {
    const base = path.join(witnessPath.get(t.witnessId)!, 'transcriptions', slugify(t.name));
    const target = taken.has(base) ? `${base}-${t.id.slice(-6).toLowerCase()}` : base;
    taken.add(target);
    transcriptionPath.set(t.id, target);
  }
  const editionPath = new Map(editionRows.map((e) => [e.id, path.join('editions', e.slug)] as const));
  return {
    db,
    work,
    scheme: scheme ?? null,
    dir: path.join(root, work.slug),
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
  };
}

/**
 * Remove the directories of records that no longer belong to the work, or
 * that belong at another path now (a renamed witness, transcription or
 * edition). Returns the ids of member records whose directory is missing,
 * which the caller must write.
 */
async function pruneArchive(ctx: WorkContext): Promise<{ witnesses: Set<string>; transcriptions: Set<string>; editions: Set<string> }> {
  const missing = { witnesses: new Set<string>(), transcriptions: new Set<string>(), editions: new Set<string>() };
  const present = { witnesses: new Set<string>(), transcriptions: new Set<string>(), editions: new Set<string>() };
  const expectedAt = (map: Map<string, string>, id: string | null, at: string) => id !== null && map.get(id) === at;
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
      if (!expectedAt(ctx.transcriptionPath, tid, trel)) await rm(path.join(ctx.dir, trel), { recursive: true, force: true });
      else present.transcriptions.add(tid!);
    }
  }
  for (const name of await subdirs(path.join(ctx.dir, 'editions'))) {
    const rel = path.join('editions', name);
    const id = await recordIdOf(path.join(ctx.dir, rel, 'edition.json'));
    if (!expectedAt(ctx.editionPath, id, rel)) await rm(path.join(ctx.dir, rel), { recursive: true, force: true });
    else present.editions.add(id!);
  }
  // Folders left empty go as well, so that the layout is the same as a write into an empty directory.
  for (const name of await subdirs(path.join(ctx.dir, 'witnesses'))) await removeIfEmpty(path.join(ctx.dir, 'witnesses', name, 'transcriptions'));
  await removeIfEmpty(path.join(ctx.dir, 'witnesses'));
  await removeIfEmpty(path.join(ctx.dir, 'editions'));
  for (const id of ctx.witnessPath.keys()) if (!present.witnesses.has(id)) missing.witnesses.add(id);
  for (const id of ctx.transcriptionPath.keys()) if (!present.transcriptions.has(id)) missing.transcriptions.add(id);
  for (const id of ctx.editionPath.keys()) if (!present.editions.has(id)) missing.editions.add(id);
  return missing;
}

async function historyFiles(ctx: WorkContext, dir: string, kind: 'transcription' | 'edition', documentId: string, upTo: number | null = null): Promise<void> {
  const { db, userNames } = ctx;
  const rows = await db
    .select()
    .from(changesets)
    .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), upTo !== null ? lte(changesets.version, upTo) : undefined))
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
    .where(and(eq(moments.documentKind, kind), eq(moments.documentId, documentId), upTo !== null ? lte(moments.version, upTo) : undefined))
    .orderBy(asc(moments.version), asc(moments.at), asc(moments.id));
  await writeJson(
    path.join(dir, 'moments.json'),
    list('moments', 'moments', named.map((m) => ({
      id: m.id,
      version: m.version,
      name: m.name,
      kind: m.kind,
      number: m.number,
      basis: m.basis,
      personId: m.personId,
      at: m.at.toISOString(),
    }))),
  );
}

/** Each person's review position on a document: process state, kept in the server's archive and left out of exports for others (PLAN-2 Open 5). */
async function reviewStates(ctx: WorkContext, kind: 'transcription' | 'edition', documentId: string) {
  if (ctx.writers.only) return [];
  const rows = await ctx.db
    .select()
    .from(reviewState)
    .where(and(eq(reviewState.documentKind, kind), eq(reviewState.documentId, documentId)))
    .orderBy(asc(reviewState.userId));
  return rows.map((r) => ({ personId: personOf(ctx, r.userId), fromVersion: r.fromVersion, accepted: r.accepted }));
}

/** The work's own files: work.json, segments, conjectures, reported readings, bibliography, citations, and the format notes. */
async function writeWorkFiles(ctx: WorkContext): Promise<void> {
  const { db, work, scheme, dir, userNames, labelOf, conjectureRows, reported } = ctx;
  await mkdir(dir, { recursive: true });
  const maintainerRows = await db.select().from(workMaintainers).where(eq(workMaintainers.workId, work.id)).orderBy(asc(workMaintainers.userId));
  await writeJson(path.join(dir, 'work.json'), record('work', {
    formatVersion: FORMAT_VERSION,
    id: work.id,
    slug: work.slug,
    title: work.title,
    author: work.author,
    language: work.language,
    identifier: work.identifier,
    description: work.description,
    visibility: work.visibility,
    scheme: scheme ? { id: scheme.id, name: scheme.name, levels: scheme.levels, createdBy: scheme.createdBy, createdAt: iso(scheme.createdAt) } : null,
    profile: work.profile,
    licence: dataLicence(),
    maintainers: maintainerRows.map((m) => ({ id: m.userId, name: userNames.get(m.userId) ?? null, since: iso(m.createdAt) })),
    mergedIds: await mergedIdsOf(db, work.id),
    createdBy: work.createdBy,
    createdAt: iso(work.createdAt),
  }));
  await writeJson(path.join(dir, 'persons.json'), list('persons', 'persons', await personsOfWork(ctx)));
  await writeText(
    path.join(dir, 'segments.tsv'),
    [
      'id\tlabel\tsort_key\taddress\turn\tcreated_at',
      ...ctx.segmentRows.map((s) => [s.id, s.label, s.sortKey, JSON.stringify(s.address), ctx.urnOf.get(s.id) ?? '', iso(s.createdAt)].join('\t')),
    ].join('\n') + '\n',
  );
  await writeJson(
    path.join(dir, 'conjectures.json'),
    list('conjectures', 'conjectures', conjectureRows.map((c) => ({ ...c, segmentLabel: labelOf.get(c.segmentId) ?? null, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) }))),
  );
  await writeJson(
    path.join(dir, 'reported-readings.json'),
    list('reported-readings', 'readings', reported.map((r) => ({ ...r, segmentLabel: labelOf.get(r.segmentId) ?? null, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }))),
  );

  const all = await citationsOfWork(db, work.id);
  // An export for one person keeps the citations of what it holds, and the entries they cite.
  const shown = { conjectures: new Set(conjectureRows.map((c) => c.id)), reported: new Set(reported.map((r) => r.id)), editions: new Set(ctx.editionRows.map((e) => e.id)) };
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
  const items = all.items.filter((i) => citedIds.has(i.id)).sort((a, b) => a.citationKey.localeCompare(b.citationKey));
  await writeText(path.join(dir, 'bibliography.bib'), serializeBiblatex(items.map((r) => ({ type: r.entryType, key: r.citationKey, fields: r.fields }))));
  await writeJson(
    path.join(dir, 'bibliography.json'),
    list('bibliography', 'items', items.map((i) => ({ ...i, createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt) }))),
  );
  await writeJson(
    path.join(dir, 'citations.json'),
    list('citations', 'citations', citationRows.map((c) => ({ ...c, createdAt: iso(c.createdAt) }))),
  );
  await writeFormatNotes(dir);
  await writeText(path.join(dir, 'LICENSE.md'), licenceNotes(ctx));
}

/** The TEI's licence statement: the licence by name with its address, and the note on rights. */
function teiRights(licenceId: string | null, rightsNote: string | null): { licence?: string; licenceUrl?: string; rightsNote?: string; authority: string } {
  const info = licenceInfo(licenceId);
  return { ...(info ? { licence: info.name, licenceUrl: info.url } : {}), ...(rightsNote ? { rightsNote } : {}), authority: siteName() };
}

/**
 * The persons responsible for a document, for its TEI header (PLAN-2 D6):
 * those whose changesets made its text, and those who wrote its notes.
 */
async function contributorsOf(ctx: WorkContext, kind: 'transcription' | 'edition', documentId: string, upTo: number | null): Promise<Contributor[]> {
  const { db } = ctx;
  const authors = await db
    .selectDistinct({ id: persons.id, name: persons.name, orcid: persons.orcid })
    .from(changesets)
    .innerJoin(persons, eq(persons.id, changesets.personId))
    .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), isNotNull(changesets.version), upTo !== null ? lte(changesets.version, upTo) : undefined))
    .orderBy(asc(persons.name), asc(persons.id));
  const out: Contributor[] = authors.map((p) => ({ name: p.name, resp: kind, personId: p.id, ...(p.orcid ? { orcid: p.orcid } : {}) }));
  if (kind === 'edition') {
    const noteAuthors = await db
      .selectDistinct({ id: persons.id, name: persons.name, orcid: persons.orcid })
      .from(notes)
      .innerJoin(persons, eq(persons.id, notes.personId))
      .where(eq(notes.editionId, documentId))
      .orderBy(asc(persons.name), asc(persons.id));
    out.push(...noteAuthors.map((p) => ({ name: p.name, resp: 'notes', personId: p.id, ...(p.orcid ? { orcid: p.orcid } : {}) })));
  }
  return out;
}

/** LICENSE.md: the licence of each kind of file in the archive (Data Format 2, 10.1). */
function licenceNotes(ctx: WorkContext): string {
  const work = licenceInfo(dataLicence())!;
  const used = new Set([...ctx.transcriptionRows.map((t) => t.licenceId), ...ctx.editionRows.map((e) => e.licenceId)].filter((id): id is string => !!id));
  const named = [...used].map((id) => licenceInfo(id)).filter((l): l is NonNullable<typeof l> => l !== null);
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
  if (!formats) console.warn('docs/formats not found: the archive gets no README, TEI notes or schemas');
  const readme = formats ? await readFile(path.join(formats, 'README.md'), 'utf8').catch(() => null) : null;
  await writeText(path.join(dir, 'README.md'), readme ?? '# Varians archive\n');
  const teiDoc = formats ? await readFile(path.join(formats, 'tei-subset.md'), 'utf8').catch(() => null) : null;
  if (teiDoc) await writeText(path.join(dir, 'tei-subset.md'), teiDoc);
  if (formats) {
    try {
      const schemaDir = path.join(formats, 'schemas');
      for (const name of await readdir(schemaDir)) {
        if (name.endsWith('.json')) await writeText(path.join(dir, 'schemas', name), await readFile(path.join(schemaDir, name), 'utf8'));
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
  const maintainerRows = await db.select().from(witnessMaintainers).where(eq(witnessMaintainers.witnessId, witness.id)).orderBy(asc(witnessMaintainers.userId));
  await writeJson(path.join(wdir, 'witness.json'), record('witness', {
    ...witness,
    maintainers: maintainerRows.map((m) => ({ id: m.userId, name: userNames.get(m.userId) ?? null, since: iso(m.createdAt) })),
    mergedIds: await mergedIdsOf(db, witness.id),
    createdAt: iso(witness.createdAt),
    updatedAt: iso(witness.updatedAt),
  }));
  const pageRows = await db.select().from(pages).where(eq(pages.witnessId, witness.id)).orderBy(pages.position, pages.id);
  const imageFiles = new Map<string, string>();
  const imagesDir = path.join(wdir, 'images');
  if (writers.storageRoot) {
    for (const p of pageRows) {
      // Only an image whose rights statement allows copying goes into the archive (PLAN-2 D5).
      if (p.imageKind !== 'upload' || !p.imagePath || !isCopyable(p.rights)) continue;
      const ext = path.extname(p.imagePath) || '.jpg';
      const target = path.join('images', `${slugify(p.label)}-${p.id.slice(-6)}${ext}`);
      if (await syncFile(path.join(writers.storageRoot, p.imagePath), path.join(wdir, target))) imageFiles.set(p.id, target);
    }
  }
  // Images of pages that are gone or renamed go too.
  const kept = new Set([...imageFiles.values()].map((f) => path.basename(f)));
  try {
    for (const name of await readdir(imagesDir)) if (!kept.has(name)) await rm(path.join(imagesDir, name), { force: true });
    if (kept.size === 0) await rm(imagesDir, { recursive: true, force: true });
  } catch {
    // No images directory.
  }
  await writeJson(
    path.join(wdir, 'pages.json'),
    list('pages', 'pages', pageRows.map((p) => ({
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
    }))),
  );
}

/** One transcription's directory, written afresh. */
async function writeTranscriptionFiles(ctx: WorkContext, t: TranscriptionRow): Promise<void> {
  const { db, work, writers, userNames, labelOf } = ctx;
  const witness = ctx.witnessRows.find((w) => w.id === t.witnessId)!;
  const tdir = path.join(ctx.dir, ctx.transcriptionPath.get(t.id)!);
  await rm(tdir, { recursive: true, force: true });
  const chosen = await chosenWorksOf(db, [t.id]);
  await writeJson(path.join(tdir, 'transcription.json'), record('transcription', {
    id: t.id,
    name: t.name,
    witnessId: t.witnessId,
    ownerId: t.ownerId,
    ownerName: userNames.get(t.ownerId) ?? null,
    visibility: t.visibility,
    version: t.version,
    head: await headOf(db, 'transcription', t.id, null),
    keepsWrittenForm: t.keepsWrittenForm,
    displayAsWritten: t.displayAsWritten,
    profile: t.profile,
    description: t.description,
    sources: t.sources,
    licence: t.licenceId,
    rightsNote: t.rightsNote,
    workIds: chosen.get(t.id) ?? [],
    createdAt: iso(t.createdAt),
    content: t.content,
  }));
  await writeJson(path.join(tdir, 'memory.json'), list('memory', 'entries', t.memory));
  const zoneRows = await db.select().from(zones).where(eq(zones.transcriptionId, t.id)).orderBy(asc(zones.id));
  await writeJson(
    path.join(tdir, 'zones.json'),
    list('zones', 'zones', zoneRows.map((z) => ({ id: z.id, pageId: z.pageId, tokenIds: z.tokenIds, geometry: z.geometry, feature: z.feature, createdAt: iso(z.createdAt) }))),
  );
  await writeText(path.join(tdir, 'transcription.txt'), toText(t.content, { form: 'read' }) + '\n');
  const states = await reviewStates(ctx, 'transcription', t.id);
  if (states.length) await writeJson(path.join(tdir, 'reviews.json'), record('reviews', { states }));
  if (writers.tei !== false) {
    const pageRows = await db.select().from(pages).where(eq(pages.witnessId, witness.id)).orderBy(pages.position, pages.id);
    const segmentLabels: Record<string, string> = {};
    for (const [id, label] of labelOf) segmentLabels[id] = label;
    await writeText(
      path.join(tdir, 'transcription.tei.xml'),
      exportTranscriptionTei({
        stream: t.content,
        title: `${work.title}: ${witness.name}, ${t.name}`,
        language: work.language,
        ...(t.sources ? { sources: t.sources } : {}),
        ...teiRights(t.licenceId, t.rightsNote),
        contributors: await contributorsOf(ctx, 'transcription', t.id, null),
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
          ...(p.imageIiif ? { imageUrl: `${p.imageIiif}/full/max/0/default.jpg` } : p.imagePath ? { imageUrl: p.imagePath } : {}),
          ...(p.imageWidth ? { width: p.imageWidth } : {}),
          ...(p.imageHeight ? { height: p.imageHeight } : {}),
        })),
        zones: zoneRows.map((z) => ({ id: z.id, pageId: z.pageId, tokenIds: z.tokenIds, geometry: z.geometry })),
        segmentLabels,
        words: true,
        regularizations: true,
        origin: originOf(writers),
      }),
    );
  }
  await historyFiles(ctx, tdir, 'transcription', t.id);
}

/** One edition's directory, written afresh: its working state, or for someone who does not edit it the version readers see. */
async function writeEditionFiles(ctx: WorkContext, edition: EditionRow): Promise<void> {
  const { db, work, writers, userNames, labelOf } = ctx;
  const only = writers.only;
  const edir = path.join(ctx.dir, ctx.editionPath.get(edition.id)!);
  await rm(edir, { recursive: true, force: true });
  const working = !only || only.editionWorking(edition);
  const shownVersion = working ? null : edition.publishedVersion;
  const { context: shown, asOf } = await contextAt(db, edition.id, shownVersion);
  const sigla = working
    ? ctx.siglaRows.filter((s) => s.editionId === edition.id).sort((a, b) => a.position - b.position)
    : shown.sigla.map((s, position) => ({ ...s, editionId: edition.id, position }));
  const adoptions = await db.select().from(editionAdoptions).where(eq(editionAdoptions.editionId, edition.id)).orderBy(asc(editionAdoptions.conjectureId));
  const noteRows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.editionId, edition.id), asOf ? lte(notes.createdAt, asOf) : undefined))
    .orderBy(asc(notes.id));
  const kindRows = working
    ? (await db.select().from(editionSiteKinds).where(eq(editionSiteKinds.editionId, edition.id))).map((k) => ({
        segmentId: k.segmentId,
        siteKey: k.siteKey,
        kind: k.kind,
        personId: personOf(ctx, k.setBy),
        setAt: iso(k.setAt),
      }))
    : [...shown.siteKinds].flatMap(([segmentId, bySite]) => [...bySite].map(([siteKey, k]) => ({ segmentId, siteKey, kind: k.kind, personId: null, setAt: iso(k.setAt) })));
  kindRows.sort((a, b) => a.segmentId.localeCompare(b.segmentId) || a.siteKey.localeCompare(b.siteKey));
  const collaboratorRows = working
    ? await db.select().from(editionCollaborators).where(eq(editionCollaborators.editionId, edition.id)).orderBy(asc(editionCollaborators.userId))
    : [];
  await writeJson(path.join(edir, 'edition.json'), record('edition', {
    id: edition.id,
    slug: edition.slug,
    title: edition.title,
    editors: edition.editors,
    preface: edition.preface,
    ownerId: edition.ownerId,
    ownerName: userNames.get(edition.ownerId) ?? null,
    visibility: edition.visibility,
    version: shown.edition.version,
    head: await headOf(db, 'edition', edition.id, shownVersion),
    publishedVersion: edition.publishedVersion,
    conventions: edition.conventions,
    copiedFrom: edition.copiedFrom,
    sources: edition.sources,
    licence: edition.licenceId,
    rightsNote: edition.rightsNote,
    createdAt: iso(edition.createdAt),
    sigla: sigla.map((s) => ({ siglum: s.siglum, witnessId: s.witnessId, transcriptionId: s.transcriptionId, states: s.states, variantSiglum: s.variantSiglum })),
    adoptions: adoptions.map((a) => ({ conjectureId: a.conjectureId, at: iso(a.createdAt) })),
    collaborators: collaboratorRows.map((c) => ({ personId: personOf(ctx, c.userId), grantedBy: personOf(ctx, c.grantedBy), since: iso(c.createdAt) })),
    notes: noteRows.map((n) => ({
      id: n.id,
      segmentId: n.segmentId,
      segmentLabel: labelOf.get(n.segmentId) ?? null,
      tokenIds: n.tokenIds,
      text: n.text,
      personId: n.personId,
      createdAt: iso(n.createdAt),
    })),
    siteKinds: kindRows,
    content: shown.edition.content,
  }));
  if (working) {
    const constraints = await db.select().from(alignmentConstraints).where(eq(alignmentConstraints.editionId, edition.id)).orderBy(asc(alignmentConstraints.id));
    await writeJson(
      path.join(edir, 'alignment.json'),
      list('alignment', 'constraints', constraints.map((c) => ({
        id: c.id,
        segmentId: c.segmentId,
        baseTokenIds: c.baseTokenIds,
        transcriptionId: c.transcriptionId,
        witnessTokenIds: c.witnessTokenIds,
        createdAt: iso(c.createdAt),
      }))),
    );
    const sites = await db
      .select()
      .from(editionSiteReviews)
      .where(eq(editionSiteReviews.editionId, edition.id))
      .orderBy(asc(editionSiteReviews.segmentId), asc(editionSiteReviews.siteKey));
    await writeJson(path.join(edir, 'reviews.json'), record('reviews', {
      sites: sites.map((s) => ({ segmentId: s.segmentId, siteKey: s.siteKey, personId: personOf(ctx, s.reviewedBy), reviewedAt: iso(s.reviewedAt) })),
      states: await reviewStates(ctx, 'edition', edition.id),
    }));
  }
  const text = await editionText(db, edition.id, labelOf, shownVersion, ctx.urnOf);
  await writeText(path.join(edir, 'edition.txt'), text.plain);
  await writeText(path.join(edir, 'edition.md'), text.markdown);
  if (writers.tei !== false) {
    const witnessNames = new Map(ctx.witnessRows.map((w) => [w.id, w.name] as const));
    await writeText(
      path.join(edir, 'edition.tei.xml'),
      exportEditionTei({
        title: edition.title,
        ...(edition.editors.length ? { editors: edition.editors } : {}),
        language: work.language,
        ...(edition.preface ? { preface: edition.preface } : {}),
        ...(edition.sources ? { sources: edition.sources } : {}),
        ...teiRights(edition.licenceId, edition.rightsNote),
        contributors: await contributorsOf(ctx, 'edition', edition.id, shownVersion),
        baseSiglum: 'ed.',
        witnesses: sigla.map((s) => ({ siglum: s.siglum, id: s.witnessId, ...(witnessNames.get(s.witnessId) ? { name: witnessNames.get(s.witnessId)! } : {}) })),
        segments: text.segments,
        words: true,
        origin: originOf(writers),
      }),
    );
  }
  await historyFiles(ctx, edir, 'edition', edition.id, shownVersion);
}

/**
 * Write the given parts of a work's archive, after pruning what no longer
 * belongs. The work's own files are always written; so is any member record
 * whose directory is missing. Returns the work's directory.
 */
export async function writeWorkParts(db: Database, workId: string, root: string, plan: ArchivePlan, writers: ArchiveWriters = {}): Promise<string> {
  const ctx = await loadWorkContext(db, workId, root, writers);
  const fresh = !existsSync(path.join(ctx.dir, 'work.json'));
  const missing = await pruneArchive(ctx);
  const all = plan.all || fresh;
  const wanted = (set: Set<string> | undefined, extra: Set<string>, id: string) => all || set?.has(id) || extra.has(id);
  await writeWorkFiles(ctx);
  for (const witness of ctx.witnessRows) {
    if (wanted(plan.witnesses, missing.witnesses, witness.id)) await writeWitnessFiles(ctx, witness);
  }
  for (const t of ctx.transcriptionRows) {
    if (wanted(plan.transcriptions, missing.transcriptions, t.id)) await writeTranscriptionFiles(ctx, t);
  }
  for (const edition of ctx.editionRows) {
    if (plan.editionsAll || wanted(plan.editions, missing.editions, edition.id)) await writeEditionFiles(ctx, edition);
  }
  return ctx.dir;
}

/** Write a work's whole archive directory from the database. Existing files are replaced; the `.git` directory is kept. */
export async function writeArchive(db: Database, workId: string, root: string, writers: ArchiveWriters = {}): Promise<string> {
  return writeWorkParts(db, workId, root, { all: true }, writers);
}

/**
 * The format documentation the archive carries (docs/formats in the
 * repository), found upward from the working directory and from this module,
 * since the built server runs from another depth than the source.
 */
export function formatsDir(): string | null {
  const starts = [process.env.VARIANS_FORMATS_DIR ? path.dirname(path.dirname(process.env.VARIANS_FORMATS_DIR)) : null, process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  if (process.env.VARIANS_FORMATS_DIR && existsSync(path.join(process.env.VARIANS_FORMATS_DIR, 'README.md'))) return process.env.VARIANS_FORMATS_DIR;
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

/** The critical text with its apparatus under each segment, as plain text, as Markdown, and as the input of the TEI export. */
export async function editionText(
  db: Database,
  editionId: string,
  labelOf: Map<string, string>,
  atVersion: number | null = null,
  urnOf: Map<string, string> = new Map(),
): Promise<{ plain: string; markdown: string; segments: Parameters<typeof exportEditionTei>[0]['segments'] }> {
  const { context } = await contextAt(db, editionId, atVersion);
  const [row] = await db.select({ conventions: editions.conventions }).from(editions).where(eq(editions.id, editionId));
  const conventions = apparatusConventionsOf(row!.conventions);
  const collations = await collateEdition(db, context);
  const plain: string[] = [];
  const markdown: string[] = [];
  const segmentsOut: Parameters<typeof exportEditionTei>[0]['segments'] = [];
  const runs = segmentRuns(context.edition.content).filter((r) => r.segmentId !== null);
  const siglaOrder = siglaOrderOf(context.sigla);
  // Runs of one segment are gathered, so that a segment printed in two places is one entry.
  const bySegment = new Map<string, typeof runs>();
  for (const run of runs) bySegment.set(run.segmentId!, [...(bySegment.get(run.segmentId!) ?? []), run]);
  for (const [segmentId, segmentRunsHere] of bySegment) {
    const label = labelOf.get(segmentId) ?? segmentId;
    const items = segmentRunsHere.flatMap((run) => context.edition.content.items.slice(run.from, run.to));
    const text = toText({ items }, { form: 'read' });
    const collation = collations.get(segmentId);
    const { main, interpretative } = collation ? splitEntries(apparatusEntries(collation, label, {}, conventions, siglaOrder), conventions) : { main: [], interpretative: [] };
    const app = [...formatApparatus(main, conventions), ...formatApparatus(interpretative, conventions).map((line) => `Interpretative: ${line}`)];
    plain.push(`${label}  ${text}`);
    for (const line of app) plain.push(`    ${line}`);
    markdown.push(`**${label}** ${text}  `);
    for (const line of app) markdown.push(`> ${line}  `);
    const baseUnits = segmentRunsHere.flatMap((run) => units(context.edition.content, run.from, run.to));
    segmentsOut.push({ label, id: segmentId, ...(urnOf.get(segmentId) ? { urn: urnOf.get(segmentId)! } : {}), items, baseUnits, sites: collation?.sites ?? [] });
  }
  return { plain: plain.join('\n') + '\n', markdown: markdown.join('\n') + '\n', segments: segmentsOut };
}

/** The citations made by the work's conjectures, reported readings, editions, notes and segments, and the items they cite. */
export async function citationsOfWork(
  db: Database,
  workId: string,
): Promise<{
  items: (typeof bibliographyItems.$inferSelect)[];
  citations: (typeof citations.$inferSelect)[];
}> {
  const conjectureIds = (await db.select({ id: conjectures.id }).from(conjectures).where(eq(conjectures.workId, workId))).map((r) => r.id);
  const reportedIds = (await db.select({ id: reportedReadings.id }).from(reportedReadings).where(eq(reportedReadings.workId, workId))).map((r) => r.id);
  const editionIds = (await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))).map((r) => r.id);
  const segmentIds = (await db.select({ id: segments.id }).from(segments).where(eq(segments.workId, workId))).map((r) => r.id);
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
  const items = itemIds.length ? await db.select().from(bibliographyItems).where(inArray(bibliographyItems.id, itemIds)) : [];
  return { items, citations: rows };
}

/** Every bibliography item cited by the work, as biblatex. */
export async function bibliographyOfWork(db: Database, workId: string): Promise<string> {
  const { items } = await citationsOfWork(db, workId);
  return serializeBiblatex(items.map((r) => ({ type: r.entryType, key: r.citationKey, fields: r.fields })));
}

/** Who a commit is by: Varians for the nightly pass, the person for a named moment or a publication. */
export interface ArchiveAuthor {
  name: string;
  email: string;
}

export const VARIANS_AUTHOR: ArchiveAuthor = { name: 'Varians', email: 'varians@localhost' };

/** A person as a commit author, without their address: archives are published, addresses are not. */
export function personAuthor(name: string, id: string): ArchiveAuthor {
  return { name: name.replace(/[<>\n]/gu, '').trim() || 'Unnamed', email: `${id.toLowerCase()}@persons.invalid` };
}

/** Commit the archive directory, initializing the repository the first time. Returns the commit hash, or null when nothing changed. */
export async function commitArchive(dir: string, message: string, author: ArchiveAuthor = VARIANS_AUTHOR): Promise<string | null> {
  const git = (...args: string[]) => run('git', args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(dir)) } });
  // The archive is a repository of its own. Asking git whether we are inside a repository is not enough:
  // the storage directory may sit inside a checkout, and the commit would land there.
  if (!existsSync(path.join(dir, '.git'))) await git('init', '-q', '-b', 'main');
  const top = (await git('rev-parse', '--show-toplevel')).stdout.trim();
  if (path.resolve(top) !== path.resolve(dir)) throw new Error(`the archive at ${dir} is not a repository of its own (git found ${top})`);
  await git('add', '-A');
  const status = await git('status', '--porcelain');
  if (status.stdout.trim() === '') return null;
  await git('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-q', '-m', message);
  const hash = await git('rev-parse', 'HEAD');
  return hash.stdout.trim();
}

/** The person of an account, for the archive's references to people. */
function personOf(ctx: WorkContext, userId: string | null | undefined): string | null {
  return userId ? ctx.personOfUser.get(userId) ?? null : null;
}

/**
 * Every person the work's files refer to (Data Format 2, 4.2): the authors of
 * the changesets and moments written, the notes' authors, the collaborators,
 * who reviewed or classed a site, and (in the server's archive) who holds a
 * review position.
 */
async function personsOfWork(ctx: WorkContext): Promise<{ id: string; name: string; orcid: string | null }[]> {
  const { db } = ctx;
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };
  const documents: { kind: 'transcription' | 'edition'; id: string; upTo: number | null }[] = [
    ...ctx.transcriptionRows.map((t) => ({ kind: 'transcription' as const, id: t.id, upTo: null })),
    ...ctx.editionRows.map((e) => ({ kind: 'edition' as const, id: e.id, upTo: !ctx.writers.only || ctx.writers.only.editionWorking(e) ? null : e.publishedVersion })),
  ];
  for (const d of documents) {
    const range = and(eq(changesets.documentKind, d.kind), eq(changesets.documentId, d.id), d.upTo !== null ? lte(changesets.version, d.upTo) : undefined);
    for (const r of await db.selectDistinct({ id: changesets.personId }).from(changesets).where(range)) add(r.id);
    const momentRange = and(eq(moments.documentKind, d.kind), eq(moments.documentId, d.id), d.upTo !== null ? lte(moments.version, d.upTo) : undefined);
    for (const r of await db.selectDistinct({ id: moments.personId }).from(moments).where(momentRange)) add(r.id);
    if (!ctx.writers.only) for (const r of await db.select({ userId: reviewState.userId }).from(reviewState).where(and(eq(reviewState.documentKind, d.kind), eq(reviewState.documentId, d.id)))) add(personOf(ctx, r.userId));
  }
  const editionIds = ctx.editionRows.map((e) => e.id);
  if (editionIds.length) {
    for (const r of await db.selectDistinct({ id: notes.personId }).from(notes).where(inArray(notes.editionId, editionIds))) add(r.id);
    const working = ctx.editionRows.filter((e) => !ctx.writers.only || ctx.writers.only.editionWorking(e)).map((e) => e.id);
    if (working.length) {
      for (const r of await db.select({ a: editionCollaborators.userId, b: editionCollaborators.grantedBy }).from(editionCollaborators).where(inArray(editionCollaborators.editionId, working))) {
        add(personOf(ctx, r.a));
        add(personOf(ctx, r.b));
      }
      for (const r of await db.selectDistinct({ u: editionSiteReviews.reviewedBy }).from(editionSiteReviews).where(inArray(editionSiteReviews.editionId, working))) add(personOf(ctx, r.u));
      for (const r of await db.selectDistinct({ u: editionSiteKinds.setBy }).from(editionSiteKinds).where(inArray(editionSiteKinds.editionId, working))) add(personOf(ctx, r.u));
    }
  }
  if (ids.size === 0) return [];
  return db.select({ id: persons.id, name: persons.name, orcid: persons.orcid }).from(persons).where(inArray(persons.id, [...ids])).orderBy(asc(persons.id));
}

/** The ids merged into a registry entry, so that they keep resolving after an import elsewhere. */
async function mergedIdsOf(db: Database, survivorId: string) {
  const rows = await db.select().from(registryMerges).where(eq(registryMerges.survivorId, survivorId)).orderBy(asc(registryMerges.oldId));
  return rows.map((r) => ({ id: r.oldId, label: r.label, mergedBy: r.mergedBy, mergedAt: iso(r.mergedAt) }));
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
    if (hash) await db.insert(archiveCommits).values({ id: newId(), workId, commitHash: hash, reason });
    return hash;
  });
}

/**
 * The archive of a work as one person may see it, for a download: written
 * afresh into a temporary repository with one commit (the server's archive
 * history may hold other people's drafts) and streamed as a zip. The
 * temporary directory goes when the stream ends.
 */
export async function filteredArchiveZip(db: Database, work: { id: string; slug: string }, only: ArchiveFilter, storageRoot: string): Promise<Readable> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-export-'));
  const cleanup = () => void rm(tmp, { recursive: true, force: true });
  try {
    const dir = await writeArchive(db, work.id, tmp, { storageRoot, only });
    await commitArchive(dir, `export of ${work.slug}`);
    const child = spawn('git', ['archive', '--format=zip', `--prefix=${work.slug}/`, 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
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
