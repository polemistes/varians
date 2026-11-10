/**
 * The reader's server side: which state of an edition a visitor
 * may see at a URL, the page data for it, and the plain-text and TEI
 * downloads of the same state.
 *
 * A published edition shows its published version to everyone; its editors
 * may preview the current draft with `?draft=1`. A draft is shown only to
 * those who may view it. `/v/n` shows the published version numbered n.
 * Anything a visitor may not see is a 404, so that a draft's existence is
 * never revealed.
 */
import { and } from '$lib/strings/names';
import { error } from '@sveltejs/kit';
import { exportEditionTei, type Item, type LayoutLine } from '@varians/core';
import { editions, type Database, type EditionOrigin } from '@varians/db';
import { eq } from 'drizzle-orm';
import type { Actor } from './authz';
import { loadEditionAccess, type EditionAccess } from './edition-access';
import { publishedVersions } from './publish';
import { PUBLIC, editionView, type Audience, type EditionView } from './reader';
import { editionWorksCited } from './bibliography.ts';
import { plainText, teiSegments } from '$lib/reader/export';
import { alignedUnits, siglaOrderOf, withoutUnreported } from '$lib/reader/sites';
import { DEFAULT_SIGLA } from '$lib/reader/marks';
import type { ReaderData, ReaderMode, ReaderVersion } from '$lib/reader/types';
import { detailOf, packSegments, type ReaderWireData, type SegmentDetail } from '$lib/reader/wire';
import { MAX_REFRESH } from './audience';
import { reader as r } from '$lib/strings/reader';

/** What the URL asks for: a published version by number, or the draft. */
export interface ReaderRequest {
  version?: number | null;
  draft?: boolean;
  /** The segment the visitor came to, by label: the places of the segments nearest it are made first. */
  focus?: string;
}

/**
 * How many segments the page waits to have collated afresh, when the cache
 * lacks more: the others come as the page asks for them.
 */
export const READER_BUDGET = 100;

export interface PublishedMoment {
  number: number;
  version: number;
  at: Date;
}

export interface ReaderDecision {
  /** The document version to show; null for the current content. */
  atVersion: number | null;
  mode: ReaderMode;
}

/**
 * Which state of the edition to show, from the edition, the visitor's rights
 * and the published moments (newest first); null when the visitor may not
 * see what the URL asks for.
 */
export function decideReaderView(
  edition: { visibility: 'draft' | 'published'; version: number; publishedVersion: number | null },
  rights: { canView: boolean; canEdit: boolean },
  moments: PublishedMoment[],
  request: ReaderRequest,
): ReaderDecision | null {
  if (!rights.canView) return null;
  const published = edition.visibility === 'published' && edition.publishedVersion !== null;
  const currentMoment = published
    ? (moments.find((m) => m.version === edition.publishedVersion) ?? null)
    : null;
  if (request.version !== undefined && request.version !== null) {
    const moment = moments.find((m) => m.number === request.version);
    if (!moment) return null;
    return {
      atVersion: moment.version,
      mode: {
        kind: 'version',
        number: moment.number,
        at: moment.at.toISOString(),
        isCurrent: currentMoment?.number === moment.number,
      },
    };
  }
  if (published) {
    if (request.draft && rights.canEdit) {
      return {
        atVersion: null,
        mode: {
          kind: 'preview',
          version: edition.version,
          publishedNumber: currentMoment?.number ?? null,
        },
      };
    }
    return {
      atVersion: edition.publishedVersion,
      mode: {
        kind: 'published',
        number: currentMoment?.number ?? null,
        at: currentMoment ? currentMoment.at.toISOString() : null,
      },
    };
  }
  return { atVersion: null, mode: { kind: 'draft', version: edition.version } };
}

/** Published versions show the work's published records only; a draft or a preview, to its editors, what they may see. */
function audienceOf(mode: ReaderMode, user: Actor | null): Audience {
  return (mode.kind === 'draft' || mode.kind === 'preview') && user
    ? { kind: 'editor', viewer: user }
    : PUBLIC;
}

/** The request a URL makes of the downloads: `?v=n` for a published version, `?draft=1` for the draft. */
export function readerRequestFromUrl(url: URL): ReaderRequest {
  const v = url.searchParams.get('v');
  const request: ReaderRequest = { draft: url.searchParams.get('draft') === '1' };
  if (v !== null) request.version = parseVersionNumber(v);
  return request;
}

/** A version number from a URL; anything but a positive integer is a 404. */
export function parseVersionNumber(raw: string): number {
  if (!/^[1-9]\d{0,8}$/.test(raw)) error(404, 'No such version');
  return Number(raw);
}

export interface ResolvedReader extends ReaderDecision {
  access: EditionAccess;
  moments: PublishedMoment[];
}

/** Load the edition and decide what the visitor sees; a 404 for anything they may not see. */
export async function resolveReader(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
): Promise<ResolvedReader> {
  const access = await loadEditionAccess(db, user, slug);
  if (!access || !access.canView) error(404, 'No such edition');
  const moments = (await publishedVersions(db, access.edition.id)).map((m) => ({
    number: m.number,
    version: m.version,
    at: m.at,
  }));
  const decision = decideReaderView(access.edition, access, moments, request);
  if (!decision) error(404, 'No such edition');
  return { ...decision, access, moments };
}

/** Tokens without their sources: the reader does not show where a word was taken from. */
function trimItem(item: Item): Item {
  if (item.kind !== 'token' || !item.source) return item;
  const { source: _source, ...rest } = item;
  return rest;
}

function trimLine(line: LayoutLine): LayoutLine {
  return { ...line, items: line.items.map(trimItem) };
}

/** The paths and links of one state of the edition. */
export function readerLinks(
  slug: string,
  mode: ReaderMode,
  rights: { canEdit: boolean },
  published: boolean,
): Pick<ReaderData, 'basePath' | 'query' | 'exports' | 'detail' | 'sites' | 'links'> {
  const base = `/editions/${encodeURIComponent(slug)}`;
  const basePath = mode.kind === 'version' ? `${base}/v/${mode.number}` : base;
  const query = mode.kind === 'preview' ? '?draft=1' : '';
  const exportQuery = mode.kind === 'version' ? `?v=${mode.number}` : query;
  return {
    basePath,
    query,
    exports: {
      text: `${base}.txt${exportQuery}`,
      tei: `${base}.tei.xml${exportQuery}`,
      package: `${base}/package.zip`,
    },
    detail: `${base}/detail.json${exportQuery}`,
    sites: `${base}/sites.json${exportQuery}`,
    links: {
      current: base,
      preview: published && rights.canEdit ? `${base}?draft=1` : null,
      editor: rights.canEdit ? `${base}/edit` : null,
    },
  };
}

/** The published versions as the menu lists them, newest first; the current one links to the edition itself. */
export function readerVersions(
  slug: string,
  moments: PublishedMoment[],
  currentNumber: number | null,
): ReaderVersion[] {
  const base = `/editions/${encodeURIComponent(slug)}`;
  return moments.map((m) => ({
    number: m.number,
    at: m.at.toISOString(),
    href: m.number === currentNumber ? base : `${base}/v/${m.number}`,
    current: m.number === currentNumber,
  }));
}

/**
 * The page data: the view at the decided version, trimmed for the browser.
 * Of the segments it sends what the page prints and marks (their places of
 * variation and what is attached), without the words each text has at each
 * place; those come, by `readerDetail`, for the segments the visitor opens.
 */
export async function loadReader(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
): Promise<ReaderWireData> {
  const resolved = await resolveReader(db, user, slug, request);
  const { access, mode, moments } = resolved;
  const audience = audienceOf(mode, user);
  const view = await editionView(db, access.edition.id, resolved.atVersion, audience, {
    lean: true,
    order: false,
    budget: READER_BUDGET,
    ...(request.focus ? { near: request.focus } : {}),
  });
  const published =
    access.edition.visibility === 'published' && access.edition.publishedVersion !== null;
  const currentNumber = published
    ? (moments.find((m) => m.version === access.edition.publishedVersion)?.number ?? null)
    : null;

  // A reader is given nothing of the places the editor does not report.
  const { segments, texts } = packSegments(Object.values(view.segments).map(withoutUnreported));
  // Labels of the segments this edition has, not of the whole work.
  const labelOf: Record<string, string> = {};
  for (const line of view.lines) {
    for (const start of line.starts)
      if (start.segmentId && view.labelOf[start.segmentId])
        labelOf[start.segmentId] = view.labelOf[start.segmentId]!;
  }
  for (const segment of Object.values(view.segments)) labelOf[segment.segmentId] = segment.label;

  return {
    edition: view.edition,
    work: view.work,
    apparatus: view.apparatus,
    lines: view.lines.map(trimLine),
    sigla: view.sigla,
    segments,
    texts,
    baseId: access.edition.id,
    pending: view.pending,
    worksCited: await editionWorksCited(db, access.edition.id, audience),
    labelOf,
    mode,
    versions: readerVersions(access.edition.slug, moments, currentNumber),
    canEdit: access.canEdit,
    copy:
      user && (access.canEdit || published)
        ? `/editions/${encodeURIComponent(access.edition.slug)}/copy`
        : null,
    origin: await originOf(db, access.edition.copiedFrom),
    ...readerLinks(access.edition.slug, mode, access, published),
  };
}

/**
 * The places of some segments, as the page is sent them, for those the page
 * did not wait for (`pending` of the page data). What is not in the edition
 * is left out.
 */
export async function readerSites(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
  segmentIds: string[],
): Promise<Pick<ReaderWireData, 'segments' | 'texts'>> {
  const resolved = await resolveReader(db, user, slug, request);
  const view = await editionView(
    db,
    resolved.access.edition.id,
    resolved.atVersion,
    audienceOf(resolved.mode, user),
    {
      segments: [...new Set(segmentIds)].slice(0, MAX_REFRESH),
      lean: true,
      lines: false,
      order: false,
    },
  );
  // As in the page itself: nothing of the places the editor does not report.
  return packSegments(Object.values(view.segments).map(withoutUnreported));
}

/**
 * What the page was not sent of some segments: the words each text has at
 * each place, and where each stands against the edition's words. For the state
 * of the edition the visitor sees, and nothing the visitor may not see.
 */
export async function readerDetail(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
  segmentIds: string[],
): Promise<Record<string, SegmentDetail>> {
  const resolved = await resolveReader(db, user, slug, request);
  const view = await editionView(
    db,
    resolved.access.edition.id,
    resolved.atVersion,
    audienceOf(resolved.mode, user),
    {
      segments: [...new Set(segmentIds)].slice(0, MAX_REFRESH),
      lean: true,
      lines: false,
      order: false,
      detail: false,
    },
  );
  const out: Record<string, SegmentDetail> = {};
  for (const whole of Object.values(view.segments)) {
    const segment = withoutUnreported(whole);
    out[segment.segmentId] = detailOf(
      segment.collation,
      alignedUnits(segment.collation, segment.baseUnits.length),
    );
  }
  return out;
}

/** Where a copied edition came from, linked while the original is still published. */
async function originOf(db: Database, origin: EditionOrigin | null): Promise<ReaderData['origin']> {
  if (!origin) return null;
  const [source] = await db
    .select({ slug: editions.slug, visibility: editions.visibility })
    .from(editions)
    .where(eq(editions.id, origin.editionId));
  const href =
    source && source.visibility === 'published'
      ? `/editions/${encodeURIComponent(source.slug)}`
      : null;
  return { title: origin.title, editors: origin.editors, number: origin.number, href };
}

/** The version line, as the plain text prints it. */
export function versionLine(mode: ReaderMode): string {
  switch (mode.kind) {
    case 'published':
      return mode.number !== null && mode.at
        ? `${r.version(mode.number)}, ${r.published} ${mode.at.slice(0, 10)}`
        : r.unnumbered;
    case 'version':
      return `${r.version(mode.number)}, ${r.published} ${mode.at.slice(0, 10)}`;
    case 'draft':
      return r.draftVersion(mode.version);
    case 'preview':
      return r.previewVersion(mode.version);
  }
}

/** The plain text of a view: heading, then each segment with its apparatus and notes. */
export function readerPlainText(view: EditionView, mode: ReaderMode): string {
  const heading = [
    r.authorAndWork(view.work.author, view.work.title),
    view.edition.title,
    ...(view.edition.editors.length ? [r.editedByPlain(and(view.edition.editors))] : []),
    versionLine(mode),
  ];
  return plainText({
    heading,
    content: view.content,
    segments: view.segments,
    labelOf: view.labelOf,
    conventions: view.apparatus,
    siglaOrder: siglaOrderOf(view.sigla),
    sigla: view.edition.conventions.sigla ?? DEFAULT_SIGLA,
    noteWord: r.plain.note,
    interpretativeWord: r.plain.interpretative,
  });
}

/** The TEI of a view, fed as the archive feeds it, with the conjectures and reports the reader sees. */
export function readerTei(view: EditionView): string {
  return exportEditionTei({
    title: view.edition.title,
    ...(view.edition.editors.length ? { editors: view.edition.editors } : {}),
    language: view.work.language,
    ...(view.edition.preface ? { preface: view.edition.preface } : {}),
    ...(view.edition.sources ? { sources: view.edition.sources } : {}),
    ...(view.edition.licence
      ? { licence: view.edition.licence.name, licenceUrl: view.edition.licence.url }
      : {}),
    ...(view.edition.rightsNote ? { rightsNote: view.edition.rightsNote } : {}),
    baseSiglum: 'ed.',
    witnesses: view.sigla.map((s) => ({
      siglum: s.siglum,
      ...(s.witnessName ? { name: s.witnessName } : {}),
    })),
    segments: teiSegments(view.content, view.segments, view.labelOf),
  });
}

/** A download of the state the visitor would see at the edition's page. */
export async function readerDownload(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
  kind: 'text' | 'tei',
): Promise<Response> {
  const resolved = await resolveReader(db, user, slug, request);
  const view = await editionView(
    db,
    resolved.access.edition.id,
    resolved.atVersion,
    audienceOf(resolved.mode, user),
  );
  const draft = resolved.mode.kind === 'draft' || resolved.mode.kind === 'preview';
  const name =
    resolved.access.edition.slug +
    (resolved.mode.kind === 'version' ? `-v${resolved.mode.number}` : '');
  const headers: Record<string, string> =
    kind === 'text'
      ? {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `inline; filename="${name}.txt"`,
        }
      : {
          'content-type': 'application/tei+xml; charset=utf-8',
          'content-disposition': `inline; filename="${name}.tei.xml"`,
        };
  // A draft must never be kept by a shared cache.
  if (draft) headers['cache-control'] = 'private, no-store';
  return new Response(kind === 'text' ? readerPlainText(view, resolved.mode) : readerTei(view), {
    headers,
  });
}
