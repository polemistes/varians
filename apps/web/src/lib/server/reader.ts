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
  EDITION_ITSELF,
  layoutLines,
  orderVariants,
  runOn,
  type ApparatusConventions,
  type ApparatusEntry,
  type Attachment,
  type AttachmentCandidate,
  type Collation,
  type Item,
  type LayoutLine,
  type OrderVariant,
  type OrderWitness,
  type PassageSegment,
  type Site,
  type Stream,
  type Token,
  type Unit,
  units,
  licenceInfo,
  siteSegments,
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
  loadEditionContext,
  loadWitnessHands,
  segmentOrderOf,
  type EditionContext,
} from './collation.ts';
import { collatePassagesFor, marksOf, type PassageResult } from './passages.ts';
import { marksAtPublication } from './site-marks.ts';
import { collationStateOf, normalizeSiglum, type ConspectusEntry } from './sigla.ts';
import { handLabel } from '../registry/witness.ts';
import type { ReaderSiglumState } from '../reader/types.ts';
import { reader as r } from '../strings/reader.ts';
import { documentAt } from './documents/service.ts';
import { labelOfSegments, siglaOrderOf } from '../reader/sites.ts';
import { outlineOf, type SegmentOutline } from '../edition/outline.ts';

/**
 * The view of one passage of the edition (section 3.10 of the design): one
 * segment, or several consecutive segments collated together, known by its
 * first. It holds the variants of all its segments, the edition's words of
 * them in one list, and where each segment begins among those words.
 */
export interface SegmentView {
  /** The passage's first segment, by which the view is known. */
  segmentId: string;
  /** The label of that segment. */
  label: string;
  /**
   * The segments of the passage in order, each with its label and the
   * edition's units it holds, [from, to); a segment the edition does not
   * print and witnesses have stands after the segment it follows, and holds
   * none.
   */
  segments: (PassageSegment & { label: string })[];
  collation: Collation;
  /** The edition's units of the passage, each naming the segment its word begins in. */
  baseUnits: Unit[];
  /** The segments each variant's words lie in, by site index, in the order of the passage: the first is where it stands. */
  siteSegments: Record<number, string[]>;
  entries: ApparatusEntry[];
  /** Attachments by site index, for the editor's adopt buttons, each with the segment it names. */
  attachments: Record<number, (Attachment & { segmentId?: string })[]>;
  /** Conjectures and reported readings no variant took, each with the segment it names. */
  unplaced: (Attachment & { segmentId?: string })[];
  /** Sigla of witnesses without any of the passage. */
  absent: string[];
  notes: {
    id: string;
    segmentId: string;
    tokenIds: string[];
    text: string;
    author: string | null;
    cites: string[];
  }[];
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
    // A word the edition keeps divided is one word, compared whole, and the drift is its first part's.
    const word = dividedWord(context, token, token.source.transcriptionId);
    if (!word) continue;
    const source = token.source;
    const siglum = context.sigla.find((x) => x.transcriptionId === source.transcriptionId);
    const index = wordIndexOf(context, source.transcriptionId);
    if (!siglum || !index) continue;
    const tokenIds = [...new Set(word.sources.flatMap((s) => s.tokenIds))];
    const words = [
      ...new Set(
        tokenIds.map((t) => index.corrected.get(t)).filter((w): w is string => w !== undefined),
      ),
    ];
    const now = words.join(' ').normalize('NFC');
    const parts = now.split(/\s+/u).filter(Boolean);
    const form = word.form.normalize('NFC');
    if (parts.includes(form) || now === form) continue;
    // A word the edition took from another state of the witness is not adrift while that state still has it.
    if (
      index.states.some((state) =>
        tokenIds
          .map((t) => state.get(t))
          .some((w) => w !== undefined && w.normalize('NFC').split(/\s+/u).includes(form)),
      )
    )
      continue;
    if (siglum.variantSiglum) {
      const noted = tokenIds
        .map((t) => index.variant.get(t))
        .filter((w): w is string => w !== undefined);
      if (noted.some((w) => w.normalize('NFC').split(/\s+/u).includes(form))) continue;
    }
    out.push({ tokenId: id, siglum: siglum.siglum, transcriptionId: source.transcriptionId, now });
  }
  return out;
}

/**
 * The whole word an edition token is a part of, from its first part: the
 * parts' forms run together and the witness sources they were taken from.
 * Null for a part that follows another, whose word is the first part's.
 */
function dividedWord(
  context: EditionContext,
  token: Token,
  transcriptionId: string,
): { form: string; sources: { tokenIds: string[] }[] } | null {
  const items = context.edition.content.items;
  const at = positionIndex(context).get(token.id);
  if (at === undefined) return null;
  let before = at - 1;
  while (items[before]?.kind === 'break') before--;
  const previous = items[before];
  if (previous?.kind === 'token' && previous.joinNext) return null;
  const parts: Token[] = [token];
  for (let i = at + 1, last: Token = token; last.joinNext && i < items.length; i++) {
    const next = items[i]!;
    if (next.kind === 'break') continue;
    if (next.kind !== 'token') break;
    parts.push(next);
    last = next;
  }
  const sources = parts.flatMap((part) =>
    part.source?.kind === 'witness' && part.source.transcriptionId === transcriptionId
      ? [part.source]
      : [],
  );
  return { form: parts.map((part) => part.form).join(''), sources };
}

const positionIndexes = new WeakMap<EditionContext, Map<string, number>>();
function positionIndex(context: EditionContext): Map<string, number> {
  let index = positionIndexes.get(context);
  if (!index) {
    index = new Map(context.edition.content.items.map((item, i) => [item.id, i] as const));
    positionIndexes.set(context, index);
  }
  return index;
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
          scribe: r.variant.theScribe,
          other: r.variant.anotherHand,
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
  return orderOf(context).statements;
}

/**
 * Where the witnesses order the edition's segments otherwise: as statements
 * (a block a witness has elsewhere, and what it follows there), and as the
 * variants the screens report, over stretches of the edition's segments.
 * Comparing the orders is remembered for each pair of orders; the variants
 * are made from what it gave, once for each context.
 */
export function orderOf(context: EditionContext): {
  statements: OrderStatement[];
  variants: OrderVariant[];
} {
  const known = ordersOf.get(context);
  if (known && known.content === context.edition.content) return known.result;
  const editionOrder = segmentOrderOf(context.edition.content);
  const inEdition = new Set(editionOrder);
  let editionKey: string | null = null;
  const statements: OrderStatement[] = [];
  const compared: OrderWitness[] = [];
  for (const siglum of context.sigla) {
    if (!siglum.transcriptionId) continue;
    const transcription = context.transcriptions.get(siglum.transcriptionId);
    if (!transcription) continue;
    const witnessOrder = segmentOrderOf(transcription.content).filter((id) => inEdition.has(id));
    const witness: OrderWitness = {
      id: transcription.id,
      siglum: siglum.siglum,
      order: witnessOrder,
    };
    compared.push(witness);
    // A witness that has the segments it shares with the edition in the edition's order moves none.
    const shared = new Set(witnessOrder);
    const reference = editionOrder.filter((id) => shared.has(id));
    if (reference.every((id, i) => id === witnessOrder[i])) {
      witness.statements = [];
      continue;
    }
    const key = `${(editionKey ??= orderDigest(editionOrder))}:${orderDigest(witnessOrder)}`;
    let found = orderMemo.get(key);
    if (!found) {
      found = compareOrder(editionOrder, witnessOrder);
      orderMemo.set(key, found);
      if (orderMemo.size > ORDER_MEMO_KEPT) orderMemo.delete(orderMemo.keys().next().value!);
    }
    witness.statements = found;
    for (const statement of found) {
      statements.push({ siglum: siglum.siglum, moved: statement.moved, after: statement.after });
    }
  }
  const variants = statements.length === 0 ? [] : orderVariants(editionOrder, compared);
  const result = { statements, variants };
  ordersOf.set(context, { content: context.edition.content, result });
  return result;
}

const ordersOf = new WeakMap<
  EditionContext,
  { content: Stream; result: { statements: OrderStatement[]; variants: OrderVariant[] } }
>();

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
  /** The passages made, by their first segment. */
  segments: Record<string, SegmentView>;
  labelOf: Record<string, string>;
  /** Witnesses that order whole segments otherwise than the edition. */
  order: OrderStatement[];
  /** The same as variants: over a stretch of the edition's segments, the segments in each order. */
  orderVariants: OrderVariant[];
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
  /** Say where the witnesses order whole segments otherwise, as statements and as variants (default), or leave it out. */
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
  // Asked by segments, given passages: a segment the edition does not print comes in the passage of the one it follows.
  const wanted = options.segments
    ? options.segments
    : options.first !== undefined && options.first < inEdition.length
      ? inEdition.slice(0, options.first)
      : null;
  const near =
    options.near === undefined
      ? undefined
      : labelOf[options.near] !== undefined
        ? options.near
        : Object.keys(labelOf).find((id) => labelOf[id] === options.near);
  const { passages, pending } = await collatePassagesFor(db, context, wanted, {
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(near !== undefined ? { near } : {}),
  });
  const views = await buildSegmentViews(
    db,
    context,
    row,
    passages,
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
  const order = options.order === false ? null : orderOf(context);
  const lineation = row.conventions.lineation ?? 'verse';
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
        : runOn(
            context.edition.content,
            layoutLines(context.edition.content, (id) => labelOf[id] ?? id, {
              numberEvery: Number(row.conventions.numberEvery ?? 5),
              lineation,
            }),
          ),
    sigla,
    segments: views,
    labelOf,
    order: order?.statements ?? [],
    orderVariants: order?.variants ?? [],
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
  const [{ passages }, witnessById, labelOf] = await Promise.all([
    collatePassagesFor(db, context, null),
    witnessesOf(db, context),
    labelsOfWork(db, row.workId),
  ]);
  const views = await buildSegmentViews(
    db,
    context,
    row,
    passages,
    labelOf,
    witnessById,
    null,
    audience,
    { entries: false, notes: false },
  );
  return {
    outline: Object.fromEntries(
      passages.map((p) => [p.segmentId, outlineOf(views[p.segmentId]!)] as const),
    ),
    labelOf,
  };
}

/** The labels of a work's segments, by id. */
async function labelsOfWork(db: Database, workId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: segments.id, label: segments.label })
    .from(segments)
    .where(eq(segments.workId, workId));
  const labelOf: Record<string, string> = {};
  for (const s of rows) labelOf[s.id] = s.label;
  return labelOf;
}

/** The views of the passages that hold some segments, for the editor after a change: collated from the current content. */
export async function segmentViewsFor(
  db: Database,
  editionId: string,
  segmentIds: string[],
  audience: Audience = PUBLIC,
): Promise<Record<string, SegmentView>> {
  return (await refreshView(db, editionId, segmentIds, audience)).segments;
}

/**
 * The views of the passages that hold some segments, and how the whole
 * edition's segments stand to the witnesses', from the current content. The
 * plan of passages around the segments is made again, so that an edit that
 * joins two passages or parts them gives the passages as they now are.
 */
export async function refreshView(
  db: Database,
  editionId: string,
  segmentIds: string[],
  audience: Audience = PUBLIC,
): Promise<{
  segments: Record<string, SegmentView>;
  order: OrderStatement[];
  orderVariants: OrderVariant[];
}> {
  const [context, row] = await Promise.all([
    loadEditionContext(db, editionId),
    editionMeta(db, editionId),
  ]);
  // Segments of this work only, and a bounded number of them: the editor asks for those it has on screen.
  const asked = [...new Set(segmentIds)].slice(0, MAX_REFRESH);
  const labelOf = await labelsOfWork(db, row.workId);
  const wanted = asked.filter((id) => labelOf[id] !== undefined);
  const witnessById = await witnessesOf(db, context);
  const { passages } = await collatePassagesFor(db, context, wanted);
  const views = await buildSegmentViews(
    db,
    context,
    row,
    passages,
    labelOf,
    witnessById,
    null,
    audience,
  );
  const order = orderOf(context);
  return { segments: views, order: order.statements, orderVariants: order.variants };
}

/** Rows by the segment they name. */
export function bySegment<T extends { segmentId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.segmentId);
    if (list) list.push(row);
    else out.set(row.segmentId, [row]);
  }
  return out;
}

/** The edition's words taken from each conjecture, by conjecture id: found once for a text, and kept while the text is. */
const wordsFromConjectures = new WeakMap<Stream, Map<string, string[]>>();
function sourcedFrom(content: Stream): Map<string, string[]> {
  let known = wordsFromConjectures.get(content);
  if (!known) {
    known = new Map();
    for (const item of content.items) {
      if (item.kind !== 'token' || item.source?.kind !== 'conjecture') continue;
      const id = item.source.conjectureId;
      known.set(id, [...(known.get(id) ?? []), item.id]);
    }
    wordsFromConjectures.set(content, known);
  }
  return known;
}

/** The conjectures and reported readings that may be laid at the variants of an edition's passages. */
export interface PassageRecords {
  conjecturesAt: ReadonlyMap<string, (typeof conjectures.$inferSelect)[]>;
  reportedAt: ReadonlyMap<string, (typeof reportedReadings.$inferSelect)[]>;
  /** The conjectures the edition adopts. */
  adopted: ReadonlySet<string>;
  /** The siglum a reading reported for a witness is given under: that of the conspectus, or the witness's own. */
  siglumOf: (witnessId: string) => string;
}

/**
 * The conjectures and reported readings of a passage's segments, laid at
 * its variants: the collation with the places they make, under the editors'
 * marks, the records by the index of their variant, those no variant took,
 * and the segment each record names. The one place where the records of a
 * passage are attached, for the reader, the editor and the files.
 */
export function attachRecords(
  context: EditionContext,
  passage: PassageResult,
  records: PassageRecords,
): {
  collation: Collation;
  bySite: Record<number, Attachment[]>;
  unplaced: Attachment[];
  segmentOf: Map<string, string>;
} {
  const { baseUnits, collation } = passage;
  const here = passage.segments.map((s) => s.segmentId);
  // A record is looked for in its own segment only, so that the same words in a neighbouring one are not taken.
  const rangeOf = (id: string) => {
    const part = passage.segments.find((s) => s.segmentId === id);
    return part ? { range: { from: part.from, to: part.to } } : {};
  };
  const segmentOf = new Map<string, string>();
  const sourced = sourcedFrom(context.edition.content);
  const candidates: AttachmentCandidate[] = [
    ...here
      .flatMap((id) => records.conjecturesAt.get(id) ?? [])
      .map((c) => {
        segmentOf.set(c.id, c.segmentId);
        const candidate: AttachmentCandidate = {
          id: c.id,
          kind: 'conjecture',
          lemma: c.lemma,
          reading: c.reading,
          name: c.proposer ?? EDITION_ITSELF,
          conjectureKind: c.kind,
          ...rangeOf(c.segmentId),
        };
        if (records.adopted.has(c.id)) candidate.adopted = true;
        // A conjecture stands where it was registered, and where the edition has its words: an adopted one
        // is found by them when its lemma is printed no longer.
        const anchor = [
          ...(c.anchor && 'tokenIds' in c.anchor ? c.anchor.tokenIds : []),
          ...(sourced.get(c.id) ?? []),
        ];
        if (anchor.length) candidate.anchorTokenIds = anchor;
        return candidate;
      }),
    ...here
      .flatMap((id) => records.reportedAt.get(id) ?? [])
      .map((r) => {
        segmentOf.set(r.id, r.segmentId);
        const candidate: AttachmentCandidate = {
          id: r.id,
          kind: 'reported',
          lemma: r.lemma,
          reading: r.reading,
          name: records.siglumOf(r.witnessId),
          ...rangeOf(r.segmentId),
        };
        if (r.source) candidate.source = `(${r.source})`;
        return candidate;
      }),
  ];
  const attached = attachToSites(collation, baseUnits, candidates, context.profile.fold);
  return {
    // The places a conjecture or reported reading makes take the editor's marks too.
    collation: applySiteKinds(attached.collation, baseUnits, marksOf(context, passage)),
    bySite: attached.bySite,
    unplaced: attached.unplaced,
    segmentOf,
  };
}

async function buildSegmentViews(
  db: Database,
  context: EditionContext,
  row: EditionMeta,
  passages: readonly PassageResult[],
  labelOf: Record<string, string>,
  witnessById: Map<string, typeof witnesses.$inferSelect>,
  asOf: Date | null = null,
  audience: Audience = PUBLIC,
  parts: ViewParts = {},
): Promise<Record<string, SegmentView>> {
  const editionId = row.id;
  const siglumOfWitness = new Map(context.sigla.map((s) => [s.witnessId, s.siglum] as const));
  const conventions = apparatusConventionsOf(row.conventions);
  // The records of every segment of the passages: those the edition does not print among them.
  const segmentIds = passages.flatMap((p) => p.segments.map((s) => s.segmentId));
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
  const records: PassageRecords = {
    conjecturesAt: bySegment(conjectureRows),
    reportedAt: bySegment(reportedRows),
    adopted,
    siglumOf: (witnessId) =>
      siglumOfWitness.get(witnessId) ?? witnessById.get(witnessId)?.siglum ?? '?',
  };
  const notesAt = bySegment(noteRows);
  const siglaOrder = siglaOrderOf(context.sigla);
  const siglumOfText = new Map<string, string>();
  for (const s of context.sigla)
    if (s.transcriptionId && !siglumOfText.has(s.transcriptionId))
      siglumOfText.set(s.transcriptionId, s.siglum);
  const views: Record<string, SegmentView> = {};
  for (const passage of passages) {
    const { segmentId, baseUnits, collation } = passage;
    const here = passage.segments.map((s) => s.segmentId);
    const conjecturesHere = here.flatMap((id) => records.conjecturesAt.get(id) ?? []);
    const reportedHere = here.flatMap((id) => records.reportedAt.get(id) ?? []);
    const attached = attachRecords(context, passage, records);
    const segmentOfRecord = attached.segmentOf;
    const siteSegments = segmentsOfSites(attached.collation.sites, baseUnits, passage.segments);
    const label = labelOf[segmentId] ?? segmentId;
    const absent = collation.absent.map((id) => siglumOfText.get(id) ?? id);
    views[segmentId] = {
      segmentId,
      label,
      segments: passage.segments.map((s) => ({ ...s, label: labelOf[s.segmentId] ?? s.segmentId })),
      collation: attached.collation,
      baseUnits,
      siteSegments,
      entries:
        parts.entries === false
          ? []
          : labelledEntries(
              apparatusEntries(attached.collation, label, attached.bySite, conventions, siglaOrder),
              siteSegments,
              labelOf,
            ),
      // Each record with the segment it names, which an adopted conjecture's words take.
      attachments: Object.fromEntries(
        Object.entries(attached.bySite).map(([index, list]) => [
          index,
          list.map((a) => {
            const at = segmentOfRecord.get(a.id);
            return at ? { ...a, segmentId: at } : a;
          }),
        ]),
      ),
      unplaced: attached.unplaced.map((a) => {
        const at = segmentOfRecord.get(a.id);
        return at ? { ...a, segmentId: at } : a;
      }),
      absent,
      notes: here.flatMap((id) =>
        (notesAt.get(id) ?? []).map((n) => ({
          id: n.id,
          segmentId: n.segmentId,
          tokenIds: n.tokenIds,
          text: n.text,
          author: n.author,
          cites: noteCites.get(n.id) ?? [],
        })),
      ),
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

/** The segments of each site's words, by site index, in the order of the passage. */
export function segmentsOfSites(
  sites: readonly Site[],
  baseUnits: readonly Unit[],
  segments: readonly PassageSegment[],
): Record<number, string[]> {
  const rank = new Map(segments.map((s, k) => [s.segmentId, k] as const));
  const out: Record<number, string[]> = {};
  for (const site of sites)
    out[site.index] = siteSegments(site, baseUnits as Unit[]).sort(
      (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
    );
  return out;
}

/** The entries of a passage, each under the label of the segments its words lie in ("1.5", "1.5–1.6"). */
function labelledEntries(
  entries: ApparatusEntry[],
  siteSegments: Record<number, string[]>,
  labelOf: Record<string, string>,
): ApparatusEntry[] {
  return entries.map((entry) => {
    const ids = siteSegments[entry.siteIndex];
    return ids?.length ? { ...entry, label: labelOfSegments(ids, labelOf) } : entry;
  });
}

export type { EditionContext };
export { PUBLIC, recordFilter, type Audience } from './audience.ts';
