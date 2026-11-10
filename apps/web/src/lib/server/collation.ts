/**
 * Collation of an edition's segments against the witnesses of its conspectus.
 *
 * Gathers the words of one segment from the edition's stream and from each
 * transcription the conspectus names, runs the core's collate, and caches
 * the result under a hash of its inputs.
 */

import {
  applySiteKinds,
  collate,
  fold,
  isObj,
  isToken,
  runsBySegment,
  segmentRuns,
  units,
  type Collation,
  type CollationText,
  type NormalizationProfile,
  type SegmentRun,
  type SiteKind,
  type Stream,
  type Unit,
} from '@varians/core';
import {
  collationCache,
  editionSigla,
  editionSiteKinds,
  editions,
  segments,
  transcriptionSegments,
  transcriptions,
  witnesses,
  works,
  type Database,
  type WitnessHand,
} from '@varians/db';
import { collationStateOf, normalizeSiglum, stateTextId, type ConspectusEntry } from './sigla.ts';
import { loadEditionText, loadTranscriptions } from './loaded-streams.ts';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

export interface EditionContext {
  edition: { id: string; workId: string; content: Stream; version: number };
  profile: NormalizationProfile;
  /** The conspectus in order: siglum, witness, transcription (null when only reported readings), and the states collated under sigla of their own. */
  sigla: ConspectusEntry[];
  /** The hands of the witnesses named, by witness id, for the states that name a hand. */
  witnessHands: Map<string, WitnessHand[]>;
  /** The transcriptions named by the conspectus, by id. */
  transcriptions: Map<string, { id: string; content: Stream; version: number; witnessId: string }>;
  /** The editor's word on the kind of some sites: by segment, by site key. */
  siteKinds: Map<string, Map<string, { kind: SiteKind; setAt: Date }>>;
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

/** A unit standing for a passage lost in a witness. */
function lostUnit(segmentId: string): Unit {
  return { text: '', tokenIds: [], gap: { kind: 'object', id: `lost:${segmentId}`, type: 'gap' } };
}

/** Load everything a collation of an edition needs, once. */
export async function loadEditionContext(db: Database, editionId: string): Promise<EditionContext> {
  const [[meta], text] = await Promise.all([
    db
      .select({ id: editions.id, workId: editions.workId, profile: works.profile })
      .from(editions)
      .innerJoin(works, eq(works.id, editions.workId))
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
    profile: row.profile,
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

/** The kinds the editors have set on an edition's sites, by segment and site key. */
export async function siteKindsOf(
  db: Database,
  editionId: string,
): Promise<EditionContext['siteKinds']> {
  const rows = await db
    .select({
      segmentId: editionSiteKinds.segmentId,
      siteKey: editionSiteKinds.siteKey,
      kind: editionSiteKinds.kind,
      setAt: editionSiteKinds.setAt,
    })
    .from(editionSiteKinds)
    .where(eq(editionSiteKinds.editionId, editionId));
  const out: EditionContext['siteKinds'] = new Map();
  for (const r of rows) {
    const bySite = out.get(r.segmentId) ?? new Map();
    bySite.set(r.siteKey, { kind: r.kind, setAt: r.setAt });
    out.set(r.segmentId, bySite);
  }
  return out;
}

/** Set (or, with null, clear) the editor's word on the kind of a site. */
export async function setSiteKind(
  db: Database,
  editionId: string,
  segmentId: string,
  siteKey: string,
  kind: SiteKind | null,
  userId: string | null,
): Promise<void> {
  const where = and(
    eq(editionSiteKinds.editionId, editionId),
    eq(editionSiteKinds.segmentId, segmentId),
    eq(editionSiteKinds.siteKey, siteKey),
  );
  if (kind === null) {
    await db.delete(editionSiteKinds).where(where);
    return;
  }
  await db
    .insert(editionSiteKinds)
    .values({ editionId, segmentId, siteKey, kind, setBy: userId })
    .onConflictDoUpdate({
      target: [editionSiteKinds.editionId, editionSiteKinds.segmentId, editionSiteKinds.siteKey],
      set: { kind, setBy: userId, setAt: new Date() },
    });
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

/** The edition's collation units for a segment: every run in content order. */
export function editionUnits(content: Stream, segmentId: string): Unit[] {
  const out: Unit[] = [];
  for (const run of runsOf(content, segmentId)) out.push(...units(content, run.from, run.to));
  return out;
}

/** The collation inputs of one segment: base and witnesses. */
export function inputsFor(
  context: EditionContext,
  segmentId: string,
): { base: CollationText; witnesses: CollationText[] } {
  const base: CollationText = {
    id: context.edition.id,
    siglum: 'ed.',
    units: editionUnits(context.edition.content, segmentId),
  };
  const witnessTexts: CollationText[] = [];
  for (const s of context.sigla) {
    if (!s.transcriptionId) continue;
    const transcription = context.transcriptions.get(s.transcriptionId);
    if (!transcription) continue;
    const runs = runsOf(transcription.content, segmentId);
    const words: Unit[] = [];
    for (const run of runs)
      words.push(...units(transcription.content, run.from, run.to, 'corrected'));
    if (runs.length > 0) {
      witnessTexts.push({ id: transcription.id, siglum: s.siglum, units: words, present: true });
    } else {
      // Without the segment: within the stretch it covers the witness omits it, or has lost it; outside, it is absent.
      const key = context.segmentKeys?.get(segmentId);
      const covered = context.coverage?.get(transcription.id);
      if (key !== undefined && covered && key > covered.first && key < covered.last) {
        if (covered.lost.has(segmentId))
          witnessTexts.push({
            id: transcription.id,
            siglum: s.siglum,
            units: [lostUnit(segmentId)],
          });
        else
          witnessTexts.push({ id: transcription.id, siglum: s.siglum, units: [], present: true });
      } else witnessTexts.push({ id: transcription.id, siglum: s.siglum, units: [] });
      continue;
    }
    // A second state of the witness is only worth a siglum of its own where it differs from the corrected text.
    const differs = (other: Unit[]) =>
      other.length !== words.length || other.some((u, i) => u.text !== words[i]!.text);
    const hands = context.witnessHands.get(s.witnessId) ?? [];
    s.states.forEach((state, k) => {
      const text: Unit[] = [];
      const which = collationStateOf(state, hands);
      for (const run of runs) text.push(...units(transcription.content, run.from, run.to, which));
      if (differs(text))
        witnessTexts.push({
          id: stateTextId(transcription.id, k),
          siglum: state.siglum,
          units: text,
        });
    });
    if (s.variantSiglum) {
      // The variants the manuscript notes in its margins or between its lines, read in place of the words they concern.
      const variant: Unit[] = [];
      for (const run of runs)
        variant.push(...units(transcription.content, run.from, run.to, 'variant'));
      if (differs(variant))
        witnessTexts.push({
          id: `${transcription.id}:variant`,
          siglum: s.variantSiglum,
          units: variant,
        });
    }
  }
  return { base, witnesses: witnessTexts };
}

/** A hash of everything a segment's collation reads. */
export function inputHash(
  context: EditionContext,
  base: CollationText,
  witnesses: CollationText[],
): string {
  const hash = createHash('sha256');
  // The shape of the cached result: bump when the collation's output changes.
  hash.update('collation-v11');
  hash.update(JSON.stringify(context.profile.fold));
  const describe = (t: CollationText) =>
    `${t.id}|${t.siglum}|${t.present ? 'p' : ''}|${t.units.map((u) => (u.gap ? '[gap]' : `${u.text}#${u.tokenIds.join(',')}`)).join(' ')}`;
  hash.update(describe(base));
  for (const w of witnesses) hash.update('\n' + describe(w));
  return hash.digest('hex').slice(0, 32);
}

/** How many cache rows one statement reads, and how many collations are written at a time. */
const CACHE_READ = 1000;
const CACHE_WRITE = 25;

/**
 * Collate some segments of an edition, from the cache where the inputs are
 * unchanged: the cache is read in one go, what it lacks is collated and
 * written back in one go. The result is in the order asked.
 */
export async function collateSegments(
  db: Database,
  context: EditionContext,
  segmentIds: string[],
): Promise<Map<string, Collation>> {
  const wanted = [...new Set(segmentIds)];
  const gathered = wanted.map((segmentId) => {
    const { base, witnesses: witnessTexts } = inputsFor(context, segmentId);
    return { segmentId, base, witnessTexts, hash: inputHash(context, base, witnessTexts) };
  });
  const cached = new Map<string, { inputHash: string; result: unknown }>();
  for (let i = 0; i < gathered.length; i += CACHE_READ) {
    const rows = await db
      .select({
        segmentId: collationCache.segmentId,
        inputHash: collationCache.inputHash,
        result: collationCache.result,
      })
      .from(collationCache)
      .where(
        and(
          eq(collationCache.editionId, context.edition.id),
          inArray(
            collationCache.segmentId,
            gathered.slice(i, i + CACHE_READ).map((g) => g.segmentId),
          ),
        ),
      );
    for (const row of rows) cached.set(row.segmentId, row);
  }
  const results = new Map<string, Collation>();
  let fresh: { segmentId: string; hash: string; result: Collation }[] = [];
  /** Write what has been collated: the wait lets other requests run between the stretches of collating. */
  const write = async () => {
    if (fresh.length === 0) return;
    const rows = fresh.map((f) => ({
      editionId: context.edition.id,
      segmentId: f.segmentId,
      inputHash: f.hash,
      result: serializeCollation(f.result),
    }));
    fresh = [];
    await db
      .insert(collationCache)
      .values(rows)
      .onConflictDoUpdate({
        target: [collationCache.editionId, collationCache.segmentId],
        set: {
          inputHash: sql`excluded.input_hash`,
          result: sql`excluded.result`,
          computedAt: new Date(),
        },
      });
  };
  for (const { segmentId, base, witnessTexts, hash } of gathered) {
    const hit = cached.get(segmentId);
    if (hit && hit.inputHash === hash) {
      results.set(segmentId, reviveCollation(hit.result));
      continue;
    }
    const result = collate(base, witnessTexts, { fold: context.profile.fold });
    fresh.push({ segmentId, hash, result });
    results.set(segmentId, result);
    if (fresh.length >= CACHE_WRITE) await write();
  }
  await write();
  // The editor's kinds are put over the cached result, so that setting one does not collate again.
  const out = new Map<string, Collation>();
  for (const { segmentId, base } of gathered) {
    const kinds = new Map(
      [...(context.siteKinds.get(segmentId) ?? [])].map(([key, k]) => [key, k.kind] as const),
    );
    out.set(segmentId, applySiteKinds(results.get(segmentId)!, base.units, kinds));
  }
  return out;
}

/** Collate one segment of an edition, from the cache when the inputs are unchanged. */
export async function collateSegment(
  db: Database,
  context: EditionContext,
  segmentId: string,
): Promise<Collation> {
  return (await collateSegments(db, context, [segmentId])).get(segmentId)!;
}

/** Collate every segment the edition has, in the edition's order. */
export async function collateEdition(
  db: Database,
  context: EditionContext,
): Promise<Map<string, Collation>> {
  return collateSegments(db, context, segmentOrderOf(context.edition.content));
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

/** The fold text of a transcription's segment, for quick comparisons and search. */
export function foldOf(profile: NormalizationProfile, unitsOf: Unit[]): string {
  return unitsOf.map((u) => (u.gap ? '[...]' : fold(u.text, profile.fold))).join(' ');
}

export { witnesses };
