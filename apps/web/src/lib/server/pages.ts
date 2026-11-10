/**
 * The pages of a witness: an ordered list of folio sides, pages,
 * columns or fragments, each with a label and an image or none. Images are
 * uploads, kept on disk with a Deep Zoom pyramid, or IIIF Image API services
 * shown straight from the library's server. Maintainers manage the list on
 * the pages screen.
 *
 * Other records refer to pages by id: zones are drawn on them, and the page
 * breaks of a transcription name the page they begin. Removing a page moves
 * its text to Not on a page in every transcript; reordering pages reorders
 * the transcripts' text.
 *
 * Mutations of a witness's list lock the witness row, so that positions stay
 * consistent when two maintainers work at once.
 */

import { newId, normalizeRights, rightsStatement } from '@varians/core';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  pages,
  sql,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  zones,
  type Database,
  type Page,
  type Witness,
} from '@varians/db';
import {
  MAX_LABEL_LENGTH,
  expandLabels,
  labelProblem,
  labelsAfter,
  normalizeLabel,
} from '$lib/components/pages/labels';
import type { PageView } from '$lib/components/pages/types';
import type { FacsimileSource } from '$lib/facsimile/types';
import {
  ManifestError,
  imageInfoUrl,
  loadManifest,
  normalizeServiceId,
  thumbnailUrl,
  type IiifCanvas,
  type IiifManifest,
} from '$lib/server/images/iiif';
import {
  dziPath,
  imageDir,
  removePageFiles,
  storageDir,
  swapPageFiles,
  tilesDir,
} from '$lib/server/images/storage';
import { pageImage } from '$lib/server/page-source';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  TILE_SIZE,
  UploadError,
  acceptUpload,
} from '$lib/server/images/tiles';
import { pageStrings } from '$lib/strings/pages';
import { conformTranscription, wordsOnPage, type ConformOutcome } from '$lib/server/conform';

export { expandLabels };

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** The client or a transaction: reads work on either. */
type Db = Database | Tx;

/** Thumbnails on the pages screen are this wide (IIIF) or the pyramid level nearest above it (uploads). */
export const THUMBNAIL_WIDTH = 240;
/** How many canvases a manifest preview shows. */
export const PREVIEW_CANVASES = 12;
/** Rows per insert statement, well under PostgreSQL's limit on parameters. */
const INSERT_CHUNK = 500;

export type PageErrorCode = 'not-found' | 'invalid-label' | 'invalid-rights';

export class PageError extends Error {
  constructor(
    readonly code: PageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function cleanLabel(label: string): string {
  const problem = labelProblem(label);
  if (problem) throw new PageError('invalid-label', problem);
  return normalizeLabel(label);
}

// The witness

export async function witnessBySlug(db: Db, slug: string): Promise<Witness | null> {
  const [row] = await db.select().from(witnesses).where(eq(witnesses.slug, slug));
  return row ?? null;
}

export async function maintainerIdsOf(db: Db, witnessId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: witnessMaintainers.userId })
    .from(witnessMaintainers)
    .where(eq(witnessMaintainers.witnessId, witnessId));
  return rows.map((row) => row.userId);
}

/** Locks the witness row for the rest of the transaction; throws when there is no such witness. */
async function lockWitness(tx: Tx, witnessId: string): Promise<void> {
  const [row] = await tx
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(eq(witnesses.id, witnessId))
    .for('update');
  if (!row) throw new PageError('not-found', pageStrings.errors.witnessNotFound);
}

async function lastPosition(db: Db, witnessId: string): Promise<number> {
  const [row] = await db
    .select({ last: max(pages.position) })
    .from(pages)
    .where(eq(pages.witnessId, witnessId));
  return row?.last ?? 0;
}

/** Sets positions 1..n in the order given, in one statement, touching only rows that change. */
async function renumber(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const positions = ids.map((_, i) => i + 1);
  await db.execute(sql`
    update pages set position = v.position
    from unnest(${sql.param(ids)}::text[], ${sql.param(positions)}::float8[]) as v(id, position)
    where pages.id = v.id and pages.position is distinct from v.position
  `);
}

// Reading

/** The pages of a witness in order. */
export async function pagesOfWitness(db: Db, witnessId: string): Promise<Page[]> {
  return db
    .select()
    .from(pages)
    .where(eq(pages.witnessId, witnessId))
    .orderBy(asc(pages.position), asc(pages.id));
}

/** A page, when it belongs to the witness. */
export async function pageOfWitness(
  db: Db,
  witnessId: string,
  pageId: string,
): Promise<Page | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.witnessId, witnessId)));
  return row ?? null;
}

export async function pageById(db: Db, pageId: string): Promise<Page | null> {
  const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
  return row ?? null;
}

// References

export interface PageReferences {
  zones: number;
  /** Transcriptions whose page breaks name the page, with the number of words on it in each. */
  transcriptions: { id: string; name: string; owner: string | null; words: number }[];
}

/** What refers to one page: zones drawn on it and transcriptions whose page breaks name it. */
export async function referencesOf(
  db: Db,
  page: Pick<Page, 'id' | 'witnessId'>,
): Promise<PageReferences> {
  const [zoneCount] = await db.select({ n: count() }).from(zones).where(eq(zones.pageId, page.id));
  const breaking = await db
    .select({
      id: transcriptions.id,
      name: transcriptions.name,
      owner: users.name,
      content: transcriptions.content,
    })
    .from(transcriptions)
    .leftJoin(users, eq(users.id, transcriptions.ownerId))
    .where(
      and(
        eq(transcriptions.witnessId, page.witnessId),
        sql`${transcriptions.content}->'items' @> ${JSON.stringify([{ kind: 'break', type: 'page', pageId: page.id }])}::jsonb`,
      ),
    )
    .orderBy(asc(transcriptions.name));
  return {
    zones: zoneCount?.n ?? 0,
    transcriptions: breaking.map(({ content, ...rest }) => ({
      ...rest,
      words: wordsOnPage(content, page.id),
    })),
  };
}

export interface ReferenceCount {
  zones: number;
  /** Transcripts with text on the page. */
  transcriptions: number;
  /** Words on the page, in all transcripts. */
  words: number;
}

/** For every referenced page of a witness (zones drawn on it, or a transcript's page break naming it): its zones, and the transcripts and words on it. */
export async function referenceCounts(
  db: Db,
  witnessId: string,
): Promise<Map<string, ReferenceCount>> {
  const counts = new Map<string, ReferenceCount>();
  const entry = (id: string) => {
    let found = counts.get(id);
    if (!found) counts.set(id, (found = { zones: 0, transcriptions: 0, words: 0 }));
    return found;
  };
  const zoneRows = await db
    .select({ pageId: zones.pageId, n: count() })
    .from(zones)
    .innerJoin(pages, eq(pages.id, zones.pageId))
    .where(eq(pages.witnessId, witnessId))
    .groupBy(zones.pageId);
  for (const row of zoneRows) entry(row.pageId).zones = row.n;
  const texts = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.witnessId, witnessId));
  for (const { content } of texts) {
    let current: ReferenceCount | null = null;
    let words = 0;
    const close = () => {
      if (current && words > 0) {
        current.transcriptions++;
        current.words += words;
      }
      words = 0;
    };
    for (const item of content.items) {
      if (item.kind === 'break' && item.type === 'page') {
        close();
        current = item.pageId ? entry(item.pageId) : null;
      } else if (item.kind === 'token' && current) words++;
    }
    close();
  }
  return counts;
}

/** Ids of the pages of a witness that zones or page breaks refer to. */
export async function referencedPageIds(db: Db, witnessId: string): Promise<Set<string>> {
  return new Set((await referenceCounts(db, witnessId)).keys());
}

// The list

/** Appends pages with these labels after the last page of the witness. */
export async function addPages(db: Database, witnessId: string, labels: string[]): Promise<Page[]> {
  const clean = labels.map(cleanLabel);
  if (clean.length === 0) return [];
  return db.transaction(async (tx) => {
    await lockWitness(tx, witnessId);
    const last = await lastPosition(tx, witnessId);
    const rows = clean.map((label, i) => ({
      id: newId(),
      witnessId,
      label,
      position: last + i + 1,
    }));
    const inserted: Page[] = [];
    for (const chunk of chunks(rows, INSERT_CHUNK))
      inserted.push(...(await tx.insert(pages).values(chunk).returning()));
    return inserted.sort((a, b) => a.position - b.position);
  });
}

export async function renamePage(
  db: Database,
  pageId: string,
  label: string,
): Promise<Page | null> {
  const clean = cleanLabel(label);
  const [row] = await db
    .update(pages)
    .set({ label: clean })
    .where(eq(pages.id, pageId))
    .returning();
  return row ?? null;
}

/**
 * Moves a page to an index of its witness's list (0 is the first; values
 * outside the list go to its ends) and renumbers the list 1..n. The
 * transcripts of the witness follow: their pages' texts are put in the new
 * order, as a change in each one's history made by `actor`. Returns the
 * list in its new order, or null when the page does not exist.
 */
export async function movePage(
  db: Database,
  pageId: string,
  toIndex: number,
  actor: string | null = null,
): Promise<Page[] | null> {
  const page = await pageById(db, pageId);
  if (!page) return null;
  return db.transaction(async (tx) => {
    await lockWitness(tx, page.witnessId);
    const list = await pagesOfWitness(tx, page.witnessId);
    const from = list.findIndex((p) => p.id === pageId);
    if (from < 0) return null;
    const to = Math.min(
      Math.max(Math.trunc(Number.isFinite(toIndex) ? toIndex : 0), 0),
      list.length - 1,
    );
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved!);
    const order = list.map((p) => p.id);
    await renumber(tx, order);
    await conformTranscriptsOf(tx, page.witnessId, order, actor, pageStrings.history.reordered, 2);
    return list.map((p, i) => ({ ...p, position: i + 1 }));
  });
}

/**
 * Conform the transcripts of a witness to a page order, inside the caller's
 * transaction. `minBreaks`: only transcripts with at least this many page
 * breaks can be out of shape (2 for a reordering, 1 for a removal).
 */
async function conformTranscriptsOf(
  tx: Database,
  witnessId: string,
  order: readonly string[],
  actor: string | null,
  message: string,
  minBreaks: number,
): Promise<ConformOutcome[]> {
  const rows = await tx
    .select({ id: transcriptions.id, content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.witnessId, witnessId))
    .orderBy(asc(transcriptions.id));
  const out: ConformOutcome[] = [];
  for (const row of rows) {
    const breaks = row.content.items.filter(
      (item) => item.kind === 'break' && item.type === 'page',
    ).length;
    if (breaks < minBreaks) continue;
    const outcome = await conformTranscription(tx, row.id, order, actor, message);
    if (outcome) out.push(outcome);
  }
  return out;
}

export type RemovePageResult =
  | { ok: true; page: Page; moved: { words: number; transcriptions: number } }
  | { ok: false; reason: 'not-found' };

/**
 * Removes a page, its zones and its image files. Text is never deleted:
 * the text on the page goes to Not on a page in every transcript of the
 * witness, as a change in each one's history made by `actor`. Returns how
 * many words of how many transcripts moved.
 */
export async function removePage(
  db: Database,
  pageId: string,
  storageRoot: string = storageDir(),
  actor: string | null = null,
): Promise<RemovePageResult> {
  const page = await pageById(db, pageId);
  if (!page) return { ok: false, reason: 'not-found' };
  const result = await db.transaction(async (tx) => {
    await lockWitness(tx, page.witnessId);
    const before = await tx
      .select({ id: transcriptions.id, content: transcriptions.content })
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, page.witnessId));
    const counts = before.map((row) => wordsOnPage(row.content, pageId));
    const [removed] = await tx.delete(pages).where(eq(pages.id, pageId)).returning();
    if (!removed) return null;
    const order = (await pagesOfWitness(tx, page.witnessId)).map((p) => p.id);
    await conformTranscriptsOf(
      tx,
      page.witnessId,
      order,
      actor,
      pageStrings.history.removed(page.label),
      1,
    );
    return {
      page: removed,
      moved: {
        words: counts.reduce((a, b) => a + b, 0),
        transcriptions: counts.filter((n) => n > 0).length,
      },
    };
  });
  if (!result) return { ok: false, reason: 'not-found' };
  await removePageFiles(pageId, storageRoot);
  return { ok: true, ...result };
}

// Rights of images

/** The longest credit line taken. */
export const MAX_ATTRIBUTION_LENGTH = 500;
/** The longest source address taken. */
export const MAX_SOURCE_LENGTH = 2000;

/** What an image carries besides itself: its rights statement, the credit line asked for, and where it was obtained. */
export interface ImageRights {
  /** One of the listed statements (IMAGE_RIGHTS), by its address. */
  rights: string;
  attribution: string | null;
  imageSource: string | null;
}

/** As a form or a caller gives them, before they are checked. */
export interface ImageRightsInput {
  rights?: string | null;
  attribution?: string | null;
  imageSource?: string | null;
}

export type ImageRightsResult =
  | { ok: true; value: ImageRights }
  | { ok: false; field: 'rights' | 'attribution' | 'imageSource'; error: string };

function httpAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Plain text in one line, or null when empty. */
function oneLine(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\s+/gu, ' ').trim();
  return text === '' ? null : text;
}

/**
 * Checks a rights statement, credit line and source: the statement must be
 * one of the listed ones (in any of the forms `normalizeRights` reads), the
 * credit line not too long, the source empty or an http(s) address.
 */
export function parseImageRights(input: ImageRightsInput): ImageRightsResult {
  const rights = normalizeRights(input.rights ?? null);
  if (!rights) return { ok: false, field: 'rights', error: pageStrings.rights.required };
  const attribution = oneLine(input.attribution);
  if (attribution && attribution.length > MAX_ATTRIBUTION_LENGTH) {
    return {
      ok: false,
      field: 'attribution',
      error: pageStrings.rights.creditTooLong(MAX_ATTRIBUTION_LENGTH),
    };
  }
  const imageSource = oneLine(input.imageSource);
  if (imageSource && (imageSource.length > MAX_SOURCE_LENGTH || !httpAddress(imageSource))) {
    return { ok: false, field: 'imageSource', error: pageStrings.rights.sourceInvalid };
  }
  return { ok: true, value: { rights, attribution, imageSource } };
}

/** The checked rights, or a PageError('invalid-rights') with the reason. */
function checkedRights(input: ImageRightsInput): ImageRights {
  const parsed = parseImageRights(input);
  if (!parsed.ok) throw new PageError('invalid-rights', parsed.error);
  return parsed.value;
}

/**
 * Changes the rights statement, credit line and source of a page's image.
 * Throws PageError('invalid-rights') for a statement that is missing or not
 * listed. Null when the page does not exist.
 */
export async function updatePageRights(
  db: Database,
  pageId: string,
  input: ImageRightsInput,
): Promise<Page | null> {
  const value = checkedRights(input);
  const [row] = await db.update(pages).set(value).where(eq(pages.id, pageId)).returning();
  return row ?? null;
}

export interface WitnessImageDefaults {
  /** A listed statement, or null for none. */
  imageRights: string | null;
  imageAttribution: string | null;
}

export type WitnessDefaultsResult =
  | { ok: true; value: WitnessImageDefaults }
  | { ok: false; field: 'imageRights' | 'imageAttribution'; error: string };

/** Checks a witness's defaults for its images: the statement empty or listed, the credit line not too long. */
export function parseWitnessImageDefaults(input: {
  imageRights?: string | null;
  imageAttribution?: string | null;
}): WitnessDefaultsResult {
  const given = oneLine(input.imageRights);
  const imageRights = given ? normalizeRights(given) : null;
  if (given && !imageRights)
    return { ok: false, field: 'imageRights', error: pageStrings.rights.notListed };
  const imageAttribution = oneLine(input.imageAttribution);
  if (imageAttribution && imageAttribution.length > MAX_ATTRIBUTION_LENGTH) {
    return {
      ok: false,
      field: 'imageAttribution',
      error: pageStrings.rights.creditTooLong(MAX_ATTRIBUTION_LENGTH),
    };
  }
  return { ok: true, value: { imageRights, imageAttribution } };
}

/** How many pages of a witness have an image without a rights statement. */
export async function pagesWithoutRights(db: Db, witnessId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(pages)
    .where(and(eq(pages.witnessId, witnessId), isNotNull(pages.imageKind), isNull(pages.rights)));
  return row?.n ?? 0;
}

/**
 * Stores the defaults new images of a witness are given, and with `apply`
 * gives them to its pages whose image has no rights statement yet (a page's
 * own credit line is kept where it has one). Returns how many pages took
 * them. Throws PageError('invalid-rights') for a statement not listed.
 */
export async function setWitnessImageDefaults(
  db: Database,
  witnessId: string,
  input: { imageRights?: string | null; imageAttribution?: string | null },
  apply = false,
): Promise<number> {
  const parsed = parseWitnessImageDefaults(input);
  if (!parsed.ok) throw new PageError('invalid-rights', parsed.error);
  const { imageRights, imageAttribution } = parsed.value;
  return db.transaction(async (tx) => {
    await lockWitness(tx, witnessId);
    await tx
      .update(witnesses)
      .set({ imageRights, imageAttribution })
      .where(eq(witnesses.id, witnessId));
    if (!apply || !imageRights) return 0;
    const updated = await tx
      .update(pages)
      .set({
        rights: imageRights,
        attribution: sql`coalesce(${pages.attribution}, ${imageAttribution})`,
      })
      .where(and(eq(pages.witnessId, witnessId), isNotNull(pages.imageKind), isNull(pages.rights)))
      .returning({ id: pages.id });
    return updated.length;
  });
}

/** The label of a listed statement, or null. */
export function rightsLabel(uri: string | null | undefined): string | null {
  return rightsStatement(uri)?.label ?? null;
}

// Images

export interface UploadOptions {
  /** The largest file accepted; DEFAULT_MAX_UPLOAD_BYTES when omitted. */
  maxBytes?: number;
}

/**
 * Gives a page an uploaded image: the original is stored and tiled (throws
 * UploadError when the file is not an acceptable image) and the page records
 * it with its rights statement, credit line and source, replacing whatever
 * image it had. Throws PageError('invalid-rights') before anything is stored
 * when the statement is missing or not listed. Null when the page does not
 * exist.
 */
export async function attachUpload(
  db: Database,
  pageId: string,
  file: File | Buffer | Uint8Array,
  rights: ImageRightsInput,
  storageRoot: string = storageDir(),
  options: UploadOptions = {},
): Promise<Page | null> {
  const checked = checkedRights(rights);
  const page = await pageById(db, pageId);
  if (!page) return null;
  const accepted = await acceptUpload(file, pageId, {
    root: storageRoot,
    maxBytes: options.maxBytes,
  });
  const [row] = await db
    .update(pages)
    .set({
      imageKind: 'upload',
      imagePath: accepted.imagePath,
      tilesPath: accepted.dziPath,
      imageIiif: null,
      imageWidth: accepted.width,
      imageHeight: accepted.height,
      ...checked,
    })
    .where(eq(pages.id, pageId))
    .returning();
  if (!row) {
    // The page went away while its image was being tiled.
    await removePageFiles(pageId, storageRoot);
    return null;
  }
  return row;
}

/**
 * A new page at the end of the witness with an uploaded image and its
 * rights. The rights and the image are checked first, so that a missing
 * statement or a file that is not an image makes no page.
 */
export async function addImagePage(
  db: Database,
  witnessId: string,
  label: string,
  file: File | Buffer | Uint8Array,
  rights: ImageRightsInput,
  storageRoot: string = storageDir(),
  options: UploadOptions = {},
): Promise<Page> {
  const clean = cleanLabel(label);
  const checked = checkedRights(rights);
  const id = newId();
  try {
    const accepted = await acceptUpload(file, id, {
      root: storageRoot,
      maxBytes: options.maxBytes,
    });
    return await db.transaction(async (tx) => {
      await lockWitness(tx, witnessId);
      const position = (await lastPosition(tx, witnessId)) + 1;
      const [row] = await tx
        .insert(pages)
        .values({
          id,
          witnessId,
          label: clean,
          position,
          imageKind: 'upload',
          imagePath: accepted.imagePath,
          tilesPath: accepted.dziPath,
          imageWidth: accepted.width,
          imageHeight: accepted.height,
          ...checked,
        })
        .returning();
      return row!;
    });
  } catch (error) {
    await removePageFiles(id, storageRoot);
    throw error;
  }
}

/** Cleared image fields, with the image's rights. */
const NO_IMAGE = {
  imageKind: null,
  imageIiif: null,
  imageWidth: null,
  imageHeight: null,
  imagePath: null,
  tilesPath: null,
  rights: null,
  attribution: null,
  imageSource: null,
};

/** Takes the image from a page, with its rights: an upload's files are deleted, a IIIF image is unlinked. */
export async function detachImage(
  db: Database,
  pageId: string,
  storageRoot: string = storageDir(),
): Promise<Page | null> {
  const [row] = await db.update(pages).set(NO_IMAGE).where(eq(pages.id, pageId)).returning();
  if (!row) return null;
  await removePageFiles(pageId, storageRoot);
  return row;
}

export type MoveImageResult =
  | { ok: true; from: Page; to: Page; swapped: boolean }
  | { ok: false; reason: 'not-found' | 'no-image' | 'same-page' | 'other-witness' };

/** A page's image fields as they are when the image lies under another page's id. */
function imageFieldsUnder(source: Page, pageId: string) {
  const name = (file: string) => file.slice(file.lastIndexOf('/') + 1);
  return {
    imageKind: source.imageKind,
    imageIiif: source.imageIiif,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight,
    imagePath: source.imagePath ? `${imageDir(pageId)}/${name(source.imagePath)}` : null,
    tilesPath: source.tilesPath ? `${tilesDir(pageId)}/${name(source.tilesPath)}` : null,
    // The rights are the image's, and go where it goes.
    rights: source.rights,
    attribution: source.attribution,
    imageSource: source.imageSource,
  };
}

/**
 * Moves the image of a page to another page of the same witness: an image
 * that was given to the wrong page. When the other page has an image too,
 * the two change places. An upload's files move with it on disk. Zones stay
 * with their pages, as they do when an image is replaced: they are drawn on
 * the page, and show on whatever image it has.
 */
export async function moveImage(
  db: Database,
  fromId: string,
  toId: string,
  storageRoot: string = storageDir(),
): Promise<MoveImageResult> {
  if (fromId === toId) return { ok: false, reason: 'same-page' };
  const [from, to] = await Promise.all([pageById(db, fromId), pageById(db, toId)]);
  if (!from || !to) return { ok: false, reason: 'not-found' };
  if (from.witnessId !== to.witnessId) return { ok: false, reason: 'other-witness' };
  if (!from.imageKind) return { ok: false, reason: 'no-image' };
  // The files first: the rows then point at files that exist, and a failure here changes nothing.
  await swapPageFiles(fromId, toId, storageRoot);
  try {
    return await db.transaction(async (tx) => {
      await lockWitness(tx, from.witnessId);
      // Read again under the lock, in case either image changed meanwhile; the exchange stays consistent.
      const [a] = await tx.select().from(pages).where(eq(pages.id, fromId));
      const [b] = await tx.select().from(pages).where(eq(pages.id, toId));
      if (!a || !b) throw new PageError('not-found', pageStrings.errors.pageNotFound);
      const [movedTo] = await tx
        .update(pages)
        .set(imageFieldsUnder(a, toId))
        .where(eq(pages.id, toId))
        .returning();
      const [movedFrom] = await tx
        .update(pages)
        .set(imageFieldsUnder(b, fromId))
        .where(eq(pages.id, fromId))
        .returning();
      return { ok: true, from: movedFrom!, to: movedTo!, swapped: b.imageKind !== null };
    });
  } catch (cause) {
    // Put the files back where the rows still say they are.
    await swapPageFiles(fromId, toId, storageRoot);
    if (cause instanceof PageError && cause.code === 'not-found')
      return { ok: false, reason: 'not-found' };
    throw cause;
  }
}

export type ShiftDirection = 'later' | 'earlier';

export type ShiftImagesResult =
  | { ok: true; moved: number; added: Page | null }
  | { ok: false; reason: 'not-found' | 'first-page' | 'occupied' | 'nothing' };

/**
 * Shifts the images of a witness's pages by one, from a page to the end:
 * `later`, every page from that one on takes the image of the page before
 * it (for a run of images that began one page too early); when the last
 * page has an image, a new page is added at the end for it. `earlier`,
 * every page from the one before takes the image of the page after it (a
 * run that began one page too late), which needs the page before to have no
 * image. Gaps in the run shift along. Uploads move with their files; zones
 * stay with their pages.
 */
export async function shiftImages(
  db: Database,
  pageId: string,
  direction: ShiftDirection,
  storageRoot: string = storageDir(),
): Promise<ShiftImagesResult> {
  const page = await pageById(db, pageId);
  if (!page) return { ok: false, reason: 'not-found' };
  const list = await pagesOfWitness(db, page.witnessId);
  const at = list.findIndex((p) => p.id === pageId);
  if (at < 0) return { ok: false, reason: 'not-found' };
  const tail = list.slice(at);
  if (!tail.some((p) => p.imageKind)) return { ok: false, reason: 'nothing' };

  /** Each image's page and the page it goes to, in an order where the destination is always free. */
  const moves: { from: Page; to: Page }[] = [];
  let added: Page | null = null;
  if (direction === 'later') {
    const last = tail[tail.length - 1]!;
    if (last.imageKind) {
      const label = labelsAfter(last.label, 1)?.[0] ?? String(list.length + 1);
      [added] = await addPages(db, page.witnessId, [label]);
    }
    const targets = [...tail.slice(1), ...(added ? [added] : [])];
    for (let i = tail.length - 1; i >= 0; i--) {
      const to = targets[i];
      if (to && tail[i]!.imageKind) moves.push({ from: tail[i]!, to });
    }
  } else {
    if (at === 0) return { ok: false, reason: 'first-page' };
    const before = list[at - 1]!;
    if (before.imageKind) return { ok: false, reason: 'occupied' };
    const targets = [before, ...tail.slice(0, -1)];
    for (let i = 0; i < tail.length; i++) {
      if (tail[i]!.imageKind) moves.push({ from: tail[i]!, to: targets[i]! });
    }
  }

  const done: { from: Page; to: Page }[] = [];
  try {
    for (const move of moves) {
      await swapPageFiles(move.from.id, move.to.id, storageRoot);
      done.push(move);
    }
    await db.transaction(async (tx) => {
      await lockWitness(tx, page.witnessId);
      // Clear first, then fill: a page may give its image away and receive another.
      for (const { from } of moves)
        await tx.update(pages).set(NO_IMAGE).where(eq(pages.id, from.id));
      for (const { from, to } of moves)
        await tx.update(pages).set(imageFieldsUnder(from, to.id)).where(eq(pages.id, to.id));
    });
  } catch (cause) {
    for (const move of done.reverse()) await swapPageFiles(move.from.id, move.to.id, storageRoot);
    if (added) await db.delete(pages).where(eq(pages.id, added.id));
    throw cause;
  }
  return { ok: true, moved: moves.length, added };
}

/** The message for an UploadError, in the words of the pages screen. */
export function uploadErrorMessage(
  error: UploadError,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
): string {
  const messages = pageStrings.upload.errors;
  if (error.code === 'too-large')
    return messages['too-large'](Math.round(maxBytes / (1024 * 1024)));
  return messages[error.code] ?? pageStrings.upload.failed;
}

// IIIF

/** The label a canvas gives its page. */
function canvasLabel(canvas: IiifCanvas, index: number): string {
  const label = normalizeLabel(canvas.label).slice(0, MAX_LABEL_LENGTH);
  return label === '' ? String(index + 1) : label;
}

function dimension(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export interface CanvasRights {
  /** A listed statement, or null. */
  rights: string | null;
  attribution: string | null;
  /** The address given when it is not a listed statement. */
  unlisted: string | null;
}

/**
 * The rights a canvas's page gets from the manifest: the canvas's own
 * statement and credit line where it gives them, the manifest's otherwise,
 * each on its own. A statement that is not listed is kept out, and its
 * address becomes the credit line when there is no other.
 */
export function canvasRights(
  manifest: Pick<IiifManifest, 'rights' | 'attribution'>,
  canvas: Pick<IiifCanvas, 'rights' | 'attribution'>,
): CanvasRights {
  const given = canvas.rights ?? manifest.rights ?? null;
  const rights = normalizeRights(given);
  const unlisted = given && !rights ? given : null;
  return { rights, attribution: canvas.attribution ?? manifest.attribution ?? unlisted, unlisted };
}

/** A warning for every rights address in the manifest that is not a listed statement, once each. */
export function manifestRightsWarnings(manifest: IiifManifest): string[] {
  const unlisted = new Set<string>();
  for (const canvas of manifest.canvases) {
    const found = canvasRights(manifest, canvas).unlisted;
    if (found) unlisted.add(found);
  }
  return [...unlisted].map((uri) => pageStrings.manifest.unlistedRights(uri));
}

export interface PreviewCanvas {
  label: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
}

/** The rights of a manifest as the preview shows them. */
export interface ManifestRights {
  /** The manifest's statement when it is listed. */
  rights: string | null;
  label: string | null;
  /** The manifest's statement when it is not listed. */
  unlisted: string | null;
  attribution: string | null;
  /** Canvases whose own statement differs from the manifest's. */
  ownStatements: number;
  /** The witness's statement, which pages take when the manifest gives none. */
  fallback: string | null;
  fallbackLabel: string | null;
}

export interface ManifestPreview {
  url: string;
  label: string;
  version: 2 | 3;
  /** Canvases in the manifest. */
  total: number;
  /** Canvases with a IIIF image service. */
  withImage: number;
  /** Canvases whose image a page of the witness already shows. */
  present: number;
  /** Pages without an image whose label a canvas has. */
  attachable: number;
  /** The first PREVIEW_CANVASES canvases. */
  canvases: PreviewCanvas[];
  rights: ManifestRights;
  warnings: string[];
}

type ExistingPage = Pick<Page, 'label' | 'imageKind' | 'imageIiif'>;

/**
 * Reads a manifest for the import dialog: its canvases with thumbnails (the
 * first few), how many there are, its rights, and, given the pages a witness
 * has, how many of them are already there. `fallback` is the witness's
 * default statement, which pages take when the manifest gives none. Throws
 * ManifestError.
 */
export async function previewManifest(
  url: string,
  existing: ExistingPage[] = [],
  fallback: string | null = null,
): Promise<ManifestPreview> {
  const manifest = await loadManifest(url);
  const manifestRights = normalizeRights(manifest.rights ?? null);
  const ownStatements = manifest.canvases.filter(
    (c) => c.rights && normalizeRights(c.rights) !== manifestRights,
  ).length;
  const services = new Set(
    existing
      .filter((p) => p.imageKind === 'iiif' && p.imageIiif)
      .map((p) => normalizeServiceId(p.imageIiif!)),
  );
  const blank = new Map<string, number>();
  for (const p of existing) if (!p.imageKind) blank.set(p.label, (blank.get(p.label) ?? 0) + 1);
  let present = 0;
  let attachable = 0;
  manifest.canvases.forEach((canvas, i) => {
    const service = canvas.imageService ? normalizeServiceId(canvas.imageService) : null;
    if (service && services.has(service)) {
      present++;
      return;
    }
    const label = canvasLabel(canvas, i);
    const left = blank.get(label) ?? 0;
    if (service && left > 0) {
      attachable++;
      blank.set(label, left - 1);
    }
  });
  return {
    url,
    label: manifest.label,
    version: manifest.version,
    total: manifest.canvases.length,
    withImage: manifest.canvases.filter((c) => c.imageService).length,
    present,
    attachable,
    canvases: manifest.canvases.slice(0, PREVIEW_CANVASES).map((canvas, i) => ({
      label: canvasLabel(canvas, i),
      thumbnail: canvas.imageService
        ? thumbnailUrl(canvas.imageService, THUMBNAIL_WIDTH)
        : (canvas.imageUrl ?? null),
      width: dimension(canvas.width),
      height: dimension(canvas.height),
    })),
    rights: {
      rights: manifestRights,
      label: rightsLabel(manifestRights),
      unlisted: manifest.rights && !manifestRights ? manifest.rights : null,
      attribution: manifest.attribution ?? null,
      ownStatements,
      fallback: normalizeRights(fallback),
      fallbackLabel: rightsLabel(normalizeRights(fallback)),
    },
    warnings: [...manifest.warnings, ...manifestRightsWarnings(manifest)],
  };
}

export interface ImportOptions {
  /** Who imports: the transcripts conformed to a new order of the pages record the change as theirs. */
  actor?: string | null;
  /** First remove the pages nothing refers to; the manifest then makes the list. */
  replace?: boolean;
  /** Skip canvases whose image a page already shows. */
  onlyNew?: boolean;
  /** Where the files of removed pages live; the configured storage directory by default. */
  storageRoot?: string;
}

export interface ImportSummary {
  /** The manifest's label. */
  label: string;
  canvases: number;
  /** New pages made from canvases. */
  added: number;
  /** Pages without an image that took the image of the canvas with their label. */
  attached: number;
  /** Canvases already on the witness. */
  skipped: number;
  /** Pages removed first (replace). */
  removed: number;
  /** Pages kept because something refers to them, that no canvas took (replace). */
  kept: number;
  warnings: string[];
}

/**
 * The new order of a witness's pages after an import: the pages of the
 * manifest in its order, with every older page that no canvas took placed
 * after the page it followed before (or first, when it followed none of
 * them). Without matches this is the old list followed by the new pages.
 */
export function mergeOrder(previous: string[], sequence: string[], taken: Set<string>): string[] {
  const after = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const id of previous) {
    if (taken.has(id)) {
      anchor = id;
      continue;
    }
    const list = after.get(anchor) ?? [];
    list.push(id);
    after.set(anchor, list);
  }
  const order = [...(after.get(null) ?? [])];
  for (const id of sequence) {
    order.push(id);
    order.push(...(after.get(id) ?? []));
  }
  return order;
}

/**
 * Makes pages from the canvases of a IIIF manifest: one page per canvas,
 * with the canvas's label and its Image API service as the image (never
 * copied). Without options every canvas is appended. With `onlyNew`, a
 * canvas whose service a page already shows is skipped, and a page without
 * an image takes the image of the canvas with its label; the new pages are
 * placed in the manifest's order around the pages already there. With
 * `replace`, the pages nothing refers to are removed first, then the same.
 * Each page with an image keeps the rights of its canvas (canvasRights), or
 * takes the witness's defaults when the manifest states none, and the
 * manifest's URL as its source. The manifest's URL is stored on the
 * witness. Throws ManifestError.
 */
export async function importManifest(
  db: Database,
  witnessId: string,
  manifestUrl: string,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const manifest: IiifManifest = await loadManifest(manifestUrl);
  const warnings = [...manifest.warnings, ...manifestRightsWarnings(manifest)];
  const match = Boolean(options.replace || options.onlyNew);
  const removedIds: string[] = [];

  const summary = await db.transaction(async (tx) => {
    await lockWitness(tx, witnessId);
    const [defaults] = await tx
      .select({ rights: witnesses.imageRights, attribution: witnesses.imageAttribution })
      .from(witnesses)
      .where(eq(witnesses.id, witnessId));
    const fallback = normalizeRights(defaults?.rights ?? null);
    /** A canvas's rights, credit line and source: the manifest's, else the witness's defaults when the manifest states nothing. */
    const rightsFor = (canvas: IiifCanvas) => {
      const found = canvasRights(manifest, canvas);
      const useDefault = !found.rights && !found.unlisted && fallback !== null;
      return {
        rights: found.rights ?? (useDefault ? fallback : null),
        attribution: found.attribution ?? (useDefault ? (defaults?.attribution ?? null) : null),
        imageSource: manifestUrl,
      };
    };
    let existing = await pagesOfWitness(tx, witnessId);

    if (options.replace) {
      const referenced = await referencedPageIds(tx, witnessId);
      const doomed = existing.filter((p) => !referenced.has(p.id)).map((p) => p.id);
      for (const chunk of chunks(doomed, INSERT_CHUNK))
        await tx.delete(pages).where(inArray(pages.id, chunk));
      removedIds.push(...doomed);
      existing = existing.filter((p) => referenced.has(p.id));
    }

    const byService = new Map<string, Page>();
    const blankByLabel = new Map<string, Page[]>();
    if (match) {
      for (const page of existing) {
        if (page.imageKind === 'iiif' && page.imageIiif) {
          const key = normalizeServiceId(page.imageIiif);
          if (!byService.has(key)) byService.set(key, page);
        } else if (!page.imageKind) {
          const list = blankByLabel.get(page.label) ?? [];
          list.push(page);
          blankByLabel.set(page.label, list);
        }
      }
    }

    const taken = new Set<string>();
    const sequence: string[] = [];
    const inserts: (typeof pages.$inferInsert)[] = [];
    const attaches: { id: string; service: string; canvas: IiifCanvas }[] = [];
    let skipped = 0;

    manifest.canvases.forEach((canvas, index) => {
      const service = canvas.imageService ? normalizeServiceId(canvas.imageService) : null;
      const label = canvasLabel(canvas, index);
      if (match) {
        const same = service ? byService.get(service) : undefined;
        if (same && !taken.has(same.id)) {
          taken.add(same.id);
          sequence.push(same.id);
          skipped++;
          return;
        }
        const blank = blankByLabel.get(label)?.find((p) => !taken.has(p.id));
        if (blank) {
          taken.add(blank.id);
          sequence.push(blank.id);
          if (service) attaches.push({ id: blank.id, service, canvas });
          else skipped++;
          return;
        }
      }
      if (!service && canvas.imageUrl) warnings.push(pageStrings.manifest.plainImage(label));
      const id = newId();
      inserts.push({
        id,
        witnessId,
        label,
        position: 0,
        imageKind: service ? 'iiif' : null,
        imageIiif: service,
        imageWidth: service ? dimension(canvas.width) : null,
        imageHeight: service ? dimension(canvas.height) : null,
        ...(service ? rightsFor(canvas) : {}),
      });
      sequence.push(id);
    });

    const order = match
      ? mergeOrder(
          existing.map((p) => p.id),
          sequence,
          taken,
        )
      : [...existing.map((p) => p.id), ...sequence];
    const positionOf = new Map(order.map((id, i) => [id, i + 1]));
    for (const row of inserts) row.position = positionOf.get(row.id)!;
    for (const chunk of chunks(inserts, INSERT_CHUNK)) await tx.insert(pages).values(chunk);
    for (const { id, service, canvas } of attaches) {
      await tx
        .update(pages)
        .set({
          imageKind: 'iiif',
          imageIiif: service,
          imagePath: null,
          tilesPath: null,
          imageWidth: dimension(canvas.width),
          imageHeight: dimension(canvas.height),
          ...rightsFor(canvas),
        })
        .where(eq(pages.id, id));
    }
    await renumber(tx, order);
    // Matching may put pages already there in the manifest's order; the transcripts follow.
    if (match)
      await conformTranscriptsOf(
        tx,
        witnessId,
        order,
        options.actor ?? null,
        pageStrings.history.reordered,
        2,
      );
    await tx
      .update(witnesses)
      .set({ iiifManifest: manifestUrl })
      .where(eq(witnesses.id, witnessId));

    return {
      label: manifest.label,
      canvases: manifest.canvases.length,
      added: inserts.length,
      attached: attaches.length,
      skipped,
      removed: removedIds.length,
      kept: options.replace ? existing.filter((p) => !taken.has(p.id)).length : 0,
      warnings,
    };
  });

  const root = options.storageRoot ?? storageDir();
  for (const id of removedIds) await removePageFiles(id, root);
  return summary;
}

/**
 * The message for a ManifestError, in the words of the pages screen. The
 * reader's own detail is kept where it says more than the code does (the
 * server's answer, a collection given for a manifest, a response that is
 * not JSON).
 */
export function manifestErrorMessage(error: ManifestError): string {
  const messages = pageStrings.manifest.errors;
  switch (error.code) {
    case 'fetch':
      return pageStrings.manifest.errorDetail(messages.fetch, error.message);
    case 'invalid':
    case 'unsupported':
      return error.message || messages[error.code];
    default:
      return messages[error.code] ?? messages.invalid;
  }
}

// What the screen shows

/** Changes whenever the page changes, so that a replaced image is not served from a cache. */
export function mediaVersion(page: Pick<Page, 'updatedAt'>): string {
  const time =
    page.updatedAt instanceof Date ? page.updatedAt.getTime() : new Date(page.updatedAt).getTime();
  return Number.isFinite(time) ? time.toString(36) : '0';
}

/**
 * The level of a Deep Zoom pyramid whose single tile shows the whole image
 * at the largest size that fits one tile. Levels halve, rounding up, from the
 * full image down to one pixel at level 0, as libvips writes them.
 */
export function dziThumbnailLevel(width: number, height: number, tileSize = TILE_SIZE): number {
  let size = Math.max(width, height, 1);
  let top = 0;
  for (let s = size; s > 1; s = Math.ceil(s / 2)) top++;
  let level = top;
  while (level > 0 && size > tileSize) {
    size = Math.ceil(size / 2);
    level--;
  }
  return level;
}

type ImageFields = Pick<
  Page,
  | 'id'
  | 'imageKind'
  | 'imagePath'
  | 'imageIiif'
  | 'imageWidth'
  | 'imageHeight'
  | 'tilesPath'
  | 'updatedAt'
>;

/** The viewer's source for a page's image, or null when it has none. */
export function pageSource(page: ImageFields): FacsimileSource | null {
  if (page.imageKind === 'upload') {
    return {
      kind: 'dzi',
      url: `/media/${page.tilesPath ?? dziPath(page.id)}?v=${mediaVersion(page)}`,
    };
  }
  if (page.imageKind === 'iiif' && page.imageIiif)
    return { kind: 'iiif', infoUrl: imageInfoUrl(page.imageIiif) };
  return null;
}

/**
 * A small image of the page: for an upload, the one-tile level of its
 * pyramid (a JPEG whatever the original was), or the original when it has
 * no pyramid; for IIIF, the Image API scaled to THUMBNAIL_WIDTH. Null when
 * the page has no image.
 */
export function thumbnailOf(page: ImageFields): string | null {
  if (page.imageKind === 'upload') {
    const version = mediaVersion(page);
    if (page.tilesPath && page.imageWidth && page.imageHeight) {
      const level = dziThumbnailLevel(page.imageWidth, page.imageHeight);
      const files = page.tilesPath.replace(/\.dzi$/u, '_files');
      return `/media/${files}/${level}/0_0.jpeg?v=${version}`;
    }
    return page.imagePath ? `/media/${page.imagePath}?v=${version}` : null;
  }
  if (page.imageKind === 'iiif' && page.imageIiif)
    return thumbnailUrl(page.imageIiif, THUMBNAIL_WIDTH);
  return null;
}

/** The pages of a witness as the screens show them: in order, with thumbnails, viewer sources and what refers to them. */
export async function pageViewsOf(db: Db, witnessId: string): Promise<PageView[]> {
  const [rows, references] = await Promise.all([
    pagesOfWitness(db, witnessId),
    referenceCounts(db, witnessId),
  ]);
  return rows.map((page, i) => ({
    id: page.id,
    label: page.label,
    index: i + 1,
    imageKind: page.imageKind,
    width: page.imageWidth,
    height: page.imageHeight,
    thumbnail: thumbnailOf(page),
    source: pageSource(page),
    image: pageImage(page),
    zones: references.get(page.id)?.zones ?? 0,
    transcriptions: references.get(page.id)?.transcriptions ?? 0,
    words: references.get(page.id)?.words ?? 0,
    rights: page.rights,
    attribution: page.attribution,
    imageSource: page.imageSource,
  }));
}

export { ManifestError, UploadError };
