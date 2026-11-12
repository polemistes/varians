/**
 * The transcription workbench on the server: what the page loads,
 * the imports (TEI, plain text, Leiden, PAGE and ALTO), matching imported
 * pages to the witness's pages, the TEI download, the settings and the
 * deletion. Every import is one changeset; pages it creates and zones it
 * makes are written in the same transaction.
 */

import { materialLabel } from '$lib/registry/witness';
import {
  applyOps,
  applyStarts,
  conformPages,
  detectStructure,
  exportTranscriptionTei,
  fromLeiden,
  importAltoXml,
  importLeidenPlus,
  leidenPlusLanguage,
  importPageXml,
  importPlainText,
  importTei,
  insertIntoPage,
  isBreak,
  isLeidenPlus,
  isToken,
  newId,
  repairSegmentStartsFrom,
  nextLabel,
  resolveStarts,
  segmentIds,
  toLeidenPlus,
  type ImportedZone,
  type Item,
  type Level,
  type MemoryEntry,
  type NumberingPattern,
  type Op,
  type Stream,
  type UnitMapping,
  type ZoneGeometry,
} from '@varians/core';
import {
  changesets,
  checkpoints,
  moments,
  pages,
  referenceSchemes,
  reviewState,
  segments,
  transcriptionSegments,
  transcriptions,
  witnessMaintainers,
  works,
  zones,
  type Database,
  type WitnessHand,
  type TranscriptionSnapshot,
} from '@varians/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { workbench as strings } from '$lib/strings/workbench';
import { dropWrittenFormOps, keepWrittenFormOps } from '$lib/workbench/normalization';

const t = strings.importer;
import type { Actor } from './authz.ts';
import { canDeleteVersions, canMaintainWitness } from './authz.ts';
import { loadDocument, replaceContent, saveOps, type SaveResult } from './documents/service.ts';
import { fetchCtsPassage, isCtsUrn, teiFromCtsReply } from './import/cts.ts';
import { SafeFetchError, readTextCapped, safeFetch } from './safe-fetch.ts';
import { previewTei } from './import/tei.ts';
import { LanguageMissing, withLanguage } from './import/language.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { loadTranscriptionAccess } from './transcription-access.ts';
import {
  latestVersionWithSnapshot,
  versionByNumber,
  versionsOf,
  type VersionSummary,
} from './versions.ts';
import type { ReaderVersion } from '$lib/reader/types';
import { worksOfTranscription } from './transcription-works.ts';
import { grantsFor } from './authz.ts';
import { candidateWitnesses, editionsOfWork } from './editions.ts';
import { loadEditionAccess } from './edition-access.ts';
import { zonesOf } from './zones.ts';
import { exportHands, teiForm } from './witness-format.ts';
import { licenceInfo } from '@varians/core';
import { dataLicence } from './settings.ts';

// Loading

export interface WorkbenchWork {
  id: string;
  slug: string;
  title: string;
  levels: Level[];
}

/** Works as the workbench needs them, in the order of the ids given; an id of no work is left out. */
export async function workbenchWorks(db: Database, ids: string[]): Promise<WorkbenchWork[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: works.id,
      slug: works.slug,
      title: works.title,
      levels: referenceSchemes.levels,
    })
    .from(works)
    .innerJoin(referenceSchemes, eq(referenceSchemes.id, works.schemeId))
    .where(inArray(works.id, ids));
  const order = new Map(ids.map((w, i) => [w, i] as const));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export interface WorkbenchPageRow {
  id: string;
  label: string;
  position: number;
  imageKind: 'upload' | 'iiif' | null;
  imageIiif: string | null;
  imagePath: string | null;
  tilesPath: string | null;
  width: number | null;
  height: number | null;
  updatedAt: Date;
  /** The image's rights statement and credit line. */
  rights: string | null;
  attribution: string | null;
}

export interface WorkbenchData {
  transcription: {
    id: string;
    name: string;
    version: number;
    content: Stream;
    keepsWrittenForm: boolean;
    displayAsWritten: boolean;
    memory: MemoryEntry[];
    /** The number of the latest version that is not withdrawn; null while there is none. */
    latestVersion: number | null;
    /** The number of the version shown, read only; null for the draft. */
    shownVersion: number | null;
    /**
     * Of the version shown: when it was published, by whom (the name its
     * citation gives) and the note on it, and when it was withdrawn with the
     * note readers see; null for the draft.
     */
    shown: {
      at: string;
      note: string | null;
      personName: string | null;
      withdrawn: { at: string; note: string | null } | null;
    } | null;
    /** Every version, newest first, withdrawn ones among them, each at its own address. */
    versions: ReaderVersion[];
    sources: string | null;
    rightsNote: string | null;
    /** The licence fixed at publication, by name, and the installation's, which publication would give. */
    licence: string | null;
    installationLicence: string;
  };
  witness: {
    id: string;
    slug: string;
    siglum: string;
    name: string;
    hands: WitnessHand[];
    /** The rights statement and credit line new images of the witness are given. */
    imageDefaults: { rights: string | null; attribution: string | null };
  };
  pages: WorkbenchPageRow[];
  /** The works the transcription's text is assigned to, in the order they first occur in it. */
  works: WorkbenchWork[];
  /** Label and work of every segment the content names. */
  segments: Record<string, { label: string; workId: string }>;
  canEdit: boolean;
  /** May publish and withdraw versions: the owner, or an administrator. */
  canPublish: boolean;
  /** May edit the draft, whether or not it is the state shown. */
  canEditDraft: boolean;
  canDelete: boolean;
  /** May delete a version: an administrator alone. */
  canDeleteVersion: boolean;
  /** May add pages to the witness (an import that brings pages the witness lacks). */
  canMaintainWitness: boolean;
}

/**
 * The versions of a transcription as its Versions menu lists them, newest
 * first: each leads to its own address, which shows it read only to anyone
 * (the transcription's plain address shows its editors the draft).
 */
function transcriptionVersionList(id: string, all: VersionSummary[]): ReaderVersion[] {
  const latest = all.find((v) => !v.withdrawn)?.number ?? null;
  const base = `/transcriptions/${encodeURIComponent(id)}`;
  return all.map((v) => ({
    number: v.number,
    at: v.at.toISOString(),
    note: v.note,
    withdrawn: v.withdrawn ? { at: v.withdrawn.at.toISOString(), note: v.withdrawn.note } : null,
    changes: v.changes,
    href: `${base}/v/${v.number}`,
    current: v.number === latest,
  }));
}

/** What the workbench says of the version it shows. */
function shownVersion(v: VersionSummary): NonNullable<WorkbenchData['transcription']['shown']> {
  return {
    at: v.at.toISOString(),
    note: v.note,
    personName: v.personName,
    withdrawn: v.withdrawn ? { at: v.withdrawn.at.toISOString(), note: v.withdrawn.note } : null,
  };
}

/**
 * Everything the workbench page needs, or null when the transcription does
 * not exist or may not be viewed. Those who may edit it see the draft; others
 * its latest version that is not withdrawn, read only. Version `number`, when
 * asked for, is shown read only to anyone, a withdrawn one too, which says
 * that it is: someone may have cited its address.
 */
export async function loadWorkbench(
  db: Database,
  user: Actor | null,
  id: string,
  number: number | null = null,
): Promise<WorkbenchData | null> {
  const access = await loadTranscriptionAccess(db, user, id);
  if (!access) return null;
  const all = await versionsOf(db, 'transcription', id);
  const latest = all.find((v) => !v.withdrawn) ?? null;
  const asked = number === null ? null : (all.find((v) => v.number === number) ?? null);
  if (number !== null && !asked) return null;
  if (number === null && !access.canView) return null;
  const shownNumber = asked?.number ?? (access.canEdit ? null : (latest?.number ?? null));
  const shown =
    shownNumber === null ? null : await versionByNumber(db, 'transcription', id, shownNumber);
  const draft = access.transcription;
  const snapshot = shown ? (shown.snapshot as TranscriptionSnapshot) : null;
  const transcription = snapshot
    ? {
        ...draft,
        name: snapshot.name,
        version: shown!.version,
        content: snapshot.content,
        keepsWrittenForm: snapshot.keepsWrittenForm,
        displayAsWritten: snapshot.displayAsWritten,
        memory: [],
        sources: snapshot.sources,
        rightsNote: snapshot.rightsNote,
        licenceId: snapshot.licenceId,
      }
    : draft;
  const { witness } = access;
  const pageRows = await witnessPages(db, witness.id);
  const named = segmentIds(transcription.content);
  const segmentRows = named.length
    ? await db
        .select({ id: segments.id, label: segments.label, workId: segments.workId })
        .from(segments)
        .where(inArray(segments.id, named))
    : [];
  const workOf = new Map(segmentRows.map((s) => [s.id, s.workId] as const));
  const workIds = [
    ...new Set(named.map((s) => workOf.get(s)).filter((w): w is string => w !== undefined)),
  ];
  const workRows = await workbenchWorks(db, workIds);
  const maintainers = await db
    .select({ userId: witnessMaintainers.userId })
    .from(witnessMaintainers)
    .where(eq(witnessMaintainers.witnessId, witness.id));
  return {
    transcription: {
      id: transcription.id,
      name: transcription.name,
      version: transcription.version,
      content: transcription.content,
      keepsWrittenForm: transcription.keepsWrittenForm,
      displayAsWritten: transcription.displayAsWritten,
      memory: transcription.memory,
      latestVersion: latest?.number ?? null,
      shownVersion: shownNumber,
      shown: shown ? shownVersion(all.find((v) => v.number === shownNumber)!) : null,
      versions: transcriptionVersionList(id, all),
      sources: transcription.sources,
      rightsNote: transcription.rightsNote,
      licence: licenceInfo(transcription.licenceId)?.name ?? null,
      installationLicence: licenceInfo(dataLicence())!.name,
    },
    witness: {
      id: witness.id,
      slug: witness.slug,
      siglum: witness.siglum,
      name: witness.name,
      hands: witness.hands,
      imageDefaults: { rights: witness.imageRights, attribution: witness.imageAttribution },
    },
    pages: pageRows,
    works: workRows,
    segments: Object.fromEntries(
      segmentRows.map((s) => [s.id, { label: s.label, workId: s.workId }]),
    ),
    // A version is read only, to its editors too.
    canEdit: access.canEdit && shownNumber === null,
    canPublish: access.canPublish,
    canEditDraft: access.canEdit,
    canDelete: access.canDelete,
    canDeleteVersion: canDeleteVersions(user),
    canMaintainWitness: canMaintainWitness(
      user,
      witness,
      maintainers.map((m) => m.userId),
    ),
  };
}

async function witnessPages(db: Database, witnessId: string): Promise<WorkbenchPageRow[]> {
  return db
    .select({
      id: pages.id,
      label: pages.label,
      position: pages.position,
      imageKind: pages.imageKind,
      imageIiif: pages.imageIiif,
      imagePath: pages.imagePath,
      tilesPath: pages.tilesPath,
      width: pages.imageWidth,
      height: pages.imageHeight,
      updatedAt: pages.updatedAt,
      rights: pages.rights,
      attribution: pages.attribution,
    })
    .from(pages)
    .where(eq(pages.witnessId, witnessId))
    .orderBy(asc(pages.position));
}

// Pages

/** A page an import found: its label, and the image file it was made from when the source names one. */
export interface WantedPage {
  label: string;
  fileName?: string;
}

function normalized(text: string): string {
  return text.normalize('NFC').trim().toLowerCase();
}

/** A file name without directory and extension. */
function stem(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Which of the witness's pages each wanted page is: the page with the same
 * label; else one whose label ends the file name's stem (`venA_12r.jpg` is
 * 12r) or whose stored image has the same stem. A page is matched at most
 * once. Pure over the page rows.
 */
export function matchPageLabels(
  existing: { id: string; label: string; imagePath?: string | null }[],
  wanted: WantedPage[],
): (string | null)[] {
  const taken = new Set<string>();
  const byLabel = new Map<string, string>();
  for (const page of existing) {
    const key = normalized(page.label);
    if (!byLabel.has(key)) byLabel.set(key, page.id);
  }
  return wanted.map((want) => {
    const exact = byLabel.get(normalized(want.label));
    if (exact && !taken.has(exact)) {
      taken.add(exact);
      return exact;
    }
    const names = [want.label, want.fileName ? stem(want.fileName) : null]
      .filter((n): n is string => !!n)
      .map(normalized);
    const candidates = existing.filter((page) => {
      if (taken.has(page.id)) return false;
      const label = normalized(page.label);
      const own = page.imagePath ? normalized(stem(page.imagePath)) : null;
      return names.some((name) => {
        if (own && own === name) return true;
        if (!name.endsWith(label) || name.length === label.length) return false;
        const before = name[name.length - label.length - 1]!;
        return /[\s_\-.]/u.test(before);
      });
    });
    if (candidates.length !== 1) return null;
    taken.add(candidates[0]!.id);
    return candidates[0]!.id;
  });
}

/**
 * The witness's page for each wanted page, matched by label or file name;
 * pages that match none are created at the end of the witness when
 * `create` is true, else left null.
 */
export async function matchPages(
  db: Database,
  witnessId: string,
  wanted: WantedPage[],
  options: { create: boolean },
): Promise<{ ids: (string | null)[]; matched: number; created: number }> {
  const existing = await witnessPages(db, witnessId);
  const ids = matchPageLabels(existing, wanted);
  const matched = ids.filter((id) => id !== null).length;
  let created = 0;
  if (options.create) {
    let position = existing.reduce((max, page) => Math.max(max, page.position), 0);
    const rows: { id: string; witnessId: string; label: string; position: number }[] = [];
    ids.forEach((id, i) => {
      if (id !== null) return;
      const row = { id: newId(), witnessId, label: wanted[i]!.label, position: ++position };
      rows.push(row);
      ids[i] = row.id;
    });
    if (rows.length) await db.insert(pages).values(rows);
    created = rows.length;
  }
  return { ids, matched, created };
}

/** Name the witness pages on the page breaks of an imported stream, in order. Breaks without a page keep their label. */
export function namePageBreaks(stream: Stream, pageIds: (string | null)[]): Stream {
  let n = 0;
  return {
    items: stream.items.map((item) => {
      if (!isBreak(item) || item.type !== 'page') return item;
      const pageId = pageIds[n++] ?? null;
      if (!pageId) return item;
      const { label: _label, ...rest } = item;
      return { ...rest, pageId };
    }),
  };
}

// Placing an import

/** Where imported text without pages of its own goes: Staging, or a page of the witness. */
export type Placement = { to: 'unplaced' } | { to: 'page'; pageId: string };

export interface PlacedImport {
  /** The operations on the current content (for an import added to it). */
  ops: Op[];
  /** The whole content after the import. */
  content: Stream;
  /** Words that went to Staging. */
  unplaced: number;
}

/**
 * Put an imported stream into a transcription. The import's
 * page breaks that name a page of the witness (matched or created) send
 * their text to that page, appended to what it has; a page break naming no
 * page is dropped and its text goes to Staging, in the order of the
 * file. Text before the first page break, and all the text of an import
 * without pages, goes to `placement`. Each stretch is appended after a line
 * break when the text it joins does not end with one. The imported words
 * keep the segments the file gave them, the existing words theirs, and the
 * result keeps the page invariants. With `replace` the current content is
 * not kept.
 */
export function placeImport(
  current: Stream,
  imported: Stream,
  options: {
    replace: boolean;
    placement?: Placement;
    pageOrder: readonly string[];
    ids?: () => string;
  },
): PlacedImport {
  const base: Stream = options.replace ? { items: [] } : current;
  const settings = { pageOrder: options.pageOrder, ids: options.ids ?? newId };
  const known = new Set(options.pageOrder);
  const lead: Item[] = [];
  const blocks: { pageId: string | null; items: Item[] }[] = [];
  for (const item of imported.items) {
    if (isBreak(item) && item.type === 'page')
      blocks.push({
        pageId: item.pageId && known.has(item.pageId) ? item.pageId : null,
        items: [],
      });
    else if (blocks.length) blocks[blocks.length - 1]!.items.push(item);
    else lead.push(item);
  }
  let stream = base;
  const ops: Op[] = [];
  let unplaced = 0;
  const add = (items: Item[], target: string | null) => {
    const more = insertIntoPage(stream, items, target, settings);
    if (more.length === 0) return;
    stream = applyOps(stream, more).stream;
    ops.push(...more);
    if (target === null) unplaced += items.filter(isToken).length;
  };
  const placement = options.placement ?? { to: 'unplaced' };
  add(lead, placement.to === 'page' && known.has(placement.pageId) ? placement.pageId : null);
  for (const block of blocks) add(block.items, block.pageId);
  const finish = (more: Op[]) => {
    if (more.length === 0) return;
    stream = applyOps(stream, more).stream;
    ops.push(...more);
  };
  finish(repairSegmentStartsFrom([base, imported], stream));
  finish(conformPages(stream, options.pageOrder, settings.ids));
  return { ops, content: stream, unplaced };
}

export interface ImportOutcome {
  version: number;
  content: Stream;
  /** Segment starts set. */
  segments: number;
  /** Numbers or structure the work's scheme could not read. */
  unresolved: number;
  pagesMatched: number;
  pagesCreated: number;
  zones: number;
  /** Words that went to Staging. */
  unplaced: number;
  warnings: string[];
}

interface Target {
  transcriptionId: string;
  witnessId: string;
  fromVersion: number;
  userId: string | null;
  replace: boolean;
  /** May create witness pages that the import names and the witness lacks. */
  createPages: boolean;
  /** Where text without pages of its own goes; Staging when absent. */
  placement?: Placement;
  /**
   * The language of the text, as the person importing gives it: the words
   * the file leaves without one take it (see `withLanguage`). An import that
   * would leave a word without a language is refused (LanguageMissing).
   */
  language?: string | null;
}

/** One transaction: the content saved as one changeset (pages and zones beside it). */
async function inTransaction<T>(db: Database, run: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => run(tx as unknown as Database));
}

async function save(
  db: Database,
  target: Target,
  imported: Stream,
  message: string,
): Promise<SaveResult & { unplaced: number }> {
  const current = await loadDocument(db, 'transcription', target.transcriptionId);
  const pageOrder = (await witnessPages(db, target.witnessId)).map((p) => p.id);
  const replace = target.replace || current.content.items.length === 0;
  const placed = placeImport(current.content, imported, {
    replace,
    pageOrder,
    ...(target.placement ? { placement: target.placement } : {}),
  });
  const saved = replace
    ? await replaceContent(
        db,
        'transcription',
        target.transcriptionId,
        target.userId,
        target.fromVersion,
        placed.content,
        message,
      )
    : await saveOps(
        db,
        'transcription',
        target.transcriptionId,
        target.userId,
        target.fromVersion,
        placed.ops,
        message,
      );
  return { ...saved, unplaced: placed.unplaced };
}

/** Resolve labels through a work's scheme and put the segment starts on the stream. */
async function attachLabels(
  db: Database,
  workId: string | null,
  stream: Stream,
  starts: { itemIndex: number; label: string }[],
): Promise<{ stream: Stream; set: number; unresolved: string[] }> {
  if (!workId || starts.length === 0)
    return { stream, set: 0, unresolved: workId ? [] : starts.map((s) => s.label) };
  const work = await schemeOfWork(db, workId);
  const resolved = await resolveLabels(
    db,
    work,
    starts.map((s) => s.label),
  );
  const byIndex = new Map<number, string>();
  const unresolved: string[] = [];
  for (const start of starts) {
    const segment = resolved.get(start.label);
    if (segment) byIndex.set(start.itemIndex, segment.id);
    else unresolved.push(start.label);
  }
  const next = applyStarts(
    stream,
    [...byIndex.entries()].map(([itemIndex, segmentId]) => ({ itemIndex, segmentId })),
  );
  return { stream: next, set: byIndex.size, unresolved };
}

// Plain text and Leiden

export interface PlainTextInput {
  text: string;
  pattern: NumberingPattern | null;
  startLabel?: string;
  workId: string | null;
  paragraphs?: boolean;
  hyphenJoins?: boolean;
}

/** Plain text with its numbering stripped and attached as segment starts. */
export async function importPlainTextInto(
  db: Database,
  target: Target,
  input: PlainTextInput,
): Promise<ImportOutcome> {
  // Plain text declares no language: the person importing says what it is.
  if (!target.language) throw new LanguageMissing();
  const scheme = input.workId ? (await schemeOfWork(db, input.workId)).scheme : null;
  const result = importPlainText(input.text, {
    lang: target.language,
    pattern: input.pattern,
    ...(input.startLabel ? { startLabel: input.startLabel } : {}),
    ...(scheme ? { nextLabel: (label: string) => nextLabel(scheme, label) } : {}),
    ...(input.paragraphs !== undefined ? { paragraphs: input.paragraphs } : {}),
    ...(input.hyphenJoins !== undefined ? { hyphenJoins: input.hyphenJoins } : {}),
  });
  return inTransaction(db, async (tx) => {
    const labelled = await attachLabels(tx, input.workId, result.stream, result.segmentStarts);
    const saved = await save(tx, target, labelled.stream, 'plain text import');
    return outcome(saved, labelled, result.warnings);
  });
}

/**
 * Leiden notation read into words, marks and gaps: Leiden+ as papyri.info
 * writes it, or the conventions as they are printed. A text in it is a
 * transcript of its carrier, and is read as one.
 */
export async function importLeidenInto(
  db: Database,
  target: Target,
  text: string,
): Promise<ImportOutcome> {
  const plus = isLeidenPlus(text);
  const result = plus ? importLeidenPlus(text) : fromLeiden(text);
  // Leiden+ names its language at its head; the printed conventions name none.
  const declared = plus ? leidenPlusLanguage(text) : undefined;
  const stream = withLanguage(result.stream, target.language, declared);
  return inTransaction(db, async (tx) => {
    const saved = await save(tx, target, stream, 'Leiden import');
    return outcome(saved, { set: 0, unresolved: [] }, result.warnings);
  });
}

function outcome(
  saved: SaveResult & { unplaced?: number },
  labelled: { set: number; unresolved: string[] },
  warnings: string[],
  extra: Partial<Pick<ImportOutcome, 'pagesMatched' | 'pagesCreated' | 'zones'>> = {},
): ImportOutcome {
  const notes = [...warnings];
  if (labelled.unresolved.length) {
    const shown = labelled.unresolved.slice(0, 5).join(', ');
    notes.push(
      t.notes.unresolvedLabels(labelled.unresolved.length, shown, labelled.unresolved.length > 5),
    );
  }
  return {
    version: saved.version,
    content: saved.content,
    segments: labelled.set,
    unresolved: labelled.unresolved.length,
    pagesMatched: extra.pagesMatched ?? 0,
    pagesCreated: extra.pagesCreated ?? 0,
    zones: extra.zones ?? 0,
    unplaced: saved.unplaced ?? 0,
    warnings: notes,
  };
}

// TEI

/**
 * What a TEI file is taken as (docs/design.md, section 3.7): a text to start
 * from, which gives its words and their numbering and is otherwise as if
 * typed in; or a transcript of this witness, read with its features and its
 * pages.
 */
export type TeiKind = 'text' | 'transcript';

export interface TeiInput {
  xml: string;
  workId: string | null;
  mapping: UnitMapping;
  as: TeiKind;
}

/**
 * A TEI text into the transcription: the structure mapped onto the work's
 * scheme as segment starts, the `<pb>` pages matched to the witness's pages
 * by label (or created), placed as one changeset. The same steps as
 * importTeiIntoTranscription, with the pages and the placement added.
 */
export async function importTeiInto(
  db: Database,
  target: Target,
  input: TeiInput,
): Promise<ImportOutcome> {
  const read = importTei(input.xml, { as: input.as });
  const result = {
    ...read,
    stream: withLanguage(read.stream, target.language, read.header.language),
  };
  return inTransaction(db, async (tx) => {
    let starts: { itemIndex: number; label: string }[] = [];
    let unresolvedHints = 0;
    if (input.workId) {
      const work = await schemeOfWork(tx, input.workId);
      const { resolved, unresolved } = resolveStarts(
        result.segmentStarts,
        input.mapping,
        work.scheme,
      );
      // Several hints at one item keep the one resolved last, as importTeiIntoTranscription does.
      const byIndex = new Map<number, string>();
      for (const r of resolved) byIndex.set(r.itemIndex, r.label);
      starts = [...byIndex.entries()].map(([itemIndex, label]) => ({ itemIndex, label }));
      unresolvedHints = unresolved.length;
    }
    const labelled = await attachLabels(tx, input.workId, result.stream, starts);
    const wanted = result.pages.map((p) => ({
      label: p.label,
      ...(p.facs ? { fileName: p.facs } : {}),
    }));
    const matched = wanted.length
      ? await matchPages(tx, target.witnessId, wanted, { create: target.createPages })
      : { ids: [], matched: 0, created: 0 };
    const stream = namePageBreaks(labelled.stream, matched.ids);
    const saved = await save(tx, target, stream, 'TEI import');
    const warnings = [...result.warnings];
    if (unresolvedHints) warnings.push(t.notes.unresolvedPlaces(unresolvedHints));
    const unplaced = matched.ids.filter((id) => id === null).length;
    if (unplaced) warnings.push(t.notes.teiPagesUnplaced(unplaced));
    return outcome(saved, labelled, warnings, {
      pagesMatched: matched.matched,
      pagesCreated: matched.created,
    });
  });
}

export interface TeiPreviewData {
  units: { unit: string; count: number; example: string }[];
  mapping: UnitMapping;
  /** Numbered places the mapping turns into labels, and those it cannot. */
  resolved: number;
  unresolved: number;
  examples: string[];
  words: number;
  pageBreaks: number;
  title: string | null;
  /** The language the file declares for its text, which the import window offers; null where it declares none. */
  language: string | null;
  warnings: string[];
}

/** What a TEI import would do: the structure found and, for a work, the mapping onto its scheme with what it resolves. */
export async function teiPreview(
  db: Database,
  workId: string | null,
  xml: string,
  mapping?: UnitMapping,
  as: TeiKind = 'transcript',
): Promise<TeiPreviewData> {
  if (workId) {
    const preview = await previewTei(db, workId, xml, mapping, as);
    return {
      units: preview.structure.units,
      mapping: preview.mapping,
      resolved: preview.resolved,
      unresolved: preview.unresolved,
      examples: preview.examples,
      words: preview.words,
      pageBreaks: as === 'text' ? 0 : preview.structure.pageBreaks,
      title: preview.header.title ?? null,
      language: preview.header.language ?? null,
      warnings: preview.warnings,
    };
  }
  const structure = detectStructure(xml);
  const result = importTei(xml, { as });
  return {
    units: structure.units,
    mapping: {},
    resolved: 0,
    unresolved: result.segmentStarts.length,
    examples: [],
    words: result.stream.items.filter(isToken).length,
    pageBreaks: as === 'text' ? 0 : structure.pageBreaks,
    title: result.header.title ?? null,
    language: result.header.language ?? null,
    warnings: result.warnings,
  };
}

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[.*\])$/iu;

/** Whether the server may fetch a URL a user gave: http or https, not a private or local host. */
export function isFetchableUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return !PRIVATE_HOST.test(url.hostname);
}

/** The largest TEI file fetched from the web. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** The TEI a user pointed to: a CTS URN fetched from the CTS service, or a URL on the web. */
export async function fetchTeiSource(source: string, timeoutMs = 30000): Promise<string> {
  const text = source.trim();
  if (isCtsUrn(text)) return teiFromCtsReply(await fetchCtsPassage(text, { timeoutMs }), text);
  if (!isFetchableUrl(text)) throw new SourceError(t.notes.badSource);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Public addresses only, every redirect checked, the body capped: a user's URL must not reach the server's own network.
    const response = await safeFetch(text, {
      signal: controller.signal,
      headers: { accept: 'application/xml, text/xml, */*' },
    });
    if (!response.ok)
      throw new SourceError(t.notes.sourceStatus(response.status, response.statusText));
    return await readTextCapped(response, MAX_SOURCE_BYTES);
  } catch (error) {
    if (error instanceof SourceError) throw error;
    if (error instanceof SafeFetchError) throw new SourceError(t.notes.badSource);
    if (error instanceof RangeError) throw new SourceError(t.notes.sourceTooLarge);
    throw new SourceError(t.notes.sourceUnreachable);
  } finally {
    clearTimeout(timer);
  }
}

// PAGE and ALTO

/** Which kind of layout file a text is, by its root element. */
export function layoutKind(xml: string): 'page' | 'alto' | null {
  const root = /<\s*(?:[\w-]+:)?(PcGts|alto)\b/u.exec(xml);
  if (!root) return null;
  return root[1] === 'PcGts' ? 'page' : 'alto';
}

/** The page of each imported zone: the page of its first token; a zone without tokens goes with the zone before it. */
function zonePages(
  stream: Stream,
  imported: ImportedZone[],
  pageIds: (string | null)[],
): (string | null)[] {
  const pageOfItem = new Map<string, number>();
  let page = -1;
  for (const item of stream.items) {
    if (isBreak(item) && item.type === 'page') page++;
    else if (isToken(item)) pageOfItem.set(item.id, page);
  }
  let last = 0;
  return imported.map((zone) => {
    const first = zone.tokenIds[0];
    const index = first !== undefined ? pageOfItem.get(first) : undefined;
    if (index !== undefined && index >= 0) last = index;
    return pageIds[index !== undefined && index >= 0 ? index : last] ?? null;
  });
}

/**
 * PAGE XML or ALTO: pages matched to the witness's pages by label or file
 * name (or created), the page breaks named, the text placed as one
 * changeset, and a zone made for every word with coordinates.
 */
export async function importLayoutInto(
  db: Database,
  target: Target,
  xml: string,
  kind?: 'page' | 'alto',
): Promise<ImportOutcome> {
  const which = kind ?? layoutKind(xml) ?? 'page';
  const read = which === 'alto' ? importAltoXml(xml) : importPageXml(xml);
  const result = { ...read, stream: withLanguage(read.stream, target.language) };
  return inTransaction(db, async (tx) => {
    const wanted = result.pages.map((p) => ({
      label: p.label ?? '',
      ...(p.imageFilename ? { fileName: p.imageFilename } : {}),
    }));
    const matched = await matchPages(tx, target.witnessId, wanted, { create: target.createPages });
    const stream = namePageBreaks(result.stream, matched.ids);
    const saved = await save(tx, target, stream, which === 'alto' ? 'ALTO import' : 'PAGE import');
    const pageOf = zonePages(stream, result.zones, matched.ids);
    const rows = result.zones
      .map((zone, i) => ({ zone, pageId: pageOf[i] }))
      .filter(
        (z): z is { zone: ImportedZone; pageId: string } =>
          z.pageId !== null && z.pageId !== undefined,
      )
      .map(({ zone, pageId }) => ({
        id: newId(),
        transcriptionId: target.transcriptionId,
        pageId,
        geometry: zone.geometry,
        tokenIds: zone.tokenIds,
        feature: zone.feature ?? null,
      }));
    if (rows.length) await tx.insert(zones).values(rows);
    const warnings = [...result.warnings];
    const unplaced = matched.ids.filter((id) => id === null).length;
    if (unplaced) warnings.push(t.notes.layoutPagesUnplaced(unplaced));
    return outcome(saved, { set: 0, unresolved: [] }, warnings, {
      pagesMatched: matched.matched,
      pagesCreated: matched.created,
      zones: rows.length,
    });
  });
}

// Leiden+ export

/** The transcription as Leiden+, its pages as divisions under their labels. */
export async function exportLeidenPlus(
  db: Database,
  transcriptionId: string,
  draft = true,
): Promise<{ text: string; name: string } | null> {
  const row = await shownTranscription(db, transcriptionId, draft);
  if (!row) return null;
  const pageRows = await witnessPages(db, row.witnessId);
  // The head names the language most of the words have, and a run in another language says its own.
  const text = toLeidenPlus(row.content, {
    pageLabels: Object.fromEntries(pageRows.map((page) => [page.id, page.label])),
  });
  return { text, name: row.name };
}

/**
 * A transcription as a download gives it: its draft, for those who may edit
 * it, or else its latest version that is not withdrawn, from its snapshot;
 * null when there is neither.
 */
async function shownTranscription(
  db: Database,
  transcriptionId: string,
  draft: boolean,
): Promise<{
  name: string;
  witnessId: string;
  content: Stream;
  keepsWrittenForm: boolean;
  sources: string | null;
  rightsNote: string | null;
  zones: { id: string; pageId: string; tokenIds: string[]; geometry: ZoneGeometry }[];
} | null> {
  if (draft) {
    const [row] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId));
    return row ? { ...row, zones: await zonesOf(db, transcriptionId) } : null;
  }
  const latest = await latestVersionWithSnapshot(db, 'transcription', transcriptionId);
  if (!latest) return null;
  const snapshot = latest.snapshot as TranscriptionSnapshot;
  return { ...snapshot, zones: snapshot.zones };
}

// TEI export

/** The transcription as a TEI document with the witness, the pages and zones, and the segment labels. */
export async function exportTei(
  db: Database,
  transcriptionId: string,
  origin: string,
  draft = true,
): Promise<{ xml: string; name: string } | null> {
  const row = await shownTranscription(db, transcriptionId, draft);
  if (!row) return null;
  const witness = await db.query.witnesses.findFirst({
    where: (w, { eq }) => eq(w.id, row.witnessId),
  });
  const pageRows = await witnessPages(db, row.witnessId);
  const zoneRows = row.zones;
  const named = segmentIds(row.content);
  const labels = named.length
    ? await db
        .select({ id: segments.id, label: segments.label })
        .from(segments)
        .where(inArray(segments.id, named))
    : [];
  const imageUrl = (page: WorkbenchPageRow): string | undefined => {
    if (page.imageKind === 'iiif' && page.imageIiif) return page.imageIiif;
    if (page.imageKind === 'upload' && page.imagePath) return `${origin}/media/${page.imagePath}`;
    return undefined;
  };
  const xml = exportTranscriptionTei({
    stream: row.content,
    title: witness ? `${witness.name}: ${row.name}` : row.name,
    ...(witness
      ? {
          witness: compact({
            siglum: witness.siglum,
            name: witness.name,
            repository: witness.repository,
            settlement: witness.settlement,
            idno: witness.shelfmark ?? witness.identifier,
            date: witness.dateText,
            material: materialLabel(witness.material),
            extent: witness.extent,
            description: witness.description,
          }),
          ...(witness.hands.length ? { hands: exportHands(witness.hands) } : {}),
          ...(teiForm(witness) ? { form: teiForm(witness) } : {}),
        }
      : {}),
    pages: pageRows.map((page) =>
      compact({
        id: page.id,
        label: page.label,
        imageUrl: imageUrl(page),
        width: page.width,
        height: page.height,
      }),
    ) as { id: string; label: string }[],
    zones: zoneRows.map((z) => ({
      id: z.id,
      pageId: z.pageId,
      tokenIds: z.tokenIds,
      geometry: z.geometry,
    })),
    segmentLabels: Object.fromEntries(labels.map((l) => [l.id, l.label])),
    words: zoneRows.some((z) => z.tokenIds.length > 0),
    regularizations: row.keepsWrittenForm,
    ...(row.sources ? { sources: row.sources } : {}),
    ...(row.rightsNote ? { rightsNote: row.rightsNote } : {}),
  });
  return { xml, name: row.name };
}

/** An object without its null and undefined fields (the export's optional fields are absent, not null). */
function compact<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}

// Settings and deletion

export interface SettingsInput {
  name: string;
  keepsWrittenForm: boolean;
  displayAsWritten: boolean;
  /** What it rests on and its rightsNote; left as they are when absent. */
  sources?: string | null;
  rightsNote?: string | null;
  fromVersion: number;
  userId: string | null;
}

export interface SettingsOutcome {
  name: string;
  keepsWrittenForm: boolean;
  displayAsWritten: boolean;
  sources: string | null;
  rightsNote: string | null;
  version: number;
  /** The content when switching the written form changed it. */
  content: Stream | null;
}

/**
 * Save the settings. Switching the written form on gives every word a read
 * form of its own (the text as it stands); switching it off makes the read
 * form the only form. Either is one changeset.
 */
export async function saveSettings(
  db: Database,
  transcriptionId: string,
  input: SettingsInput,
): Promise<SettingsOutcome> {
  return inTransaction(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId));
    if (!row) throw new Error(`no transcription ${transcriptionId}`);
    let version = row.version;
    let content: Stream | null = null;
    if (input.keepsWrittenForm !== row.keepsWrittenForm) {
      const ops = input.keepsWrittenForm
        ? keepWrittenFormOps(row.content)
        : dropWrittenFormOps(row.content);
      if (ops.length) {
        const saved = await saveOps(
          tx,
          'transcription',
          transcriptionId,
          input.userId,
          input.fromVersion,
          ops,
          input.keepsWrittenForm ? 'keep a written form' : 'read forms only',
        );
        version = saved.version;
        content = saved.content;
      }
    }
    await tx
      .update(transcriptions)
      .set({
        name: input.name,
        keepsWrittenForm: input.keepsWrittenForm,
        displayAsWritten: input.displayAsWritten,
        ...(input.sources !== undefined ? { sources: input.sources } : {}),
        ...(input.rightsNote !== undefined ? { rightsNote: input.rightsNote } : {}),
      })
      .where(eq(transcriptions.id, transcriptionId));
    const [after] = await tx
      .select({ sources: transcriptions.sources, rightsNote: transcriptions.rightsNote })
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId));
    return {
      name: input.name,
      keepsWrittenForm: input.keepsWrittenForm,
      displayAsWritten: input.displayAsWritten,
      sources: after?.sources ?? null,
      rightsNote: after?.rightsNote ?? null,
      version,
      content,
    };
  });
}

/** Add a source to what a transcription states it rests on, on a line of its own. */
export async function appendSources(
  db: Database,
  transcriptionId: string,
  source: string,
): Promise<void> {
  const [row] = await db
    .select({ sources: transcriptions.sources })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  if (!row) return;
  const lines = (row.sources ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.includes(source.trim())) return;
  await db
    .update(transcriptions)
    .set({ sources: [...lines, source.trim()].join('\n') })
    .where(eq(transcriptions.id, transcriptionId));
}

/** Delete a transcription with its zones, derived index and history. */
export async function deleteTranscription(db: Database, transcriptionId: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const document = and(
      eq(changesets.documentKind, 'transcription'),
      eq(changesets.documentId, transcriptionId),
    );
    await tx.delete(changesets).where(document);
    await tx
      .delete(checkpoints)
      .where(
        and(
          eq(checkpoints.documentKind, 'transcription'),
          eq(checkpoints.documentId, transcriptionId),
        ),
      );
    await tx
      .delete(moments)
      .where(
        and(eq(moments.documentKind, 'transcription'), eq(moments.documentId, transcriptionId)),
      );
    await tx
      .delete(reviewState)
      .where(
        and(
          eq(reviewState.documentKind, 'transcription'),
          eq(reviewState.documentId, transcriptionId),
        ),
      );
    await tx.delete(transcriptions).where(eq(transcriptions.id, transcriptionId));
  });
}

export type { Target as ImportTarget };

/** A text whose normalized forms a transcription can take where the letters agree. */
export interface NormalizationSource {
  kind: 'transcription' | 'edition';
  id: string;
  label: string;
}

/**
 * The texts of a transcription's works that the user may see: the other
 * transcriptions assigning text to them, and their editions (an editor's
 * own drafts, everyone's published ones).
 */
export async function normalizationSources(
  db: Database,
  user: Actor | null,
  transcriptionId: string,
): Promise<NormalizationSource[]> {
  const grants = await grantsFor(db, user);
  const out: NormalizationSource[] = [];
  const seen = new Set<string>([transcriptionId]);
  for (const workId of await worksOfTranscription(db, transcriptionId)) {
    for (const c of await candidateWitnesses(db, workId, user, grants)) {
      if (seen.has(c.transcriptionId)) continue;
      seen.add(c.transcriptionId);
      out.push({
        kind: 'transcription',
        id: c.transcriptionId,
        label: `${c.siglum} · ${c.witnessName}: ${c.transcriptionName}`,
      });
    }
    for (const edition of await editionsOfWork(db, workId)) {
      const access = await loadEditionAccess(db, user, edition.id);
      if (!access?.canView || seen.has(edition.id)) continue;
      seen.add(edition.id);
      out.push({ kind: 'edition', id: edition.id, label: edition.title });
    }
  }
  return out;
}
