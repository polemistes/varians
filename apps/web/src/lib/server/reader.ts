/**
 * What a reader (or the edition editor's apparatus band) needs for an
 * edition: lines with labels, and per segment the collation sites with the
 * conjectures and reported readings attached, as apparatus entries.
 */

import {
  apparatusEntries,
  applySiteKinds,
  attachToSites,
  compareOrder,
  layoutLines,
  type ApparatusConventions,
  type ApparatusEntry,
  type Attachment,
  type AttachmentCandidate,
  type Collation,
  type Item,
  type LayoutLine,
  type Stream,
  type Unit,
  units,
  licenceInfo,
} from '@varians/core';
import {
  conjectures,
  editionAdoptions,
  editions,
  moments,
  notes,
  transcriptions,
  reportedReadings,
  segments,
  users,
  witnesses,
  type Database,
  type EditionConventions,
  type MomentBasis,
  type WitnessHand,
} from '@varians/db';
import { and, desc, eq, getTableColumns, inArray, lte } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { MAX_REFRESH, PUBLIC, recordFilter, type Audience } from './audience.ts';
import { citationsByRecord } from './bibliography.ts';
import {
  collateSegments,
  editionUnits,
  loadEditionContext,
  loadWitnessHands,
  segmentOrderOf,
  type EditionContext,
} from './collation.ts';
import { marksAtPublication } from './site-marks.ts';
import { collationStateOf, normalizeSiglum, type ConspectusEntry } from './sigla.ts';
import { handLabel } from '../registry/witness.ts';
import type { ReaderSiglumState } from '../reader/types.ts';
import { reader as r } from '../strings/reader.ts';
import { documentAt } from './documents/service.ts';
import { siglaOrderOf } from '../reader/sites.ts';
import { outlineOf, type SegmentOutline } from '../edition/outline.ts';

export interface SegmentView {
  segmentId: string;
  label: string;
  collation: Collation;
  baseUnits: Unit[];
  entries: ApparatusEntry[];
  /** Attachments by site index, for the editor's adopt buttons. */
  attachments: Record<number, Attachment[]>;
  unplaced: Attachment[];
  /** Sigla of witnesses without this segment at all. */
  absent: string[];
  notes: { id: string; tokenIds: string[]; text: string; author: string | null; cites: string[] }[];
  /** What the conjectures and reported readings attached here cite, by attachment id: "cf. West 1998, 45". */
  cites: Record<string, string[]>;
  /** Words of the edition taken from a witness that now reads differently there. `now` is empty when the witness no longer has them. */
  drift: Drift[];
}

export interface Drift {
  tokenId: string;
  siglum: string;
  transcriptionId: string;
  now: string;
}

/**
 * The edition's words whose source witness now reads otherwise: each word
 * taken from a transcription of the conspectus is compared with the read
 * forms that transcription has now at the source tokens, in its corrected
 * state and, when it is also collated before correction or with the
 * variants it notes, in those states.
 */
export function driftOf(context: EditionContext, segmentTokenIds: string[]): Drift[] {
  const editionById = editionIndex(context);
  const out: Drift[] = [];
  for (const id of new Set(segmentTokenIds)) {
    const token = editionById.get(id);
    if (!token || token.kind !== 'token' || token.source?.kind !== 'witness') continue;
    const source = token.source;
    const siglum = context.sigla.find((x) => x.transcriptionId === source.transcriptionId);
    const index = wordIndexOf(context, source.transcriptionId);
    if (!siglum || !index) continue;
    const words = [
      ...new Set(
        source.tokenIds
          .map((t) => index.corrected.get(t))
          .filter((w): w is string => w !== undefined),
      ),
    ];
    const now = words.join(' ').normalize('NFC');
    const parts = now.split(/\s+/u).filter(Boolean);
    const form = token.form.normalize('NFC');
    if (parts.includes(form) || now === form) continue;
    // A word the edition took from another state of the witness is not adrift while that state still has it.
    if (
      index.states.some((state) =>
        source.tokenIds
          .map((t) => state.get(t))
          .some((w) => w !== undefined && w.normalize('NFC').split(/\s+/u).includes(form)),
      )
    )
      continue;
    if (siglum.variantSiglum) {
      const noted = source.tokenIds
        .map((t) => index.variant.get(t))
        .filter((w): w is string => w !== undefined);
      if (noted.some((w) => w.normalize('NFC').split(/\s+/u).includes(form))) continue;
    }
    out.push({ tokenId: id, siglum: siglum.siglum, transcriptionId: source.transcriptionId, now });
  }
  return out;
}

const editionIndexes = new WeakMap<EditionContext, Map<string, Item>>();
function editionIndex(context: EditionContext): Map<string, Item> {
  let index = editionIndexes.get(context);
  if (!index) {
    index = new Map(context.edition.content.items.map((item) => [item.id, item] as const));
    editionIndexes.set(context, index);
  }
  return index;
}

type WordIndex = {
  corrected: Map<string, string>;
  variant: Map<string, string>;
  states: Map<string, string>[];
};
const wordIndexes = new WeakMap<EditionContext, Map<string, WordIndex>>();
/** For one transcription of the conspectus: each token's word, as read now, in each state. */
function wordIndexOf(context: EditionContext, transcriptionId: string): WordIndex | null {
  const transcription = context.transcriptions.get(transcriptionId);
  if (!transcription) return null;
  let byContext = wordIndexes.get(context);
  if (!byContext) {
    byContext = new Map();
    wordIndexes.set(context, byContext);
  }
  let index = byContext.get(transcriptionId);
  if (!index) {
    const content = transcription.content;
    const wordsIn = (state: Parameters<typeof units>[3]) => {
      const map = new Map<string, string>();
      for (const unit of units(content, 0, content.items.length, state)) {
        for (const t of unit.tokenIds)
          map.set(t, map.has(t) ? `${map.get(t)} ${unit.text}` : unit.text);
      }
      return map;
    };
    const entry = context.sigla.find((s) => s.transcriptionId === transcriptionId);
    const hands = context.witnessHands.get(transcription.witnessId) ?? [];
    index = {
      corrected: wordsIn('corrected'),
      variant: wordsIn('variant'),
      states: (entry?.states ?? []).map((state) => wordsIn(collationStateOf(state, hands))),
    };
    byContext.set(transcriptionId, index);
  }
  return index;
}

/** A state of a witness as the reader names it: a hand by its label. */
function readerState(
  state: ConspectusEntry['states'][number],
  hands: WitnessHand[],
): ReaderSiglumState {
  if (state.kind === 'hand') {
    return {
      kind: 'hand',
      siglum: state.siglum,
      hand:
        handLabel(state.hand, hands, {
          scribe: r.explain.theScribe,
          other: r.explain.anotherHand,
        }) ?? state.hand,
    };
  }
  return state.kind === 'stage'
    ? { kind: 'stage', siglum: state.siglum, stage: state.stage }
    : { kind: 'original', siglum: state.siglum };
}

/** The apparatus renderer's conventions from an edition's stored conventions. */
export function apparatusConventionsOf(conventions: EditionConventions): ApparatusConventions {
  const out: ApparatusConventions = {
    form: conventions.apparatus,
    latin: conventions.latin,
    interpretative: conventions.interpretative ?? 'separate',
  };
  if (conventions.groups?.length)
    out.groups = conventions.groups.map((g) => ({ siglum: g.siglum, members: g.members }));
  if (conventions.rest) out.rest = conventions.rest;
  if (conventions.all) out.all = conventions.all;
  return out;
}

/** Where a witness orders whole segments otherwise than the edition prints them. */
export interface OrderStatement {
  siglum: string;
  /** The segments the witness has elsewhere, in its order. */
  moved: string[];
  /** The segment they follow in the witness; null when they open it. */
  after: string | null;
}

/**
 * What comparing two orders of segments gave, by the two orders. Comparing
 * is slow on long editions (every pair of segments), and the orders change
 * far less often than the words do, so an edit of words asks nothing anew.
 */
const orderMemo = new Map<string, ReturnType<typeof compareOrder>>();
const ORDER_MEMO_KEPT = 512;

function orderDigest(order: string[]): string {
  return createHash('sha1').update(order.join('\n')).digest('hex');
}

/** Order statements for every witness of the conspectus with a transcription. */
export function orderStatements(context: EditionContext): OrderStatement[] {
  const editionOrder = segmentOrderOf(context.edition.content);
  const inEdition = new Set(editionOrder);
  let editionKey: string | null = null;
  const out: OrderStatement[] = [];
  for (const siglum of context.sigla) {
    if (!siglum.transcriptionId) continue;
    const transcription = context.transcriptions.get(siglum.transcriptionId);
    if (!transcription) continue;
    const witnessOrder = segmentOrderOf(transcription.content).filter((id) => inEdition.has(id));
    // A witness that has the segments it shares with the edition in the edition's order moves none.
    const shared = new Set(witnessOrder);
    const reference = editionOrder.filter((id) => shared.has(id));
    if (reference.every((id, i) => id === witnessOrder[i])) continue;
    const key = `${(editionKey ??= orderDigest(editionOrder))}:${orderDigest(witnessOrder)}`;
    let statements = orderMemo.get(key);
    if (!statements) {
      statements = compareOrder(editionOrder, witnessOrder);
      orderMemo.set(key, statements);
      if (orderMemo.size > ORDER_MEMO_KEPT) orderMemo.delete(orderMemo.keys().next().value!);
    }
    for (const statement of statements) {
      out.push({ siglum: siglum.siglum, moved: statement.moved, after: statement.after });
    }
  }
  return out;
}

/** An edition's row without its text, which a collation context holds already. */
type EditionMeta = Omit<typeof editions.$inferSelect, 'content'>;

async function editionMeta(db: Database, editionId: string): Promise<EditionMeta> {
  const { content: _content, ...columns } = getTableColumns(editions);
  const [row] = await db.select(columns).from(editions).where(eq(editions.id, editionId));
  if (!row) throw new Error(`no edition ${editionId}`);
  return row;
}

export interface EditionView {
  edition: {
    id: string;
    slug: string;
    title: string;
    editors: string[];
    preface: string | null;
    sources: string | null;
    rightsNote: string | null;
    licence: { id: string; name: string; url: string } | null;
    version: number;
    conventions: EditionConventions;
  };
  apparatus: ApparatusConventions;
  work: { id: string; title: string; author: string | null; language: string };
  content: Stream;
  lines: LayoutLine[];
  sigla: {
    siglum: string;
    witnessId: string;
    witnessName: string;
    transcriptionId: string | null;
    description: string | null;
    states: ReaderSiglumState[];
    variantSiglum: string | null;
  }[];
  segments: Record<string, SegmentView>;
  labelOf: Record<string, string>;
  /** Witnesses that order whole segments otherwise than the edition. */
  order: OrderStatement[];
  /** The version shown, when not the current one. */
  atVersion: number | null;
  /** Segments wanted whose views were not made, for want of the collation budget: nearest the one asked for first. */
  pending: string[];
}

/** The witnesses of the conspectus, by id. */
async function witnessesOf(
  db: Database,
  context: EditionContext,
): Promise<Map<string, typeof witnesses.$inferSelect>> {
  const rows = context.sigla.length
    ? await db
        .select()
        .from(witnesses)
        .where(
          inArray(
            witnesses.id,
            context.sigla.map((s) => s.witnessId),
          ),
        )
    : [];
  return new Map(rows.map((w) => [w.id, w] as const));
}

/** The parts of a segment's view that are made; all of them unless said otherwise. */
interface ViewParts {
  /** The apparatus entries, which the reader's page makes for itself under the reader's settings. */
  entries?: boolean;
  /** Which words have drifted from their source witness. */
  drift?: boolean;
  /** The notes and what the records cite. */
  notes?: boolean;
}

/** What an edition's view is made of, when a page needs less than all of it. */
export interface ViewOptions {
  /** The segments to make views of: every segment of the edition when neither this nor `first` is given. */
  segments?: string[];
  /** Views of this many segments, from the start of the text. */
  first?: number;
  /** Leave out the apparatus entries and the drift of words, which the reader's page makes for itself or has no use for. */
  lean?: boolean;
  /** Lay out the lines of the text for the reader (default), or leave them out. */
  lines?: boolean;
  /** Say where the witnesses order whole segments otherwise (default), or leave it out. */
  order?: boolean;
  /** The notes and what the records cite (default), or leave them out. */
  detail?: boolean;
  /**
   * Collate afresh at most this many of the segments the cache lacks, those
   * nearest `near` (a segment's label or id) first; the others are named in
   * `pending` and made when asked for.
   */
  budget?: number;
  near?: string;
}

/**
 * Assemble the view of an edition, at its current content or as it stood at
 * a version. A published version is collated against the witnesses as they
 * stood when it was published, with the conjectures, reported readings and
 * notes there were then, so that it reads the same for as long as it is cited.
 * Views are made of every segment unless some are named, and only those are
 * collated.
 */
export async function editionView(
  db: Database,
  editionId: string,
  atVersion: number | null = null,
  audience: Audience = PUBLIC,
  options: ViewOptions = {},
): Promise<EditionView> {
  const { context, asOf } = await contextAt(db, editionId, atVersion);
  const row = await editionMeta(db, editionId);
  const work = await db.query.works.findFirst({ where: (t, { eq }) => eq(t.id, row.workId) });
  const segmentRows = await db.select().from(segments).where(eq(segments.workId, row.workId));
  const labelOf: Record<string, string> = {};
  for (const s of segmentRows) labelOf[s.id] = s.label;
  const witnessById = await witnessesOf(db, context);
  const sigla = context.sigla.map((s) => ({
    siglum: s.siglum,
    witnessId: s.witnessId,
    witnessName: witnessById.get(s.witnessId)?.name ?? s.siglum,
    transcriptionId: s.transcriptionId,
    description: witnessById.get(s.witnessId)?.description ?? null,
    states: s.states.map((state) => readerState(state, witnessById.get(s.witnessId)?.hands ?? [])),
    variantSiglum: s.variantSiglum,
  }));
  const inEdition = segmentOrderOf(context.edition.content);
  const present = new Set(inEdition);
  const wanted = options.segments
    ? options.segments.filter((id) => present.has(id))
    : options.first !== undefined
      ? inEdition.slice(0, options.first)
      : inEdition;
  const near =
    options.near === undefined
      ? undefined
      : labelOf[options.near] !== undefined
        ? options.near
        : Object.keys(labelOf).find((id) => labelOf[id] === options.near);
  const collations = await collateSegments(db, context, wanted, {
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(near !== undefined ? { near } : {}),
  });
  const pending = wanted.filter((id) => !collations.has(id));
  if (near !== undefined && pending.length > 1) {
    const position = new Map(wanted.map((id, i) => [id, i] as const));
    const at = position.get(near) ?? 0;
    pending.sort((a, b) => Math.abs(position.get(a)! - at) - Math.abs(position.get(b)! - at));
  }
  const views = await buildSegmentViews(
    db,
    context,
    row,
    collations,
    labelOf,
    witnessById,
    asOf,
    audience,
    {
      entries: options.lean !== true,
      drift: options.lean !== true,
      notes: options.detail !== false,
    },
  );
  const lineation =
    row.conventions.lineation === 'prose' ? 1 : Number(row.conventions.numberEvery ?? 5);
  return {
    edition: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      editors: row.editors,
      preface: row.preface,
      sources: row.sources,
      rightsNote: row.rightsNote,
      licence: licenceInfo(row.licenceId),
      version: context.edition.version,
      conventions: row.conventions,
    },
    apparatus: apparatusConventionsOf(row.conventions),
    work: {
      id: row.workId,
      title: work?.title ?? '',
      author: work?.author ?? null,
      language: work?.language ?? 'grc',
    },
    content: context.edition.content,
    lines:
      options.lines === false
        ? []
        : layoutLines(context.edition.content, (id) => labelOf[id] ?? id, {
            numberEvery: lineation,
          }),
    sigla,
    segments: views,
    labelOf,
    order: options.order === false ? [] : orderStatements(context),
    atVersion: atVersion !== null && atVersion !== row.version ? atVersion : null,
    pending,
  };
}

/**
 * An edition's collation context as it stood at a version (the current one
 * when null). A published version brings its basis: the conspectus and the
 * transcription versions it was published with, and the time after which
 * records are left out (`asOf`).
 */
export async function contextAt(
  db: Database,
  editionId: string,
  atVersion: number | null,
): Promise<{ context: EditionContext; asOf: Date | null }> {
  const context = await loadEditionContext(db, editionId);
  if (atVersion !== null && atVersion !== context.edition.version) {
    context.edition = {
      ...context.edition,
      content: await documentAt(db, 'edition', editionId, atVersion),
      version: atVersion,
    };
  }
  let asOf: Date | null = null;
  if (atVersion !== null) {
    const [published] = await db
      .select({ basis: moments.basis, at: moments.at })
      .from(moments)
      .where(
        and(
          eq(moments.documentKind, 'edition'),
          eq(moments.documentId, editionId),
          eq(moments.kind, 'published'),
          eq(moments.version, atVersion),
        ),
      )
      .orderBy(desc(moments.at))
      .limit(1);
    if (published?.basis) {
      await applyBasis(db, context, published.basis);
      asOf = published.at;
      // The kinds, and the places judged minor, as the editors had them when it was published.
      context.siteKinds = marksAtPublication(context.siteKinds, published.basis, published.at);
    }
  }
  return { context, asOf };
}

/** Put a publication's conspectus and transcription versions in place of the current ones. */
async function applyBasis(
  db: Database,
  context: EditionContext,
  basis: MomentBasis,
): Promise<void> {
  // Bases published before variants could be collated have no variant siglum; those before states name the state before correction alone.
  context.sigla = basis.sigla.map(normalizeSiglum);
  context.witnessHands = await loadWitnessHands(
    db,
    context.sigla.map((s) => s.witnessId),
  );
  const ids = basis.sigla.map((s) => s.transcriptionId).filter((id): id is string => id !== null);
  // What the context holds of the transcriptions, as they are now, is not read again.
  const held = context.transcriptions;
  const absent = ids.filter((id) => !held.has(id));
  const rows = [
    ...ids.flatMap((id) => held.get(id) ?? []),
    ...(absent.length
      ? await db
          .select({
            id: transcriptions.id,
            content: transcriptions.content,
            version: transcriptions.version,
            witnessId: transcriptions.witnessId,
          })
          .from(transcriptions)
          .where(inArray(transcriptions.id, absent))
      : []),
  ];
  const loaded = new Map<
    string,
    { id: string; content: Stream; version: number; witnessId: string }
  >();
  for (const row of rows) {
    const version = basis.versions[row.id] ?? row.version;
    loaded.set(
      row.id,
      version >= row.version
        ? row
        : { ...row, content: await documentAt(db, 'transcription', row.id, version), version },
    );
  }
  // A transcription deleted since is simply absent from the apparatus.
  context.sigla = context.sigla.filter(
    (s) => s.transcriptionId === null || loaded.has(s.transcriptionId),
  );
  context.transcriptions = loaded;
}

/**
 * The outline of every segment of the current text: where the places of
 * variation stand and which words have drifted, which the editor needs of the
 * whole text at once (to mark its words, to count the places and to step from
 * one to the next), with the labels of the work's segments. Whatever the cache
 * lacks is collated, and a page asks for this after it has opened.
 */
export async function editionOutline(
  db: Database,
  editionId: string,
  audience: Audience = PUBLIC,
): Promise<{ outline: Record<string, SegmentOutline>; labelOf: Record<string, string> }> {
  const [context, row] = await Promise.all([
    loadEditionContext(db, editionId),
    editionMeta(db, editionId),
  ]);
  const ids = segmentOrderOf(context.edition.content);
  const [collations, witnessById, segmentRows] = await Promise.all([
    collateSegments(db, context, ids),
    witnessesOf(db, context),
    db
      .select({ id: segments.id, label: segments.label })
      .from(segments)
      .where(eq(segments.workId, row.workId)),
  ]);
  const labelOf: Record<string, string> = {};
  for (const s of segmentRows) labelOf[s.id] = s.label;
  const views = await buildSegmentViews(
    db,
    context,
    row,
    collations,
    labelOf,
    witnessById,
    null,
    audience,
    { entries: false, notes: false },
  );
  return {
    outline: Object.fromEntries(ids.map((id) => [id, outlineOf(views[id]!)] as const)),
    labelOf,
  };
}

/** The views of some segments only, for the editor after a change: collated from the current content. */
export async function segmentViewsFor(
  db: Database,
  editionId: string,
  segmentIds: string[],
  audience: Audience = PUBLIC,
): Promise<Record<string, SegmentView>> {
  return (await refreshView(db, editionId, segmentIds, audience)).segments;
}

/** The views of some segments and the order statements of the whole edition, from the current content. */
export async function refreshView(
  db: Database,
  editionId: string,
  segmentIds: string[],
  audience: Audience = PUBLIC,
): Promise<{ segments: Record<string, SegmentView>; order: OrderStatement[] }> {
  const [context, row] = await Promise.all([
    loadEditionContext(db, editionId),
    editionMeta(db, editionId),
  ]);
  // Segments of this work only, and a bounded number of them: the editor asks for those it has on screen.
  const asked = [...new Set(segmentIds)].slice(0, MAX_REFRESH);
  const segmentRows = asked.length
    ? await db
        .select()
        .from(segments)
        .where(and(inArray(segments.id, asked), eq(segments.workId, row.workId)))
    : [];
  const wanted = segmentRows.map((s) => s.id);
  const labelOf: Record<string, string> = {};
  for (const s of segmentRows) labelOf[s.id] = s.label;
  const witnessById = await witnessesOf(db, context);
  const collations = await collateSegments(db, context, wanted);
  return {
    segments: await buildSegmentViews(
      db,
      context,
      row,
      collations,
      labelOf,
      witnessById,
      null,
      audience,
    ),
    order: orderStatements(context),
  };
}

async function buildSegmentViews(
  db: Database,
  context: EditionContext,
  row: EditionMeta,
  collations: Map<string, Collation>,
  labelOf: Record<string, string>,
  witnessById: Map<string, typeof witnesses.$inferSelect>,
  asOf: Date | null = null,
  audience: Audience = PUBLIC,
  parts: ViewParts = {},
): Promise<Record<string, SegmentView>> {
  const editionId = row.id;
  const siglumOfWitness = new Map(context.sigla.map((s) => [s.witnessId, s.siglum] as const));
  const conventions = apparatusConventionsOf(row.conventions);
  const segmentIds = [...collations.keys()];
  const adopted = new Set(
    (await db.select().from(editionAdoptions).where(eq(editionAdoptions.editionId, editionId))).map(
      (a) => a.conjectureId,
    ),
  );
  // The work's published records are a commons every reader sees; drafts only those who may see them, in the editor.
  const sees = await recordFilter(db, row.workId, audience);
  const conjectureRows = segmentIds.length
    ? (
        await db
          .select()
          .from(conjectures)
          .where(
            and(
              eq(conjectures.workId, row.workId),
              inArray(conjectures.segmentId, segmentIds),
              asOf ? lte(conjectures.createdAt, asOf) : undefined,
            ),
          )
      ).filter(sees)
    : [];
  const reportedRows = segmentIds.length
    ? (
        await db
          .select()
          .from(reportedReadings)
          .where(
            and(
              eq(reportedReadings.workId, row.workId),
              inArray(reportedReadings.segmentId, segmentIds),
              asOf ? lte(reportedReadings.createdAt, asOf) : undefined,
            ),
          )
      ).filter(sees)
    : [];
  const withNotes = parts.notes !== false;
  const noteRows = withNotes
    ? await db
        .select({
          id: notes.id,
          segmentId: notes.segmentId,
          tokenIds: notes.tokenIds,
          text: notes.text,
          author: users.name,
        })
        .from(notes)
        .leftJoin(users, eq(users.id, notes.authorId))
        .where(
          and(
            eq(notes.editionId, editionId),
            segmentIds.length ? inArray(notes.segmentId, segmentIds) : undefined,
            asOf ? lte(notes.createdAt, asOf) : undefined,
          ),
        )
    : [];
  const texts = (map: Map<string, { text: string }[]>) =>
    new Map([...map].map(([id, list]) => [id, list.map((c) => c.text)] as const));
  const noteCites = withNotes
    ? texts(
        await citationsByRecord(
          db,
          'note',
          noteRows.map((n) => n.id),
        ),
      )
    : new Map<string, string[]>();
  const recordCites = withNotes
    ? new Map([
        ...texts(
          await citationsByRecord(
            db,
            'conjecture',
            conjectureRows.map((c) => c.id),
          ),
        ),
        ...texts(
          await citationsByRecord(
            db,
            'reported',
            reportedRows.map((r) => r.id),
          ),
        ),
      ])
    : new Map<string, string[]>();
  const bySegment = <T extends { segmentId: string }>(rows: T[]) => {
    const out = new Map<string, T[]>();
    for (const row of rows) {
      const list = out.get(row.segmentId);
      if (list) list.push(row);
      else out.set(row.segmentId, [row]);
    }
    return out;
  };
  const conjecturesAt = bySegment(conjectureRows);
  const reportedAt = bySegment(reportedRows);
  const notesAt = bySegment(noteRows);
  const siglaOrder = siglaOrderOf(context.sigla);
  const siglumOfText = new Map<string, string>();
  for (const s of context.sigla)
    if (s.transcriptionId && !siglumOfText.has(s.transcriptionId))
      siglumOfText.set(s.transcriptionId, s.siglum);
  const views: Record<string, SegmentView> = {};
  for (const [segmentId, collation] of collations) {
    const baseUnits = editionUnits(context.edition.content, segmentId);
    const conjecturesHere = conjecturesAt.get(segmentId) ?? [];
    const reportedHere = reportedAt.get(segmentId) ?? [];
    const candidates: AttachmentCandidate[] = [
      ...conjecturesHere.map((c) => {
        const candidate: AttachmentCandidate = {
          id: c.id,
          kind: 'conjecture',
          lemma: c.lemma,
          reading: c.reading,
          name: c.proposer ?? 'this edition',
          conjectureKind: c.kind,
        };
        if (adopted.has(c.id)) candidate.adopted = true;
        if (c.anchor && 'tokenIds' in c.anchor) candidate.anchorTokenIds = c.anchor.tokenIds;
        return candidate;
      }),
      ...reportedHere.map((r) => {
        const candidate: AttachmentCandidate = {
          id: r.id,
          kind: 'reported',
          lemma: r.lemma,
          reading: r.reading,
          name: siglumOfWitness.get(r.witnessId) ?? witnessById.get(r.witnessId)?.siglum ?? '?',
        };
        if (r.source) candidate.source = `(${r.source})`;
        return candidate;
      }),
    ];
    const attached = attachToSites(collation, baseUnits, candidates, context.profile.fold);
    // The places a conjecture or reported reading makes take the editor's marks too.
    attached.collation = applySiteKinds(
      attached.collation,
      baseUnits,
      context.siteKinds.get(segmentId),
    );
    const label = labelOf[segmentId] ?? segmentId;
    const absent = collation.absent.map((id) => siglumOfText.get(id) ?? id);
    views[segmentId] = {
      segmentId,
      label,
      collation: attached.collation,
      baseUnits,
      entries:
        parts.entries === false
          ? []
          : apparatusEntries(attached.collation, label, attached.bySite, conventions, siglaOrder),
      attachments: attached.bySite,
      unplaced: attached.unplaced,
      absent,
      notes: (notesAt.get(segmentId) ?? []).map((n) => ({
        id: n.id,
        tokenIds: n.tokenIds,
        text: n.text,
        author: n.author,
        cites: noteCites.get(n.id) ?? [],
      })),
      drift:
        parts.drift === false
          ? []
          : driftOf(
              context,
              baseUnits.flatMap((u) => u.tokenIds),
            ),
      cites: Object.fromEntries(
        [...conjecturesHere, ...reportedHere]
          .filter((r) => recordCites.has(r.id))
          .map((r) => [r.id, recordCites.get(r.id)!] as const),
      ),
    };
  }
  return views;
}

export type { EditionContext };
export { PUBLIC, recordFilter, type Audience } from './audience.ts';
