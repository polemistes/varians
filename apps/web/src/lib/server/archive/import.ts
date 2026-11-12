/**
 * Reading an archive back into an installation: the inverse of writeArchive
 * (Varians Data Format 2; version 1 archives are read too).
 *
 * - Registry records are matched by id, then through the record of merges,
 *   then by a canonical identifier of the same scheme and value; a matched
 *   record's ids are put in place of the archive's throughout its files.
 * - Persons are matched by id, then by ORCID, else made without an account.
 *   Accounts own and maintain records; an owner without an account here is
 *   replaced by the person importing, an author never is.
 * - Each document's history is reconciled with ours (core `reconcile`):
 *   nothing to do, a fast-forward, a merge of disjoint changes, or a
 *   conflict, which is reported and left alone unless the person chose to
 *   keep ours or take theirs. Nothing is ever overwritten silently.
 *
 * The whole import is one transaction, so that a dry run (the preview) is
 * the same import rolled back.
 */

import { withoutLatin } from '$lib/edition/conventions';
import { normalizeSiglum } from '../sigla.ts';
import { markOfBasis } from '../site-marks.ts';
import {
  isDataLicence,
  licenceCompatible,
  licenceInfo,
  newId,
  normalizeRights,
  reconcile,
  ReconcileError,
  type DataLicence,
  type Level,
  type Item,
  type Op,
  type Stream,
  type ZoneGeometry,
} from '@varians/core';
import {
  alignmentConstraints,
  bibliographyItems,
  changesets,
  checkpoints,
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
  versions,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  zones,
  type CanonicalIdentifier,
  type Database,
  type EditionSnapshot,
  type TranscriptionSnapshot,
  type SiglumState,
} from '@varians/db';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { changesBetween } from '../../history/changes.ts';
import { citationsOfWork } from './archive.ts';
import { nameMoment, rebuildSegmentIndex, replaceContent } from '../documents/service.ts';
import { conformStored } from '../conform.ts';
import { pageStrings } from '../../strings/pages.ts';
import {
  canEditEdition,
  canEditTranscription,
  canGrantOnEdition,
  canMaintainWitness,
  canMaintainWork,
  grantsFor,
  isAdministrator,
  isSiteEditor,
  type Actor,
} from '../authz.ts';
import { dataLicence } from '../settings.ts';

/** What to do with a document whose history conflicts with ours: report it and leave it, keep ours (storing theirs unapplied), or take theirs. */
export type ConflictPolicy = 'report' | 'keep' | 'take';

export interface ImportOptions {
  onConflict?: ConflictPolicy;
  /**
   * The account importing, when it is not the installation's operator (the
   * import page): records it may not edit here are left as they are, the
   * registry entries it does not maintain only gain what is missing, and
   * what it brings in is its own.
   */
  actor?: Actor;
  /** Work everything out and roll it back: the preview. */
  dryRun?: boolean;
  /** Where the archive came from, for the message of a merge changeset. */
  source?: string;
}

export type DocumentResult =
  | 'created'
  | 'unchanged'
  | 'fast-forward'
  | 'merged'
  | 'conflict'
  | 'kept'
  | 'taken'
  | 'refused';

export interface DocumentOutcome {
  kind: 'transcription' | 'edition';
  id: string;
  name: string;
  result: DocumentResult;
  /** Changesets stored (applied or kept for their provenance). */
  changesets: number;
  /** For a conflict: the segments concerned, by label where known. */
  segments: string[];
  reason?: string;
}

export interface RegistryMatch {
  kind: 'work' | 'witness';
  incomingId: string;
  localId: string;
  by: 'merge' | 'identifier';
  value?: string;
}

export interface ImportReport {
  workId: string;
  formatVersion: number;
  witnesses: number;
  transcriptions: number;
  editions: number;
  changesets: number;
  documents: DocumentOutcome[];
  persons: { matched: number; created: number; createdNames: string[] };
  matches: RegistryMatch[];
  /** Witnesses with the repository and shelfmark of one here under another id: reported, not acted on. */
  possibleDuplicates: { incomingId: string; name: string; localId: string; localName: string }[];
  warnings: string[];
  dryRun: boolean;
}

class Rollback extends Error {}

/** An import that may not be made: licences that do not go together. Nothing has been written. */
export class ImportRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportRefused';
  }
}

/** A time as the archive writes it, or undefined so that the database's default applies. */
function when(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The fields of a record file without the ones the writer adds for people (names, labels), the schema, and the times, which are read apart. */
function stripped<T extends Record<string, unknown>>(
  record: T,
  ...keys: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const key of ['$schema', 'createdAt', 'updatedAt', 'segmentLabel', ...keys]) delete out[key];
  return out;
}

/**
 * Where an installation keeps a page's image, as an archive names it: kept
 * only in the layout uploads have here (images/<page id>/<file>), for that
 * very page, so that an archive can never name another file of the server.
 */
function storedPath(pageId: string, value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  if (parts.length < 3 || parts[0] !== 'images' || parts[1] !== pageId) return null;
  if (
    parts.some(
      (part) =>
        part === '' || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
    )
  )
    return null;
  return value;
}

/** The editors of an edition as an archive gives them: a list of names, or one string in older archives. */
function editorList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : [];
}

async function dirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** A slug that is free, or the same record's own. */
async function freeSlug(
  db: Database,
  table: typeof works | typeof witnesses | typeof editions,
  given: string,
  id: string,
): Promise<string> {
  // A slug from an archive is made again as slugs are made here: it names folders and addresses, and is never trusted as it comes.
  const wanted =
    String(given ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80) || id.toLowerCase();
  let slug = wanted;
  for (let n = 2; n < 1000; n++) {
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
    if (!row || row.id === id) return slug;
    slug = `${wanted}-${n}`;
  }
  return `${wanted}-${id.slice(-6).toLowerCase()}`;
}

/**
 * The archive's files, read with ids of matched records put in place of the
 * archive's. Ids are unique strings, so the replacement is made on the text.
 */
class ArchiveReader {
  private readonly map = new Map<string, string>();
  private pattern: RegExp | null = null;

  remap(from: string, to: string): void {
    if (from === to) return;
    this.map.set(from, to);
    this.pattern = null;
  }

  id(value: string): string {
    return this.map.get(value) ?? value;
  }

  async text(file: string): Promise<string | null> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return null;
    }
    if (this.map.size === 0) return text;
    this.pattern ??= new RegExp(
      [...this.map.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g',
    );
    return text.replace(this.pattern, (m) => this.map.get(m) ?? m);
  }

  async json<T>(file: string): Promise<T | null> {
    const text = await this.text(file);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** A list from a file: a version 2 file names its list (`{ "$schema", "<key>": [...] }`), a version 1 file is the list itself. */
  async list<T>(file: string, key: string): Promise<T[] | null> {
    const data = await this.json<unknown>(file);
    if (data === null) return null;
    if (Array.isArray(data)) return data as T[];
    const value = (data as Record<string, unknown>)[key];
    return Array.isArray(value) ? (value as T[]) : [];
  }
}

interface IncomingPerson {
  id: string;
  name: string;
  orcid: string | null;
}

interface HistoryLine {
  id: string;
  parentId?: string | null;
  merged?: string[];
  version: number | null;
  personId?: string | null;
  /** Version 1. */
  userId?: string | null;
  userName?: string | null;
  at: string;
  ops: Op[];
  reverse: Op[];
  message: string | null;
}

/** The persons a version 1 archive names: accounts of the installation that wrote it, with their names where given. */
async function personsOfVersion1(reader: ArchiveReader, dir: string): Promise<IncomingPerson[]> {
  const found = new Map<string, string>();
  const add = (id: unknown, name: unknown) => {
    if (typeof id !== 'string' || id === '') return;
    if (!found.has(id) || (typeof name === 'string' && name !== '' && found.get(id) === ''))
      found.set(id, typeof name === 'string' ? name : '');
  };
  const documentDirs = [
    ...(
      await Promise.all(
        (await dirs(path.join(dir, 'witnesses'))).map((w) => dirs(path.join(w, 'transcriptions'))),
      )
    ).flat(),
    ...(await dirs(path.join(dir, 'editions'))),
  ];
  for (const d of documentDirs) {
    const text = await reader.text(path.join(d, 'history.ndjson'));
    for (const line of (text ?? '').split('\n').filter((l) => l.trim() !== '')) {
      const c = JSON.parse(line) as HistoryLine;
      add(c.userId, c.userName);
    }
    for (const m of (await reader.list<{ createdBy?: string | null }>(
      path.join(d, 'moments.json'),
      'moments',
    )) ?? [])
      add(m.createdBy, '');
    const e = await reader.json<{
      notes?: { authorId?: string | null }[];
      collaborators?: { id?: string; name?: string | null }[];
    }>(path.join(d, 'edition.json'));
    for (const n of e?.notes ?? []) add(n.authorId, '');
    for (const c of e?.collaborators ?? []) add(c.id, c.name);
  }
  return [...found].map(([id, name]) => ({ id, name: name || 'Unnamed', orcid: null }));
}

/** Import an archive directory. `userId` is the person importing: owner and maintainer where the archive's accounts are unknown here. */
export async function importArchive(
  db: Database,
  dir: string,
  userId: string,
  options: ImportOptions = {},
): Promise<ImportReport> {
  let report: ImportReport | undefined;
  try {
    await db.transaction(async (tx) => {
      report = await importInto(tx as unknown as Database, dir, userId, options);
      if (options.dryRun) throw new Rollback();
    });
  } catch (cause) {
    if (!(cause instanceof Rollback)) throw cause;
  }
  return report!;
}

/** Which record here an archive's registry record is: by id, through the merges, or by a canonical identifier. */
async function resolveRegistry(
  db: Database,
  kind: 'work' | 'witness',
  id: string,
  identifiers: CanonicalIdentifier[],
): Promise<{ id: string; by?: 'merge' | 'identifier'; value?: string }> {
  const table = kind === 'work' ? works : witnesses;
  const [own] = await db.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (own) return { id };
  // A record merged away here: its survivor, following a chain of merges.
  let current = id;
  for (let i = 0; i < 20; i++) {
    const [merged] = await db
      .select({ survivorId: registryMerges.survivorId })
      .from(registryMerges)
      .where(and(eq(registryMerges.oldId, current), eq(registryMerges.kind, kind)));
    if (!merged) break;
    current = merged.survivorId;
  }
  if (current !== id) return { id: current, by: 'merge' };
  for (const identifier of identifiers) {
    if (!identifier?.value) continue;
    const contains = sql`${table.identifiers} @> ${JSON.stringify([{ scheme: identifier.scheme, value: identifier.value }])}::jsonb`;
    const primary =
      kind === 'work' && identifier.scheme === 'cts'
        ? sql`or ${works.identifier} = ${identifier.value}`
        : sql``;
    const [match] = await db
      .select({ id: table.id })
      .from(table)
      .where(sql`${contains} ${primary}`)
      .limit(1);
    if (match)
      return { id: match.id, by: 'identifier', value: `${identifier.scheme}:${identifier.value}` };
  }
  return { id };
}

function identifierList(value: unknown): CanonicalIdentifier[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is CanonicalIdentifier =>
      !!v &&
      typeof v === 'object' &&
      typeof (v as CanonicalIdentifier).scheme === 'string' &&
      typeof (v as CanonicalIdentifier).value === 'string',
  );
}

function mergeIdentifiers(
  a: CanonicalIdentifier[],
  b: CanonicalIdentifier[],
): CanonicalIdentifier[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((i) => {
    const key = `${i.scheme}\u0000${i.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What a restricted import may touch (ImportOptions.actor). */
interface Guard {
  restricted: boolean;
  maintainsWork(workId: string): Promise<boolean>;
  maintainsWitness(witnessId: string): Promise<boolean>;
  editsDocument(kind: 'transcription' | 'edition', id: string): Promise<boolean>;
  ownsOrEdits(
    table: typeof conjectures | typeof reportedReadings | typeof bibliographyItems,
    id: string,
  ): Promise<boolean>;
  /** Whether the account may change who collaborates on an edition. */
  grantsOn(editionId: string): Promise<boolean>;
  /** The account, for a restricted import. */
  actorId: string | null;
}

async function guardFor(db: Database, actor: Actor | undefined): Promise<Guard> {
  if (!actor || isAdministrator(actor)) {
    const yes = async () => true;
    return {
      restricted: false,
      maintainsWork: yes,
      maintainsWitness: yes,
      editsDocument: yes,
      ownsOrEdits: yes,
      grantsOn: yes,
      actorId: null,
    };
  }
  const grants = await grantsFor(db, actor);
  return {
    restricted: true,
    actorId: actor.id,
    async grantsOn(editionId) {
      const [e] = await db
        .select({ ownerId: editions.ownerId })
        .from(editions)
        .where(eq(editions.id, editionId));
      return !e || canGrantOnEdition(actor, e);
    },
    async maintainsWork(workId) {
      const [w] = await db
        .select({ id: works.id, createdBy: works.createdBy })
        .from(works)
        .where(eq(works.id, workId));
      if (!w) return true;
      const maintainers = (
        await db
          .select({ userId: workMaintainers.userId })
          .from(workMaintainers)
          .where(eq(workMaintainers.workId, workId))
      ).map((m) => m.userId);
      return canMaintainWork(actor, w, maintainers);
    },
    async maintainsWitness(witnessId) {
      const [w] = await db
        .select({ id: witnesses.id, createdBy: witnesses.createdBy })
        .from(witnesses)
        .where(eq(witnesses.id, witnessId));
      if (!w) return true;
      const maintainers = (
        await db
          .select({ userId: witnessMaintainers.userId })
          .from(witnessMaintainers)
          .where(eq(witnessMaintainers.witnessId, witnessId))
      ).map((m) => m.userId);
      return canMaintainWitness(actor, w, maintainers);
    },
    async editsDocument(kind, id) {
      if (kind === 'transcription') {
        const [t] = await db
          .select({ id: transcriptions.id, ownerId: transcriptions.ownerId })
          .from(transcriptions)
          .where(eq(transcriptions.id, id));
        return !t || canEditTranscription(actor, t, grants);
      }
      const [e] = await db
        .select({ id: editions.id, ownerId: editions.ownerId })
        .from(editions)
        .where(eq(editions.id, id));
      return (
        !e || canEditEdition(actor, e, grants.collaboratingEditionIds.has(e.id) ? [actor.id] : [])
      );
    },
    async ownsOrEdits(table, id) {
      if (table === bibliographyItems) {
        const [b] = await db
          .select({ createdBy: bibliographyItems.createdBy })
          .from(bibliographyItems)
          .where(eq(bibliographyItems.id, id));
        return !b || b.createdBy === actor.id || isSiteEditor(actor);
      }
      const t = table as typeof conjectures;
      const [r] = await db.select({ ownerId: t.ownerId }).from(t).where(eq(t.id, id));
      return !r || r.ownerId === actor.id || isSiteEditor(actor);
    },
  };
}

interface Context {
  guard: Guard;
  /** Ids of the records this import wrote or may write to: what its citations may cite from. */
  imported: Set<string>;
  db: Database;
  userId: string;
  options: ImportOptions;
  reader: ArchiveReader;
  warnings: string[];
  /** Accounts here. */
  known: Set<string>;
  /** The archive's person ids to persons here. */
  personMap: Map<string, string>;
  /** Persons here to their accounts. */
  accountOfPerson: Map<string, string>;
  segmentLabel: Map<string, string>;
}

/** An owner or maintainer: the account, or the person importing when it has none here (and always, in a restricted import). */
function owner(ctx: Context, id: string | null | undefined): string {
  return !ctx.guard.restricted && id && ctx.known.has(id) ? id : ctx.userId;
}

/** The person here of a person the archive names. */
function person(ctx: Context, id: string | null | undefined): string | null {
  return id ? (ctx.personMap.get(id) ?? null) : null;
}

/** The account here of a person the archive names, or null when they have none. */
function account(ctx: Context, personId: string | null | undefined): string | null {
  const local = person(ctx, personId);
  return local ? (ctx.accountOfPerson.get(local) ?? null) : null;
}

async function importInto(
  db: Database,
  dir: string,
  userId: string,
  options: ImportOptions,
): Promise<ImportReport> {
  const reader = new ArchiveReader();
  const warnings: string[] = [];
  const matches: RegistryMatch[] = [];
  const possibleDuplicates: ImportReport['possibleDuplicates'] = [];

  // Registry records: which of ours each of the archive's is, before anything is read for good.
  const rawWork = await reader.json<{
    id: string;
    identifier?: string | null;
    identifiers?: unknown;
  }>(path.join(dir, 'work.json'));
  if (!rawWork) throw new Error(`no work.json in ${dir}`);
  const workIdentifiers = [
    ...identifierList(rawWork.identifiers),
    ...(rawWork.identifier ? [{ scheme: 'cts' as const, value: rawWork.identifier }] : []),
  ];
  const guard = await guardFor(db, options.actor);
  const workMatch = await resolveRegistry(db, 'work', rawWork.id, workIdentifiers);
  if (workMatch.id !== rawWork.id) {
    reader.remap(rawWork.id, workMatch.id);
    matches.push({
      kind: 'work',
      incomingId: rawWork.id,
      localId: workMatch.id,
      by: workMatch.by!,
      ...(workMatch.value ? { value: workMatch.value } : {}),
    });
    // Segments of the work here are matched by label.
    const ours = new Map(
      (
        await db
          .select({ id: segments.id, label: segments.label })
          .from(segments)
          .where(eq(segments.workId, workMatch.id))
      ).map((s) => [s.label, s.id] as const),
    );
    const tsv = (await readFile(path.join(dir, 'segments.tsv'), 'utf8').catch(() => '')).split(
      '\n',
    );
    const header = (tsv[0] ?? '').split('\t');
    for (const line of tsv.slice(1).filter((l) => l.trim() !== '')) {
      const fields = line.split('\t');
      const id = fields[header.indexOf('id')]!;
      const label = fields[header.indexOf('label')]!;
      const [exists] = await db
        .select({ id: segments.id })
        .from(segments)
        .where(eq(segments.id, id));
      if (!exists && ours.has(label)) reader.remap(id, ours.get(label)!);
    }
  }
  for (const wdir of await dirs(path.join(dir, 'witnesses'))) {
    const raw = await reader.json<{
      id: string;
      name: string;
      identifiers?: unknown;
      repository?: string | null;
      shelfmark?: string | null;
    }>(path.join(wdir, 'witness.json'));
    if (!raw) continue;
    const match = await resolveRegistry(db, 'witness', raw.id, identifierList(raw.identifiers));
    if (match.id !== raw.id) {
      reader.remap(raw.id, match.id);
      matches.push({
        kind: 'witness',
        incomingId: raw.id,
        localId: match.id,
        by: match.by!,
        ...(match.value ? { value: match.value } : {}),
      });
      // Pages of the witness here are matched by label.
      const ours = new Map(
        (
          await db
            .select({ id: pages.id, label: pages.label })
            .from(pages)
            .where(eq(pages.witnessId, match.id))
        ).map((p) => [p.label, p.id] as const),
      );
      for (const p of (await reader.list<{ id: string; label: string }>(
        path.join(wdir, 'pages.json'),
        'pages',
      )) ?? []) {
        const [exists] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, p.id));
        if (!exists && ours.has(p.label)) reader.remap(p.id, ours.get(p.label)!);
      }
    } else if (raw.repository && raw.shelfmark) {
      const [same] = await db
        .select({ id: witnesses.id, name: witnesses.name })
        .from(witnesses)
        .where(
          sql`lower(trim(${witnesses.repository})) = lower(trim(${raw.repository})) and lower(trim(${witnesses.shelfmark})) = lower(trim(${raw.shelfmark})) and ${witnesses.id} <> ${raw.id}`,
        )
        .limit(1);
      if (same)
        possibleDuplicates.push({
          incomingId: raw.id,
          name: raw.name,
          localId: same.id,
          localName: same.name,
        });
    }
  }

  const work = await reader.json<{
    formatVersion?: number;
    id: string;
    slug: string;
    title: string;
    author: string | null;
    /** Written on or before 12 November 2026: the language of the words, read as the language of a token without one. */
    language?: unknown;
    identifier: string | null;
    identifiers?: unknown;
    description: string | null;
    scheme: {
      id: string;
      name: string;
      levels: Level[];
      createdBy?: string | null;
      createdAt?: string | null;
    } | null;
    maintainers?: { id: string; name: string | null; since?: string | null }[];
    mergedIds?: { id: string; label: string; mergedBy?: string | null; mergedAt?: string | null }[];
    createdBy?: string | null;
    createdAt?: string | null;
  }>(path.join(dir, 'work.json'));
  if (!work) throw new Error(`no work.json in ${dir}`);
  const formatVersion = typeof work.formatVersion === 'number' ? work.formatVersion : 1;
  // The language of the words of an archive written before every word carried its own.
  const wordsOf = (content: Stream): Stream =>
    withWordLanguages(content, typeof work.language === 'string' ? work.language : undefined);

  await checkLicences(reader, dir);
  const known = new Set((await db.select({ id: users.id }).from(users)).map((u) => u.id));
  const ctx: Context = {
    guard,
    imported: new Set(),
    db,
    userId,
    options,
    reader,
    warnings,
    known,
    personMap: new Map(),
    accountOfPerson: new Map(),
    segmentLabel: new Map(),
  };

  // Persons: by id, then ORCID, else new and without an account.
  const incomingPersons =
    (await reader.list<IncomingPerson>(path.join(dir, 'persons.json'), 'persons')) ??
    (await personsOfVersion1(reader, dir));
  let matched = 0;
  const createdNames: string[] = [];
  for (const p of incomingPersons) {
    const [byId] = await db.select({ id: persons.id }).from(persons).where(eq(persons.id, p.id));
    if (byId) {
      ctx.personMap.set(p.id, byId.id);
      matched++;
      continue;
    }
    if (p.orcid) {
      const [byOrcid] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.orcid, p.orcid));
      if (byOrcid) {
        ctx.personMap.set(p.id, byOrcid.id);
        matched++;
        continue;
      }
    }
    await db
      .insert(persons)
      .values({ id: p.id, name: p.name || 'Unnamed', orcid: p.orcid ?? null, userId: null });
    ctx.personMap.set(p.id, p.id);
    createdNames.push(p.name);
  }
  const localPersonIds = [...new Set(ctx.personMap.values())];
  if (localPersonIds.length) {
    for (const r of await db
      .select({ id: persons.id, userId: persons.userId })
      .from(persons)
      .where(and(inArray(persons.id, localPersonIds), isNotNull(persons.userId)))) {
      // A restricted import links no one to an account but the account importing: authorship is kept by person, permissions are not given away.
      if (guard.restricted && r.userId !== guard.actorId) continue;
      ctx.accountOfPerson.set(r.id, r.userId!);
    }
  }

  if (!work.scheme) throw new Error('work.json has no scheme');
  await db
    .insert(referenceSchemes)
    .values({
      id: work.scheme.id,
      name: work.scheme.name,
      levels: work.scheme.levels,
      createdBy: owner(ctx, work.scheme.createdBy),
      createdAt: when(work.scheme.createdAt),
    })
    // A scheme is shared by the works that use it: a restricted import adds one and changes none.
    .onConflictDoUpdate({
      target: referenceSchemes.id,
      set: { name: work.scheme.name, levels: work.scheme.levels },
      ...(guard.restricted ? { where: sql`false` } : {}),
    });
  const [existingWork] = await db
    .select({ identifiers: works.identifiers, schemeId: works.schemeId })
    .from(works)
    .where(eq(works.id, work.id));
  const identifiers = mergeIdentifiers(
    existingWork?.identifiers ?? [],
    identifierList(work.identifiers),
  );
  const slug = await freeSlug(db, works, work.slug, work.id);
  const maintainsWork = await guard.maintainsWork(work.id);
  if (existingWork && !maintainsWork) {
    // A work this account does not maintain is left as it is; what is missing (segments) is added below.
    warnings.push(
      `the work ${work.title} is maintained by others here: its details were left as they are`,
    );
  } else if (existingWork && workMatch.by) {
    // A work matched by identifier or merge keeps its own details; only the identifiers are joined.
    await db.update(works).set({ identifiers }).where(eq(works.id, work.id));
  } else {
    await db
      .insert(works)
      .values({
        id: work.id,
        slug,
        title: work.title,
        author: work.author,
        identifier: work.identifier,
        identifiers,
        description: work.description,
        schemeId: work.scheme.id,
        createdBy: work.createdBy === undefined ? userId : owner(ctx, work.createdBy),
        createdAt: when(work.createdAt),
      })
      .onConflictDoUpdate({
        target: works.id,
        set: {
          slug,
          title: work.title,
          author: work.author,
          identifier: work.identifier,
          identifiers,
          description: work.description,
          schemeId: work.scheme.id,
        },
      });
  }
  if (maintainsWork) {
    for (const m of work.maintainers ?? [])
      await db
        .insert(workMaintainers)
        .values({ workId: work.id, userId: owner(ctx, m.id), createdAt: when(m.since) })
        .onConflictDoNothing();
    await db.insert(workMaintainers).values({ workId: work.id, userId }).onConflictDoNothing();
  }
  for (const m of guard.restricted ? [] : (work.mergedIds ?? [])) {
    await db
      .insert(registryMerges)
      .values({
        oldId: m.id,
        kind: 'work',
        survivorId: work.id,
        label: m.label,
        mergedBy: m.mergedBy && known.has(m.mergedBy) ? m.mergedBy : null,
        mergedAt: when(m.mergedAt),
      })
      .onConflictDoNothing();
  }

  const tsv = (await reader.text(path.join(dir, 'segments.tsv'))) ?? '';
  // Columns by the header's names: version 1 has id, label, sort_key, address; version 2 adds urn and created_at.
  const [header = '', ...lines] = tsv.split('\n');
  const column = new Map(header.split('\t').map((name, i) => [name.trim(), i] as const));
  const cell = (fields: string[], name: string) =>
    column.has(name) ? fields[column.get(name)!] : undefined;
  for (const line of lines.filter((l) => l.trim() !== '')) {
    const fields = line.split('\t');
    const s = {
      id: cell(fields, 'id')!,
      workId: work.id,
      label: cell(fields, 'label')!,
      sortKey: cell(fields, 'sort_key')!,
      address: JSON.parse(cell(fields, 'address') || '{}') as Record<string, string>,
      createdAt: when(cell(fields, 'created_at')),
    };
    ctx.segmentLabel.set(s.id, s.label);
    ctx.imported.add(s.id);
    // A segment of another work under the same id is not touched.
    if (maintainsWork)
      await db
        .insert(segments)
        .values(s)
        .onConflictDoUpdate({
          target: segments.id,
          set: { label: s.label, sortKey: s.sortKey, address: s.address },
          where: eq(segments.workId, work.id),
        });
    else await db.insert(segments).values(s).onConflictDoNothing();
  }
  for (const s of await db
    .select({ id: segments.id, label: segments.label })
    .from(segments)
    .where(eq(segments.workId, work.id)))
    ctx.segmentLabel.set(s.id, s.label);

  const documents: DocumentOutcome[] = [];
  let witnessCount = 0;
  let transcriptionCount = 0;
  for (const wdir of await dirs(path.join(dir, 'witnesses'))) {
    const w = await reader.json<
      typeof witnesses.$inferSelect & {
        slug: string;
        maintainers?: { id: string; since?: string | null }[];
        mergedIds?: {
          id: string;
          label: string;
          mergedBy?: string | null;
          mergedAt?: string | null;
        }[];
      }
    >(path.join(wdir, 'witness.json'));
    if (!w) continue;
    witnessCount++;
    const [existing] = await db
      .select({ identifiers: witnesses.identifiers })
      .from(witnesses)
      .where(eq(witnesses.id, w.id));
    const matchedHere = matches.some((m) => m.kind === 'witness' && m.localId === w.id);
    const maintainsWitness = await guard.maintainsWitness(w.id);
    const witnessIdentifiers = mergeIdentifiers(
      existing?.identifiers ?? [],
      identifierList(w.identifiers),
    );
    if (existing && !maintainsWitness) {
      // Left as it is; missing pages are added below.
    } else if (existing && matchedHere) {
      await db
        .update(witnesses)
        .set({ identifiers: witnessIdentifiers })
        .where(eq(witnesses.id, w.id));
    } else {
      const wslug = await freeSlug(db, witnesses, w.slug, w.id);
      // The fragments flag of archives written before 8 November 2026 is dropped.
      const read = stripped(
        w as unknown as Record<string, unknown>,
        'fragmentary',
        'maintainers',
        'mergedIds',
      ) as Partial<typeof witnesses.$inferInsert>;
      // Archives written before 3 October 2026 knew "papyrus" as a category: it is a manuscript whose material is papyrus.
      const legacy = (read as { category?: string }).category === 'papyrus';
      const fields = {
        ...(legacy
          ? { ...read, category: 'manuscript' as const, material: read.material || 'papyrus' }
          : read),
        identifiers: witnessIdentifiers,
      } as typeof witnesses.$inferInsert;
      await db
        .insert(witnesses)
        .values({
          ...fields,
          slug: wslug,
          createdBy: owner(ctx, w.createdBy),
          createdAt: when(w.createdAt),
        })
        .onConflictDoUpdate({
          target: witnesses.id,
          set: {
            ...fields,
            slug: wslug,
            createdBy: guard.restricted ? sql`${witnesses.createdBy}` : owner(ctx, w.createdBy),
          },
        });
    }
    if (maintainsWitness) {
      for (const m of w.maintainers ?? [])
        await db
          .insert(witnessMaintainers)
          .values({ witnessId: w.id, userId: owner(ctx, m.id), createdAt: when(m.since) })
          .onConflictDoNothing();
      await db.insert(witnessMaintainers).values({ witnessId: w.id, userId }).onConflictDoNothing();
    }
    for (const m of guard.restricted ? [] : (w.mergedIds ?? [])) {
      await db
        .insert(registryMerges)
        .values({
          oldId: m.id,
          kind: 'witness',
          survivorId: w.id,
          label: m.label,
          mergedBy: m.mergedBy && known.has(m.mergedBy) ? m.mergedBy : null,
          mergedAt: when(m.mergedAt),
        })
        .onConflictDoNothing();
    }
    const pageList =
      (await reader.list<{
        id: string;
        label: string;
        position: number;
        image: {
          kind: 'upload' | 'iiif';
          path: string | null;
          iiif: string | null;
          width: number | null;
          height: number | null;
          tiles?: string | null;
          rights?: string | null;
          attribution?: string | null;
          source?: string | null;
        } | null;
        createdAt?: string;
      }>(path.join(wdir, 'pages.json'), 'pages')) ?? [];
    for (const p of pageList) {
      const values = {
        id: p.id,
        witnessId: w.id,
        label: p.label,
        position: p.position,
        imageKind: p.image?.kind ?? null,
        imagePath: storedPath(p.id, p.image?.path),
        imageIiif: p.image?.iiif ?? null,
        imageWidth: p.image?.width ?? null,
        imageHeight: p.image?.height ?? null,
        tilesPath: storedPath(p.id, p.image?.tiles),
        rights: normalizeRights(p.image?.rights),
        attribution: p.image?.attribution ?? null,
        imageSource: p.image?.source ?? null,
        createdAt: when(p.createdAt),
      };
      const [ours] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, p.id));
      // A page matched by label to one of ours keeps our image; a witness maintained by others keeps its pages.
      if (ours && (matchedHere || !maintainsWitness)) continue;
      // A page of another witness under the same id is not touched.
      const { witnessId: _parent, ...update } = values;
      void _parent;
      await db
        .insert(pages)
        .values(values)
        .onConflictDoUpdate({ target: pages.id, set: update, where: eq(pages.witnessId, w.id) });
    }
    for (const tdir of await dirs(path.join(wdir, 'transcriptions'))) {
      const t = await reader.json<{
        id: string;
        name: string;
        witnessId: string;
        ownerId: string;
        version: number;
        keepsWrittenForm: boolean;
        displayAsWritten: boolean;
        description: string | null;
        sources?: string | null;
        /** An SPDX identifier since format 2; free text before. */
        licence?: string | null;
        rightsNote?: string | null;
        createdAt?: string;
        content: Stream;
      }>(path.join(tdir, 'transcription.json'));
      if (!t) continue;
      transcriptionCount++;
      const memory =
        (await reader.list<{ form: string; norm: string; count: number }>(
          path.join(tdir, 'memory.json'),
          'entries',
        )) ?? [];
      const meta = {
        witnessId: w.id,
        name: t.name,
        ownerId: owner(ctx, t.ownerId),
        keepsWrittenForm: t.keepsWrittenForm,
        displayAsWritten: t.displayAsWritten,
        memory,
        description: t.description,
        sources: t.sources ?? null,
        ...licenceFields(t.licence, t.rightsNote),
      };
      const outcome = await importDocument(
        ctx,
        'transcription',
        t.id,
        t.name,
        tdir,
        t.content,
        wordsOf,
        async (content, version) => {
          await db
            .insert(transcriptions)
            .values(
              asNew(ctx, { id: t.id, ...meta, content, version, createdAt: when(t.createdAt) }),
            )
            .onConflictDoUpdate({ target: transcriptions.id, set: keepOwner(ctx, meta) });
        },
      );
      documents.push(outcome);
      if (!applies(outcome)) continue;
      // Its page breaks name pages of the witness here, once each, in their order.
      await conformStored(db, t.id, ctx.userId, pageStrings.history.reorganized);
      const zoneList =
        (await reader.list<{
          id: string;
          pageId: string;
          tokenIds: string[];
          geometry: ZoneGeometry;
          feature: { kind: string; description?: string } | null;
          createdAt?: string;
        }>(path.join(tdir, 'zones.json'), 'zones')) ?? [];
      const rows = zoneList.map((z) => ({
        id: z.id,
        pageId: z.pageId,
        tokenIds: z.tokenIds,
        geometry: z.geometry,
        feature: z.feature,
        createdAt: when(z.createdAt),
        transcriptionId: t.id,
      }));
      if (outcome.result === 'merged' || outcome.result === 'unchanged') {
        // Our zones stay; theirs are added where their words are in the text.
        const [row] = await db
          .select({ content: transcriptions.content })
          .from(transcriptions)
          .where(eq(transcriptions.id, t.id));
        const live = new Set(row!.content.items.map((i) => i.id));
        const usable = rows.filter((z) => z.tokenIds.every((id) => live.has(id)));
        if (usable.length) await db.insert(zones).values(usable).onConflictDoNothing();
      } else {
        await db.delete(zones).where(eq(zones.transcriptionId, t.id));
        if (rows.length) await db.insert(zones).values(rows).onConflictDoNothing();
      }
      await importReviewStates(ctx, tdir, 'transcription', t.id);
      await importVersions(ctx, tdir, 'transcription', t.id, wordsOf);
    }
  }

  const conjectureList =
    (await reader.list<typeof conjectures.$inferSelect & { segmentLabel?: string }>(
      path.join(dir, 'conjectures.json'),
      'conjectures',
    )) ?? [];
  for (const c of conjectureList) {
    // An archive written before a conjecture was public from the start may give its `visibility`; it is not read.
    const fields = stripped(c, 'visibility') as typeof c;
    const values = {
      ...fields,
      workId: work.id,
      ownerId: owner(ctx, c.ownerId),
      createdAt: when(c.createdAt),
    };
    if (await guard.ownsOrEdits(conjectures, c.id)) {
      await db
        .insert(conjectures)
        .values(asNew(ctx, values))
        .onConflictDoUpdate({
          target: conjectures.id,
          set: keepOwner(ctx, values),
          where: eq(conjectures.workId, work.id),
        });
      ctx.imported.add(c.id);
    }
  }
  const reportedList =
    (await reader.list<typeof reportedReadings.$inferSelect & { segmentLabel?: string }>(
      path.join(dir, 'reported-readings.json'),
      'readings',
    )) ?? [];
  for (const r of reportedList) {
    const fields = stripped(r, 'visibility') as typeof r;
    const values = {
      ...fields,
      workId: work.id,
      ownerId: owner(ctx, r.ownerId),
      createdAt: when(r.createdAt),
    };
    if (await guard.ownsOrEdits(reportedReadings, r.id)) {
      await db
        .insert(reportedReadings)
        .values(asNew(ctx, values))
        .onConflictDoUpdate({
          target: reportedReadings.id,
          set: keepOwner(ctx, values),
          where: eq(reportedReadings.workId, work.id),
        });
      ctx.imported.add(r.id);
    }
  }

  let editionCount = 0;
  for (const edir of await dirs(path.join(dir, 'editions'))) {
    const e = await reader.json<{
      id: string;
      slug: string;
      title: string;
      /** A list of names; one string in archives written before. */
      editors: string[] | string | null;
      preface: string | null;
      ownerId: string;
      version: number;
      conventions: typeof editions.$inferSelect.conventions;
      /** Absent in archives written before editions could be copied. */
      copiedFrom?: typeof editions.$inferSelect.copiedFrom;
      sources?: string | null;
      /** An SPDX identifier since format 2; free text before. */
      licence?: string | null;
      rightsNote?: string | null;
      /** Archives written before 8 November 2026 name the state before correction as originalSiglum. */
      sigla: {
        siglum: string;
        witnessId: string;
        transcriptionId: string | null;
        states?: SiglumState[];
        originalSiglum?: string | null;
        variantSiglum?: string | null;
      }[];
      /** Conjecture ids; objects with the time of adoption since format 2. */
      adoptions: (string | { conjectureId: string; at?: string | null })[];
      /** Persons since format 2; accounts (id, name) before. */
      collaborators?: {
        personId?: string;
        id?: string;
        grantedBy?: string | null;
        since?: string | null;
      }[];
      notes: {
        id: string;
        segmentId: string;
        tokenIds: string[];
        text: string;
        personId?: string | null;
        authorId?: string | null;
        createdAt?: string;
      }[];
      /** Absent in archives written before sites could be given a kind; `kind: "unreported"` is how archives of one day wrote a minor place. */
      siteKinds?: {
        segmentId: string;
        siteKey: string;
        kind?: string;
        minor?: boolean;
        personId?: string | null;
        setBy?: string | null;
        setAt?: string | null;
      }[];
      createdAt?: string;
      content: Stream;
    }>(path.join(edir, 'edition.json'));
    if (!e) continue;
    editionCount++;
    const eslug = await freeSlug(db, editions, e.slug, e.id);
    const meta = {
      workId: work.id,
      slug: eslug,
      title: e.title,
      editors: editorList(e.editors),
      preface: e.preface,
      ownerId: owner(ctx, e.ownerId),
      // An archive written before November 2026 may carry `latin`, which is ignored.
      conventions: withoutLatin(e.conventions),
      copiedFrom: e.copiedFrom
        ? { ...e.copiedFrom, editors: editorList((e.copiedFrom as { editors?: unknown }).editors) }
        : null,
      sources: e.sources ?? null,
      ...licenceFields(e.licence, e.rightsNote),
    };
    const outcome = await importDocument(
      ctx,
      'edition',
      e.id,
      e.title,
      edir,
      e.content,
      wordsOf,
      async (content, version) => {
        await db
          .insert(editions)
          .values(asNew(ctx, { id: e.id, ...meta, content, version, createdAt: when(e.createdAt) }))
          .onConflictDoUpdate({ target: editions.id, set: keepOwner(ctx, meta) });
      },
    );
    documents.push(outcome);
    if (!applies(outcome)) continue;
    ctx.imported.add(e.id);
    await db.delete(editionSigla).where(eq(editionSigla.editionId, e.id));
    if (e.sigla.length)
      await db
        .insert(editionSigla)
        .values(e.sigla.map((s, i) => ({ editionId: e.id, position: i, ...normalizeSiglum(s) })));
    await db.delete(editionAdoptions).where(eq(editionAdoptions.editionId, e.id));
    const adoptions = (e.adoptions ?? []).map((a) =>
      typeof a === 'string' ? { conjectureId: a, at: null } : a,
    );
    if (adoptions.length) {
      await db
        .insert(editionAdoptions)
        .values(
          adoptions.map((a) => ({
            editionId: e.id,
            conjectureId: a.conjectureId,
            createdAt: when(a.at),
          })),
        )
        .onConflictDoNothing();
    }
    // Collaborators are accounts: only persons who have one here are kept; and only someone who may grant on the edition changes them.
    if (await guard.grantsOn(e.id))
      await db.delete(editionCollaborators).where(eq(editionCollaborators.editionId, e.id));
    const collaborators = (e.collaborators ?? [])
      .map((c) => ({
        userId: account(ctx, c.personId ?? c.id),
        grantedBy: account(ctx, c.grantedBy),
        since: c.since,
      }))
      .filter(
        (c): c is { userId: string; grantedBy: string | null; since: string | null | undefined } =>
          c.userId !== null,
      );
    if (collaborators.length && (await guard.grantsOn(e.id))) {
      await db
        .insert(editionCollaborators)
        .values(
          collaborators.map((c) => ({
            editionId: e.id,
            userId: c.userId,
            grantedBy: c.grantedBy,
            createdAt: when(c.since),
          })),
        )
        .onConflictDoNothing();
    }
    for (const n of e.notes ?? []) {
      const author = n.personId ?? n.authorId;
      const noteValues = {
        id: n.id,
        editionId: e.id,
        segmentId: n.segmentId,
        tokenIds: n.tokenIds,
        text: n.text,
        personId: person(ctx, author),
        authorId: account(ctx, author),
        createdAt: when(n.createdAt),
      };
      // A note of another edition under the same id is not touched.
      await db
        .insert(notes)
        .values(noteValues)
        .onConflictDoUpdate({
          target: notes.id,
          set: noteValues,
          where: eq(notes.editionId, e.id),
        });
      ctx.imported.add(n.id);
    }
    await db.delete(editionSiteKinds).where(eq(editionSiteKinds.editionId, e.id));
    // An entry that says neither a kind nor that the place is minor says nothing.
    const kinds = (e.siteKinds ?? []).flatMap((k) => {
      const mark = markOfBasis(k);
      return mark.kind || mark.minor
        ? [{ ...k, kind: mark.kind ?? null, minor: mark.minor === true }]
        : [];
    });
    if (kinds.length) {
      await db
        .insert(editionSiteKinds)
        .values(
          kinds.map((k) => ({
            editionId: e.id,
            segmentId: k.segmentId,
            siteKey: k.siteKey,
            kind: k.kind,
            minor: k.minor,
            setBy: account(ctx, k.personId ?? k.setBy),
            setAt: when(k.setAt),
          })),
        )
        .onConflictDoNothing();
    }
    const alignment = await reader.list<{
      id: string;
      segmentId: string;
      baseTokenIds: string[];
      transcriptionId: string;
      witnessTokenIds: string[];
      createdAt?: string;
    }>(path.join(edir, 'alignment.json'), 'constraints');
    if (alignment) {
      await db.delete(alignmentConstraints).where(eq(alignmentConstraints.editionId, e.id));
      const transcriptionIds = new Set(
        (alignment.length
          ? await db
              .select({ id: transcriptions.id })
              .from(transcriptions)
              .where(
                inArray(
                  transcriptions.id,
                  alignment.map((a) => a.transcriptionId),
                ),
              )
          : []
        ).map((t) => t.id),
      );
      const usable = alignment.filter((a) => transcriptionIds.has(a.transcriptionId));
      if (usable.length < alignment.length)
        warnings.push(
          `${alignment.length - usable.length} alignment constraint(s) of ${e.slug} name a transcription this installation does not have`,
        );
      if (usable.length) {
        await db
          .insert(alignmentConstraints)
          .values(
            usable.map((a) => ({
              id: a.id,
              editionId: e.id,
              segmentId: a.segmentId,
              baseTokenIds: a.baseTokenIds,
              transcriptionId: a.transcriptionId,
              witnessTokenIds: a.witnessTokenIds,
              createdAt: when(a.createdAt),
            })),
          )
          .onConflictDoNothing();
      }
    }
    const reviews = await reader.json<{
      sites?: {
        segmentId: string;
        siteKey: string;
        personId?: string | null;
        reviewedBy?: string | null;
        reviewedAt?: string | null;
      }[];
    }>(path.join(edir, 'reviews.json'));
    if (reviews?.sites) {
      await db.delete(editionSiteReviews).where(eq(editionSiteReviews.editionId, e.id));
      if (reviews.sites.length) {
        await db
          .insert(editionSiteReviews)
          .values(
            reviews.sites.map((r) => ({
              editionId: e.id,
              segmentId: r.segmentId,
              siteKey: r.siteKey,
              reviewedBy: account(ctx, r.personId ?? r.reviewedBy),
              reviewedAt: when(r.reviewedAt),
            })),
          )
          .onConflictDoNothing();
      }
    }
    await importReviewStates(ctx, edir, 'edition', e.id);
    await importVersions(ctx, edir, 'edition', e.id, wordsOf);
  }

  const items =
    (await reader.list<{
      id: string;
      entryType: string;
      citationKey: string;
      fields: Record<string, string>;
      label: string;
      createdBy?: string | null;
      createdAt?: string;
    }>(path.join(dir, 'bibliography.json'), 'items')) ?? [];
  // An entry whose key this installation already has under another id: the citations go to that entry.
  const sameItem = new Map<string, string>();
  for (const item of items) {
    const [byKey] = await db
      .select({ id: bibliographyItems.id })
      .from(bibliographyItems)
      .where(eq(bibliographyItems.citationKey, item.citationKey));
    if (byKey && byKey.id !== item.id) {
      sameItem.set(item.id, byKey.id);
      warnings.push(
        `bibliography key ${item.citationKey} already exists with another id; its citations now cite the existing entry`,
      );
      continue;
    }
    if (!(await guard.ownsOrEdits(bibliographyItems, item.id))) continue;
    await db
      .insert(bibliographyItems)
      .values({
        id: item.id,
        entryType: item.entryType,
        citationKey: item.citationKey,
        fields: item.fields,
        label: item.label,
        createdBy: item.createdBy === undefined ? userId : owner(ctx, item.createdBy),
        createdAt: when(item.createdAt),
      })
      .onConflictDoUpdate({
        target: bibliographyItems.id,
        set: {
          entryType: item.entryType,
          citationKey: item.citationKey,
          fields: item.fields,
          label: item.label,
        },
      });
  }
  const citationList =
    (await reader.list<typeof citations.$inferSelect>(
      path.join(dir, 'citations.json'),
      'citations',
    )) ?? [];
  for (const c of citationList) {
    const fields = stripped(c) as typeof c;
    // A restricted import adds citations only to records it brought in or may change.
    const targets = [
      fields.conjectureId,
      fields.reportedReadingId,
      fields.noteId,
      fields.editionId,
      fields.segmentId,
    ].filter((t): t is string => !!t);
    if (guard.restricted && !targets.every((t) => ctx.imported.has(t))) continue;
    await db
      .insert(citations)
      .values({
        ...fields,
        itemId: sameItem.get(fields.itemId) ?? fields.itemId,
        createdAt: when(c.createdAt),
      })
      .onConflictDoNothing();
  }

  return {
    workId: work.id,
    formatVersion,
    witnesses: witnessCount,
    transcriptions: transcriptionCount,
    editions: editionCount,
    changesets: documents.reduce((n, d) => n + d.changesets, 0),
    documents,
    persons: { matched, created: createdNames.length, createdNames },
    matches,
    possibleDuplicates,
    warnings,
    dryRun: options.dryRun ?? false,
  };
}

/** A record's licence as an archive gives it: an SPDX identifier (format 2) is the licence; free text (format 1) is a note on rights. */
function licenceFields(
  licence: string | null | undefined,
  rightsNote: string | null | undefined,
): { licenceId: string | null; rightsNote: string | null } {
  if (isDataLicence(licence)) return { licenceId: licence, rightsNote: rightsNote ?? null };
  const free = typeof licence === 'string' && licence.trim() !== '' ? licence.trim() : null;
  return { licenceId: null, rightsNote: rightsNote ?? free };
}

/**
 * The fields of an existing record to update: a restricted import never
 * changes who owns it, nor where it belongs
 * (its work, its witness, its address); those are its owner's to change.
 */
function keepOwner<T extends Record<string, unknown>>(ctx: Context, meta: T): Partial<T> {
  if (!ctx.guard.restricted) return meta;
  const rest: Record<string, unknown> = { ...meta };
  for (const key of [
    'ownerId',
    'workId',
    'witnessId',
    'slug',
    'licenceId',
  ])
    delete rest[key];
  return rest as Partial<T>;
}

/** What a restricted import brings in new is a draft: it brings no versions (`importVersions`), publishing being done here. */
function asNew<T extends Record<string, unknown>>(_ctx: Context, values: T): T {
  return values;
}

/** Whether a document's own records (zones, conspectus, notes and the rest) are taken from the archive: not when its text conflicts and ours is kept. */
function applies(outcome: DocumentOutcome): boolean {
  return outcome.result !== 'conflict' && outcome.result !== 'kept' && outcome.result !== 'refused';
}

/**
 * Whether the archive's records may be published here (Data Format 2,
 * 10.2): CC0 anywhere, CC BY into CC BY and CC BY-SA, CC BY-SA into CC BY-SA
 * only. Refused before anything is written, naming both licences.
 */
async function checkLicences(reader: ArchiveReader, dir: string): Promise<void> {
  const target = dataLicence();
  const found = new Set<DataLicence>();
  const work = await reader.json<{ licence?: unknown }>(path.join(dir, 'work.json'));
  if (isDataLicence(work?.licence)) found.add(work.licence);
  for (const wdir of await dirs(path.join(dir, 'witnesses'))) {
    for (const tdir of await dirs(path.join(wdir, 'transcriptions'))) {
      const t = await reader.json<{ licence?: unknown }>(path.join(tdir, 'transcription.json'));
      if (isDataLicence(t?.licence)) found.add(t.licence);
    }
  }
  for (const edir of await dirs(path.join(dir, 'editions'))) {
    const e = await reader.json<{ licence?: unknown }>(path.join(edir, 'edition.json'));
    if (isDataLicence(e?.licence)) found.add(e.licence);
  }
  for (const licence of found) {
    if (!licenceCompatible(licence, target)) {
      throw new ImportRefused(
        `Records licensed under ${licenceInfo(licence)!.name} cannot be published under ${licenceInfo(target)!.name}, the licence of this installation.`,
      );
    }
  }
}

/** The archive's history of a document as changesets: persons here, accounts here, parents (derived from the order in version 1 archives). */
async function readHistory(ctx: Context, dir: string) {
  const text = (await ctx.reader.text(path.join(dir, 'history.ndjson'))) ?? '';
  const lines = text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as HistoryLine);
  const applied = lines
    .filter((c) => c.version !== null && c.version !== undefined)
    .sort((a, b) => a.version! - b.version!);
  let previous: string | null = null;
  for (const c of applied) {
    if (c.parentId === undefined) c.parentId = previous;
    previous = c.id;
  }
  const row = (c: HistoryLine) => {
    const author = c.personId ?? c.userId ?? null;
    return {
      id: c.id,
      parentId: c.parentId ?? null,
      merged: c.merged ?? null,
      version: c.version ?? null,
      personId: person(ctx, author),
      userId: account(ctx, author),
      at: new Date(c.at),
      ops: c.ops,
      reverse: c.reverse,
      message: c.message ?? null,
    };
  };
  return {
    applied: applied.map(row),
    unapplied: lines.filter((c) => c.version === null || c.version === undefined).map(row),
  };
}

type ChangesetValues = Awaited<ReturnType<typeof readHistory>>['applied'][number];

/**
 * Bring one document in: create it, or reconcile its history with ours.
 * `upsert` writes the document's row (metadata always, content and version
 * only when the row is new).
 */
async function importDocument(
  ctx: Context,
  kind: 'transcription' | 'edition',
  id: string,
  name: string,
  dir: string,
  incoming: Stream,
  /** The text as Varians now has it, from the text of an older archive (`withWordLanguages`). */
  wordsOf: (content: Stream) => Stream,
  upsert: (content: Stream, version: number) => Promise<void>,
): Promise<DocumentOutcome> {
  const { db } = ctx;
  const incomingContent = wordsOf(incoming);
  const table = kind === 'transcription' ? transcriptions : editions;
  const history = await readHistory(ctx, dir);
  const [local] = await db
    .select({ version: table.version, content: table.content })
    .from(table)
    .where(eq(table.id, id));
  const outcome = (
    result: DocumentResult,
    stored: number,
    extra: Partial<DocumentOutcome> = {},
  ): DocumentOutcome => ({ kind, id, name, result, changesets: stored, segments: [], ...extra });
  if (local && !(await ctx.guard.editsDocument(kind, id)))
    return outcome('refused', 0, { reason: 'you may not edit it here' });
  const store = async (rows: ChangesetValues[], version: (i: number) => number | null) => {
    let stored = 0;
    for (const [i, c] of rows.entries()) {
      const [held] = await db
        .select({
          id: changesets.id,
          version: changesets.version,
          kind: changesets.documentKind,
          documentId: changesets.documentId,
        })
        .from(changesets)
        .where(eq(changesets.id, c.id));
      const v = version(i);
      // A changeset of another document under the same id is not touched.
      if (held && (held.kind !== kind || held.documentId !== id)) continue;
      if (held) {
        // Held for its provenance, now applied here.
        if (held.version === null && v !== null)
          await db.update(changesets).set({ version: v }).where(eq(changesets.id, c.id));
        continue;
      }
      await db.insert(changesets).values({ ...c, documentKind: kind, documentId: id, version: v });
      stored++;
    }
    return stored;
  };

  if (!local) {
    // New here: the document as it is, with its whole history.
    const version = history.applied.length;
    await upsert(incomingContent, version);
    const stored =
      (await store(history.applied, (i) => i + 1)) + (await store(history.unapplied, () => null));
    await importMoments(ctx, dir, kind, id);
    if (kind === 'transcription') await rebuildSegmentIndex(db, id, incomingContent);
    return outcome('created', stored);
  }

  const ours = await db
    .select({
      id: changesets.id,
      parentId: changesets.parentId,
      merged: changesets.merged,
      version: changesets.version,
      ops: changesets.ops,
      reverse: changesets.reverse,
    })
    .from(changesets)
    .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, id)));
  const head =
    ours.filter((c) => c.version !== null).sort((a, b) => b.version! - a.version!)[0]?.id ?? null;
  const asEntry = <T extends { merged: string[] | null }>(c: T) => ({
    ...c,
    merged: c.merged ?? undefined,
  });
  let r;
  try {
    // With their text, a merge is also checked for words it would carry into another segment.
    r = reconcile(ours.map(asEntry), history.applied.map(asEntry), local.content, {
      head,
      incomingContent,
    });
  } catch (cause) {
    if (!(cause instanceof ReconcileError)) throw cause;
    return outcome('conflict', 0, {
      reason: `the archive's history is not a chain: ${cause.message}`,
    });
  }
  const byId = new Map(history.applied.map((c) => [c.id, c] as const));
  const values = (list: { id: string }[]) => list.map((c) => byId.get(c.id)!).filter(Boolean);

  switch (r.kind) {
    case 'nothing': {
      await upsert(local.content, local.version);
      const stored =
        (await store(values(r.keep), () => null)) + (await store(history.unapplied, () => null));
      await importMoments(ctx, dir, kind, id);
      return outcome('unchanged', stored);
    }
    case 'fast-forward': {
      const apply = values(r.apply);
      const version = local.version + apply.length;
      const stored = await store(apply, (i) => local.version + i + 1);
      const content = wordsOf(r.content);
      await db.update(table).set({ content, version }).where(eq(table.id, id));
      await upsert(content, version);
      await store(history.unapplied, () => null);
      await importMoments(ctx, dir, kind, id);
      if (kind === 'transcription') await rebuildSegmentIndex(db, id, content);
      return outcome('fast-forward', stored);
    }
    case 'merge': {
      const theirs = values(r.theirs);
      let stored = await store(theirs, () => null);
      const version = local.version + 1;
      await db.insert(changesets).values({
        id: newId(),
        documentKind: kind,
        documentId: id,
        version,
        parentId: head,
        merged: theirs.map((c) => c.id),
        userId: ctx.userId,
        ops: r.ops,
        reverse: r.reverse,
        message: ctx.options.source
          ? `merged from ${ctx.options.source}`
          : 'merged from an archive',
      });
      stored++;
      const content = wordsOf(r.content);
      await db.update(table).set({ content, version }).where(eq(table.id, id));
      await upsert(content, version);
      await importMoments(ctx, dir, kind, id);
      if (kind === 'transcription') await rebuildSegmentIndex(db, id, content);
      return outcome('merged', stored);
    }
    case 'conflict': {
      const segmentsConcerned = r.segments.map((s) => ctx.segmentLabel.get(s) ?? s);
      const policy = ctx.options.onConflict ?? 'report';
      const theirs = values(r.theirs);
      if (policy === 'report')
        return outcome('conflict', 0, { segments: segmentsConcerned, reason: r.reason });
      // Either way their history is kept, unapplied, for its provenance.
      const stored = await store(theirs, () => null);
      if (policy === 'keep')
        return outcome('kept', stored, { segments: segmentsConcerned, reason: r.reason });
      // Take theirs: our state is named, and their text becomes a new changeset of the person importing; our changesets stay.
      const date = new Date().toISOString().slice(0, 10);
      await nameMoment(db, kind, id, local.version, `Before import, ${date}`, ctx.userId);
      await replaceContent(
        db,
        kind,
        id,
        ctx.userId,
        local.version,
        incomingContent,
        ctx.options.source
          ? `took the text from ${ctx.options.source}`
          : 'took the text from an archive',
      );
      const [after] = await db
        .select({ version: table.version, content: table.content })
        .from(table)
        .where(eq(table.id, id));
      await upsert(after!.content, after!.version);
      await importMoments(ctx, dir, kind, id);
      return outcome('taken', stored + 1, { segments: segmentsConcerned, reason: r.reason });
    }
  }
}

/**
 * The words of a text from an archive written before every word carried
 * its own language (12 November 2026): a token with a `foreign` mark takes
 * the mark's language, over the whole word, and the mark goes; a token
 * without a language takes `fallback`, the `language` its work.json gave,
 * where there is one. A text whose words all have theirs is returned as it is.
 */
export function withWordLanguages(content: Stream, fallback: string | undefined): Stream {
  const needs = (item: Item) =>
    item.kind === 'token' &&
    ((item.lang === undefined && fallback !== undefined) ||
      (item.marks ?? []).some((m) => m.kind === 'foreign'));
  if (!content.items.some(needs)) return content;
  return {
    ...content,
    items: content.items.map((item) => {
      if (item.kind !== 'token' || !needs(item)) return item;
      const foreign = (item.marks ?? []).find(
        (m) => m.kind === 'foreign' && typeof m.attrs?.lang === 'string',
      );
      const marks = (item.marks ?? []).filter((m) => m.kind !== 'foreign');
      const { marks: _marks, ...rest } = item;
      void _marks;
      const lang = item.lang ?? (foreign?.attrs?.lang as string | undefined) ?? fallback;
      return {
        ...rest,
        ...(lang !== undefined ? { lang } : {}),
        ...(marks.length > 0 ? { marks } : {}),
      };
    }),
  };
}

/** Named and published moments of a document, kept where the version they name is ours too. */
async function importMoments(
  ctx: Context,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
): Promise<void> {
  const momentList =
    (await ctx.reader.list<{
      id: string;
      version: number;
      name: string;
      kind: 'named' | 'published';
      personId?: string | null;
      createdBy?: string | null;
      at: string;
    }>(path.join(dir, 'moments.json'), 'moments')) ?? [];
  for (const m of momentList) {
    const author = m.personId ?? m.createdBy;
    await ctx.db
      .insert(moments)
      .values({
        id: m.id,
        documentKind: kind,
        documentId,
        version: m.version,
        name: m.name,
        kind: m.kind,
        personId: person(ctx, author),
        createdBy: account(ctx, author),
        at: new Date(m.at),
      })
      .onConflictDoNothing();
  }
}

/**
 * The versions of a document (Data Format 2, 4.12): each listed in
 * versions.json and not yet here is made from the files of its directory,
 * versions/<n>/, which are its snapshot; a withdrawal is taken over by one
 * already here. A version this installation numbers otherwise is left as it
 * is, and a restricted import brings none, publishing being done here.
 * Archives written before versions existed have none to read: their
 * published moments are moments only.
 */
async function importVersions(
  ctx: Context,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
  wordsOf: (content: Stream) => Stream,
): Promise<void> {
  if (ctx.guard.restricted) return;
  const { db, reader } = ctx;
  const list =
    (await reader.list<{
      id: string;
      number: number;
      version: number;
      momentId?: string | null;
      note?: string | null;
      personId?: string | null;
      at: string;
      withdrawn?: { at: string; personId?: string | null; note?: string | null } | null;
    }>(path.join(dir, 'versions.json'), 'versions')) ?? [];
  for (const v of list) {
    if (!Number.isInteger(v.number) || v.number < 1) continue;
    const [here] = await db
      .select({ id: versions.id, withdrawnAt: versions.withdrawnAt })
      .from(versions)
      .where(
        and(
          eq(versions.documentKind, kind),
          eq(versions.documentId, documentId),
          eq(versions.number, v.number),
        ),
      );
    if (here) {
      // The same version: withdrawn there, withdrawn here too. Another under the same number is ours to keep.
      if (here.id === v.id && v.withdrawn && !here.withdrawnAt)
        await db
          .update(versions)
          .set({
            withdrawnAt: when(v.withdrawn.at) ?? new Date(),
            withdrawnBy: person(ctx, v.withdrawn.personId),
            withdrawalNote: v.withdrawn.note ?? null,
          })
          .where(eq(versions.id, here.id));
      continue;
    }
    const vdir = path.join(dir, 'versions', String(v.number));
    const snapshot =
      kind === 'transcription'
        ? await transcriptionSnapshotFrom(ctx, vdir, wordsOf)
        : await editionSnapshotFrom(ctx, vdir, wordsOf);
    if (!snapshot) {
      ctx.warnings.push(`version ${v.number} of ${documentId} has no files and is left out`);
      continue;
    }
    const [moment] = v.momentId
      ? await db.select({ id: moments.id }).from(moments).where(eq(moments.id, v.momentId))
      : [];
    const [taken] = await db.select({ id: versions.id }).from(versions).where(eq(versions.id, v.id));
    // versions.json lists no changes: they are made here, from the text of the version before and of this one.
    const [before] = await db
      .select({ version: versions.version, snapshot: versions.snapshot })
      .from(versions)
      .where(
        and(
          eq(versions.documentKind, kind),
          eq(versions.documentId, documentId),
          lt(versions.number, v.number),
        ),
      )
      .orderBy(desc(versions.number))
      .limit(1);
    const changes = changesBetween(
      before?.snapshot.content ?? { items: [] },
      snapshot.content,
      before?.version ?? 0,
      v.version,
      [],
      (id) => ctx.segmentLabel.get(id) ?? null,
    );
    await db.insert(versions).values({
      id: taken ? newId() : v.id,
      documentKind: kind,
      documentId,
      number: v.number,
      version: v.version,
      momentId: moment?.id ?? null,
      note: v.note ?? null,
      personId: person(ctx, v.personId),
      createdBy: account(ctx, v.personId),
      at: when(v.at) ?? new Date(),
      withdrawnAt: v.withdrawn ? (when(v.withdrawn.at) ?? new Date()) : null,
      withdrawnBy: v.withdrawn ? person(ctx, v.withdrawn.personId) : null,
      withdrawalNote: v.withdrawn?.note ?? null,
      snapshot,
      changes,
    });
  }
}

/** A row of a version's file with its times kept as the strings they are. */
type FileRow = Record<string, unknown> & { id: string };

/** A transcription's snapshot from the files of a version's directory. */
async function transcriptionSnapshotFrom(
  ctx: Context,
  vdir: string,
  wordsOf: (content: Stream) => Stream,
): Promise<TranscriptionSnapshot | null> {
  const t = await ctx.reader.json<{
    name: string;
    witnessId: string;
    description?: string | null;
    sources?: string | null;
    licence?: string | null;
    rightsNote?: string | null;
    keepsWrittenForm?: boolean;
    displayAsWritten?: boolean;
    content: Stream;
  }>(path.join(vdir, 'transcription.json'));
  if (!t) return null;
  const zoneList =
    (await ctx.reader.list<{
      id: string;
      pageId: string;
      tokenIds: string[];
      geometry: ZoneGeometry;
      feature: { kind: string; description?: string } | null;
      createdAt?: string | null;
    }>(path.join(vdir, 'zones.json'), 'zones')) ?? [];
  const licence = licenceFields(t.licence, t.rightsNote);
  return {
    name: t.name,
    witnessId: t.witnessId,
    description: t.description ?? null,
    sources: t.sources ?? null,
    rightsNote: licence.rightsNote,
    licenceId: licence.licenceId,
    keepsWrittenForm: t.keepsWrittenForm ?? false,
    displayAsWritten: t.displayAsWritten ?? false,
    content: wordsOf(t.content),
    zones: zoneList.map((z) => ({
      id: z.id,
      pageId: z.pageId,
      tokenIds: z.tokenIds,
      geometry: z.geometry,
      feature: z.feature ?? null,
      createdAt: z.createdAt ?? new Date(0).toISOString(),
    })),
  };
}

/** An edition's snapshot from the edition.json of a version's directory, with the members a version's has besides. */
async function editionSnapshotFrom(
  ctx: Context,
  vdir: string,
  wordsOf: (content: Stream) => Stream,
): Promise<EditionSnapshot | null> {
  const e = await ctx.reader.json<{
    title: string;
    editors?: string[] | string | null;
    preface?: string | null;
    sources?: string | null;
    licence?: string | null;
    rightsNote?: string | null;
    conventions: EditionSnapshot['conventions'];
    copiedFrom?: EditionSnapshot['copiedFrom'];
    content: Stream;
    sigla?: {
      siglum: string;
      witnessId: string;
      transcriptionId: string | null;
      states?: SiglumState[];
      originalSiglum?: string | null;
      variantSiglum?: string | null;
    }[];
    witnessVersions?: Record<string, number>;
    adoptions?: (string | { conjectureId: string; at?: string | null })[];
    notes?: {
      id: string;
      segmentId: string;
      tokenIds: string[];
      text: string;
      personId?: string | null;
      createdAt?: string | null;
    }[];
    siteKinds?: {
      segmentId: string;
      siteKey: string;
      kind?: string;
      minor?: boolean;
      personId?: string | null;
      setAt?: string | null;
    }[];
    conjectures?: FileRow[];
    readings?: FileRow[];
    citations?: FileRow[];
    bibliography?: FileRow[];
    constraints?: FileRow[];
  }>(path.join(vdir, 'edition.json'));
  if (!e) return null;
  const notePersons = [
    ...new Set((e.notes ?? []).map((n) => person(ctx, n.personId)).filter((id) => id !== null)),
  ] as string[];
  const names = new Map(
    notePersons.length
      ? (
          await ctx.db
            .select({ id: persons.id, name: persons.name })
            .from(persons)
            .where(inArray(persons.id, notePersons))
        ).map((p) => [p.id, p.name] as const)
      : [],
  );
  const licence = licenceFields(e.licence, e.rightsNote);
  // What the writer adds for people (labels) is not part of the record.
  const withoutLabel = <T extends FileRow>(row: T) => stripped(row, 'segmentLabel') as T;
  return {
    title: e.title,
    editors: editorList(e.editors ?? null),
    preface: e.preface ?? null,
    sources: e.sources ?? null,
    rightsNote: licence.rightsNote,
    licenceId: licence.licenceId,
    conventions: withoutLatin(e.conventions),
    copiedFrom: e.copiedFrom ?? null,
    content: wordsOf(e.content),
    sigla: (e.sigla ?? []).map((s) => {
      const n = normalizeSiglum(s);
      return {
        siglum: n.siglum,
        witnessId: n.witnessId,
        transcriptionId: n.transcriptionId,
        states: n.states,
        variantSiglum: n.variantSiglum,
      };
    }),
    witnessVersions: e.witnessVersions ?? {},
    adoptions: (e.adoptions ?? []).map((a) =>
      typeof a === 'string' ? { conjectureId: a, at: null } : { conjectureId: a.conjectureId, at: a.at ?? null },
    ),
    notes: (e.notes ?? []).map((n) => {
      const local = person(ctx, n.personId);
      return {
        id: n.id,
        segmentId: n.segmentId,
        tokenIds: n.tokenIds,
        text: n.text,
        personId: local,
        author: local ? (names.get(local) ?? null) : null,
        createdAt: n.createdAt ?? null,
      };
    }),
    siteKinds: (e.siteKinds ?? []).flatMap((k) => {
      const mark = markOfBasis(k);
      return mark.kind || mark.minor
        ? [
            {
              segmentId: k.segmentId,
              siteKey: k.siteKey,
              ...(mark.kind ? { kind: mark.kind } : {}),
              ...(mark.minor ? { minor: true as const } : {}),
              personId: person(ctx, k.personId),
              setAt: k.setAt ?? null,
            },
          ]
        : [];
    }),
    conjectures: (e.conjectures ?? []).map(withoutLabel) as unknown as EditionSnapshot['conjectures'],
    readings: (e.readings ?? []).map(withoutLabel) as unknown as EditionSnapshot['readings'],
    citations: (e.citations ?? []) as unknown as EditionSnapshot['citations'],
    bibliography: (e.bibliography ?? []) as unknown as EditionSnapshot['bibliography'],
    constraints: (e.constraints ?? []) as unknown as EditionSnapshot['constraints'],
  };
}


/** Each person's review position on a document, for the persons who have an account here. */
async function importReviewStates(
  ctx: Context,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
): Promise<void> {
  const reviews = await ctx.reader.json<{
    states?: { personId?: string; userId?: string; fromVersion: number; accepted: string[] }[];
  }>(path.join(dir, 'reviews.json'));
  for (const s of reviews?.states ?? []) {
    const userId = account(ctx, s.personId ?? s.userId);
    if (!userId) continue;
    await ctx.db
      .insert(reviewState)
      .values({
        documentKind: kind,
        documentId,
        userId,
        fromVersion: s.fromVersion,
        accepted: s.accepted,
      })
      .onConflictDoUpdate({
        target: [reviewState.documentKind, reviewState.documentId, reviewState.userId],
        set: { fromVersion: s.fromVersion, accepted: s.accepted },
      });
  }
}

/** Remove a work and everything only it holds, for a round-trip test: its documents with their history, its witnesses, and the bibliography and scheme only it uses. */
export async function removeWorkCompletely(db: Database, workId: string): Promise<void> {
  const [work] = await db
    .select({ schemeId: works.schemeId })
    .from(works)
    .where(eq(works.id, workId));
  const editionIds = (
    await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))
  ).map((e) => e.id);
  const siglaRows = editionIds.length
    ? await db.select().from(editionSigla).where(inArray(editionSigla.editionId, editionIds))
    : [];
  const assigning = await db
    .selectDistinct({ id: transcriptionSegments.transcriptionId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId));
  const transcriptionIds = [
    ...new Set([
      ...siglaRows.map((s) => s.transcriptionId).filter((id): id is string => id !== null),
      ...assigning.map((c) => c.id),
    ]),
  ];
  const witnessIds = [...new Set(siglaRows.map((s) => s.witnessId))];
  const { items } = await citationsOfWork(db, workId);
  const documentIds = [...transcriptionIds, ...editionIds];
  if (documentIds.length) {
    await db.delete(changesets).where(inArray(changesets.documentId, documentIds));
    await db.delete(moments).where(inArray(moments.documentId, documentIds));
    await db.delete(reviewState).where(inArray(reviewState.documentId, documentIds));
    await db.delete(checkpoints).where(inArray(checkpoints.documentId, documentIds));
  }
  if (transcriptionIds.length)
    await db.delete(transcriptions).where(inArray(transcriptions.id, transcriptionIds));
  await db
    .delete(registryMerges)
    .where(inArray(registryMerges.survivorId, [workId, ...witnessIds]));
  await db.delete(works).where(eq(works.id, workId));
  if (witnessIds.length) await db.delete(witnesses).where(inArray(witnesses.id, witnessIds));
  // Entries no one cites any more, and the scheme no other work uses.
  for (const item of items) {
    const [cited] = await db
      .select({ id: citations.id })
      .from(citations)
      .where(eq(citations.itemId, item.id))
      .limit(1);
    if (!cited) await db.delete(bibliographyItems).where(eq(bibliographyItems.id, item.id));
  }
  if (work) {
    const [other] = await db
      .select({ id: works.id })
      .from(works)
      .where(eq(works.schemeId, work.schemeId))
      .limit(1);
    if (!other) await db.delete(referenceSchemes).where(eq(referenceSchemes.id, work.schemeId));
  }
}
