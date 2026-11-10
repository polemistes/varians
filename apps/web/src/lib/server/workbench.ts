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
  importPageXml,
  importPlainText,
  importTei,
  insertIntoPage,
  isBreak,
  isToken,
  newId,
  repairSegmentStartsFrom,
  nextLabel,
  resolveStarts,
  segmentIds,
  type ImportedZone,
  type Item,
  type Level,
  type MemoryEntry,
  type NormalizationProfile,
  type NumberingPattern,
  type Op,
  type Stream,
  type UnitMapping,
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
  type Visibility,
} from '@varians/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { workbench as strings } from '$lib/strings/workbench';
import { dropWrittenFormOps, keepWrittenFormOps } from '$lib/workbench/normalization';

const t = strings.importer;
import type { Actor } from './authz.ts';
import { canMaintainWitness } from './authz.ts';
import { loadDocument, replaceContent, saveOps, type SaveResult } from './documents/service.ts';
import { fetchCtsPassage, isCtsUrn, teiFromCtsReply } from './import/cts.ts';
import { SafeFetchError, readTextCapped, safeFetch } from './safe-fetch.ts';
import { previewTei } from './import/tei.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { loadTranscriptionAccess } from './transcription-access.ts';
import { chosenWorks, setChosenWorks, worksOfTranscription } from './transcription-works.ts';
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
  language: string;
  levels: Level[];
  profile: NormalizationProfile;
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
    visibility: Visibility;
    sources: string | null;
    rightsNote: string | null;
    /** The licence fixed at publication, by name, and the installation's, which publication would give. */
    licence: string | null;
    installationLicence: string;
    /** The works the transcription is for, in order; the works its text is assigned to are in `works`. */
    workIds: string[];
    profile: Partial<NormalizationProfile> | null;
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
  /** The works the transcription is for first, then the other works its text is assigned to. */
  works: WorkbenchWork[];
  /** Label and work of every segment the content names. */
  segments: Record<string, { label: string; workId: string }>;
  canEdit: boolean;
  canDelete: boolean;
  /** May add pages to the witness (an import that brings pages the witness lacks). */
  canMaintainWitness: boolean;
}

/** Everything the workbench page needs, or null when the transcription does not exist or may not be viewed. */
export async function loadWorkbench(
  db: Database,
  user: Actor | null,
  id: string,
): Promise<WorkbenchData | null> {
  const access = await loadTranscriptionAccess(db, user, id);
  if (!access || !access.canView) return null;
  const { transcription, witness } = access;
  const pageRows = await witnessPages(db, witness.id);
  const named = segmentIds(transcription.content);
  const segmentRows = named.length
    ? await db
        .select({ id: segments.id, label: segments.label, workId: segments.workId })
        .from(segments)
        .where(inArray(segments.id, named))
    : [];
  const chosen = await chosenWorks(db, id);
  const workIds = [
    ...new Set([...(await worksOfTranscription(db, id)), ...segmentRows.map((s) => s.workId)]),
  ];
  const workRows = workIds.length
    ? await db
        .select({
          id: works.id,
          slug: works.slug,
          title: works.title,
          language: works.language,
          levels: referenceSchemes.levels,
          profile: works.profile,
        })
        .from(works)
        .innerJoin(referenceSchemes, eq(referenceSchemes.id, works.schemeId))
        .where(inArray(works.id, workIds))
    : [];
  const order = new Map(workIds.map((w, i) => [w, i] as const));
  workRows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
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
      visibility: transcription.visibility,
      sources: transcription.sources,
      rightsNote: transcription.rightsNote,
      licence: licenceInfo(transcription.licenceId)?.name ?? null,
      installationLicence: licenceInfo(dataLicence())!.name,
      workIds: chosen,
      profile: transcription.profile,
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
    canEdit: access.canEdit,
    canDelete: access.canDelete,
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

/** Where imported text without pages of its own goes: Not on a page, or a page of the witness. */
export type Placement = { to: 'unplaced' } | { to: 'page'; pageId: string };

export interface PlacedImport {
  /** The operations on the current content (for an import added to it). */
  ops: Op[];
  /** The whole content after the import. */
  content: Stream;
  /** Words that went to Not on a page. */
  unplaced: number;
}

/**
 * Put an imported stream into a transcription. The import's
 * page breaks that name a page of the witness (matched or created) send
 * their text to that page, appended to what it has; a page break naming no
 * page is dropped and its text goes to Not on a page, in the order of the
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
  /** Words that went to Not on a page. */
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
  /** Where text without pages of its own goes; Not on a page when absent. */
  placement?: Placement;
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
  const scheme = input.workId ? (await schemeOfWork(db, input.workId)).scheme : null;
  const result = importPlainText(input.text, {
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

/** Leiden notation read into words, marks and gaps. */
export async function importLeidenInto(
  db: Database,
  target: Target,
  text: string,
): Promise<ImportOutcome> {
  const result = fromLeiden(text);
  return inTransaction(db, async (tx) => {
    const saved = await save(tx, target, result.stream, 'Leiden import');
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

export interface TeiInput {
  xml: string;
  workId: string | null;
  mapping: UnitMapping;
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
  const result = importTei(input.xml);
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
  warnings: string[];
}

/** What a TEI import would do: the structure found and, for a work, the mapping onto its scheme with what it resolves. */
export async function teiPreview(
  db: Database,
  workId: string | null,
  xml: string,
  mapping?: UnitMapping,
): Promise<TeiPreviewData> {
  if (workId) {
    const preview = await previewTei(db, workId, xml, mapping);
    return {
      units: preview.structure.units,
      mapping: preview.mapping,
      resolved: preview.resolved,
      unresolved: preview.unresolved,
      examples: preview.examples,
      words: preview.words,
      pageBreaks: preview.structure.pageBreaks,
      title: preview.header.title ?? null,
      warnings: preview.warnings,
    };
  }
  const structure = detectStructure(xml);
  const result = importTei(xml);
  return {
    units: structure.units,
    mapping: {},
    resolved: 0,
    unresolved: result.segmentStarts.length,
    examples: [],
    words: result.stream.items.filter(isToken).length,
    pageBreaks: structure.pageBreaks,
    title: result.header.title ?? null,
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
  const result = which === 'alto' ? importAltoXml(xml) : importPageXml(xml);
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

// TEI export

/** The transcription as a TEI document with the witness, the pages and zones, and the segment labels. */
export async function exportTei(
  db: Database,
  transcriptionId: string,
  origin: string,
): Promise<{ xml: string; name: string } | null> {
  const [row] = await db
    .select()
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  if (!row) return null;
  const witness = await db.query.witnesses.findFirst({
    where: (w, { eq }) => eq(w.id, row.witnessId),
  });
  // The first of its works names the text; a transcription of several works is exported whole all the same.
  const [firstWork] = await worksOfTranscription(db, transcriptionId);
  const work = firstWork
    ? await db.query.works.findFirst({ where: (w, { eq }) => eq(w.id, firstWork) })
    : undefined;
  const pageRows = await witnessPages(db, row.witnessId);
  const zoneRows = await zonesOf(db, transcriptionId);
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
    ...(work ? { language: work.language } : {}),
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
  /** The works it is for, in order; left as they are when absent. */
  workIds?: string[];
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
  workIds: string[];
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
    if (input.workIds) await setChosenWorks(tx, transcriptionId, input.workIds);
    const workIds = await chosenWorks(tx, transcriptionId);
    const [after] = await tx
      .select({ sources: transcriptions.sources, rightsNote: transcriptions.rightsNote })
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId));
    return {
      name: input.name,
      keepsWrittenForm: input.keepsWrittenForm,
      displayAsWritten: input.displayAsWritten,
      workIds,
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
