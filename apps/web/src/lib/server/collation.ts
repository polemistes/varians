/**
 * What the collation of an edition reads: its context (the edition's text,
 * the conspectus, the transcriptions, the editor's marks), and the words of
 * one segment from the edition's stream and from each transcription the
 * conspectus names, with the hashes the cache keeps results under. The
 * collation itself, in passages, is `passages.ts`.
 */

import {
  fold,
  unitFold,
  isObj,
  isToken,
  runsBySegment,
  segmentRuns,
  units,
  type Collation,
  type CollationState,
  type CollationText,
  type PassageInputs,
  type SegmentRun,
  type SiteKind,
  type Stream,
  type Unit,
} from '@varians/core';
import {
  editionSigla,
  editionSiteKinds,
  editions,
  segments,
  transcriptionSegments,
  transcriptions,
  witnesses,
  type Database,
  type WitnessHand,
} from '@varians/db';
import { collationStateOf, normalizeSiglum, stateTextId, type ConspectusEntry } from './sigla.ts';
import { loadEditionText, loadTranscriptions } from './loaded-streams.ts';
import type { Marks } from './site-marks.ts';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';

export interface EditionContext {
  edition: { id: string; workId: string; content: Stream; version: number };
  /** The conspectus in order: siglum, witness, transcription (null when only reported readings), and the states collated under sigla of their own. */
  sigla: ConspectusEntry[];
  /** The hands of the witnesses named, by witness id, for the states that name a hand. */
  witnessHands: Map<string, WitnessHand[]>;
  /** The transcriptions named by the conspectus, by id. */
  transcriptions: Map<string, { id: string; content: Stream; version: number; witnessId: string }>;
  /** The editor's word on some sites, their kind and whether they are minor: by segment, by site key. */
  siteKinds: Marks;
  /** The sort key of every segment of the work, by id. */
  segmentKeys?: Map<string, string>;
  /** How much of the work each transcription covers, by transcription id (B5). */
  coverage?: Map<string, Coverage>;
}

/**
 * The stretch of a work a transcription covers: from the first to the last
 * segment it has (by sort key), less the segments lost in it, those whose
 * keys lie between two segments the text has with a gap or a lacuna marked
 * between them.
 */
export interface Coverage {
  first: string;
  last: string;
  lost: Set<string>;
}

/** A transcription's coverage of a work whose segments have these sort keys; null when it has none of them. */
export function coverageOf(
  content: Stream,
  segmentKeys: ReadonlyMap<string, string>,
  /** The keys in order, when several transcriptions are asked of one work. */
  sortedKeys?: readonly (readonly [string, string])[],
): Coverage | null {
  let first: string | null = null;
  let last: string | null = null;
  const lost = new Set<string>();
  // The segment of the last word seen, and whether a gap or lacuna stands after it.
  let previous: string | null = null;
  let gapSince = false;
  const sorted = sortedKeys ?? sortedByKey(segmentKeys);
  for (const run of segmentRuns(content)) {
    for (let i = run.from; i < run.to; i++) {
      const item = content.items[i]!;
      if (isObj(item) && (item.type === 'gap' || item.type === 'lacuna')) {
        gapSince = true;
        continue;
      }
      if (!isToken(item) || run.segmentId === null) continue;
      const key = segmentKeys.get(run.segmentId);
      if (key === undefined) continue;
      if (first === null || key < first) first = key;
      if (last === null || key > last) last = key;
      if (previous !== null && previous !== run.segmentId && gapSince) {
        const a = segmentKeys.get(previous)!;
        const [low, high] = a < key ? [a, key] : [key, a];
        for (const [id, k] of sorted) if (k > low && k < high) lost.add(id);
      }
      if (previous !== run.segmentId || gapSince) gapSince = false;
      previous = run.segmentId;
    }
  }
  return first !== null && last !== null ? { first, last, lost } : null;
}

function sortedByKey(segmentKeys: ReadonlyMap<string, string>): [string, string][] {
  return [...segmentKeys.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

/** Load everything a collation of an edition needs, once. */
export async function loadEditionContext(db: Database, editionId: string): Promise<EditionContext> {
  const [[meta], text] = await Promise.all([
    db
      .select({ id: editions.id, workId: editions.workId })
      .from(editions)
      .where(eq(editions.id, editionId)),
    loadEditionText(db, editionId),
  ]);
  if (!meta || !text) throw new Error(`no edition ${editionId}`);
  const row = { ...meta, ...text };
  const sigla = await db
    .select({
      siglum: editionSigla.siglum,
      witnessId: editionSigla.witnessId,
      transcriptionId: editionSigla.transcriptionId,
      states: editionSigla.states,
      variantSiglum: editionSigla.variantSiglum,
      position: editionSigla.position,
    })
    .from(editionSigla)
    .where(eq(editionSigla.editionId, editionId))
    .orderBy(editionSigla.position);
  const transcriptionIds = sigla
    .map((s) => s.transcriptionId)
    .filter((id): id is string => id !== null);
  // What the rest needs is asked at once.
  const [rows, keyRows, witnessHands, siteKinds] = await Promise.all([
    loadTranscriptions(db, transcriptionIds),
    db
      .select({ id: segments.id, sortKey: segments.sortKey })
      .from(segments)
      .where(eq(segments.workId, row.workId)),
    loadWitnessHands(
      db,
      sigla.map((s) => s.witnessId),
    ),
    siteKindsOf(db, editionId),
  ]);
  const segmentKeys = new Map(keyRows.map((r) => [r.id, r.sortKey] as const));
  // Which stretch each transcription covers is worked out when a collation first asks (a witness lacking a segment).
  let coverage: Map<string, Coverage> | undefined;
  return {
    edition: { id: row.id, workId: row.workId, content: row.content, version: row.version },
    segmentKeys,
    get coverage() {
      if (!coverage) {
        coverage = new Map();
        const sorted = sortedByKey(segmentKeys);
        for (const r of rows) {
          const found = coverageOf(r.content, segmentKeys, sorted);
          if (found) coverage.set(r.id, found);
        }
      }
      return coverage;
    },
    sigla: sigla.map(normalizeSiglum),
    witnessHands,
    transcriptions: new Map(rows.map((r) => [r.id, r] as const)),
    siteKinds,
  };
}

/** The hands of some witnesses, by witness id. */
export async function loadWitnessHands(
  db: Database,
  witnessIds: string[],
): Promise<Map<string, WitnessHand[]>> {
  const ids = [...new Set(witnessIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: witnesses.id, hands: witnesses.hands })
    .from(witnesses)
    .where(inArray(witnesses.id, ids));
  return new Map(rows.map((r) => [r.id, r.hands] as const));
}

/** The kinds the editors have given an edition's sites and the sites they judge minor, by segment and site key. */
export async function siteKindsOf(
  db: Database,
  editionId: string,
): Promise<EditionContext['siteKinds']> {
  const rows = await db
    .select({
      segmentId: editionSiteKinds.segmentId,
      siteKey: editionSiteKinds.siteKey,
      kind: editionSiteKinds.kind,
      minor: editionSiteKinds.minor,
      setAt: editionSiteKinds.setAt,
    })
    .from(editionSiteKinds)
    .where(eq(editionSiteKinds.editionId, editionId));
  const out: EditionContext['siteKinds'] = new Map();
  for (const r of rows) {
    const bySite = out.get(r.segmentId) ?? new Map();
    bySite.set(r.siteKey, {
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.minor ? { minor: true } : {}),
      setAt: r.setAt,
    });
    out.set(r.segmentId, bySite);
  }
  return out;
}

/**
 * Change the editor's word on a site. The kind (null: back to what the
 * letters say) and whether the site is minor are separate words: one that
 * the change leaves out stays as it is. A site keeps its row while either
 * word is said, and loses it when neither is.
 */
export async function setSiteMark(
  db: Database,
  editionId: string,
  segmentId: string,
  siteKey: string,
  change: { kind?: SiteKind | null; minor?: boolean },
  userId: string | null,
): Promise<void> {
  const where = and(
    eq(editionSiteKinds.editionId, editionId),
    eq(editionSiteKinds.segmentId, segmentId),
    eq(editionSiteKinds.siteKey, siteKey),
  );
  const said = {
    ...(change.kind !== undefined ? { kind: change.kind } : {}),
    ...(change.minor !== undefined ? { minor: change.minor } : {}),
  };
  if (Object.keys(said).length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(editionSiteKinds)
      .values({ editionId, segmentId, siteKey, ...said, setBy: userId })
      .onConflictDoUpdate({
        target: [editionSiteKinds.editionId, editionSiteKinds.segmentId, editionSiteKinds.siteKey],
        set: { ...said, setBy: userId, setAt: new Date() },
      });
    await tx
      .delete(editionSiteKinds)
      .where(and(where, isNull(editionSiteKinds.kind), eq(editionSiteKinds.minor, false)));
  });
}

/** Set (or, with null, clear) the editor's word on the kind of a site; whether it is minor is left as it is. */
export function setSiteKind(
  db: Database,
  editionId: string,
  segmentId: string,
  siteKey: string,
  kind: SiteKind | null,
  userId: string | null,
): Promise<void> {
  return setSiteMark(db, editionId, segmentId, siteKey, { kind }, userId);
}

/** Mark a site minor, or not; its kind is left as it is. */
export function setSiteMinor(
  db: Database,
  editionId: string,
  segmentId: string,
  siteKey: string,
  minor: boolean,
  userId: string | null,
): Promise<void> {
  return setSiteMark(db, editionId, segmentId, siteKey, { minor }, userId);
}

/**
 * The runs of a stream by segment, found once for each stream: a stream is
 * not changed once it is loaded (an edit makes a new one), and a collation
 * of the whole edition asks for the runs of every segment in every witness.
 */
const runIndexes = new WeakMap<Stream, Map<string, SegmentRun[]>>();

function runIndexOf(stream: Stream): Map<string, SegmentRun[]> {
  let index = runIndexes.get(stream);
  if (!index) {
    index = runsBySegment(stream);
    runIndexes.set(stream, index);
  }
  return index;
}

/** The runs of one segment of a stream, in content order. */
export function runsOf(stream: Stream, segmentId: string): SegmentRun[] {
  return runIndexOf(stream).get(segmentId) ?? [];
}

/** The ids of the segments a stream assigns text to, in order of first appearance. */
export function segmentOrderOf(stream: Stream): string[] {
  return [...runIndexOf(stream).keys()];
}

/**
 * A segment of the work that some witness of the conspectus has and the
 * edition's text does not, and where it stands: after the edition's segment
 * that precedes it in the work's numbering.
 */
export interface Unprinted {
  segmentId: string;
  after: string;
}

const unprintedOf = new WeakMap<EditionContext, { content: Stream; list: Unprinted[] }>();

/**
 * The segments the edition does not print and some transcription of the
 * conspectus has words for, within the stretch of the work the edition has
 * (between its first and its last segment by sort key, so that an edition
 * of one book reports nothing of another), in the order of the work. Found
 * from the runs of the texts the context holds, which a collation finds
 * anyway, and which for a published version are the texts of its basis.
 */
export function unprintedSegments(context: EditionContext): Unprinted[] {
  const known = unprintedOf.get(context);
  if (known && known.content === context.edition.content) return known.list;
  const keys = context.segmentKeys;
  const list: Unprinted[] = [];
  if (keys) {
    const printed = new Set(segmentOrderOf(context.edition.content));
    const printedKeys = [...printed]
      .map((id) => [keys.get(id), id] as const)
      .filter((pair): pair is readonly [string, string] => pair[0] !== undefined)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (printedKeys.length >= 2) {
      const first = printedKeys[0]![0];
      const last = printedKeys[printedKeys.length - 1]![0];
      const found = new Map<string, string>();
      for (const s of context.sigla) {
        const transcription = s.transcriptionId
          ? context.transcriptions.get(s.transcriptionId)
          : undefined;
        if (!transcription) continue;
        for (const [segmentId, runs] of runIndexOf(transcription.content)) {
          if (printed.has(segmentId) || found.has(segmentId)) continue;
          const key = keys.get(segmentId);
          if (key === undefined || key <= first || key >= last) continue;
          const content = transcription.content;
          const hasWords = runs.some((run) => {
            for (let i = run.from; i < run.to; i++) if (isToken(content.items[i]!)) return true;
            return false;
          });
          if (hasWords) found.set(segmentId, key);
        }
      }
      for (const [segmentId, key] of [...found].sort((a, b) =>
        a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
      )) {
        // The edition's segment with the greatest key below this one's.
        let lo = 0;
        let hi = printedKeys.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (printedKeys[mid]![0] < key) lo = mid;
          else hi = mid - 1;
        }
        list.push({ segmentId, after: printedKeys[lo]![1] });
      }
    }
  }
  unprintedOf.set(context, { content: context.edition.content, list });
  return list;
}

/** The edition's segments in its order with the segments it does not print set after the ones they follow. */
export function withUnprinted(
  editionOrder: readonly string[],
  unprinted: readonly Unprinted[],
): string[] {
  if (unprinted.length === 0) return [...editionOrder];
  const following = new Map<string, string[]>();
  for (const u of unprinted) {
    const list = following.get(u.after);
    if (list) list.push(u.segmentId);
    else following.set(u.after, [u.segmentId]);
  }
  return editionOrder.flatMap((id) => [id, ...(following.get(id) ?? [])]);
}

/** The edition's collation units for a segment: every run in content order. */
export function editionUnits(content: Stream, segmentId: string): Unit[] {
  const out: Unit[] = [];
  for (const run of runsOf(content, segmentId)) out.push(...units(content, run.from, run.to));
  return out;
}

/**
 * A text of one segment as collation may take it: a witness's corrected
 * text, or a further state of it (one collated under a siglum of its own,
 * or the variants it notes) with whether it differs there from the
 * corrected text.
 */
export interface SegmentText extends CollationText {
  /** A further state of a witness: given only where it differs, in this segment or (in a passage) in another. */
  state?: { differs: boolean };
}

/**
 * Every text of one segment: the edition's and each witness's, every
 * further state of a witness included, in the order of the conspectus. A
 * segment the edition does not print (`unprinted`) has no words of the
 * edition, and its witnesses are those that have it.
 */
export function segmentTexts(
  context: EditionContext,
  segmentId: string,
  unprinted = false,
): { base: CollationText; texts: SegmentText[] } {
  const base: CollationText = {
    id: context.edition.id,
    siglum: 'ed.',
    units: unprinted ? [] : editionUnits(context.edition.content, segmentId),
  };
  const texts: SegmentText[] = [];
  for (const s of context.sigla) {
    if (!s.transcriptionId) continue;
    const transcription = context.transcriptions.get(s.transcriptionId);
    if (!transcription) continue;
    const runs = runsOf(transcription.content, segmentId);
    const hands = context.witnessHands.get(s.witnessId) ?? [];
    const readIn = (state: CollationState) => {
      const out: Unit[] = [];
      for (const run of runs) out.push(...units(transcription.content, run.from, run.to, state));
      return out;
    };
    const further: { id: string; siglum: string; state: CollationState }[] = [
      ...s.states.map((state, k) => ({
        id: stateTextId(transcription.id, k),
        siglum: state.siglum,
        state: collationStateOf(state, hands),
      })),
      // The variants the manuscript notes in its margins or between its lines, read in place of the words they concern.
      ...(s.variantSiglum
        ? [
            {
              id: `${transcription.id}:variant`,
              siglum: s.variantSiglum,
              state: 'variant' as const,
            },
          ]
        : []),
    ];
    if (runs.length > 0) {
      const words = readIn('corrected');
      texts.push({ id: transcription.id, siglum: s.siglum, units: words, present: true });
      // A further state of the witness is only worth a siglum of its own where it differs from the corrected text.
      const differs = (other: Unit[]) =>
        other.length !== words.length || other.some((u, i) => u.text !== words[i]!.text);
      for (const f of further) {
        const text = readIn(f.state);
        // Without `present`: a state that has none of the segment's words has no text of it.
        texts.push({ id: f.id, siglum: f.siglum, units: text, state: { differs: differs(text) } });
      }
      continue;
    }
    // A segment the edition does not print concerns only the witnesses that have it.
    if (unprinted) continue;
    // Without the segment: within the stretch it covers, its text runs on without it, unless a gap
    // stands there (of whatever reason, a stretch not transcribed included); outside, or where it
    // has lost the segment, the witness is not there and stands in no variant.
    const key = context.segmentKeys?.get(segmentId);
    const covered = context.coverage?.get(transcription.id);
    const runsOn =
      key !== undefined &&
      covered !== undefined &&
      key > covered.first &&
      key < covered.last &&
      !covered.lost.has(segmentId);
    const without = { units: [], ...(runsOn ? { present: true } : {}) };
    texts.push({ id: transcription.id, siglum: s.siglum, ...without });
    for (const f of further)
      texts.push({ id: f.id, siglum: f.siglum, ...without, state: { differs: false } });
  }
  return { base, texts };
}

/** The texts as collation is given them: a further state of a witness where `keep` says so, and nothing of the bookkeeping. */
export function collationTexts(
  texts: readonly SegmentText[],
  keep: (text: SegmentText) => boolean = (text) => text.state?.differs === true,
): CollationText[] {
  const out: CollationText[] = [];
  for (const { state, ...text } of texts) {
    if (state && !keep({ ...text, state })) continue;
    out.push(text);
  }
  return out;
}

/** The collation inputs of one segment collated alone: base and witnesses. */
export function inputsFor(
  context: EditionContext,
  segmentId: string,
): { base: CollationText; witnesses: CollationText[] } {
  const { base, texts } = segmentTexts(context, segmentId);
  return { base, witnesses: collationTexts(texts) };
}

/** The shape of the cached results: bump when the collation's output changes. */
export const COLLATION_VERSION = 'collation-v16';

/** A text as the hashes describe it: everything collation reads of it. */
function describeText(t: CollationText): string {
  const away = (t.notThere ?? []).map((r) => `${r.from}-${r.to}`).join(',');
  return `${t.id}|${t.siglum}|${t.present ? 'p' : ''}|${away}|${t.units.map((u) => (u.gap ? '[gap]' : `${u.text}:${u.lang ?? ''}#${u.tokenIds.join(',')}@${u.segmentId ?? ''}`)).join(' ')}`;
}

/**
 * What the hashes say of the fold: every word is folded by its own language,
 * which the description of each text gives. A fixed string, so that no row
 * cached when one fold served the whole edition is read against this one.
 */
const FOLD_KEY = 'fold-by-language';

/** A hash of everything a segment's collation reads. */
export function inputHash(
  context: EditionContext,
  base: CollationText,
  witnesses: CollationText[],
): string {
  void context;
  const hash = createHash('sha256');
  hash.update(COLLATION_VERSION);
  hash.update(FOLD_KEY);
  hash.update(describeText(base));
  for (const w of witnesses) hash.update('\n' + describeText(w));
  return hash.digest('hex').slice(0, 32);
}

/** A hash of everything a passage's collation reads: its segments, where each begins, and every text over them. */
export function passageHash(context: EditionContext, inputs: PassageInputs): string {
  const hash = createHash('sha256');
  void context;
  hash.update(`${COLLATION_VERSION}:passage`);
  hash.update(FOLD_KEY);
  hash.update(
    inputs.segments.map((s) => `${s.segmentId}:${s.from}-${s.to}${s.printed ? '' : 'u'}`).join(','),
  );
  hash.update(`|${inputs.segmentStarts.join(',')}`);
  hash.update('\n' + describeText(inputs.base));
  for (const w of inputs.witnesses) hash.update('\n' + describeText(w));
  return hash.digest('hex').slice(0, 32);
}

/** Maps cannot be stored as JSON; columns are serialized as arrays of [textId, cell] pairs. */
export function serializeCollation(collation: Collation): unknown {
  return {
    ...collation,
    columns: collation.columns.map((c) => ({ cells: [...c.cells.entries()] })),
  };
}

export function reviveCollation(raw: unknown): Collation {
  const data = raw as Omit<Collation, 'columns'> & {
    columns: { cells: [string, { unitIndex: number; lacunose?: boolean }][] }[];
  };
  return { ...data, columns: data.columns.map((c) => ({ cells: new Map(c.cells) })) };
}

/** Which witnesses of a work have which segments: the coverage shown on the work page. */
export async function coverage(
  db: Database,
  workId: string,
): Promise<{ segmentId: string; label: string; sortKey: string; transcriptionIds: string[] }[]> {
  const rows = await db
    .select({ segmentId: segments.id, label: segments.label, sortKey: segments.sortKey })
    .from(segments)
    .where(eq(segments.workId, workId))
    .orderBy(segments.sortKey);
  const has = await db
    .select({
      segmentId: transcriptionSegments.segmentId,
      transcriptionId: transcriptionSegments.transcriptionId,
    })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId));
  const bySegment = new Map<string, Set<string>>();
  for (const h of has) {
    const set = bySegment.get(h.segmentId) ?? new Set<string>();
    set.add(h.transcriptionId);
    bySegment.set(h.segmentId, set);
  }
  return rows.map((r) => ({ ...r, transcriptionIds: [...(bySegment.get(r.segmentId) ?? [])] }));
}

/** The fold text of a transcription's segment, for quick comparisons and search: each word by its own language. */
export function foldOf(unitsOf: Unit[]): string {
  return unitsOf.map((u) => (u.gap ? '[...]' : fold(u.text, unitFold(u.lang)))).join(' ');
}

export { witnesses };
