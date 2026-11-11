/**
 * The registry on the server: works and witnesses as shared entries with
 * their maintainers, the transcriptions that hang off them, and the queries
 * the registry pages load. Conjectures and
 * reported readings are created through conjectures.ts; their catalogue
 * queries, and the update of a reported reading, are here.
 *
 * Nothing here decides who may do what: the routes check authz first. The
 * deletions are the exception, because their refusals are part of the rule
 * (nobody's records are deleted by someone else's action).
 */
import {
  SCHEME_PRESETS,
  defaultProfile,
  deriveTranscription,
  newId,
  segmentIds,
  validateScheme,
  type Address,
  type Level,
  type Scheme,
  type Stream,
} from '@varians/core';
import {
  and,
  asc,
  changesets,
  checkpoints,
  conjectures,
  countDistinct,
  editionCollaborators,
  editionSigla,
  editions,
  eq,
  inArray,
  like,
  moments,
  ne,
  or,
  ownershipOffers,
  pages,
  referenceSchemes,
  reportedReadings,
  reviewState,
  segments,
  sql,
  transcriptionSegments,
  transcriptionWorks,
  transcriptions,
  zones,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  type CanonicalIdentifier,
  type Database,
  type WitnessHand,
  type SQL,
  type Transcription,
  type Witness,
  type Work,
} from '@varians/db';
import { identifierMatches } from './identifier-search.ts';
import { chosenWorks, chosenWorksOf, setChosenWorks } from './transcription-works.ts';
import { joinLevelLabels, keepsAddresses, relabel, separatorsChanged } from '$lib/registry/scheme';
import type {
  ConjectureRow,
  Dependents,
  EditionRef,
  Maintainer,
  PageRow,
  ReadingRow,
  SearchHit,
  TranscriptionOption,
  WitnessOption,
  WitnessTranscriptionRow,
  WitnessWorkRow,
  WorkEditionRow,
  WorkOption,
  WorkTranscriptionRow,
} from '$lib/registry/types';
import { slugify } from '$lib/registry/slug';
import { registry as t } from '$lib/strings/registry';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { archiveWork, folderName } from './archive/archive.ts';
import {
  canDeleteTranscription,
  canViewEdition,
  canViewTranscription,
  isAdministrator,
  isSiteEditor,
  type Actor,
  type Grants,
} from './authz';
import { replaceContent } from './documents/service.ts';

export type {
  ConjectureRow,
  Dependents,
  EditionRef,
  Maintainer,
  PageRow,
  ReadingRow,
  SearchHit,
  TranscriptionOption,
  WitnessOption,
  WitnessTranscriptionRow,
  WitnessWorkRow,
  WorkEditionRow,
  WorkOption,
  WorkTranscriptionRow,
};

/** A transaction, as db.transaction hands it to its callback. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type RegistryErrorCode =
  | 'invalid-scheme'
  | 'scheme-locked'
  | 'label-collision'
  | 'not-found'
  | 'unknown-preset';

/** A refusal with a reason the page can show. */
export class RegistryError extends Error {
  constructor(
    public readonly code: RegistryErrorCode,
    message: string,
    public readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Trims an optional text field; empty becomes null. */
export function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Escapes the wildcards of LIKE so that a value matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const iso = (date: Date) => date.toISOString();

// Slugs

type SlugTable = typeof works | typeof witnesses | typeof editions;

/** The base slug, or the first of base-2, base-3, ... that no row of the table has. */
export async function uniqueSlug(db: Database, table: SlugTable, base: string): Promise<string> {
  const rows = await db
    .select({ slug: table.slug })
    .from(table as typeof works)
    .where(or(eq(table.slug, base), like(table.slug, `${escapeLike(base)}-%`)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Whether an insert failed because another request took the slug first. */
function isSlugConflict(error: unknown): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  } | null;
  const code = e?.code ?? e?.cause?.code;
  const constraint = e?.constraint ?? e?.cause?.constraint ?? '';
  return code === '23505' && constraint.includes('slug');
}

/** Runs an insert with a free slug, trying again with the next one when a concurrent insert took it. */
async function withSlug<T>(
  db: Database,
  table: SlugTable,
  base: string,
  insert: (slug: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const slug = await uniqueSlug(db, table, base);
    try {
      return await insert(slug);
    } catch (error) {
      if (attempt < 3 && isSlugConflict(error)) continue;
      throw error;
    }
  }
}

// Loading entries

export interface WorkRecord {
  work: Work;
  scheme: Scheme;
  maintainerIds: string[];
}

export async function workBySlug(db: Database, slug: string): Promise<WorkRecord | null> {
  const [row] = await db
    .select({ work: works, levels: referenceSchemes.levels })
    .from(works)
    .innerJoin(referenceSchemes, eq(referenceSchemes.id, works.schemeId))
    .where(eq(works.slug, slug));
  if (!row) return null;
  const maintainers = await db
    .select({ userId: workMaintainers.userId })
    .from(workMaintainers)
    .where(eq(workMaintainers.workId, row.work.id));
  return {
    work: row.work,
    scheme: { levels: row.levels },
    maintainerIds: maintainers.map((m) => m.userId),
  };
}

export interface WitnessRecord {
  witness: Witness;
  maintainerIds: string[];
}

export async function witnessBySlug(db: Database, slug: string): Promise<WitnessRecord | null> {
  const [witness] = await db.select().from(witnesses).where(eq(witnesses.slug, slug));
  if (!witness) return null;
  const maintainers = await db
    .select({ userId: witnessMaintainers.userId })
    .from(witnessMaintainers)
    .where(eq(witnessMaintainers.witnessId, witness.id));
  return { witness, maintainerIds: maintainers.map((m) => m.userId) };
}

// Works

export type SchemeInput = { preset: string } | { levels: Level[]; name?: string };

export interface NewWork {
  title: string;
  author?: string | null;
  language: string;
  identifier?: string | null;
  /** Further canonical identifiers, checked by parseIdentifiers. */
  identifiers?: CanonicalIdentifier[];
  description?: string | null;
  scheme: SchemeInput;
}

/** Levels trimmed, with the first level's separator cleared (it is never printed). */
function normalizeLevels(levels: Level[]): Level[] {
  return levels.map((level, index) => ({
    key: level.key.trim(),
    label: level.label.trim(),
    type: level.type,
    separator: index === 0 ? '' : level.separator,
  }));
}

/** A preset by name, or custom levels checked by validateScheme. */
export function resolveSchemeInput(input: SchemeInput): { name: string; levels: Level[] } {
  if ('preset' in input) {
    const preset = SCHEME_PRESETS.find((p) => p.name === input.preset);
    if (!preset) throw new RegistryError('unknown-preset', `no scheme preset "${input.preset}"`);
    return { name: preset.name, levels: preset.scheme.levels.map((l) => ({ ...l })) };
  }
  const levels = normalizeLevels(input.levels);
  const problems = validateScheme({ levels });
  if (problems.length) throw new RegistryError('invalid-scheme', problems.join(' '), problems);
  return { name: input.name?.trim() || schemeName({ levels }), levels };
}

/** The preset's name when the levels are a preset's, else the levels joined: "Book and line". */
export function schemeName(scheme: Scheme): string {
  const preset = SCHEME_PRESETS.find(
    (p) =>
      p.scheme.levels.length === scheme.levels.length &&
      p.scheme.levels.every((l, i) => {
        const o = scheme.levels[i]!;
        return (
          l.key === o.key &&
          l.label === o.label &&
          l.type === o.type &&
          (i === 0 || l.separator === o.separator)
        );
      }),
  );
  return preset?.name ?? joinLevelLabels(scheme);
}

/** Creates the scheme row, the work with the default profile of its language, and the creator as maintainer. */
export async function createWork(db: Database, input: NewWork, userId: string): Promise<Work> {
  const scheme = resolveSchemeInput(input.scheme);
  const title = input.title.trim();
  const language = input.language.trim();
  return withSlug(db, works, slugify(title, 'work'), (slug) =>
    db.transaction(async (tx) => {
      const schemeId = newId();
      await tx
        .insert(referenceSchemes)
        .values({ id: schemeId, name: scheme.name, levels: scheme.levels, createdBy: userId });
      const [work] = await tx
        .insert(works)
        .values({
          id: newId(),
          slug,
          title,
          author: clean(input.author),
          language,
          identifier: clean(input.identifier),
          identifiers: input.identifiers ?? [],
          description: clean(input.description),
          schemeId,
          profile: defaultProfile(language),
          createdBy: userId,
        })
        .returning();
      await tx.insert(workMaintainers).values({ workId: work!.id, userId });
      return work!;
    }),
  );
}

export interface WorkUpdate {
  title?: string;
  author?: string | null;
  language?: string;
  identifier?: string | null;
  identifiers?: CanonicalIdentifier[];
  description?: string | null;
  /** New levels: labels and separators always; keys and types only while the work has no segments. */
  scheme?: { levels: Level[] };
}

/**
 * Gives segments new labels without two rows ever sharing one on the way:
 * first every changed row to a placeholder made from its id, then each to
 * its new label.
 */
async function relabelSegments(tx: Tx, changed: { id: string; label: string }[]): Promise<void> {
  for (let i = 0; i < changed.length; i += 500) {
    const ids = changed.slice(i, i + 500).map((c) => c.id);
    await tx
      .update(segments)
      .set({ label: sql`chr(1) || ${segments.id}` })
      .where(inArray(segments.id, ids));
  }
  for (let i = 0; i < changed.length; i += 500) {
    const rows = changed.slice(i, i + 500).map((c) => sql`(${c.id}::text, ${c.label}::text)`);
    await tx.execute(
      sql`update ${segments} set label = v.label from (values ${sql.join(rows, sql`, `)}) as v(id, label) where ${segments.id} = v.id`,
    );
  }
}

/**
 * Updates the metadata, and the scheme when given. A language change resets
 * the normalization profile to the language's default. A scheme shared with
 * another work is copied first, so the change stays with this work; when the
 * separators change, the segments are relabelled.
 */
export async function updateWork(db: Database, workId: string, fields: WorkUpdate): Promise<Work> {
  const [current] = await db.select().from(works).where(eq(works.id, workId));
  if (!current) throw new RegistryError('not-found', `no work ${workId}`);
  const set: Partial<typeof works.$inferInsert> = {};
  if (fields.title !== undefined) set.title = fields.title.trim();
  if (fields.author !== undefined) set.author = clean(fields.author);
  if (fields.identifier !== undefined) set.identifier = clean(fields.identifier);
  if (fields.identifiers !== undefined) set.identifiers = fields.identifiers;
  if (fields.description !== undefined) set.description = clean(fields.description);
  if (fields.language !== undefined && fields.language.trim() !== current.language) {
    set.language = fields.language.trim();
    set.profile = defaultProfile(set.language);
  }
  return db.transaction(async (tx) => {
    if (fields.scheme) {
      const levels = normalizeLevels(fields.scheme.levels);
      const problems = validateScheme({ levels });
      if (problems.length) throw new RegistryError('invalid-scheme', problems.join(' '), problems);
      const [scheme] = await tx
        .select()
        .from(referenceSchemes)
        .where(eq(referenceSchemes.id, current.schemeId));
      if (!scheme) throw new RegistryError('not-found', `no scheme ${current.schemeId}`);
      const before: Scheme = { levels: scheme.levels };
      const after: Scheme = { levels };
      const rows = await tx
        .select({ id: segments.id, address: segments.address, label: segments.label })
        .from(segments)
        .where(eq(segments.workId, workId));
      if (rows.length > 0 && !keepsAddresses(before, after)) {
        throw new RegistryError(
          'scheme-locked',
          'the work has segments; only labels and separators may change',
        );
      }
      if (rows.length > 0 && separatorsChanged(before, after)) {
        const { changed, collisions } = relabel(
          after,
          rows as { id: string; address: Address; label: string }[],
        );
        if (collisions.length) {
          throw new RegistryError(
            'label-collision',
            `labels would collide: ${collisions.join(', ')}`,
            collisions,
          );
        }
        if (changed.length) await relabelSegments(tx, changed);
      }
      const [{ n: sharers }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(works)
        .where(eq(works.schemeId, current.schemeId))) as [{ n: number }];
      const name = schemeName(after);
      if (sharers > 1) {
        // Another work uses this scheme row: this work gets its own.
        const schemeId = newId();
        await tx
          .insert(referenceSchemes)
          .values({ id: schemeId, name, levels, createdBy: current.createdBy });
        set.schemeId = schemeId;
      } else {
        await tx
          .update(referenceSchemes)
          .set({ name, levels })
          .where(eq(referenceSchemes.id, current.schemeId));
      }
    }
    if (Object.keys(set).length === 0) return current;
    const [updated] = await tx.update(works).set(set).where(eq(works.id, workId)).returning();
    return updated!;
  });
}

// Maintainers

export type MaintainerKind = 'work' | 'witness';

async function creatorOf(db: Database, kind: MaintainerKind, id: string): Promise<string | null> {
  const table = kind === 'work' ? works : witnesses;
  const [row] = await db.select({ createdBy: table.createdBy }).from(table).where(eq(table.id, id));
  if (!row) throw new RegistryError('not-found', `no ${kind} ${id}`);
  return row.createdBy;
}

/** The maintainers of an entry, creator first; the creator counts even without a row. */
export async function maintainersOf(
  db: Database,
  kind: MaintainerKind,
  id: string,
): Promise<Maintainer[]> {
  const creator = await creatorOf(db, kind, id);
  const rows =
    kind === 'work'
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            since: workMaintainers.createdAt,
          })
          .from(workMaintainers)
          .innerJoin(users, eq(users.id, workMaintainers.userId))
          .where(eq(workMaintainers.workId, id))
      : await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            since: witnessMaintainers.createdAt,
          })
          .from(witnessMaintainers)
          .innerJoin(users, eq(users.id, witnessMaintainers.userId))
          .where(eq(witnessMaintainers.witnessId, id));
  const list: Maintainer[] = rows
    .sort((a, b) => a.since.getTime() - b.since.getTime())
    .map((r) => ({ id: r.id, name: r.name, email: r.email, isCreator: r.id === creator }));
  if (creator && !list.some((m) => m.id === creator)) {
    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, creator));
    if (user) list.unshift({ ...user, isCreator: true });
  }
  return list.sort((a, b) => Number(b.isCreator) - Number(a.isCreator));
}

export type AddMaintainerResult =
  | { ok: true; user: Maintainer }
  | { ok: false; error: 'no-user' | 'already' };

/** Adds the account with this email as a maintainer. */
export async function addMaintainer(
  db: Database,
  kind: MaintainerKind,
  id: string,
  email: string,
): Promise<AddMaintainerResult> {
  const creator = await creatorOf(db, kind, id);
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  if (!user) return { ok: false, error: 'no-user' };
  const inserted =
    kind === 'work'
      ? await db
          .insert(workMaintainers)
          .values({ workId: id, userId: user.id })
          .onConflictDoNothing()
          .returning()
      : await db
          .insert(witnessMaintainers)
          .values({ witnessId: id, userId: user.id })
          .onConflictDoNothing()
          .returning();
  if (inserted.length === 0) return { ok: false, error: 'already' };
  return { ok: true, user: { ...user, isCreator: user.id === creator } };
}

export type RemoveMaintainerResult =
  | { ok: true; name: string }
  | { ok: false; error: 'creator' | 'not-maintainer' };

/** Removes a maintainer; the creator stays. */
export async function removeMaintainer(
  db: Database,
  kind: MaintainerKind,
  id: string,
  userId: string,
): Promise<RemoveMaintainerResult> {
  const creator = await creatorOf(db, kind, id);
  if (creator === userId) return { ok: false, error: 'creator' };
  const removed =
    kind === 'work'
      ? await db
          .delete(workMaintainers)
          .where(and(eq(workMaintainers.workId, id), eq(workMaintainers.userId, userId)))
          .returning()
      : await db
          .delete(witnessMaintainers)
          .where(and(eq(witnessMaintainers.witnessId, id), eq(witnessMaintainers.userId, userId)))
          .returning();
  if (removed.length === 0) return { ok: false, error: 'not-maintainer' };
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return { ok: true, name: user?.name ?? '' };
}

// Witnesses

export interface NewWitness {
  siglum: string;
  name: string;
  category?: Witness['category'];
  format?: Witness['format'];
  sourceAuthor?: string | null;
  sourceWork?: string | null;
  repository?: string | null;
  settlement?: string | null;
  shelfmark?: string | null;
  identifier?: string | null;
  identifiers?: CanonicalIdentifier[];
  dateText?: string | null;
  material?: string | null;
  extent?: string | null;
  hands?: WitnessHand[];
  provenance?: string | null;
  description?: string | null;
  iiifManifest?: string | null;
}

const WITNESS_TEXT_FIELDS = [
  'sourceAuthor',
  'sourceWork',
  'repository',
  'settlement',
  'shelfmark',
  'identifier',
  'dateText',
  'material',
  'extent',
  'provenance',
  'description',
  'iiifManifest',
] as const;

function witnessFields(input: Partial<NewWitness>): Partial<typeof witnesses.$inferInsert> {
  const set: Partial<typeof witnesses.$inferInsert> = {};
  if (input.siglum !== undefined) set.siglum = input.siglum.trim();
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.category !== undefined) set.category = input.category;
  if (input.format !== undefined) set.format = input.format;
  if (input.hands !== undefined) set.hands = input.hands;
  if (input.identifiers !== undefined) set.identifiers = input.identifiers;
  for (const field of WITNESS_TEXT_FIELDS) {
    if (input[field] !== undefined) set[field] = clean(input[field]);
  }
  return set;
}

/** Creates the witness and its creator as maintainer. */
export async function createWitness(
  db: Database,
  input: NewWitness,
  userId: string,
): Promise<Witness> {
  return withSlug(db, witnesses, slugify(input.name, 'witness'), (slug) =>
    db.transaction(async (tx) => {
      const [witness] = await tx
        .insert(witnesses)
        .values({
          id: newId(),
          slug,
          createdBy: userId,
          ...witnessFields(input),
          siglum: input.siglum.trim(),
          name: input.name.trim(),
        })
        .returning();
      await tx.insert(witnessMaintainers).values({ witnessId: witness!.id, userId });
      return witness!;
    }),
  );
}

export async function updateWitness(
  db: Database,
  witnessId: string,
  fields: Partial<NewWitness>,
): Promise<Witness> {
  const set = witnessFields(fields);
  if (Object.keys(set).length === 0) {
    const [current] = await db.select().from(witnesses).where(eq(witnesses.id, witnessId));
    if (!current) throw new RegistryError('not-found', `no witness ${witnessId}`);
    return current;
  }
  const [updated] = await db
    .update(witnesses)
    .set(set)
    .where(eq(witnesses.id, witnessId))
    .returning();
  if (!updated) throw new RegistryError('not-found', `no witness ${witnessId}`);
  return updated;
}

// Transcriptions

export interface NewTranscription {
  witnessId: string;
  /** The works the transcription is for, in order; by default the source's when copying. */
  workIds?: string[];
  name: string;
  keepsWrittenForm?: boolean;
  /** Copy this transcription's text, with new ids, as the starting point. */
  fromTranscriptionId?: string | null;
}

/**
 * Creates a transcription, empty or copied from another through
 * deriveTranscription and saved as its first changeset. A copy keeps the
 * source's works, settings and normalization memory; a copy of the same
 * witness keeps its boxes on the images too, each naming the copied words.
 * Anyone may have any number of transcriptions of a witness, for the same
 * work or others: an edition's conspectus names the one behind each siglum.
 */
export async function createTranscription(
  db: Database,
  input: NewTranscription,
  ownerId: string,
): Promise<Transcription> {
  const [witness] = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(eq(witnesses.id, input.witnessId));
  if (!witness) throw new RegistryError('not-found', `no witness ${input.witnessId}`);
  let source: (Transcription & { witnessName: string }) | null = null;
  if (input.fromTranscriptionId) {
    const [row] = await db
      .select({ transcription: transcriptions, witnessName: witnesses.name })
      .from(transcriptions)
      .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
      .where(eq(transcriptions.id, input.fromTranscriptionId));
    if (!row) throw new RegistryError('not-found', `no transcription ${input.fromTranscriptionId}`);
    source = { ...row.transcription, witnessName: row.witnessName };
  }
  const workIds = [...new Set(input.workIds ?? (source ? await chosenWorks(db, source.id) : []))];
  if (workIds.length) {
    const found = await db.select({ id: works.id }).from(works).where(inArray(works.id, workIds));
    const missing = workIds.find((w) => !found.some((f) => f.id === w));
    if (missing) throw new RegistryError('not-found', `no work ${missing}`);
  }
  const derived = source ? deriveTranscription(source.content) : null;

  const id = newId();
  const [created] = await db
    .insert(transcriptions)
    .values({
      id,
      witnessId: input.witnessId,
      name: input.name.trim(),
      ownerId,
      keepsWrittenForm: input.keepsWrittenForm ?? source?.keepsWrittenForm ?? false,
      displayAsWritten: source?.displayAsWritten ?? false,
      profile: source?.profile ?? null,
      memory: source?.memory ?? [],
      sources: source?.sources ?? null,
      rightsNote: source?.rightsNote ?? null,
      description: source ? t.transcription.startedFrom(source.witnessName, source.name) : null,
    })
    .returning();
  if (workIds.length) await setChosenWorks(db, id, workIds);
  if (derived && derived.items.length > 0) {
    try {
      await replaceContent(
        db,
        'transcription',
        id,
        ownerId,
        0,
        derived,
        t.transcription.copiedFrom(source!.name),
      );
    } catch (error) {
      // No half-made transcription: the copy and the row go together.
      await db.transaction(async (tx) => {
        await deleteHistory(tx, 'transcription', [id]);
        await tx.delete(transcriptions).where(eq(transcriptions.id, id));
      });
      throw error;
    }
    if (source!.witnessId === input.witnessId)
      await copyZones(db, source!.id, id, source!.content, derived);
    const [fresh] = await db.select().from(transcriptions).where(eq(transcriptions.id, id));
    return fresh!;
  }
  return created!;
}

/**
 * The boxes of one transcription made again for its copy: the copy's items
 * stand one for one in the order of the source's, so each box names the
 * copied words. Boxes left without words are dropped; features stay.
 */
async function copyZones(
  db: Database,
  fromId: string,
  toId: string,
  from: Stream,
  to: Stream,
): Promise<void> {
  const map = new Map<string, string>();
  from.items.forEach((item, i) => {
    const copy = to.items[i];
    if (copy) map.set(item.id, copy.id);
  });
  const rows = await db.select().from(zones).where(eq(zones.transcriptionId, fromId));
  const copies = rows
    .map((z) => ({
      ...z,
      tokenIds: z.tokenIds.map((tid) => map.get(tid)).filter((tid): tid is string => !!tid),
    }))
    .filter((z) => z.feature || z.tokenIds.length > 0)
    .map((z) => ({
      id: newId(),
      transcriptionId: toId,
      pageId: z.pageId,
      geometry: z.geometry,
      tokenIds: z.tokenIds,
      feature: z.feature,
    }));
  if (copies.length) await db.insert(zones).values(copies);
}

export async function renameTranscription(
  db: Database,
  id: string,
  name: string,
): Promise<Transcription | null> {
  const [row] = await db
    .update(transcriptions)
    .set({ name: name.trim() })
    .where(eq(transcriptions.id, id))
    .returning();
  return row ?? null;
}

/** Removes the history of documents that are being deleted: those rows have no foreign key to cascade. */
export async function deleteHistory(
  tx: Tx | Database,
  kind: 'transcription' | 'edition',
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .delete(changesets)
    .where(and(eq(changesets.documentKind, kind), inArray(changesets.documentId, ids)));
  await tx
    .delete(checkpoints)
    .where(and(eq(checkpoints.documentKind, kind), inArray(checkpoints.documentId, ids)));
  await tx
    .delete(moments)
    .where(and(eq(moments.documentKind, kind), inArray(moments.documentId, ids)));
  await tx
    .delete(reviewState)
    .where(and(eq(reviewState.documentKind, kind), inArray(reviewState.documentId, ids)));
  await tx
    .delete(ownershipOffers)
    .where(and(eq(ownershipOffers.kind, kind), inArray(ownershipOffers.recordId, ids)));
}

export type DeleteTranscriptionResult =
  | { ok: true; name: string }
  | { ok: false; error: 'not-found' | 'forbidden' }
  | { ok: false; error: 'in-conspectus'; editions: EditionRef[]; hiddenEditions: number };

/**
 * Deletes a transcription with its history. Owner or administrator only,
 * and refused while an edition's conspectus names it. The refusal names the
 * editions the person may see and counts the drafts of others they may not.
 */
export async function deleteTranscription(
  db: Database,
  id: string,
  user: Actor | null,
): Promise<DeleteTranscriptionResult> {
  const [row] = await db
    .select({ id: transcriptions.id, ownerId: transcriptions.ownerId, name: transcriptions.name })
    .from(transcriptions)
    .where(eq(transcriptions.id, id));
  if (!row) return { ok: false, error: 'not-found' };
  if (!canDeleteTranscription(user, row)) return { ok: false, error: 'forbidden' };
  const naming = await db
    .selectDistinct({
      id: editions.id,
      slug: editions.slug,
      title: editions.title,
      ownerId: editions.ownerId,
      visibility: editions.visibility,
    })
    .from(editionSigla)
    .innerJoin(editions, eq(editions.id, editionSigla.editionId))
    .where(eq(editionSigla.transcriptionId, id));
  if (naming.length) {
    // `canDeleteTranscription` has let a person through, so `user` is not null.
    return { ok: false, error: 'in-conspectus', ...(await nameVisibleEditions(db, user!, naming)) };
  }
  await db.transaction(async (tx) => {
    await deleteHistory(tx, 'transcription', [id]);
    await tx.delete(transcriptions).where(eq(transcriptions.id, id));
  });
  return { ok: true, name: row.name };
}

// Deleting registry entries

export type DeleteEntryResult =
  | { ok: true; title: string }
  | { ok: false; error: 'not-found' | 'forbidden' }
  | { ok: false; error: 'in-use'; dependents: Dependents };

function mayDeleteEntry(user: Actor | null, entry: { createdBy: string | null }): user is Actor {
  return !!user && governs(user, entry);
}

/** Who governs an entry: its creator and administrators. They decide who maintains it, and may delete it. */
export function governs(user: Actor, entry: { createdBy: string | null }): boolean {
  return entry.createdBy === user.id || isAdministrator(user);
}

/**
 * Splits editions into those `user` may see, which a refusal may name, and
 * the number of the rest: another person's draft leaves no trace in what is
 * said to someone who may not see it.
 */
async function nameVisibleEditions(
  db: Database,
  user: Actor,
  rows: {
    id: string;
    slug: string;
    title: string;
    ownerId: string;
    visibility: 'draft' | 'published';
  }[],
): Promise<Pick<Dependents, 'editions' | 'hiddenEditions'>> {
  if (rows.length === 0) return { editions: [], hiddenEditions: 0 };
  const collaborating = await db
    .select({ editionId: editionCollaborators.editionId })
    .from(editionCollaborators)
    .where(
      and(
        eq(editionCollaborators.userId, user.id),
        inArray(
          editionCollaborators.editionId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const collaborates = new Set(collaborating.map((c) => c.editionId));
  const named = rows
    .filter((r) => canViewEdition(user, r, collaborates.has(r.id) ? [user.id] : []))
    .map((r) => ({ slug: r.slug, title: r.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { editions: named, hiddenEditions: rows.length - named.length };
}

/** Whether anything depends on the entry: its deletion is refused while it does. */
export function isDepended(d: Dependents): boolean {
  return d.editions.length > 0 || d.hiddenEditions > 0 || d.transcriptions > 0 || d.records > 0;
}

/** What of others depends on a witness and refuses its deletion by `user`: editions naming it, others' transcripts and reported readings. */
export async function witnessDependents(
  db: Database,
  witnessId: string,
  user: Actor,
): Promise<Dependents> {
  const naming = await db
    .selectDistinct({
      id: editions.id,
      slug: editions.slug,
      title: editions.title,
      ownerId: editions.ownerId,
      visibility: editions.visibility,
    })
    .from(editionSigla)
    .innerJoin(editions, eq(editions.id, editionSigla.editionId))
    .where(eq(editionSigla.witnessId, witnessId));
  const [othersTranscriptions] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transcriptions)
    .where(and(eq(transcriptions.witnessId, witnessId), ne(transcriptions.ownerId, user.id)));
  const [othersReadings] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reportedReadings)
    .where(and(eq(reportedReadings.witnessId, witnessId), ne(reportedReadings.ownerId, user.id)));
  return {
    ...(await nameVisibleEditions(db, user, naming)),
    transcriptions: Number(othersTranscriptions?.n ?? 0),
    records: Number(othersReadings?.n ?? 0),
  };
}

/** What of others depends on a work and refuses its deletion by `user`: editions of it, text assigned to it, conjectures and reported readings on it. */
export async function workDependents(
  db: Database,
  workId: string,
  user: Actor,
): Promise<Dependents> {
  const othersEditions = await db
    .select({
      id: editions.id,
      slug: editions.slug,
      title: editions.title,
      ownerId: editions.ownerId,
      visibility: editions.visibility,
    })
    .from(editions)
    .where(and(eq(editions.workId, workId), ne(editions.ownerId, user.id)));
  const [othersTranscriptions] = await db
    .select({ n: countDistinct(transcriptionSegments.transcriptionId) })
    .from(transcriptionSegments)
    .innerJoin(transcriptions, eq(transcriptions.id, transcriptionSegments.transcriptionId))
    .where(and(eq(transcriptionSegments.workId, workId), ne(transcriptions.ownerId, user.id)));
  const [othersConjectures] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conjectures)
    .where(and(eq(conjectures.workId, workId), ne(conjectures.ownerId, user.id)));
  const [othersReadings] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reportedReadings)
    .where(and(eq(reportedReadings.workId, workId), ne(reportedReadings.ownerId, user.id)));
  return {
    ...(await nameVisibleEditions(db, user, othersEditions)),
    transcriptions: Number(othersTranscriptions?.n ?? 0),
    records: Number(othersConjectures?.n ?? 0) + Number(othersReadings?.n ?? 0),
  };
}

/**
 * Deletes a work with everything that belongs to it: its segments, its
 * editions with their history, its conjectures and reported readings, and its
 * scheme when no other work uses it. Its creator or an administrator only;
 * refused while an edition of it, a transcription assigning text to it, or a
 * conjecture or reported reading on it belongs to someone else.
 */
export async function deleteWork(
  db: Database,
  workId: string,
  user: Actor | null,
): Promise<DeleteEntryResult> {
  const [work] = await db.select().from(works).where(eq(works.id, workId));
  if (!work) return { ok: false, error: 'not-found' };
  if (!mayDeleteEntry(user, work)) return { ok: false, error: 'forbidden' };

  const dependents = await workDependents(db, workId, user);
  if (isDepended(dependents)) return { ok: false, error: 'in-use', dependents };

  await db.transaction(async (tx) => {
    const editionIds = (
      await tx.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))
    ).map((e) => e.id);
    await deleteHistory(tx, 'edition', editionIds);
    // Segments, editions, conjectures, reported readings, maintainers and the
    // segment index go by cascade; transcriptions made for the work keep their
    // text and lose only the reference.
    await tx.delete(works).where(eq(works.id, workId));
    const [{ n: sharers }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(works)
      .where(eq(works.schemeId, work.schemeId))) as [{ n: number }];
    if (sharers === 0)
      await tx.delete(referenceSchemes).where(eq(referenceSchemes.id, work.schemeId));
  });
  return { ok: true, title: work.title };
}

export type DeleteWitnessResult =
  | { ok: true; title: string; pageIds: string[] }
  | { ok: false; error: 'not-found' | 'forbidden' }
  | { ok: false; error: 'in-use'; dependents: Dependents };

/**
 * Deletes a witness with its pages, maintainers and the deleting user's own
 * transcriptions of it. Its creator or an administrator only; refused while
 * an edition's conspectus names it, or a transcription or reported reading of
 * it belongs to someone else. Returns the page ids, so that the caller can
 * remove their image files.
 */
export async function deleteWitness(
  db: Database,
  witnessId: string,
  user: Actor | null,
): Promise<DeleteWitnessResult> {
  const [witness] = await db.select().from(witnesses).where(eq(witnesses.id, witnessId));
  if (!witness) return { ok: false, error: 'not-found' };
  if (!mayDeleteEntry(user, witness)) return { ok: false, error: 'forbidden' };

  const dependents = await witnessDependents(db, witnessId, user);
  if (isDepended(dependents)) return { ok: false, error: 'in-use', dependents };

  const pageIds = (
    await db.select({ id: pages.id }).from(pages).where(eq(pages.witnessId, witnessId))
  ).map((p) => p.id);
  await db.transaction(async (tx) => {
    const own = (
      await tx
        .select({ id: transcriptions.id })
        .from(transcriptions)
        .where(eq(transcriptions.witnessId, witnessId))
    ).map((r) => r.id);
    await deleteHistory(tx, 'transcription', own);
    // Pages, zones, transcriptions, reported readings and maintainers go by cascade.
    await tx.delete(witnesses).where(eq(witnesses.id, witnessId));
  });
  return { ok: true, title: witness.name, pageIds };
}

// What the pages show

/**
 * The transcriptions of a work: those assigning text to its segments
 * (through the derived segment index) and those made for it that have none
 * yet, ordered by siglum.
 */
export async function transcriptionsOfWork(
  db: Database,
  workId: string,
): Promise<WorkTranscriptionRow[]> {
  const counts = await db
    .select({
      id: transcriptionSegments.transcriptionId,
      n: countDistinct(transcriptionSegments.segmentId),
    })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId))
    .groupBy(transcriptionSegments.transcriptionId);
  const segmentCount = new Map(counts.map((c) => [c.id, Number(c.n)] as const));
  const ids = [...segmentCount.keys()];
  const rows = await db
    .select({
      id: transcriptions.id,
      name: transcriptions.name,
      ownerId: transcriptions.ownerId,
      ownerName: users.name,
      visibility: transcriptions.visibility,
      witnessId: witnesses.id,
      witnessSlug: witnesses.slug,
      witnessName: witnesses.name,
      witnessSiglum: witnesses.siglum,
      updatedAt: transcriptions.updatedAt,
    })
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .innerJoin(users, eq(users.id, transcriptions.ownerId))
    .where(
      or(
        inArray(
          transcriptions.id,
          db
            .select({ id: transcriptionWorks.transcriptionId })
            .from(transcriptionWorks)
            .where(eq(transcriptionWorks.workId, workId)),
        ),
        ...(ids.length ? [inArray(transcriptions.id, ids)] : []),
      ),
    )
    .orderBy(asc(witnesses.siglum), asc(witnesses.name), asc(transcriptions.name));
  return rows.map((r) => ({
    ...r,
    segmentCount: segmentCount.get(r.id) ?? 0,
    updatedAt: iso(r.updatedAt),
  }));
}

/** The transcriptions of a witness with the works they are made for and assign text to. */
export async function transcriptionsOfWitness(
  db: Database,
  witnessId: string,
): Promise<WitnessTranscriptionRow[]> {
  const rows = await db
    .select({
      id: transcriptions.id,
      name: transcriptions.name,
      ownerId: transcriptions.ownerId,
      ownerName: users.name,
      visibility: transcriptions.visibility,
      updatedAt: transcriptions.updatedAt,
    })
    .from(transcriptions)
    .innerJoin(users, eq(users.id, transcriptions.ownerId))
    .where(eq(transcriptions.witnessId, witnessId))
    .orderBy(asc(transcriptions.name), asc(transcriptions.createdAt));
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      transcriptionId: transcriptionSegments.transcriptionId,
      workId: transcriptionSegments.workId,
      n: countDistinct(transcriptionSegments.segmentId),
    })
    .from(transcriptionSegments)
    .where(
      inArray(
        transcriptionSegments.transcriptionId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(transcriptionSegments.transcriptionId, transcriptionSegments.workId);
  const chosen = await chosenWorksOf(
    db,
    rows.map((r) => r.id),
  );
  const workIds = [...new Set([...[...chosen.values()].flat(), ...counts.map((c) => c.workId)])];
  const workRows = workIds.length
    ? await db
        .select({
          id: works.id,
          slug: works.slug,
          title: works.title,
        })
        .from(works)
        .where(inArray(works.id, workIds))
    : [];
  const workById = new Map(workRows.map((w) => [w.id, w] as const));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    visibility: r.visibility,
    updatedAt: iso(r.updatedAt),
    works: (chosen.get(r.id) ?? [])
      .map((w) => workById.get(w))
      .filter((w): w is NonNullable<typeof w> => !!w),
    assigned: counts
      .filter((c) => c.transcriptionId === r.id && workById.has(c.workId))
      .map((c) => ({ ...workById.get(c.workId)!, segmentCount: Number(c.n) }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  }));
}

/**
 * The works a witness is connected to: through transcriptions made for them or assigning text to them, and through reported readings.
 * Of the transcriptions only what the viewer may see is counted and connects: another person's draft is no trace of a work on the witness's page.
 */
export async function worksOfWitness(
  db: Database,
  witnessId: string,
  viewer: Actor | null | undefined,
  grants: Grants,
): Promise<WitnessWorkRow[]> {
  const viaText = (
    await db
      .select({
        workId: transcriptionSegments.workId,
        transcriptionId: transcriptionSegments.transcriptionId,
        ownerId: transcriptions.ownerId,
        visibility: transcriptions.visibility,
        n: countDistinct(transcriptionSegments.segmentId),
      })
      .from(transcriptionSegments)
      .innerJoin(transcriptions, eq(transcriptions.id, transcriptionSegments.transcriptionId))
      .where(eq(transcriptions.witnessId, witnessId))
      .groupBy(
        transcriptionSegments.workId,
        transcriptionSegments.transcriptionId,
        transcriptions.ownerId,
        transcriptions.visibility,
      )
  ).filter((r) => canViewTranscription(viewer, { ...r, id: r.transcriptionId }, grants));
  const declared = (
    await db
      .select({
        workId: transcriptionWorks.workId,
        transcriptionId: transcriptionWorks.transcriptionId,
        ownerId: transcriptions.ownerId,
        visibility: transcriptions.visibility,
      })
      .from(transcriptionWorks)
      .innerJoin(transcriptions, eq(transcriptions.id, transcriptionWorks.transcriptionId))
      .where(eq(transcriptions.witnessId, witnessId))
  ).filter((r) => canViewTranscription(viewer, { ...r, id: r.transcriptionId }, grants));
  const viaReadings = await db
    .select({ id: reportedReadings.id, workId: reportedReadings.workId })
    .from(reportedReadings)
    .where(eq(reportedReadings.witnessId, witnessId));

  const tally = new Map<
    string,
    { transcriptions: Set<string>; segments: number; readings: number }
  >();
  const entry = (workId: string) => {
    let found = tally.get(workId);
    if (!found)
      tally.set(workId, (found = { transcriptions: new Set(), segments: 0, readings: 0 }));
    return found;
  };
  for (const row of viaText) {
    const e = entry(row.workId);
    e.transcriptions.add(row.transcriptionId);
    e.segments = Math.max(e.segments, Number(row.n));
  }
  for (const row of declared) entry(row.workId).transcriptions.add(row.transcriptionId);
  for (const row of viaReadings) entry(row.workId).readings++;
  const ids = [...tally.keys()];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: works.id,
      slug: works.slug,
      title: works.title,
      author: works.author,
    })
    .from(works)
    .where(inArray(works.id, ids));
  return rows
    .map((w) => {
      const e = tally.get(w.id)!;
      return {
        ...w,
        transcriptionCount: e.transcriptions.size,
        segmentCount: e.segments,
        readingCount: e.readings,
      };
    })
    .sort(
      (a, b) => (a.author ?? '').localeCompare(b.author ?? '') || a.title.localeCompare(b.title),
    );
}

/** The editions of a work without their texts, with what deciding who may see and edit them needs. */
export async function editionRowsOfWork(db: Database, workId: string): Promise<WorkEditionRow[]> {
  const rows = await db
    .select({
      id: editions.id,
      slug: editions.slug,
      title: editions.title,
      editors: editions.editors,
      ownerId: editions.ownerId,
      ownerName: users.name,
      visibility: editions.visibility,
      updatedAt: editions.updatedAt,
    })
    .from(editions)
    .innerJoin(users, eq(users.id, editions.ownerId))
    .where(eq(editions.workId, workId))
    .orderBy(asc(editions.createdAt));
  if (rows.length === 0) return [];
  const collaborators = await db
    .select({ editionId: editionCollaborators.editionId, userId: editionCollaborators.userId })
    .from(editionCollaborators)
    .where(
      inArray(
        editionCollaborators.editionId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({
    ...r,
    updatedAt: iso(r.updatedAt),
    collaboratorIds: collaborators.filter((c) => c.editionId === r.id).map((c) => c.userId),
  }));
}

/** The conjecture catalogue of a work, in the order of the work. */
export async function conjecturesOfWork(db: Database, workId: string): Promise<ConjectureRow[]> {
  return db
    .select({
      id: conjectures.id,
      workId: conjectures.workId,
      segmentId: conjectures.segmentId,
      label: segments.label,
      kind: conjectures.kind,
      lemma: conjectures.lemma,
      reading: conjectures.reading,
      extent: conjectures.extent,
      proposer: conjectures.proposer,
      note: conjectures.note,
      ownerId: conjectures.ownerId,
      ownerName: users.name,
    })
    .from(conjectures)
    .innerJoin(segments, eq(segments.id, conjectures.segmentId))
    .innerJoin(users, eq(users.id, conjectures.ownerId))
    .where(eq(conjectures.workId, workId))
    .orderBy(asc(segments.sortKey), asc(conjectures.createdAt));
}

async function selectReadings(db: Database, where: SQL): Promise<ReadingRow[]> {
  const rows = await db
    .select({
      id: reportedReadings.id,
      workId: reportedReadings.workId,
      workSlug: works.slug,
      workTitle: works.title,
      segmentId: reportedReadings.segmentId,
      label: segments.label,
      witnessId: witnesses.id,
      witnessSlug: witnesses.slug,
      witnessName: witnesses.name,
      witnessSiglum: witnesses.siglum,
      lemma: reportedReadings.lemma,
      reading: reportedReadings.reading,
      source: reportedReadings.source,
      note: reportedReadings.note,
      ownerId: reportedReadings.ownerId,
      ownerName: users.name,
    })
    .from(reportedReadings)
    .innerJoin(works, eq(works.id, reportedReadings.workId))
    .innerJoin(segments, eq(segments.id, reportedReadings.segmentId))
    .innerJoin(witnesses, eq(witnesses.id, reportedReadings.witnessId))
    .innerJoin(users, eq(users.id, reportedReadings.ownerId))
    .where(where)
    .orderBy(
      asc(works.title),
      asc(segments.sortKey),
      asc(witnesses.siglum),
      asc(reportedReadings.createdAt),
    );
  return rows.map(({ workSlug, workTitle, ...r }) => ({
    ...r,
    work: { id: r.workId, slug: workSlug, title: workTitle },
  }));
}

/** The reported readings of a work, in the order of the work. */
export function readingsOfWork(db: Database, workId: string): Promise<ReadingRow[]> {
  return selectReadings(db, eq(reportedReadings.workId, workId));
}

/** The readings reported for a witness, by work and in the order of each work. */
export function readingsOfWitness(db: Database, witnessId: string): Promise<ReadingRow[]> {
  return selectReadings(db, eq(reportedReadings.witnessId, witnessId));
}

export interface ReadingUpdate {
  segmentId?: string;
  witnessId?: string;
  lemma?: string;
  reading?: string;
  source?: string | null;
  note?: string | null;
}

/** Updates a reported reading; conjectures.ts has no counterpart of updateConjecture for these. */
export async function updateReportedReading(db: Database, id: string, fields: ReadingUpdate) {
  const set: Partial<typeof reportedReadings.$inferInsert> = {};
  if (fields.segmentId !== undefined) set.segmentId = fields.segmentId;
  if (fields.witnessId !== undefined) set.witnessId = fields.witnessId;
  if (fields.lemma !== undefined) set.lemma = fields.lemma.trim();
  if (fields.reading !== undefined) set.reading = fields.reading.trim();
  if (fields.source !== undefined) set.source = clean(fields.source);
  if (fields.note !== undefined) set.note = clean(fields.note);
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(reportedReadings).where(eq(reportedReadings.id, id));
    return row ?? null;
  }
  const [row] = await db
    .update(reportedReadings)
    .set(set)
    .where(eq(reportedReadings.id, id))
    .returning();
  return row ?? null;
}

/** The pages of a witness in order, with whether each has an image. */
export async function pagesOfWitness(db: Database, witnessId: string): Promise<PageRow[]> {
  const rows = await db
    .select({ id: pages.id, label: pages.label, imageKind: pages.imageKind })
    .from(pages)
    .where(eq(pages.witnessId, witnessId))
    .orderBy(asc(pages.position));
  return rows.map((r) => ({ id: r.id, label: r.label, hasImage: r.imageKind !== null }));
}

/** Every witness, for the select of a reported reading. */
export function witnessOptions(db: Database): Promise<WitnessOption[]> {
  return db
    .select({ id: witnesses.id, name: witnesses.name, siglum: witnesses.siglum })
    .from(witnesses)
    .orderBy(asc(witnesses.name))
    .limit(1000);
}

/** Every work, for the select of a new transcription. */
export function workOptions(db: Database): Promise<WorkOption[]> {
  return db
    .select({ id: works.id, title: works.title, author: works.author })
    .from(works)
    .orderBy(asc(works.title))
    .limit(500);
}

/** The transcriptions a user may view, for "start from another transcription". */
export function viewableTranscriptions(
  db: Database,
  user: Actor | null | undefined,
  grants: Grants,
): Promise<TranscriptionOption[]> {
  const reached = [...grants.transcriptionIds];
  const where = isSiteEditor(user)
    ? undefined
    : or(
        eq(transcriptions.visibility, 'published'),
        user ? eq(transcriptions.ownerId, user.id) : undefined,
        reached.length ? inArray(transcriptions.id, reached) : undefined,
      );
  return db
    .select({
      id: transcriptions.id,
      name: transcriptions.name,
      witnessName: witnesses.name,
      witnessSiglum: witnesses.siglum,
      ownerName: users.name,
    })
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .innerJoin(users, eq(users.id, transcriptions.ownerId))
    .where(where)
    .orderBy(asc(witnesses.name), asc(transcriptions.name))
    .limit(300);
}

// Search

export type RegistryKind = 'work' | 'witness';

export const SEARCH_LIMIT = 8;

/** Up to eight entries whose title or author (name, siglum or shelfmark) contain the query, or with the query as an identifier. */
export async function searchRegistry(
  db: Database,
  kind: RegistryKind,
  q: string,
): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const pattern = `%${escapeLike(query)}%`;
  if (kind === 'work') {
    const rows = await db
      .select({ id: works.id, slug: works.slug, title: works.title, author: works.author })
      .from(works)
      .where(
        or(
          sql`${works.title} ilike ${pattern}`,
          sql`${works.author} ilike ${pattern}`,
          identifierMatches(works, query),
        ),
      )
      .orderBy(asc(works.title))
      .limit(SEARCH_LIMIT);
    return rows.map((r) => ({ ...r, siglum: null, shelfmark: null, settlement: null }));
  }
  const rows = await db
    .select({
      id: witnesses.id,
      slug: witnesses.slug,
      title: witnesses.name,
      siglum: witnesses.siglum,
      shelfmark: witnesses.shelfmark,
      settlement: witnesses.settlement,
    })
    .from(witnesses)
    .where(
      or(
        sql`${witnesses.name} ilike ${pattern}`,
        sql`${witnesses.siglum} ilike ${pattern}`,
        sql`${witnesses.shelfmark} ilike ${pattern}`,
        identifierMatches(witnesses, query),
      ),
    )
    .orderBy(asc(witnesses.name))
    .limit(SEARCH_LIMIT);
  return rows.map((r) => ({ ...r, author: null }));
}

// The archive as a download

const git = promisify(execFile);
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });

/**
 * Makes a directory a git repository of its own unless it is one already.
 * In a directory without its own .git, git uses the nearest enclosing
 * repository: a storage directory inside a checkout (as in development)
 * would have the archive's commits land in the checkout.
 */
export async function ownRepository(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (existsSync(path.join(dir, '.git'))) return;
  await git('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: gitEnv() });
}

/**
 * Brings a work's archive up to date and answers its HEAD as a
 * zip, streamed from `git archive` with the work's slug as the top folder.
 * Throws when the archive cannot be written or has no commit.
 */
export async function archiveZip(
  db: Database,
  work: { id: string; slug: string },
  root: string,
  storageRoot: string,
): Promise<Readable> {
  const folder = folderName(work.slug, work.id);
  const dir = path.join(root, folder);
  await ownRepository(dir);
  await archiveWork(db, work.id, root, 'download', { storageRoot });
  await git('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, env: gitEnv() });
  // spawn rather than execFile: execFile gathers the whole output in memory, spawn streams it.
  const child = spawn('git', ['archive', '--format=zip', `--prefix=${folder}/`, 'HEAD'], {
    cwd: dir,
    env: gitEnv(),
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.on('error', (e) => child.stdout.destroy(e));
  return child.stdout;
}
