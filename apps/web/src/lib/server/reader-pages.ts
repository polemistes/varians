/**
 * The reader's server side: which state of an edition a visitor
 * may see at a URL, the page data for it, and the plain-text and TEI
 * downloads of the same state.
 *
 * An edition with a version shows its latest version that is not withdrawn
 * to everyone; its editors may preview the draft with `?draft=1`. An edition
 * with no version is shown, as its draft, only to those who may edit it.
 * `/v/n` shows version n, read from its snapshot; a withdrawn version has a
 * page of its own, with its citation and the withdrawal and no text.
 * Anything a visitor may not see is a 404, so that a draft's existence is
 * never revealed.
 */
import { and } from '$lib/strings/names';
import { error } from '@sveltejs/kit';
import {
  exportEditionTei,
  type EditionBibliography,
  type Item,
  type LayoutLine,
} from '@varians/core';
import { editions, type Database, type EditionOrigin, type EditionSnapshot } from '@varians/db';
import { eq } from 'drizzle-orm';
import { editionRights, type Actor } from './authz';
import { loadEditionAccess, type EditionAccess } from './edition-access';
import { MAX_REFRESH, editionSource, viewOf, type EditionView } from './reader';
import {
  editionBibliographyFor,
  editionWorksCited,
  snapshotBibliography,
  snapshotWorksCited,
} from './bibliography.ts';
import { hasVersionSql, versionByNumber, versionsOf, type VersionSummary } from './versions';
import { plainText, teiText } from '$lib/reader/export';
import { alignedUnits, siglaOrderOf } from '$lib/reader/sites';
import { DEFAULT_SIGLA } from '$lib/reader/marks';
import type {
  ReaderData,
  ReaderMode,
  ReaderVersion,
  WithdrawnVersionData,
} from '$lib/reader/types';
import { detailOf, packSegments, type ReaderWireData, type SegmentDetail } from '$lib/reader/wire';
import { reader as r } from '$lib/strings/reader';

/** What the URL asks for: a version by number, or the draft. */
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

/** A version as the reader decides by it: its number, when it was published, the note, and whether it is withdrawn. */
export type PublishedMoment = Pick<VersionSummary, 'number' | 'version' | 'at' | 'note'> & {
  withdrawn: VersionSummary['withdrawn'];
};

export type ReaderDecision =
  | {
      /** The number of the version to show; null for the draft. */
      versionNumber: number | null;
      mode: ReaderMode;
    }
  /** A withdrawn version, whose page has no text. */
  | { withdrawn: PublishedMoment };

/**
 * Which state of the edition to show, from the edition, the visitor's rights
 * and its versions (newest first); null when the visitor may not see what the
 * URL asks for.
 */
export function decideReaderView(
  edition: { version: number },
  rights: { canView: boolean; canEdit: boolean },
  versions: PublishedMoment[],
  request: ReaderRequest,
): ReaderDecision | null {
  const latest = versions.find((v) => !v.withdrawn) ?? null;
  if (request.version !== undefined && request.version !== null) {
    const asked = versions.find((v) => v.number === request.version);
    if (!asked) return null;
    // A withdrawn version keeps its address for everyone who may have cited it.
    if (asked.withdrawn) return { withdrawn: asked };
    return {
      versionNumber: asked.number,
      mode: {
        kind: 'version',
        number: asked.number,
        at: asked.at.toISOString(),
        note: asked.note,
        isCurrent: latest?.number === asked.number,
      },
    };
  }
  if (!rights.canView) return null;
  if (latest) {
    if (request.draft && rights.canEdit) {
      return {
        versionNumber: null,
        mode: { kind: 'preview', version: edition.version, publishedNumber: latest.number },
      };
    }
    return {
      versionNumber: latest.number,
      mode: {
        kind: 'published',
        number: latest.number,
        at: latest.at.toISOString(),
        note: latest.note,
      },
    };
  }
  if (!rights.canEdit) return null;
  return { versionNumber: null, mode: { kind: 'draft', version: edition.version } };
}

/** The request a URL makes of the downloads: `?v=n` for a version, `?draft=1` for the draft. */
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

export interface ResolvedReader {
  versionNumber: number | null;
  mode: ReaderMode;
  access: EditionAccess;
  versions: VersionSummary[];
}

/** The edition's access and versions, and what the visitor sees; a 404 for anything they may not see. */
async function decideFor(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
): Promise<{ access: EditionAccess; versions: VersionSummary[]; decision: ReaderDecision }> {
  const access = await loadEditionAccess(db, user, slug);
  if (!access) error(404, 'No such edition');
  const versions = await versionsOf(db, 'edition', access.edition.id);
  const decision = decideReaderView(access.edition, access, versions, request);
  if (!decision) error(404, 'No such edition');
  return { access, versions, decision };
}

/** Load the edition and decide what the visitor sees; a 404 for anything they may not see, a withdrawn version among them. */
export async function resolveReader(
  db: Database,
  user: Actor | null,
  slug: string,
  request: ReaderRequest,
): Promise<ResolvedReader> {
  const { access, versions, decision } = await decideFor(db, user, slug, request);
  if ('withdrawn' in decision) error(404, 'No such version');
  return { ...decision, access, versions };
}

/**
 * The page of version n when it is withdrawn: the citation's parts (the
 * edition's title and editors as the version had them, its number and date)
 * and the withdrawal's date and note, and no text. Null when version n is not
 * withdrawn; a 404 when there is no such version.
 */
export async function loadWithdrawnVersion(
  db: Database,
  user: Actor | null,
  slug: string,
  number: number,
): Promise<WithdrawnVersionData | null> {
  const { access, versions, decision } = await decideFor(db, user, slug, { version: number });
  if (!('withdrawn' in decision)) return null;
  const asked = decision.withdrawn;
  const row = await versionByNumber(db, 'edition', access.edition.id, number);
  const snapshot = row?.snapshot as EditionSnapshot | undefined;
  const work = await db.query.works.findFirst({
    where: (t, { eq }) => eq(t.id, access.edition.workId),
  });
  const latest = versions.find((v) => !v.withdrawn);
  return {
    edition: {
      id: access.edition.id,
      slug: access.edition.slug,
      title: snapshot?.title ?? access.edition.title,
      editors: snapshot?.editors ?? access.edition.editors,
    },
    work: { id: access.edition.workId, title: work?.title ?? '', author: work?.author ?? null },
    number: asked.number,
    at: asked.at.toISOString(),
    note: asked.note,
    withdrawn: { at: asked.withdrawn!.at.toISOString(), note: asked.withdrawn!.note },
    current: latest ? `/editions/${encodeURIComponent(access.edition.slug)}` : null,
    versions: readerVersions(access.edition.slug, versions, latest?.number ?? null),
  };
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
      tei: `${base}.tei.xml${exportQuery}`,
      package: `${base}/package.zip`,
    },
    detail: `${base}/detail.json${exportQuery}`,
    sites: `${base}/sites.json${exportQuery}`,
    links: {
      current: base,
      preview: published && rights.canEdit ? `${base}?draft=1` : null,
    },
  };
}

/** The versions as the menu lists them, newest first, withdrawn ones marked; the current one links to the edition itself. */
export function readerVersions(
  slug: string,
  versions: (PublishedMoment & Partial<Pick<VersionSummary, 'changes'>>)[],
  currentNumber: number | null,
): ReaderVersion[] {
  const base = `/editions/${encodeURIComponent(slug)}`;
  return versions.map((v) => ({
    number: v.number,
    at: v.at.toISOString(),
    note: v.note,
    withdrawn: v.withdrawn
      ? { at: v.withdrawn.at.toISOString(), note: v.withdrawn.note }
      : null,
    changes: v.changes ?? {
      from: 0,
      to: v.version,
      described: [],
      segments: [],
      added: 0,
      changed: 0,
      removed: 0,
    },
    href: v.number === currentNumber ? base : `${base}/v/${v.number}`,
    current: v.number === currentNumber,
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
  const { access, mode, versions } = resolved;
  const source = await editionSource(db, access.edition.id, resolved.versionNumber);
  // The order of whole segments is given as variants: comparing two orders is quick, and remembered for the pair.
  const view = await viewOf(db, source, {
    lean: true,
    budget: READER_BUDGET,
    ...(request.focus ? { near: request.focus } : {}),
  });
  const published = access.edition.hasVersion;
  const currentNumber = versions.find((v) => !v.withdrawn)?.number ?? null;

  const { segments, texts } = packSegments(Object.values(view.segments));
  // Labels of the segments this edition has, not of the whole work.
  const labelOf: Record<string, string> = {};
  for (const line of view.lines) {
    for (const start of line.starts)
      if (start.segmentId && view.labelOf[start.segmentId])
        labelOf[start.segmentId] = view.labelOf[start.segmentId]!;
  }
  // And of every segment of the passages sent, those the edition does not print among them.
  for (const segment of Object.values(view.segments))
    for (const { segmentId } of segment.segments)
      if (view.labelOf[segmentId]) labelOf[segmentId] = view.labelOf[segmentId]!;

  return {
    edition: view.edition,
    work: view.work,
    languages: view.languages,
    lines: view.lines.map(trimLine),
    sigla: view.sigla,
    segments,
    texts,
    baseId: access.edition.id,
    pending: view.pending,
    worksCited: source.version
      ? snapshotWorksCited(source.version.snapshot as EditionSnapshot)
      : await editionWorksCited(db, access.edition.id),
    labelOf,
    orderVariants: view.orderVariants,
    mode,
    versions: readerVersions(access.edition.slug, versions, currentNumber),
    canEdit: access.canEdit,
    published,
    rights: editionRights(user, access.edition, access.collaboratorIds),
    origin: await originOf(db, source.meta.copiedFrom),
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
  const view = await viewOf(db, await editionSource(db, resolved.access.edition.id, resolved.versionNumber), {
    segments: [...new Set(segmentIds)].slice(0, MAX_REFRESH),
    lean: true,
    lines: false,
    order: false,
  });
  return packSegments(Object.values(view.segments));
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
  const view = await viewOf(db, await editionSource(db, resolved.access.edition.id, resolved.versionNumber), {
    segments: [...new Set(segmentIds)].slice(0, MAX_REFRESH),
    lean: true,
    lines: false,
    order: false,
    detail: false,
  });
  const out: Record<string, SegmentDetail> = {};
  for (const segment of Object.values(view.segments))
    out[segment.segmentId] = detailOf(
      segment.collation,
      alignedUnits(segment.collation, segment.baseUnits.length),
    );
  return out;
}

/** Where a copied edition came from, linked while the original has a version that is not withdrawn. */
async function originOf(db: Database, origin: EditionOrigin | null): Promise<ReaderData['origin']> {
  if (!origin) return null;
  const [source] = await db
    .select({ slug: editions.slug, hasVersion: hasVersionSql('edition', editions.id) })
    .from(editions)
    .where(eq(editions.id, origin.editionId));
  const href = source?.hasVersion ? `/editions/${encodeURIComponent(source.slug)}` : null;
  return { title: origin.title, editors: origin.editors, number: origin.number, href };
}

/** The version line, as the plain text prints it. */
export function versionLine(mode: ReaderMode): string {
  switch (mode.kind) {
    case 'published':
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
    lineation: view.edition.conventions.lineation,
  });
}

/** The TEI of a view, fed as the archive feeds it, with the conjectures and reports the reader sees and, where given, the edition's bibliography. */
export function readerTei(view: EditionView, bibliography?: EditionBibliography): string {
  return exportEditionTei({
    title: view.edition.title,
    ...(view.edition.editors.length ? { editors: view.edition.editors } : {}),
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
    ...teiText(view.content, Object.values(view.segments), view.labelOf),
    ...(bibliography ? { bibliography } : {}),
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
  const source = await editionSource(db, resolved.access.edition.id, resolved.versionNumber);
  const view = await viewOf(db, source);
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
  const body =
    kind === 'text'
      ? readerPlainText(view, resolved.mode)
      : readerTei(
          view,
          source.version
            ? snapshotBibliography(source.version.snapshot as EditionSnapshot)
            : await editionBibliographyFor(db, resolved.access.edition.id),
        );
  return new Response(body, { headers });
}
