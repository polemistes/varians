/**
 * Reading an archive back into an installation: the inverse of writeArchive,
 * matching records by id so that an import over an existing work updates it.
 * Records whose owner does not exist here are given to the importing user.
 */

import { normalizeSiglum } from '../sigla.ts';
import type { Level, NormalizationProfile, Op, Stream, ZoneGeometry } from '@varians/core';
import {
  bibliographyItems,
  changesets,
  citations,
  conjectures,
  editionAdoptions,
  editionSigla,
  editionSiteKinds,
  editions,
  moments,
  notes,
  pages,
  referenceSchemes,
  reportedReadings,
  segments,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  zones,
  type Database,
  type SiglumState,
} from '@varians/db';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
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
    scheme: { id: string; name: string; levels: Level[] } | null;
    profile: NormalizationProfile;
    maintainers?: { id: string; name: string | null }[];
  }>(path.join(dir, 'work.json'));
  if (!work) throw new Error(`no work.json in ${dir}`);
  const known = new Set((await db.select({ id: users.id }).from(users)).map((u) => u.id));
  const owner = (id: string | null | undefined) => (id && known.has(id) ? id : userId);

  if (!work.scheme) throw new Error('work.json has no scheme');
  await db
    .insert(referenceSchemes)
    .values({ id: work.scheme.id, name: work.scheme.name, levels: work.scheme.levels, createdBy: userId })
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
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: works.id,
      set: { slug, title: work.title, author: work.author, language: work.language, identifier: work.identifier, description: work.description, schemeId: work.scheme.id, profile: work.profile, visibility: work.visibility },
    });
  const maintainers = (work.maintainers ?? []).map((m) => owner(m.id));
  if (!maintainers.includes(userId)) maintainers.push(userId);
  for (const m of new Set(maintainers)) await db.insert(workMaintainers).values({ workId: work.id, userId: m }).onConflictDoNothing();

  const tsv = await readFile(path.join(dir, 'segments.tsv'), 'utf8').catch(() => '');
  const segmentRows = tsv
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const [id, label, sortKey, address] = line.split('\t');
      return { id: id!, workId: work.id, label: label!, sortKey: sortKey!, address: JSON.parse(address ?? '{}') as Record<string, string> };
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
    const w = await readJson<typeof witnesses.$inferSelect & { slug: string }>(path.join(wdir, 'witness.json'));
    if (!w) continue;
    witnessCount++;
    const wslug = await freeSlug(db, witnesses, w.slug, w.id);
    // The fragments flag of archives written before 8 November 2026 is dropped.
    const { createdAt: _c, updatedAt: _u, fragmentary: _f, ...read } = w as typeof w & { fragmentary?: boolean };
    void _c;
    void _u;
    void _f;
    // Archives written before 3 October 2026 knew "papyrus" as a category: it is a manuscript whose material is papyrus.
    const legacy = (read as { category?: string }).category === 'papyrus';
    const fields = legacy ? { ...read, category: 'manuscript' as const, material: read.material || 'papyrus' } : read;
    await db
      .insert(witnesses)
      .values({ ...fields, slug: wslug, createdBy: owner(w.createdBy) })
      .onConflictDoUpdate({ target: witnesses.id, set: { ...fields, slug: wslug, createdBy: owner(w.createdBy) } });
    await db.insert(witnessMaintainers).values({ witnessId: w.id, userId }).onConflictDoNothing();
    const pageList = (await readJson<{ id: string; label: string; position: number; image: { kind: 'upload' | 'iiif'; path: string | null; iiif: string | null; width: number | null; height: number | null } | null }[]>(path.join(wdir, 'pages.json'))) ?? [];
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
        content: Stream;
      }>(path.join(tdir, 'transcription.json'));
      if (!t) continue;
      transcriptionCount++;
      const memory = (await readJson<{ form: string; norm: string; count: number }[]>(path.join(tdir, 'memory.json'))) ?? [];
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
      };
      await db.insert(transcriptions).values(values).onConflictDoUpdate({ target: transcriptions.id, set: values });
      // Its works, as far as this installation knows them.
      const named = t.workIds ?? [];
      const known = named.length ? new Set((await db.select({ id: works.id }).from(works).where(inArray(works.id, named))).map((w) => w.id)) : new Set<string>();
      await setChosenWorks(db, t.id, named.filter((w) => known.has(w)));
      await rebuildSegmentIndex(db, t.id, t.content);
      const zoneList = (await readJson<{ id: string; pageId: string; tokenIds: string[]; geometry: ZoneGeometry; feature: { kind: string; description?: string } | null }[]>(path.join(tdir, 'zones.json'))) ?? [];
      await db.delete(zones).where(eq(zones.transcriptionId, t.id));
      if (zoneList.length) await db.insert(zones).values(zoneList.map((z) => ({ ...z, transcriptionId: t.id })));
      changesetCount += await importHistory(db, tdir, 'transcription', t.id, owner);
    }
  }

  const conjectureList = (await readJson<(typeof conjectures.$inferSelect & { segmentLabel?: string })[]>(path.join(dir, 'conjectures.json'))) ?? [];
  for (const c of conjectureList) {
    const { segmentLabel: _l, createdAt: _c, updatedAt: _u, ...fields } = c as typeof c & { createdAt?: unknown; updatedAt?: unknown };
    void _l;
    void _c;
    void _u;
    const values = { ...fields, workId: work.id, ownerId: owner(c.ownerId) };
    await db.insert(conjectures).values(values).onConflictDoUpdate({ target: conjectures.id, set: values });
  }
  const reportedList = (await readJson<(typeof reportedReadings.$inferSelect & { segmentLabel?: string })[]>(path.join(dir, 'reported-readings.json'))) ?? [];
  for (const r of reportedList) {
    const { segmentLabel: _l, createdAt: _c, updatedAt: _u, ...fields } = r as typeof r & { createdAt?: unknown; updatedAt?: unknown };
    void _l;
    void _c;
    void _u;
    const values = { ...fields, workId: work.id, ownerId: owner(r.ownerId) };
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
      adoptions: string[];
      notes: { id: string; segmentId: string; tokenIds: string[]; text: string; authorId: string | null }[];
      /** Absent in archives written before sites could be given a kind. */
      siteKinds?: { segmentId: string; siteKey: string; kind: 'textual' | 'interpretative' }[];
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
    };
    await db.insert(editions).values(values).onConflictDoUpdate({ target: editions.id, set: values });
    await db.delete(editionSigla).where(eq(editionSigla.editionId, e.id));
    if (e.sigla.length) {
      await db.insert(editionSigla).values(e.sigla.map((s, i) => ({ editionId: e.id, position: i, ...normalizeSiglum(s) })));
    }
    await db.delete(editionAdoptions).where(eq(editionAdoptions.editionId, e.id));
    if (e.adoptions.length) await db.insert(editionAdoptions).values(e.adoptions.map((conjectureId) => ({ editionId: e.id, conjectureId }))).onConflictDoNothing();
    for (const n of e.notes ?? []) {
      const noteValues = { id: n.id, editionId: e.id, segmentId: n.segmentId, tokenIds: n.tokenIds, text: n.text, authorId: n.authorId && known.has(n.authorId) ? n.authorId : userId };
      await db.insert(notes).values(noteValues).onConflictDoUpdate({ target: notes.id, set: noteValues });
    }
    await db.delete(editionSiteKinds).where(eq(editionSiteKinds.editionId, e.id));
    const kinds = (e.siteKinds ?? []).filter((k) => k.kind === 'textual' || k.kind === 'interpretative');
    if (kinds.length) await db.insert(editionSiteKinds).values(kinds.map((k) => ({ editionId: e.id, segmentId: k.segmentId, siteKey: k.siteKey, kind: k.kind }))).onConflictDoNothing();
    changesetCount += await importHistory(db, edir, 'edition', e.id, owner);
  }

  const items = (await readJson<{ id: string; entryType: string; citationKey: string; fields: Record<string, string>; label: string }[]>(path.join(dir, 'bibliography.json'))) ?? [];
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
      .values({ ...item, createdBy: userId })
      .onConflictDoUpdate({ target: bibliographyItems.id, set: { entryType: item.entryType, citationKey: item.citationKey, fields: item.fields, label: item.label } });
  }
  const citationList = (await readJson<(typeof citations.$inferSelect)[]>(path.join(dir, 'citations.json'))) ?? [];
  for (const c of citationList) {
    const { createdAt: _c, ...fields } = c as typeof c & { createdAt?: unknown };
    void _c;
    await db
      .insert(citations)
      .values({ ...fields, itemId: sameItem.get(fields.itemId) ?? fields.itemId })
      .onConflictDoNothing();
  }

  return { workId: work.id, witnesses: witnessCount, transcriptions: transcriptionCount, editions: editionCount, changesets: changesetCount, warnings };
}

async function importHistory(db: Database, dir: string, kind: 'transcription' | 'edition', documentId: string, owner: (id: string | null | undefined) => string): Promise<number> {
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
  const momentList = (await readJson<{ id: string; version: number; name: string; kind: 'named' | 'published'; number: number | null; at: string }[]>(path.join(dir, 'moments.json'))) ?? [];
  for (const m of momentList) {
    await db
      .insert(moments)
      .values({ id: m.id, documentKind: kind, documentId, version: m.version, name: m.name, kind: m.kind, number: m.number, at: new Date(m.at) })
      .onConflictDoNothing();
  }
  return count;
}

/** Remove a work and everything only it holds, for a round-trip test. */
export async function removeWorkCompletely(db: Database, workId: string): Promise<void> {
  const editionIds = (await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))).map((e) => e.id);
  const siglaRows = editionIds.length ? await db.select().from(editionSigla).where(inArray(editionSigla.editionId, editionIds)) : [];
  const transcriptionIds = siglaRows.map((s) => s.transcriptionId).filter((id): id is string => id !== null);
  const witnessIds = siglaRows.map((s) => s.witnessId);
  if (transcriptionIds.length) {
    await db.delete(changesets).where(inArray(changesets.documentId, transcriptionIds));
    await db.delete(transcriptions).where(inArray(transcriptions.id, transcriptionIds));
  }
  if (editionIds.length) await db.delete(changesets).where(inArray(changesets.documentId, editionIds));
  await db.delete(works).where(eq(works.id, workId));
  if (witnessIds.length) await db.delete(witnesses).where(inArray(witnesses.id, witnessIds));
  await db.execute(sql`select 1`);
}
