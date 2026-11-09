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
  segmentIds as segmentIdsOf,
  type ApparatusConventions,
  type ApparatusEntry,
  type Attachment,
  type AttachmentCandidate,
  type Collation,
  type Item,
  type LayoutLine,
  type Stream,
  type Unit,
  type VariantRelation,
  units,
  variantRelation,
  looseKey,
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
  works,
  type Database,
  type EditionConventions,
  type MomentBasis,
  type WitnessHand,
} from '@varians/db';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { MAX_REFRESH, PUBLIC, recordFilter, type Audience } from './audience.ts';
import { citationsByRecord } from './bibliography.ts';
import { collateEdition, collateSegment, editionUnits, loadEditionContext, loadWitnessHands, type EditionContext } from './collation.ts';
import { collationStateOf, normalizeSiglum, type ConspectusEntry } from './sigla.ts';
import { handLabel } from '../registry/witness.ts';
import type { ReaderSiglumState } from '../reader/types.ts';
import { reader as r } from '../strings/reader.ts';
import { documentAt } from './documents/service.ts';
import { analyseWords } from './lexicon.ts';
import { siglaOrderOf } from '../reader/sites.ts';

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
  /** Words of the edition taken from a witness that now reads differently there (PLAN 4.7). `now` is empty when the witness no longer has them. */
  drift: Drift[];
  /**
   * How each reading of a textual place stands to the edition's words, by
   * site index and the reading's index among the site's readings: another
   * form of the same word, another word, another order. Greek works only.
   */
  relations?: Record<number, (VariantRelation | null)[]>;
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
    const words = [...new Set(source.tokenIds.map((t) => index.corrected.get(t)).filter((w): w is string => w !== undefined))];
    const now = words.join(' ').normalize('NFC');
    const parts = now.split(/\s+/u).filter(Boolean);
    const form = token.form.normalize('NFC');
    if (parts.includes(form) || now === form) continue;
    // A word the edition took from another state of the witness is not adrift while that state still has it.
    if (index.states.some((state) => source.tokenIds.map((t) => state.get(t)).some((w) => w !== undefined && w.normalize('NFC').split(/\s+/u).includes(form)))) continue;
    if (siglum.variantSiglum) {
      const noted = source.tokenIds.map((t) => index.variant.get(t)).filter((w): w is string => w !== undefined);
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

type WordIndex = { corrected: Map<string, string>; variant: Map<string, string>; states: Map<string, string>[] };
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
        for (const t of unit.tokenIds) map.set(t, map.has(t) ? `${map.get(t)} ${unit.text}` : unit.text);
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
function readerState(state: ConspectusEntry['states'][number], hands: WitnessHand[]): ReaderSiglumState {
  if (state.kind === 'hand') {
    return { kind: 'hand', siglum: state.siglum, hand: handLabel(state.hand, hands, { scribe: r.explain.theScribe, other: r.explain.anotherHand }) ?? state.hand };
  }
  return state.kind === 'stage' ? { kind: 'stage', siglum: state.siglum, stage: state.stage } : { kind: 'original', siglum: state.siglum };
}

/** The apparatus renderer's conventions from an edition's stored conventions. */
export function apparatusConventionsOf(conventions: EditionConventions): ApparatusConventions {
  return { form: conventions.apparatus, latin: conventions.latin, interpretative: conventions.interpretative ?? 'separate' };
}

/** Where a witness orders whole segments otherwise than the edition prints them (PLAN 4.8). */
export interface OrderStatement {
  siglum: string;
  /** The segments the witness has elsewhere, in its order. */
  moved: string[];
  /** The segment they follow in the witness; null when they open it. */
  after: string | null;
}

/** Order statements for every witness of the conspectus with a transcription. */
export function orderStatements(context: EditionContext): OrderStatement[] {
  const editionOrder = segmentIdsOf(context.edition.content);
  const out: OrderStatement[] = [];
  for (const siglum of context.sigla) {
    if (!siglum.transcriptionId) continue;
    const transcription = context.transcriptions.get(siglum.transcriptionId);
    if (!transcription) continue;
    const inEdition = new Set(editionOrder);
    const witnessOrder = segmentIdsOf(transcription.content).filter((id) => inEdition.has(id));
    for (const statement of compareOrder(editionOrder, witnessOrder)) {
      out.push({ siglum: siglum.siglum, moved: statement.moved, after: statement.after });
    }
  }
  return out;
}

export interface EditionView {
  edition: { id: string; slug: string; title: string; editors: string[]; preface: string | null; sources: string | null; rightsNote: string | null; licence: { id: string; name: string; url: string } | null; version: number; conventions: EditionConventions };
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
}

/**
 * Assemble the view of an edition, at its current content or as it stood at
 * a version. A published version is collated against the witnesses as they
 * stood when it was published, with the conjectures, reported readings and
 * notes there were then, so that it reads the same for as long as it is cited.
 */
export async function editionView(db: Database, editionId: string, atVersion: number | null = null, audience: Audience = PUBLIC): Promise<EditionView> {
  const { context, asOf } = await contextAt(db, editionId, atVersion);
  const [row] = await db.select().from(editions).where(eq(editions.id, editionId));
  if (!row) throw new Error(`no edition ${editionId}`);
  const work = await db.query.works.findFirst({ where: (t, { eq }) => eq(t.id, row.workId) });
  const segmentRows = await db.select().from(segments).where(eq(segments.workId, row.workId));
  const labelOf: Record<string, string> = {};
  for (const s of segmentRows) labelOf[s.id] = s.label;
  const witnessRows = context.sigla.length
    ? await db.select().from(witnesses).where(inArray(witnesses.id, context.sigla.map((s) => s.witnessId)))
    : [];
  const witnessById = new Map(witnessRows.map((w) => [w.id, w] as const));
  const sigla = context.sigla.map((s) => ({
    siglum: s.siglum,
    witnessId: s.witnessId,
    witnessName: witnessById.get(s.witnessId)?.name ?? s.siglum,
    transcriptionId: s.transcriptionId,
    description: witnessById.get(s.witnessId)?.description ?? null,
    states: s.states.map((state) => readerState(state, witnessById.get(s.witnessId)?.hands ?? [])),
    variantSiglum: s.variantSiglum,
  }));
  const collations = await collateEdition(db, context);
  const views = await buildSegmentViews(db, context, row, collations, labelOf, witnessById, asOf, audience);
  const lineation = row.conventions.lineation === 'prose' ? 1 : Number(row.conventions.numberEvery ?? 5);
  return {
    edition: { id: row.id, slug: row.slug, title: row.title, editors: row.editors, preface: row.preface, sources: row.sources, rightsNote: row.rightsNote, licence: licenceInfo(row.licenceId), version: context.edition.version, conventions: row.conventions },
    apparatus: apparatusConventionsOf(row.conventions),
    work: { id: row.workId, title: work?.title ?? '', author: work?.author ?? null, language: work?.language ?? 'grc' },
    content: context.edition.content,
    lines: layoutLines(context.edition.content, (id) => labelOf[id] ?? id, { numberEvery: lineation }),
    sigla,
    segments: views,
    labelOf,
    order: orderStatements(context),
    atVersion: atVersion !== null && atVersion !== row.version ? atVersion : null,
  };
}

/**
 * An edition's collation context as it stood at a version (the current one
 * when null). A published version brings its basis: the conspectus and the
 * transcription versions it was published with, and the time after which
 * records are left out (`asOf`).
 */
export async function contextAt(db: Database, editionId: string, atVersion: number | null): Promise<{ context: EditionContext; asOf: Date | null }> {
  const context = await loadEditionContext(db, editionId);
  if (atVersion !== null && atVersion !== context.edition.version) {
    context.edition = { ...context.edition, content: await documentAt(db, 'edition', editionId, atVersion), version: atVersion };
  }
  let asOf: Date | null = null;
  if (atVersion !== null) {
    const [published] = await db
      .select({ basis: moments.basis, at: moments.at })
      .from(moments)
      .where(and(eq(moments.documentKind, 'edition'), eq(moments.documentId, editionId), eq(moments.kind, 'published'), eq(moments.version, atVersion)))
      .orderBy(desc(moments.at))
      .limit(1);
    if (published?.basis) {
      await applyBasis(db, context, published.basis);
      asOf = published.at;
      // The kinds as the editors had set them when it was published.
      const at = published.at;
      for (const [segmentId, bySite] of context.siteKinds) {
        context.siteKinds.set(segmentId, new Map([...bySite].filter(([, k]) => k.setAt <= at)));
      }
    }
  }
  return { context, asOf };
}

/** Put a publication's conspectus and transcription versions in place of the current ones. */
async function applyBasis(db: Database, context: EditionContext, basis: MomentBasis): Promise<void> {
  // Bases published before variants could be collated have no variant siglum; those before states name the state before correction alone.
  context.sigla = basis.sigla.map(normalizeSiglum);
  context.witnessHands = await loadWitnessHands(db, context.sigla.map((s) => s.witnessId));
  const ids = basis.sigla.map((s) => s.transcriptionId).filter((id): id is string => id !== null);
  const rows = ids.length
    ? await db.select({ id: transcriptions.id, content: transcriptions.content, version: transcriptions.version, witnessId: transcriptions.witnessId }).from(transcriptions).where(inArray(transcriptions.id, ids))
    : [];
  const loaded = new Map<string, { id: string; content: Stream; version: number; witnessId: string }>();
  for (const row of rows) {
    const version = basis.versions[row.id] ?? row.version;
    loaded.set(row.id, version >= row.version ? row : { ...row, content: await documentAt(db, 'transcription', row.id, version), version });
  }
  // A transcription deleted since is simply absent from the apparatus.
  context.sigla = context.sigla.filter((s) => s.transcriptionId === null || loaded.has(s.transcriptionId));
  context.transcriptions = loaded;
}

/** The views of some segments only, for the editor after a change: collated from the current content. */
export async function segmentViewsFor(db: Database, editionId: string, segmentIds: string[], audience: Audience = PUBLIC): Promise<Record<string, SegmentView>> {
  return (await refreshView(db, editionId, segmentIds, audience)).segments;
}

/** The views of some segments and the order statements of the whole edition, from the current content. */
export async function refreshView(
  db: Database,
  editionId: string,
  segmentIds: string[],
  audience: Audience = PUBLIC,
): Promise<{ segments: Record<string, SegmentView>; order: OrderStatement[] }> {
  const context = await loadEditionContext(db, editionId);
  const [row] = await db.select().from(editions).where(eq(editions.id, editionId));
  if (!row) throw new Error(`no edition ${editionId}`);
  // Segments of this work only, and a bounded number of them: the editor asks for those it has on screen.
  const asked = [...new Set(segmentIds)].slice(0, MAX_REFRESH);
  const segmentRows = asked.length ? await db.select().from(segments).where(and(inArray(segments.id, asked), eq(segments.workId, row.workId))) : [];
  const wanted = segmentRows.map((s) => s.id);
  const labelOf: Record<string, string> = {};
  for (const s of segmentRows) labelOf[s.id] = s.label;
  const witnessRows = context.sigla.length
    ? await db.select().from(witnesses).where(inArray(witnesses.id, context.sigla.map((s) => s.witnessId)))
    : [];
  const witnessById = new Map(witnessRows.map((w) => [w.id, w] as const));
  const collations = new Map<string, Collation>();
  for (const id of wanted) collations.set(id, await collateSegment(db, context, id));
  return { segments: await buildSegmentViews(db, context, row, collations, labelOf, witnessById, null, audience), order: orderStatements(context) };
}

async function buildSegmentViews(
  db: Database,
  context: EditionContext,
  row: typeof editions.$inferSelect,
  collations: Map<string, Collation>,
  labelOf: Record<string, string>,
  witnessById: Map<string, typeof witnesses.$inferSelect>,
  asOf: Date | null = null,
  audience: Audience = PUBLIC,
): Promise<Record<string, SegmentView>> {
  const editionId = row.id;
  const siglumOfWitness = new Map(context.sigla.map((s) => [s.witnessId, s.siglum] as const));
  const conventions = apparatusConventionsOf(row.conventions);
  const segmentIds = [...collations.keys()];
  const adopted = new Set((await db.select().from(editionAdoptions).where(eq(editionAdoptions.editionId, editionId))).map((a) => a.conjectureId));
  // The work's published records are a commons every reader sees; drafts only those who may see them, in the editor (PLAN 4.10).
  const sees = await recordFilter(db, row.workId, audience);
  const conjectureRows = segmentIds.length
    ? (
        await db
          .select()
          .from(conjectures)
          .where(and(eq(conjectures.workId, row.workId), inArray(conjectures.segmentId, segmentIds), asOf ? lte(conjectures.createdAt, asOf) : undefined))
      ).filter(sees)
    : [];
  const reportedRows = segmentIds.length
    ? (
        await db
          .select()
          .from(reportedReadings)
          .where(and(eq(reportedReadings.workId, row.workId), inArray(reportedReadings.segmentId, segmentIds), asOf ? lte(reportedReadings.createdAt, asOf) : undefined))
      ).filter(sees)
    : [];
  const noteRows = await db
    .select({ id: notes.id, segmentId: notes.segmentId, tokenIds: notes.tokenIds, text: notes.text, author: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(and(eq(notes.editionId, editionId), asOf ? lte(notes.createdAt, asOf) : undefined));
  const texts = (map: Map<string, { text: string }[]>) => new Map([...map].map(([id, list]) => [id, list.map((c) => c.text)] as const));
  const noteCites = texts(await citationsByRecord(db, 'note', noteRows.map((n) => n.id)));
  const recordCites = new Map([
    ...texts(await citationsByRecord(db, 'conjecture', conjectureRows.map((c) => c.id))),
    ...texts(await citationsByRecord(db, 'reported', reportedRows.map((r) => r.id))),
  ]);
  const views: Record<string, SegmentView> = {};
  for (const [segmentId, collation] of collations) {
    const baseUnits = editionUnits(context.edition.content, segmentId);
    const candidates: AttachmentCandidate[] = [
      ...conjectureRows
        .filter((c) => c.segmentId === segmentId)
        .map((c) => {
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
      ...reportedRows
        .filter((r) => r.segmentId === segmentId)
        .map((r) => {
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
    // The places a conjecture or reported reading makes take the editor's kind too.
    const kinds = new Map([...(context.siteKinds.get(segmentId) ?? [])].map(([key, k]) => [key, k.kind] as const));
    attached.collation = applySiteKinds(attached.collation, baseUnits, kinds);
    const label = labelOf[segmentId] ?? segmentId;
    const siglaOrder = siglaOrderOf(context.sigla);
    const absent = collation.absent.map((id) => context.sigla.find((s) => s.transcriptionId === id)?.siglum ?? id);
    views[segmentId] = {
      segmentId,
      label,
      collation: attached.collation,
      baseUnits,
      entries: apparatusEntries(attached.collation, label, attached.bySite, conventions, siglaOrder),
      attachments: attached.bySite,
      unplaced: attached.unplaced,
      absent,
      notes: noteRows
        .filter((n) => n.segmentId === segmentId)
        .map((n) => ({ id: n.id, tokenIds: n.tokenIds, text: n.text, author: n.author, cites: noteCites.get(n.id) ?? [] })),
      drift: driftOf(context, baseUnits.flatMap((u) => u.tokenIds)),
      cites: Object.fromEntries(
        [...conjectureRows.filter((c) => c.segmentId === segmentId), ...reportedRows.filter((r) => r.segmentId === segmentId)]
          .filter((r) => recordCites.has(r.id))
          .map((r) => [r.id, recordCites.get(r.id)!] as const),
      ),
    };
  }
  const [work] = await db.select({ language: works.language }).from(works).where(eq(works.id, row.workId));
  if (work?.language === 'grc') await relateReadings(db, Object.values(views));
  return views;
}

/** The relations of the readings of textual places to the edition's words, from the analyser of Greek forms. */
async function relateReadings(db: Database, views: SegmentView[]): Promise<void> {
  const textual = views.flatMap((view) => view.collation.sites.filter((site) => site.kind === 'textual' && site.readings.length > 1).map((site) => ({ view, site })));
  const words = new Set<string>();
  for (const { site } of textual) for (const reading of site.readings) for (const w of reading.text.split(/\s+/u)) if (w) words.add(w);
  if (words.size === 0) return;
  const analysed = await analyseWords(db, [...words]);
  // Lemmas compared by their letters: the treebanks and Morpheus spell some differently, and number homographs.
  const lemmas = new Map(Object.entries(analysed).map(([w, list]) => [w, new Set(list.map((a) => looseKey(a.lemma)))] as const));
  for (const { view, site } of textual) {
    const base = site.readings.find((r) => r.base);
    if (!base) continue;
    const list = site.readings.map((reading) => (reading.base ? null : variantRelation(base.text, reading.text, (w) => lemmas.get(w))));
    if (list.some((x) => x !== null)) (view.relations ??= {})[site.index] = list;
  }
}

export type { EditionContext };
export { PUBLIC, recordFilter, type Audience } from './audience.ts';
