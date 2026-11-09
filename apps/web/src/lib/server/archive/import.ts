/**
 * Reading an archive back into an installation: the inverse of writeArchive,
 * matching records by id so that an import over an existing work updates it.
 * Records whose owner does not exist here are given to the importing user.
 */

import { normalizeSiglum } from '../sigla.ts';
import type { Level, NormalizationProfile, Op, Stream, ZoneGeometry } from '@varians/core';
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
  referenceSchemes,
  reportedReadings,
  reviewState,
  segments,
  transcriptionWorks,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  zones,
  type Database,
  type MomentBasis,
  type SiglumState,
} from '@varians/db';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { citationsOfWork } from './archive.ts';
import { rebuildSegmentIndex } from '../documents/service.ts';
import { setChosenWorks } from '../transcription-works.ts';

export interface ImportReport {
  workId: string;
  witnesses: number;
  transcriptions: number;
  editions: number;
  changesets: number;
  warnings: string[];
}


/** The editors of an edition as an archive gives them: a list of names, or one string in older archives. */
function editorList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : [];
}

/** A time as the archive writes it, or undefined so that the database's default applies. */
function when(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The fields of a record file without the ones the writer adds for people (names, labels) and the times, which are read apart. */
function stripped<T extends Record<string, unknown>>(record: T, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const key of ['createdAt', 'updatedAt', 'segmentLabel', ...keys]) delete out[key];
  return out;
}

/** A list from a file: a version 2 file names its list (`{ "$schema", "<key>": [...] }`), a version 1 file is the list itself. */
async function readList<T>(file: string, key: string): Promise<T[] | null> {
  const data = await readJson<unknown>(file);
  if (data === null) return null;
  if (Array.isArray(data)) return data as T[];
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
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
async function freeSlug<T extends { id: string; slug: string }>(
  db: Database,
  table: typeof works | typeof witnesses | typeof editions,
  wanted: string,
  id: string,
): Promise<string> {
  let slug = wanted;
  for (let n = 2; n < 1000; n++) {
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
    if (!row || row.id === id) return slug;
    slug = `${wanted}-${n}`;
  }
  return `${wanted}-${id.slice(-6).toLowerCase()}`;
}

/** Import an archive directory. `userId` becomes owner and maintainer where the archive's people are unknown here. */
export async function importArchive(db: Database, dir: string, userId: string): Promise<ImportReport> {
  const warnings: string[] = [];
  const work = await readJson<{
    id: string;
    slug: string;
    title: string;
    author: string | null;
    language: string;
    identifier: string | null;
    description: string | null;
    visibility: 'public' | 'private';
    scheme: { id: string; name: string; levels: Level[]; createdBy?: string | null; createdAt?: string | null } | null;
    profile: NormalizationProfile;
    maintainers?: { id: string; name: string | null; since?: string | null }[];
    createdBy?: string | null;
    createdAt?: string | null;
  }>(path.join(dir, 'work.json'));
  if (!work) throw new Error(`no work.json in ${dir}`);
  const known = new Set((await db.select({ id: users.id }).from(users)).map((u) => u.id));
  const owner = (id: string | null | undefined) => (id && known.has(id) ? id : userId);
  /** A person reference that stays empty when the person has no account here (who reviewed, who set, who granted). */
  const knownOrNull = (id: string | null | undefined) => (id && known.has(id) ? id : null);

  if (!work.scheme) throw new Error('work.json has no scheme');
  await db
    .insert(referenceSchemes)
    .values({ id: work.scheme.id, name: work.scheme.name, levels: work.scheme.levels, createdBy: owner(work.scheme.createdBy), createdAt: when(work.scheme.createdAt) })
    .onConflictDoUpdate({ target: referenceSchemes.id, set: { name: work.scheme.name, levels: work.scheme.levels } });
  const slug = await freeSlug(db, works, work.slug, work.id);
  await db
    .insert(works)
    .values({
      id: work.id,
      slug,
      title: work.title,
      author: work.author,
      language: work.language,
      identifier: work.identifier,
      description: work.description,
      schemeId: work.scheme.id,
      profile: work.profile,
      visibility: work.visibility,
      createdBy: work.createdBy === undefined ? userId : owner(work.createdBy),
      createdAt: when(work.createdAt),
    })
    .onConflictDoUpdate({
      target: works.id,
      set: { slug, title: work.title, author: work.author, language: work.language, identifier: work.identifier, description: work.description, schemeId: work.scheme.id, profile: work.profile, visibility: work.visibility },
    });
  for (const m of work.maintainers ?? []) await db.insert(workMaintainers).values({ workId: work.id, userId: owner(m.id), createdAt: when(m.since) }).onConflictDoNothing();
  await db.insert(workMaintainers).values({ workId: work.id, userId }).onConflictDoNothing();

  const tsv = await readFile(path.join(dir, 'segments.tsv'), 'utf8').catch(() => '');
  // Columns by the header's names: version 1 has id, label, sort_key, address; version 2 adds urn and created_at.
  const [header = '', ...lines] = tsv.split('\n');
  const column = new Map(header.split('\t').map((name, i) => [name.trim(), i] as const));
  const cell = (fields: string[], name: string) => (column.has(name) ? fields[column.get(name)!] : undefined);
  const segmentRows = lines
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const fields = line.split('\t');
      return {
        id: cell(fields, 'id')!,
        workId: work.id,
        label: cell(fields, 'label')!,
        sortKey: cell(fields, 'sort_key')!,
        address: JSON.parse(cell(fields, 'address') || '{}') as Record<string, string>,
        createdAt: when(cell(fields, 'created_at')),
      };
    });
  for (const s of segmentRows) {
    await db
      .insert(segments)
      .values(s)
      .onConflictDoUpdate({ target: segments.id, set: { label: s.label, sortKey: s.sortKey, address: s.address } });
  }

  let witnessCount = 0;
  let transcriptionCount = 0;
  let changesetCount = 0;
  for (const wdir of await dirs(path.join(dir, 'witnesses'))) {
    const w = await readJson<typeof witnesses.$inferSelect & { slug: string; maintainers?: { id: string; since?: string | null }[] }>(path.join(wdir, 'witness.json'));
    if (!w) continue;
    witnessCount++;
    const wslug = await freeSlug(db, witnesses, w.slug, w.id);
    // The fragments flag of archives written before 8 November 2026 is dropped.
    const { createdAt: _c, updatedAt: _u, fragmentary: _f, maintainers: _m, $schema: _s, ...read } = w as typeof w & { fragmentary?: boolean; $schema?: string };
    void _s;
    void _c;
    void _u;
    void _f;
    void _m;
    // Archives written before 3 October 2026 knew "papyrus" as a category: it is a manuscript whose material is papyrus.
    const legacy = (read as { category?: string }).category === 'papyrus';
    const fields = legacy ? { ...read, category: 'manuscript' as const, material: read.material || 'papyrus' } : read;
    await db
      .insert(witnesses)
      .values({ ...fields, slug: wslug, createdBy: owner(w.createdBy), createdAt: when(w.createdAt) })
      .onConflictDoUpdate({ target: witnesses.id, set: { ...fields, slug: wslug, createdBy: owner(w.createdBy) } });
    for (const m of w.maintainers ?? []) await db.insert(witnessMaintainers).values({ witnessId: w.id, userId: owner(m.id), createdAt: when(m.since) }).onConflictDoNothing();
    await db.insert(witnessMaintainers).values({ witnessId: w.id, userId }).onConflictDoNothing();
    const pageList =
      (await readList<{
        id: string;
        label: string;
        position: number;
        image: { kind: 'upload' | 'iiif'; path: string | null; iiif: string | null; width: number | null; height: number | null; tiles?: string | null } | null;
        createdAt?: string;
      }>(path.join(wdir, 'pages.json'), 'pages')) ?? [];
    for (const p of pageList) {
      const values = {
        id: p.id,
        witnessId: w.id,
        label: p.label,
        position: p.position,
        imageKind: p.image?.kind ?? null,
        imagePath: p.image?.path ?? null,
        imageIiif: p.image?.iiif ?? null,
        imageWidth: p.image?.width ?? null,
        imageHeight: p.image?.height ?? null,
        tilesPath: p.image?.tiles ?? null,
        createdAt: when(p.createdAt),
      };
      await db.insert(pages).values(values).onConflictDoUpdate({ target: pages.id, set: values });
    }
    for (const tdir of await dirs(path.join(wdir, 'transcriptions'))) {
      const t = await readJson<{
        id: string;
        name: string;
        witnessId: string;
        ownerId: string;
        visibility: 'draft' | 'published';
        version: number;
        keepsWrittenForm: boolean;
        displayAsWritten: boolean;
        profile: Partial<NormalizationProfile> | null;
        description: string | null;
        /** The works it is for; absent in archives written before transcriptions had several. */
        workIds?: string[];
        sources?: string | null;
        licence?: string | null;
        createdAt?: string;
        content: Stream;
      }>(path.join(tdir, 'transcription.json'));
      if (!t) continue;
      transcriptionCount++;
      const memory = (await readList<{ form: string; norm: string; count: number }>(path.join(tdir, 'memory.json'), 'entries')) ?? [];
      const values = {
        id: t.id,
        witnessId: w.id,
        name: t.name,
        ownerId: owner(t.ownerId),
        visibility: t.visibility,
        content: t.content,
        version: t.version,
        keepsWrittenForm: t.keepsWrittenForm,
        displayAsWritten: t.displayAsWritten,
        profile: t.profile,
        memory,
        description: t.description,
        sources: t.sources ?? null,
        licence: t.licence ?? null,
        createdAt: when(t.createdAt),
      };
      await db.insert(transcriptions).values(values).onConflictDoUpdate({ target: transcriptions.id, set: values });
      // Its works, as far as this installation knows them.
      const named = t.workIds ?? [];
      const known = named.length ? new Set((await db.select({ id: works.id }).from(works).where(inArray(works.id, named))).map((w) => w.id)) : new Set<string>();
      await setChosenWorks(db, t.id, named.filter((w) => known.has(w)));
      await rebuildSegmentIndex(db, t.id, t.content);
      const zoneList =
        (await readList<{ id: string; pageId: string; tokenIds: string[]; geometry: ZoneGeometry; feature: { kind: string; description?: string } | null; createdAt?: string }>(
          path.join(tdir, 'zones.json'),
          'zones',
        )) ?? [];
      await db.delete(zones).where(eq(zones.transcriptionId, t.id));
      if (zoneList.length) await db.insert(zones).values(zoneList.map((z) => ({ id: z.id, pageId: z.pageId, tokenIds: z.tokenIds, geometry: z.geometry, feature: z.feature, createdAt: when(z.createdAt), transcriptionId: t.id })));
      changesetCount += await importHistory(db, tdir, 'transcription', t.id, owner, knownOrNull);
      await importReviewStates(db, tdir, 'transcription', t.id, knownOrNull);
    }
  }

  const conjectureList = (await readList<typeof conjectures.$inferSelect & { segmentLabel?: string }>(path.join(dir, 'conjectures.json'), 'conjectures')) ?? [];
  for (const c of conjectureList) {
    const fields = stripped(c) as typeof c;
    const values = { ...fields, workId: work.id, ownerId: owner(c.ownerId), createdAt: when(c.createdAt) };
    await db.insert(conjectures).values(values).onConflictDoUpdate({ target: conjectures.id, set: values });
  }
  const reportedList = (await readList<typeof reportedReadings.$inferSelect & { segmentLabel?: string }>(path.join(dir, 'reported-readings.json'), 'readings')) ?? [];
  for (const r of reportedList) {
    const fields = stripped(r) as typeof r;
    const values = { ...fields, workId: work.id, ownerId: owner(r.ownerId), createdAt: when(r.createdAt) };
    await db.insert(reportedReadings).values(values).onConflictDoUpdate({ target: reportedReadings.id, set: values });
  }

  let editionCount = 0;
  for (const edir of await dirs(path.join(dir, 'editions'))) {
    const e = await readJson<{
      id: string;
      slug: string;
      title: string;
      /** A list of names; one string in archives written before. */
      editors: string[] | string | null;
      preface: string | null;
      ownerId: string;
      visibility: 'draft' | 'published';
      version: number;
      publishedVersion: number | null;
      conventions: typeof editions.$inferSelect.conventions;
      /** Absent in archives written before editions could be copied. */
      copiedFrom?: typeof editions.$inferSelect.copiedFrom;
      sources?: string | null;
      licence?: string | null;
      /** Archives written before 8 November 2026 name the state before correction as originalSiglum. */
      sigla: { siglum: string; witnessId: string; transcriptionId: string | null; states?: SiglumState[]; originalSiglum?: string | null; variantSiglum?: string | null }[];
      /** Conjecture ids; objects with the time of adoption since format 2. */
      adoptions: (string | { conjectureId: string; at?: string | null })[];
      collaborators?: { id: string; grantedBy?: string | null; since?: string | null }[];
      notes: { id: string; segmentId: string; tokenIds: string[]; text: string; authorId: string | null; createdAt?: string }[];
      /** Absent in archives written before sites could be given a kind. */
      siteKinds?: { segmentId: string; siteKey: string; kind: 'textual' | 'interpretative'; setBy?: string | null; setAt?: string | null }[];
      createdAt?: string;
      content: Stream;
    }>(path.join(edir, 'edition.json'));
    if (!e) continue;
    editionCount++;
    const eslug = await freeSlug(db, editions, e.slug, e.id);
    const values = {
      id: e.id,
      workId: work.id,
      slug: eslug,
      title: e.title,
      editors: editorList(e.editors),
      preface: e.preface,
      ownerId: owner(e.ownerId),
      visibility: e.visibility,
      content: e.content,
      version: e.version,
      publishedVersion: e.publishedVersion,
      conventions: e.conventions,
      copiedFrom: e.copiedFrom ? { ...e.copiedFrom, editors: editorList((e.copiedFrom as { editors?: unknown }).editors) } : null,
      sources: e.sources ?? null,
      licence: e.licence ?? null,
      createdAt: when(e.createdAt),
    };
    await db.insert(editions).values(values).onConflictDoUpdate({ target: editions.id, set: values });
    await db.delete(editionSigla).where(eq(editionSigla.editionId, e.id));
    if (e.sigla.length) {
      await db.insert(editionSigla).values(e.sigla.map((s, i) => ({ editionId: e.id, position: i, ...normalizeSiglum(s) })));
    }
    await db.delete(editionAdoptions).where(eq(editionAdoptions.editionId, e.id));
    const adoptions = (e.adoptions ?? []).map((a) => (typeof a === 'string' ? { conjectureId: a, at: null } : a));
    if (adoptions.length) {
      await db
        .insert(editionAdoptions)
        .values(adoptions.map((a) => ({ editionId: e.id, conjectureId: a.conjectureId, createdAt: when(a.at) })))
        .onConflictDoNothing();
    }
    // Collaborators are accounts: only those who have one here are kept.
    await db.delete(editionCollaborators).where(eq(editionCollaborators.editionId, e.id));
    const collaborators = (e.collaborators ?? []).filter((c) => known.has(c.id));
    if (collaborators.length) {
      await db
        .insert(editionCollaborators)
        .values(collaborators.map((c) => ({ editionId: e.id, userId: c.id, grantedBy: knownOrNull(c.grantedBy), createdAt: when(c.since) })))
        .onConflictDoNothing();
    }
    for (const n of e.notes ?? []) {
      const noteValues = { id: n.id, editionId: e.id, segmentId: n.segmentId, tokenIds: n.tokenIds, text: n.text, authorId: n.authorId && known.has(n.authorId) ? n.authorId : userId, createdAt: when(n.createdAt) };
      await db.insert(notes).values(noteValues).onConflictDoUpdate({ target: notes.id, set: noteValues });
    }
    await db.delete(editionSiteKinds).where(eq(editionSiteKinds.editionId, e.id));
    const kinds = (e.siteKinds ?? []).filter((k) => k.kind === 'textual' || k.kind === 'interpretative');
    if (kinds.length) {
      await db
        .insert(editionSiteKinds)
        .values(kinds.map((k) => ({ editionId: e.id, segmentId: k.segmentId, siteKey: k.siteKey, kind: k.kind, setBy: knownOrNull(k.setBy), setAt: when(k.setAt) })))
        .onConflictDoNothing();
    }
    const alignment = await readList<{ id: string; segmentId: string; baseTokenIds: string[]; transcriptionId: string; witnessTokenIds: string[]; createdAt?: string }>(path.join(edir, 'alignment.json'), 'constraints');
    if (alignment) {
      await db.delete(alignmentConstraints).where(eq(alignmentConstraints.editionId, e.id));
      const transcriptionIds = new Set((alignment.length ? await db.select({ id: transcriptions.id }).from(transcriptions).where(inArray(transcriptions.id, alignment.map((a) => a.transcriptionId))) : []).map((t) => t.id));
      const usable = alignment.filter((a) => transcriptionIds.has(a.transcriptionId));
      if (usable.length < alignment.length) warnings.push(`${alignment.length - usable.length} alignment constraint(s) of ${e.slug} name a transcription this installation does not have`);
      if (usable.length) {
        await db.insert(alignmentConstraints).values(
          usable.map((a) => ({ id: a.id, editionId: e.id, segmentId: a.segmentId, baseTokenIds: a.baseTokenIds, transcriptionId: a.transcriptionId, witnessTokenIds: a.witnessTokenIds, createdAt: when(a.createdAt) })),
        );
      }
    }
    const reviews = await readJson<{ sites?: { segmentId: string; siteKey: string; reviewedBy: string | null; reviewedAt?: string | null }[] }>(path.join(edir, 'reviews.json'));
    if (reviews?.sites) {
      await db.delete(editionSiteReviews).where(eq(editionSiteReviews.editionId, e.id));
      if (reviews.sites.length) {
        await db
          .insert(editionSiteReviews)
          .values(reviews.sites.map((r) => ({ editionId: e.id, segmentId: r.segmentId, siteKey: r.siteKey, reviewedBy: knownOrNull(r.reviewedBy), reviewedAt: when(r.reviewedAt) })))
          .onConflictDoNothing();
      }
    }
    await importReviewStates(db, edir, 'edition', e.id, knownOrNull);
    changesetCount += await importHistory(db, edir, 'edition', e.id, owner, knownOrNull);
  }

  const items =
    (await readList<{ id: string; entryType: string; citationKey: string; fields: Record<string, string>; label: string; createdBy?: string | null; createdAt?: string }>(
      path.join(dir, 'bibliography.json'),
      'items',
    )) ?? [];
  // An entry whose key this installation already has under another id: the citations go to that entry.
  const sameItem = new Map<string, string>();
  for (const item of items) {
    const [byKey] = await db.select({ id: bibliographyItems.id }).from(bibliographyItems).where(eq(bibliographyItems.citationKey, item.citationKey));
    if (byKey && byKey.id !== item.id) {
      sameItem.set(item.id, byKey.id);
      warnings.push(`bibliography key ${item.citationKey} already exists with another id; its citations now cite the existing entry`);
      continue;
    }
    await db
      .insert(bibliographyItems)
      .values({ id: item.id, entryType: item.entryType, citationKey: item.citationKey, fields: item.fields, label: item.label, createdBy: item.createdBy === undefined ? userId : owner(item.createdBy), createdAt: when(item.createdAt) })
      .onConflictDoUpdate({ target: bibliographyItems.id, set: { entryType: item.entryType, citationKey: item.citationKey, fields: item.fields, label: item.label } });
  }
  const citationList = (await readList<typeof citations.$inferSelect>(path.join(dir, 'citations.json'), 'citations')) ?? [];
  for (const c of citationList) {
    const fields = stripped(c) as typeof c;
    await db
      .insert(citations)
      .values({ ...fields, itemId: sameItem.get(fields.itemId) ?? fields.itemId, createdAt: when(c.createdAt) })
      .onConflictDoNothing();
  }

  return { workId: work.id, witnesses: witnessCount, transcriptions: transcriptionCount, editions: editionCount, changesets: changesetCount, warnings };
}

/** Each person's review position on a document, for the persons who have an account here. */
async function importReviewStates(db: Database, dir: string, kind: 'transcription' | 'edition', documentId: string, knownOrNull: (id: string | null | undefined) => string | null): Promise<void> {
  const reviews = await readJson<{ states?: { userId: string; fromVersion: number; accepted: string[] }[] }>(path.join(dir, 'reviews.json'));
  for (const s of reviews?.states ?? []) {
    const userId = knownOrNull(s.userId);
    if (!userId) continue;
    await db
      .insert(reviewState)
      .values({ documentKind: kind, documentId, userId, fromVersion: s.fromVersion, accepted: s.accepted })
      .onConflictDoUpdate({ target: [reviewState.documentKind, reviewState.documentId, reviewState.userId], set: { fromVersion: s.fromVersion, accepted: s.accepted } });
  }
}

async function importHistory(
  db: Database,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
  owner: (id: string | null | undefined) => string,
  knownOrNull: (id: string | null | undefined) => string | null,
): Promise<number> {
  const file = path.join(dir, 'history.ndjson');
  if (!(await exists(file))) return 0;
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l.trim() !== '');
  let count = 0;
  for (const line of lines) {
    const c = JSON.parse(line) as { id: string; version: number; userId: string | null; at: string; ops: Op[]; reverse: Op[]; message: string | null };
    const result = await db
      .insert(changesets)
      .values({ id: c.id, documentKind: kind, documentId, version: c.version, userId: c.userId ? owner(c.userId) : null, at: new Date(c.at), ops: c.ops, reverse: c.reverse, message: c.message })
      .onConflictDoNothing();
    void result;
    count++;
  }
  const momentList =
    (await readList<{ id: string; version: number; name: string; kind: 'named' | 'published'; number: number | null; basis?: MomentBasis | null; createdBy?: string | null; at: string }>(
      path.join(dir, 'moments.json'),
      'moments',
    )) ?? [];
  for (const m of momentList) {
    await db
      .insert(moments)
      .values({ id: m.id, documentKind: kind, documentId, version: m.version, name: m.name, kind: m.kind, number: m.number, basis: m.basis ?? null, createdBy: knownOrNull(m.createdBy), at: new Date(m.at) })
      .onConflictDoNothing();
  }
  return count;
}

/** Remove a work and everything only it holds, for a round-trip test: its documents with their history, its witnesses, and the bibliography and scheme only it uses. */
export async function removeWorkCompletely(db: Database, workId: string): Promise<void> {
  const [work] = await db.select({ schemeId: works.schemeId }).from(works).where(eq(works.id, workId));
  const editionIds = (await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))).map((e) => e.id);
  const siglaRows = editionIds.length ? await db.select().from(editionSigla).where(inArray(editionSigla.editionId, editionIds)) : [];
  const chosen = await db.select({ id: transcriptionWorks.transcriptionId }).from(transcriptionWorks).where(eq(transcriptionWorks.workId, workId));
  const transcriptionIds = [...new Set([...siglaRows.map((s) => s.transcriptionId).filter((id): id is string => id !== null), ...chosen.map((c) => c.id)])];
  const witnessIds = [...new Set(siglaRows.map((s) => s.witnessId))];
  const { items } = await citationsOfWork(db, workId);
  const documentIds = [...transcriptionIds, ...editionIds];
  if (documentIds.length) {
    await db.delete(changesets).where(inArray(changesets.documentId, documentIds));
    await db.delete(moments).where(inArray(moments.documentId, documentIds));
    await db.delete(reviewState).where(inArray(reviewState.documentId, documentIds));
    await db.delete(checkpoints).where(inArray(checkpoints.documentId, documentIds));
  }
  if (transcriptionIds.length) await db.delete(transcriptions).where(inArray(transcriptions.id, transcriptionIds));
  await db.delete(works).where(eq(works.id, workId));
  if (witnessIds.length) await db.delete(witnesses).where(inArray(witnesses.id, witnessIds));
  // Entries no one cites any more, and the scheme no other work uses.
  for (const item of items) {
    const [cited] = await db.select({ id: citations.id }).from(citations).where(eq(citations.itemId, item.id)).limit(1);
    if (!cited) await db.delete(bibliographyItems).where(eq(bibliographyItems.id, item.id));
  }
  if (work) {
    const [other] = await db.select({ id: works.id }).from(works).where(eq(works.schemeId, work.schemeId)).limit(1);
    if (!other) await db.delete(referenceSchemes).where(eq(referenceSchemes.id, work.schemeId));
  }
}
