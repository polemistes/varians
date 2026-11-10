/**
 * A stress edition in the database: the work, its second work for the
 * scholia, a few dozen witnesses with hands and pages, a transcript of each
 * with its history, conjectures, reported readings, the bibliography, and one
 * edition with the editors' work done on it. The text comes from
 * stress-text.ts; everything that is not a registry row is written through
 * the services the application itself uses, so that changesets, the segment
 * index and the archive queue are as the application makes them.
 */

import {
  SCHEME_PRESETS,
  adoptReading,
  archetypeLetters,
  attachToSites,
  defaultProfile,
  isToken,
  newId,
  runsOfSegment,
  segmentRuns,
  siteKey,
  similarity,
  type AttachmentCandidate,
  type Collation,
  type Id,
  type Item,
  type Op,
  type Reading,
  type Site,
  type Stream,
  type Token,
  type Unit,
} from '@varians/core';
import {
  bibliographyItems,
  changesets,
  checkpoints,
  editionCollaborators,
  editionSigla,
  editions,
  moments,
  pages,
  referenceSchemes,
  reviewState,
  sql,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  type Database,
  type SiglumState,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { opsForAttachment, type SegmentForAdoption } from '../../edition/adopt-client.ts';
import { claimTypedWords, moveLinesOps } from '../../edition/workspace.ts';
import { setCitations } from '../bibliography.ts';
import {
  collateSegment,
  editionUnits,
  loadEditionContext,
  setSiteKind,
  type EditionContext,
} from '../collation.ts';
import { addCollaborator } from '../collaborators.ts';
import {
  adoptConjecture as recordAdoption,
  registerConjecture,
  reportReading,
  reviewSite,
} from '../conjectures.ts';
import { nameMoment, replaceContent, saveOps } from '../documents/service.ts';
import { createEdition, setSigla } from '../editions.ts';
import { setReviewFrom } from '../history.ts';
import { addNote } from '../notes.ts';
import { publishEdition } from '../publish.ts';
import { resolveLabels, schemeOfWork } from '../segments.ts';
import { setChosenWorks } from '../transcription-works.ts';
import { DEFAULT_CONVENTIONS } from './sample.ts';
import {
  generateStress,
  makeRandom,
  type Random,
  type StressConjecture,
  type StressItem,
  type StressOptions,
  type StressText,
  type StressWitness,
} from './stress-text.ts';

export const STRESS_SLUG = 'stress';
export const STRESS_IDENTIFIER = 'urn:cts:greekLit:tlg9999.tlg001';
export const STRESS_SCHOLIA_IDENTIFIER = 'urn:cts:greekLit:tlg9999.tlg002';

/** The share of the places where the edition's base stands alone at which the editors take the reading of the majority. */
export const MAJORITY_SHARE = 0.7;
/** Most lines the editors work on between two saves; fewer in a short work, so that it has several saves. */
const MAX_BLOCK_LINES = 50;
/** Changesets of a text's first writing: a handful. */
const FIRST_WRITING_CHANGESETS = 4;
/** Transcripts that get many small changesets, and how many words are touched in each (three changesets a word). */
const LONG_HISTORIES = 3;
const LONG_HISTORY_WORDS = 100;

export interface StressSeedOptions extends StressOptions {
  /** The work's slug; the witnesses, schemes and edition take their names from it. */
  slug?: string;
  /** Changesets in each of the transcripts with a long history; 300 by default. */
  longHistory?: number;
  /** Where to say what is being done; nothing is printed when absent. */
  log?: (message: string) => void;
}

export interface StressSeedResult {
  workId: string;
  scholiaWorkId: string | null;
  slug: string;
  editionId: string;
  editionSlug: string;
  collaboratorId: string | null;
  /** Witness ids by key (ms01, pap1, rep1). */
  witnessIds: Record<string, string>;
  /** Transcript ids by witness key; none for the witness only reported. */
  transcriptionIds: Record<string, string>;
  /** The transcripts that were given a long history. */
  longHistories: string[];
  /** What the editors did, in numbers; empty when the work existed already. */
  done: Record<string, number>;
  /** Seconds each stage took. */
  seconds: Record<string, number>;
  /** Whether the work was there already and nothing was written. */
  existed: boolean;
}

/** Refuse the owner's development database, whichever way it was reached. */
export async function refuseDevelopmentDatabase(db: Database): Promise<string> {
  const result = await db.execute(sql`select current_database() as name`);
  const name = String((result.rows[0] as { name: string }).name);
  if (name === 'varians_dev') throw new Error('this tool never works in varians_dev');
  return name;
}

// The stream of a witness

interface StreamPlan {
  stream: Stream;
  /** Where each entry begins in the items, with one more at the end. */
  starts: number[];
  tokens: number;
}

/** The items of a witness's text as a stream with the shape its pages need, and where each entry begins. */
export function streamOf(
  witness: StressWitness,
  segmentIdOf: (work: 'main' | 'scholia', number: number) => string,
  pageIds: readonly string[],
): StreamPlan {
  const items: Item[] = [];
  const starts: number[] = [];
  let page: number | null = null;
  let tokens = 0;
  witness.entries.forEach((entry, index) => {
    starts.push(items.length);
    const on = witness.pageOf[index] ?? null;
    if (on !== null && on !== page) {
      items.push({ kind: 'break', id: newId(), type: 'page', pageId: pageIds[on]! });
      page = on;
    } else if (items.length > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
    if (entry.kind === 'lost') {
      items.push({
        kind: 'object',
        id: newId(),
        type: 'gap',
        attrs: { reason: 'lost', quantity: entry.lines, unit: 'line' },
        segment: { segmentId: null },
      });
      return;
    }
    const first = items.length;
    for (const item of entry.items) items.push(itemOf(item));
    tokens += entry.items.filter((i) => i.kind === 'word').length;
    // The first thing of the line, a word or a gap at its start, begins the segment.
    const head = items[first];
    if (head && (head.kind === 'token' || head.kind === 'object'))
      head.segment = { segmentId: segmentIdOf(entry.work, entry.number) };
  });
  starts.push(items.length);
  return { stream: { items }, starts, tokens };
}

function itemOf(item: StressItem): Item {
  switch (item.kind) {
    case 'word': {
      const token: Token = { kind: 'token', id: newId(), form: item.form };
      if (item.norm !== undefined) token.norm = item.norm;
      if (item.marks?.length) token.marks = item.marks.map((m) => ({ ...m }));
      return token;
    }
    case 'gap':
      return { kind: 'object', id: newId(), type: 'gap', attrs: { ...item.attrs } };
    case 'object': {
      const object: Item = { kind: 'object', id: newId(), type: item.type };
      if (item.attrs) object.attrs = { ...item.attrs };
      if (item.text !== undefined) object.text = item.text;
      return object;
    }
  }
}

/** The tokens of a line of an edition or a transcript, in order. */
function tokensOf(stream: Stream, segmentId: string): Token[] {
  const out: Token[] = [];
  for (const run of runsOfSegment(stream, segmentId))
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (isToken(item)) out.push(item);
    }
  return out;
}

// The seeder

interface Seeding {
  db: Database;
  slug: string;
  ownerId: string;
  collaboratorId: string | null;
  text: StressText;
  rng: Random;
  log: (message: string) => void;
  workId: string;
  /** The work of the scholia, when some witness carries them. */
  scholiaWorkId: string | null;
  segmentOf: Map<number, string>;
  scholiaSegmentOf: Map<number, string>;
  witnessId: Map<string, string>;
  transcriptionId: Map<string, string>;
  pageIds: Map<string, string[]>;
  bibliographyId: Map<number, string>;
  done: Record<string, number>;
  seconds: Record<string, number>;
}

const count = (s: Seeding, what: string, n = 1) => (s.done[what] = (s.done[what] ?? 0) + n);

async function timed<T>(s: Seeding, stage: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    s.seconds[stage] = Math.round((performance.now() - start) / 100) / 10;
    s.log(`${stage}: ${s.seconds[stage]} s`);
  }
}

/** Seed the stress edition, owned by the given user. Idempotent by the work's slug. */
export async function seedStress(
  db: Database,
  ownerId: string,
  options: StressSeedOptions = {},
): Promise<StressSeedResult> {
  await refuseDevelopmentDatabase(db);
  const slug = options.slug ?? STRESS_SLUG;
  const existing = await db.select({ id: works.id }).from(works).where(eq(works.slug, slug));
  if (existing.length) return describeExisting(db, slug, existing[0]!.id);

  const text = generateStress(options);
  const s: Seeding = {
    db,
    slug,
    ownerId,
    collaboratorId: null,
    text,
    rng: makeRandom(text.seed ^ 0x5eed),
    log: options.log ?? (() => {}),
    workId: newId(),
    scholiaWorkId: null,
    segmentOf: new Map(),
    scholiaSegmentOf: new Map(),
    witnessId: new Map(),
    transcriptionId: new Map(),
    pageIds: new Map(),
    bibliographyId: new Map(),
    done: {},
    seconds: {},
  };

  const scholiaWorkId = await timed(s, 'work and segments', () => makeWorks(s, slug));
  await timed(s, 'witnesses and pages', () => makeWitnesses(s, slug));
  const longHistories = await timed(s, 'transcripts and histories', () =>
    makeTranscripts(s, options.longHistory ?? 300),
  );
  await timed(s, 'bibliography', () => makeBibliography(s));
  const { editionId, editionSlug } = await timed(s, 'edition', () => makeEdition(s, slug));
  const conjectureIds = await timed(s, 'conjectures and reports', () =>
    makeConjectures(s, editionId),
  );
  await timed(s, 'the editors work', () => editorsWork(s, editionId, conjectureIds));
  return {
    workId: s.workId,
    scholiaWorkId,
    slug,
    editionId,
    editionSlug,
    collaboratorId: s.collaboratorId,
    witnessIds: Object.fromEntries(s.witnessId),
    transcriptionIds: Object.fromEntries(s.transcriptionId),
    longHistories,
    done: s.done,
    seconds: s.seconds,
    existed: false,
  };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Take a stress edition out of the database again, with everything made for
 * it: the works, the witnesses and their transcripts, the histories, the
 * schemes, the bibliography and the account that was its collaborator. For
 * a seeding that was interrupted, or to seed again.
 */
export async function removeStress(db: Database, slug: string): Promise<void> {
  await refuseDevelopmentDatabase(db);
  const workRows = await db
    .select({ id: works.id })
    .from(works)
    .where(sql`${works.slug} in (${slug}, ${`${slug}-scholia`})`);
  const workIds = workRows.map((w) => w.id);
  const witnessRows = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(sql`${witnesses.slug} ~ ${`^${escapeRegex(slug)}-(ms|pap|rep)[0-9]+$`}`);
  const witnessIds = witnessRows.map((w) => w.id);
  const editionRows = workIds.length
    ? await db.select({ id: editions.id }).from(editions).where(inArray(editions.workId, workIds))
    : [];
  const transcriptionRows = witnessIds.length
    ? await db
        .select({ id: transcriptions.id })
        .from(transcriptions)
        .where(inArray(transcriptions.witnessId, witnessIds))
    : [];
  const documentIds = [...editionRows, ...transcriptionRows].map((d) => d.id);
  const collaborators = editionRows.length
    ? await db
        .select({ id: editionCollaborators.userId })
        .from(editionCollaborators)
        .innerJoin(users, eq(users.id, editionCollaborators.userId))
        .where(
          sql`${editionCollaborators.editionId} in (${sql.join(
            editionRows.map((e) => sql`${e.id}`),
            sql`, `,
          )}) and ${users.email} like '%-collaborator-%@stress.invalid'`,
        )
    : [];
  // History and the rest that points at documents by id alone, with no key to follow.
  if (documentIds.length) {
    await db.delete(changesets).where(inArray(changesets.documentId, documentIds));
    await db.delete(checkpoints).where(inArray(checkpoints.documentId, documentIds));
    await db.delete(moments).where(inArray(moments.documentId, documentIds));
    await db.delete(reviewState).where(inArray(reviewState.documentId, documentIds));
  }
  if (workIds.length) await db.delete(works).where(inArray(works.id, workIds));
  if (witnessIds.length) await db.delete(witnesses).where(inArray(witnesses.id, witnessIds));
  await db
    .delete(referenceSchemes)
    .where(
      sql`${referenceSchemes.name} in (${`${SCHEME_PRESETS[1]!.name} (${slug})`}, ${`Scholium (${slug})`})`,
    );
  await db
    .delete(bibliographyItems)
    .where(
      sql`${bibliographyItems.citationKey} ~ ${`^${escapeRegex(slug)}-[a-z]+[0-9]{4}-[0-9]+$`}`,
    );
  if (collaborators.length)
    await db.delete(users).where(
      inArray(
        users.id,
        collaborators.map((u) => u.id),
      ),
    );
}

async function describeExisting(
  db: Database,
  slug: string,
  workId: string,
): Promise<StressSeedResult> {
  const [edition] = await db
    .select({ id: editions.id, slug: editions.slug })
    .from(editions)
    .where(eq(editions.workId, workId));
  const witnessRows = await db
    .select({ id: witnesses.id, slug: witnesses.slug })
    .from(witnesses)
    .where(sql`${witnesses.slug} like ${`${slug}-%`}`);
  const transcriptionRows = witnessRows.length
    ? await db
        .select({ id: transcriptions.id, witnessId: transcriptions.witnessId })
        .from(transcriptions)
        .where(
          inArray(
            transcriptions.witnessId,
            witnessRows.map((w) => w.id),
          ),
        )
    : [];
  const keyOf = new Map(witnessRows.map((w) => [w.id, w.slug.slice(slug.length + 1)] as const));
  const [scholia] = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.slug, `${slug}-scholia`));
  return {
    workId,
    scholiaWorkId: scholia?.id ?? null,
    slug,
    editionId: edition?.id ?? '',
    editionSlug: edition?.slug ?? '',
    collaboratorId: null,
    witnessIds: Object.fromEntries(witnessRows.map((w) => [keyOf.get(w.id)!, w.id])),
    transcriptionIds: Object.fromEntries(
      transcriptionRows
        .filter((t) => keyOf.has(t.witnessId))
        .map((t) => [keyOf.get(t.witnessId)!, t.id]),
    ),
    longHistories: [],
    done: {},
    seconds: {},
    existed: true,
  };
}

// The works and their segments

async function makeWorks(s: Seeding, slug: string): Promise<string | null> {
  const { db, ownerId, text } = s;
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: `${SCHEME_PRESETS[1]!.name} (${slug})`,
    levels: SCHEME_PRESETS[1]!.scheme.levels,
    createdBy: ownerId,
  });
  await db.insert(works).values({
    id: s.workId,
    slug,
    title: 'The Stress Play',
    author: 'Nobody',
    language: 'grc',
    identifier: STRESS_IDENTIFIER,
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: ownerId,
  });
  await db.insert(workMaintainers).values({ workId: s.workId, userId: ownerId });
  const labels = Array.from({ length: text.lines }, (_, i) => String(i + 1));
  const map = await resolveLabels(db, await schemeOfWork(db, s.workId), labels);
  for (const [label, segment] of map) s.segmentOf.set(Number(label), segment.id);
  count(s, 'segments', map.size);

  let scholiaWorkId: string | null = null;
  if (text.scholia.length > 0 && text.witnesses.some((w) => w.roles.includes('carries scholia'))) {
    const scholiaScheme = newId();
    await db.insert(referenceSchemes).values({
      id: scholiaScheme,
      name: `Scholium (${slug})`,
      levels: [{ key: 'scholium', label: 'Scholium', type: 'number', separator: '' }],
      createdBy: ownerId,
    });
    scholiaWorkId = newId();
    await db.insert(works).values({
      id: scholiaWorkId,
      slug: `${slug}-scholia`,
      title: 'Scholia to the Stress Play',
      language: 'grc',
      identifier: STRESS_SCHOLIA_IDENTIFIER,
      schemeId: scholiaScheme,
      profile: defaultProfile('grc'),
      createdBy: ownerId,
    });
    await db.insert(workMaintainers).values({ workId: scholiaWorkId, userId: ownerId });
    const scholiaMap = await resolveLabels(
      db,
      await schemeOfWork(db, scholiaWorkId),
      text.scholia.map((c) => String(c.number)),
    );
    for (const [label, segment] of scholiaMap) s.scholiaSegmentOf.set(Number(label), segment.id);
    count(s, 'scholia segments', scholiaMap.size);
  }
  s.scholiaWorkId = scholiaWorkId;
  return scholiaWorkId;
}

// Witnesses

async function makeWitnesses(s: Seeding, slug: string): Promise<void> {
  const { db, ownerId, text } = s;
  for (const w of text.witnesses) {
    const id = newId();
    s.witnessId.set(w.key, id);
    const papyrus = w.type === 'papyrus';
    await db.insert(witnesses).values({
      id,
      slug: `${slug}-${w.key}`,
      siglum: w.siglum,
      name: w.name,
      category: w.type === 'reported' ? 'indirect' : 'manuscript',
      ...(w.type === 'reported'
        ? { sourceAuthor: 'Athenaeus', sourceWork: 'Deipnosophistae' }
        : { format: papyrus ? ('roll' as const) : ('codex' as const) }),
      material: w.type === 'reported' ? null : papyrus ? 'papyrus' : 'parchment',
      ...(w.type === 'reported'
        ? {}
        : {
            repository: 'A Library of Tests',
            settlement: 'Testville',
            shelfmark: `${papyrus ? 'P.Test.' : 'Cod. Test.'} ${w.key.replace(/\D/gu, '')}`,
            dateText: papyrus ? 's. II' : 's. XIII',
          }),
      hands: w.hands,
      createdBy: ownerId,
    });
    await db.insert(witnessMaintainers).values({ witnessId: id, userId: ownerId });
    if (w.pages.length > 0) {
      const ids = w.pages.map(() => newId());
      s.pageIds.set(w.key, ids);
      await db
        .insert(pages)
        .values(
          w.pages.map((label, i) => ({ id: ids[i]!, witnessId: id, label, position: i + 1 })),
        );
      count(s, 'pages', ids.length);
    } else s.pageIds.set(w.key, []);
    count(s, 'witnesses');
  }
}

// Transcripts and their histories

async function makeTranscripts(s: Seeding, longHistory: number): Promise<string[]> {
  const { db, ownerId, text } = s;
  const transcribed = text.witnesses.filter((w) => w.type !== 'reported');
  // The transcripts that get a long history: the edition's base, the manuscript with three hands, and a diplomatic one.
  const chosen = new Set<string>();
  const base = text.witnesses.find((w) => w.key === text.baseWitness);
  if (base) chosen.add(base.key);
  const threeHands = transcribed.find((w) => w.hands.length === 3);
  if (threeHands) chosen.add(threeHands.key);
  for (const w of transcribed) {
    if (chosen.size >= LONG_HISTORIES) break;
    if (w.type === 'manuscript' && w.keepsWrittenForm && w.pages.length > 0) chosen.add(w.key);
  }
  const longHistories: string[] = [];
  for (const w of transcribed) {
    const id = newId();
    s.transcriptionId.set(w.key, id);
    await db.insert(transcriptions).values({
      id,
      witnessId: s.witnessId.get(w.key)!,
      name: `${w.name}, the stress transcript`,
      ownerId,
      keepsWrittenForm: w.keepsWrittenForm,
      visibility: 'draft',
    });
    const scholia = w.entries.some((e) => e.kind === 'line' && e.work === 'scholia');
    await setChosenWorks(
      db,
      id,
      s.scholiaWorkId && scholia ? [s.workId, s.scholiaWorkId] : [s.workId],
    );
    const plan = streamOf(
      w,
      (work, n) => (work === 'main' ? s.segmentOf.get(n)! : s.scholiaSegmentOf.get(n)!),
      s.pageIds.get(w.key)!,
    );
    await writeInPieces(s, id, plan);
    count(s, 'transcripts');
    count(s, 'words in transcripts', plan.tokens);
    if (chosen.has(w.key) && longHistory > 0) {
      await smallChanges(s, id, plan.stream, longHistory);
      longHistories.push(id);
    }
    if (w.key === text.baseWitness) {
      const [row] = await db
        .select({ version: transcriptions.version })
        .from(transcriptions)
        .where(eq(transcriptions.id, id));
      await nameMoment(db, 'transcription', id, row!.version, 'Collated for the edition', ownerId);
      count(s, 'moments');
    }
  }
  return longHistories;
}

/** A transcript's text saved in a handful of changesets, as if typed in sittings: the first replaces nothing, the others add what follows. */
async function writeInPieces(s: Seeding, transcriptionId: string, plan: StreamPlan): Promise<void> {
  const { db, ownerId } = s;
  const entries = plan.starts.length - 1;
  const pieces = Math.max(1, Math.min(FIRST_WRITING_CHANGESETS, entries));
  const bounds = Array.from(
    { length: pieces + 1 },
    (_, k) => plan.starts[Math.round((k * entries) / pieces)]!,
  );
  let version = 0;
  let lastId: Id | null = null;
  for (let k = 0; k < pieces; k++) {
    const items = plan.stream.items.slice(bounds[k]!, bounds[k + 1]!);
    if (items.length === 0) continue;
    const result =
      version === 0
        ? await replaceContent(
            db,
            'transcription',
            transcriptionId,
            ownerId,
            0,
            { items },
            'first sitting',
          )
        : await saveOps(
            db,
            'transcription',
            transcriptionId,
            ownerId,
            version,
            [{ t: 'insert', after: lastId, items }],
            `sitting ${k + 1}`,
          );
    version = result.version;
    lastId = items[items.length - 1]!.id;
    count(s, 'changesets');
  }
}

/** Many small changesets on one transcript: words typed wrong, marked unchecked, then confirmed; the text ends as it was. */
async function smallChanges(
  s: Seeding,
  transcriptionId: string,
  stream: Stream,
  changesets: number,
): Promise<void> {
  const { db, ownerId } = s;
  const candidates = stream.items.filter(
    (i): i is Token => isToken(i) && !i.marks?.length && Array.from(i.form).length >= 3,
  );
  const words = Math.max(1, Math.ceil(changesets / 3));
  const stride = Math.max(1, Math.floor(candidates.length / words));
  const chosen = Array.from({ length: words }, (_, k) => candidates[k * stride]).filter(
    (t): t is Token => t !== undefined,
  );
  const [row] = await db
    .select({ version: transcriptions.version })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  let version = row!.version;
  let made = 0;
  const save = async (ops: Op[], message: string) => {
    version = (await saveOps(db, 'transcription', transcriptionId, ownerId, version, ops, message))
      .version;
    made++;
    count(s, 'changesets');
  };
  for (const token of chosen) {
    if (made >= changesets) break;
    const mangled = Array.from(token.form).slice(0, -1).join('');
    await save([{ t: 'set', id: token.id, fields: { form: mangled } }], 'typed');
    if (made >= changesets) break;
    await save(
      [{ t: 'set', id: token.id, fields: { form: token.form, unchecked: true } }],
      'corrected, to be checked',
    );
    if (made >= changesets) break;
    await save([{ t: 'set', id: token.id, fields: { unchecked: null } }], 'checked');
  }
  // The changesets asked for, whatever the number of words: the rest are confirmations that change nothing.
  for (let k = 0; made < changesets && chosen.length > 0; k++)
    await save(
      [{ t: 'set', id: chosen[k % chosen.length]!.id, fields: { unchecked: null } }],
      'looked at again',
    );
}

// Bibliography

async function makeBibliography(s: Seeding): Promise<void> {
  const { db, ownerId, text } = s;
  for (const entry of text.bibliography) {
    const id = newId();
    await db.insert(bibliographyItems).values({
      id,
      entryType: entry.entryType,
      citationKey: `${s.slug}-${entry.key}`,
      fields: entry.fields,
      label: entry.label,
      createdBy: ownerId,
    });
    s.bibliographyId.set(entry.index, id);
  }
  count(s, 'bibliography entries', text.bibliography.length);
}

// The edition

async function makeEdition(
  s: Seeding,
  slug: string,
): Promise<{ editionId: string; editionSlug: string }> {
  const { db, ownerId, text } = s;
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, ownerId));
  const baseTranscription = s.transcriptionId.get(text.baseWitness)!;
  const edition = await createEdition(
    db,
    {
      workId: s.workId,
      title: 'The Stress Play, a working edition',
      slug: `${slug}-edition`,
      editors: [owner?.name ?? 'Editor'],
      preface: 'An edition of a made-up play in many witnesses, for measuring Varians. Not a text.',
      baseTranscriptionId: baseTranscription,
      sigla: [],
      conventions: { ...DEFAULT_CONVENTIONS, interpretative: 'separate' },
    },
    ownerId,
  );
  // The conspectus names every witness; some have further states under sigla of their own.
  await setSigla(
    db,
    edition.id,
    text.witnesses.map((w) => ({
      witnessId: s.witnessId.get(w.key)!,
      transcriptionId: s.transcriptionId.get(w.key) ?? null,
      siglum: w.siglum,
      states: w.states.map(
        (st): SiglumState =>
          st.kind === 'original'
            ? { kind: 'original', siglum: st.siglum }
            : st.kind === 'stage'
              ? { kind: 'stage', stage: st.stage, siglum: st.siglum }
              : { kind: 'hand', hand: st.hand, siglum: st.siglum },
      ),
      variantSiglum: w.variantSiglum,
    })),
  );
  count(s, 'sigla', text.witnesses.length);
  return { editionId: edition.id, editionSlug: edition.slug };
}

// Conjectures and reported readings

async function makeConjectures(s: Seeding, editionId: string): Promise<Map<number, string>> {
  const { db, ownerId, text } = s;
  const context = await loadEditionContext(db, editionId);
  const ids = new Map<number, string>();
  const register = async (c: StressConjecture) => {
    const segmentId = s.segmentOf.get(c.line)!;
    // A lemma that stands twice in the line is told apart by the token it was registered at.
    const anchor =
      c.anchorWord !== null
        ? tokensOf(context.edition.content, segmentId)[c.anchorWord]
        : undefined;
    const row = await registerConjecture(
      db,
      {
        workId: s.workId,
        segmentId,
        kind: c.kind,
        lemma: c.lemma,
        reading: c.reading,
        proposer: c.proposer,
        note: c.note,
        sequence: c.sequence?.map((n) => s.segmentOf.get(n)!) ?? null,
        supplementsId: c.supplements !== null ? (ids.get(c.supplements) ?? null) : null,
        anchor: anchor ? { editionId, tokenIds: [anchor.id] } : null,
      },
      ownerId,
    );
    ids.set(c.index, row.id);
    if (c.cites.length)
      await setCitations(
        db,
        { conjectureId: row.id },
        c.cites.map((i) => ({ itemId: s.bibliographyId.get(i)!, postnote: `ad ${c.line}` })),
      );
    count(s, `conjectures (${c.kind})`);
  };
  // A supplement names the lacuna it fills, so the lacunae are registered first.
  for (const c of text.conjectures.filter((c) => c.kind === 'lacuna')) await register(c);
  for (const c of text.conjectures.filter((c) => c.kind !== 'lacuna')) await register(c);
  const reporter = s.witnessId.get('rep1');
  if (reporter) {
    for (const r of text.reported) {
      await reportReading(
        db,
        {
          workId: s.workId,
          segmentId: s.segmentOf.get(r.line)!,
          witnessId: reporter,
          lemma: r.lemma,
          reading: r.reading,
          source: r.source,
        },
        ownerId,
      );
      count(s, 'reported readings');
    }
  }
  return ids;
}

// The editors' work

interface Work {
  s: Seeding;
  editionId: string;
  context: EditionContext;
  conjectureIds: Map<number, string>;
  /** The adopted conjectures not yet in the text, by line. */
  adopting: Map<number, StressConjecture[]>;
  userId: string;
}

async function editorsWork(
  s: Seeding,
  editionId: string,
  conjectureIds: Map<number, string>,
): Promise<void> {
  const { db, ownerId, text } = s;
  const context = await loadEditionContext(db, editionId);
  const adopting = new Map<number, StressConjecture[]>();
  for (const c of text.conjectures.filter((c) => c.adopt))
    adopting.set(c.line, [...(adopting.get(c.line) ?? []), c]);
  const work: Work = { s, editionId, context, conjectureIds, adopting, userId: ownerId };
  const half = Math.floor(text.lines / 2);
  const blocks: [number, number][] = [];
  const block = Math.max(5, Math.min(MAX_BLOCK_LINES, Math.ceil(text.lines / 8)));
  for (let from = 1; from <= text.lines; from += block)
    blocks.push([from, Math.min(text.lines, from + block - 1)]);

  let published = false;
  let moment = false;
  for (const [from, to] of blocks) {
    // A second account joins part-way: some of the saves after are its own.
    if (!s.collaboratorId && from > half) s.collaboratorId = await makeCollaborator(s, editionId);
    work.userId =
      s.collaboratorId && Math.floor(from / block) % 3 === 0 ? s.collaboratorId : ownerId;
    await workOn(work, from, to);
    s.log(`  lines ${from} to ${to} done`);
    if (!moment && from > text.lines / 4) {
      moment = true;
      await nameMoment(
        db,
        'edition',
        editionId,
        context.edition.version,
        'First quarter collated',
        ownerId,
      );
      count(s, 'moments');
    }
    // Published half-way; the work goes on after it.
    if (!published && to >= half) {
      await publishEdition(db, editionId, ownerId);
      published = true;
      count(s, 'publications');
    }
  }
  await finish(work);
}

async function makeCollaborator(s: Seeding, editionId: string): Promise<string> {
  const email = `${s.text.seed}-collaborator-${editionId.slice(-8).toLowerCase()}@stress.invalid`;
  const id = newId();
  await s.db
    .insert(users)
    .values({ id, email, name: 'Collaborator', passwordHash: 'x', emailVerifiedAt: new Date() });
  const added = await addCollaborator(s.db, editionId, email, s.ownerId);
  if (!added.ok) throw new Error(`the collaborator was not added: ${added.error}`);
  count(s, 'collaborators');
  return id;
}

/** The ids of what an adoption or a change at a place touches, so that two changes in one save never meet. */
function touching(ops: Op[]): Set<Id> {
  const ids = new Set<Id>();
  for (const op of ops) {
    if (op.t === 'delete' || op.t === 'replace' || op.t === 'move')
      for (const id of op.ids) ids.add(id);
    if (op.t === 'set') ids.add(op.id);
    if (op.t === 'insert' && op.after) ids.add(op.after);
  }
  return ids;
}

function disjoint(a: Set<Id>, b: Set<Id>): boolean {
  for (const id of b) if (a.has(id)) return false;
  return true;
}

/** How many distinct witnesses read a reading, the edition not counted and a witness's states as the witness. */
function support(reading: Reading, editionId: string): Set<string> {
  return new Set(
    reading.textIds.filter((id) => id !== editionId).map((id) => id.replace(/:.*$/u, '')),
  );
}

/** What the editors do for a stretch of lines, in the order an editor works: readings and conjectures, then the apparatus of the page, notes, then lines moved. */
async function workOn(work: Work, from: number, to: number): Promise<void> {
  const { s, context, editionId } = work;
  const { db, text } = s;
  const baseTranscription = s.transcriptionId.get(text.baseWitness)!;
  const save = async (ops: Op[], message: string): Promise<boolean> => {
    if (ops.length === 0) return false;
    const result = await saveOps(
      db,
      'edition',
      editionId,
      work.userId,
      context.edition.version,
      ops,
      message,
    );
    context.edition = { ...context.edition, content: result.content, version: result.version };
    count(s, 'edition changesets');
    return true;
  };

  // 1. The readings of the majority where the base stands alone, and the conjectures adopted, in one save.
  const ops: Op[] = [];
  const adoptedNow: StressConjecture[] = [];
  for (let line = from; line <= to; line++) {
    const segmentId = s.segmentOf.get(line)!;
    const collation = await collateSegment(db, context, segmentId);
    const baseUnits = editionUnits(context.edition.content, segmentId);
    const taken = new Set<Id>();
    const stream = context.edition.content;
    // The conjectures first: their places are not open to the majority.
    for (const c of work.adopting.get(line) ?? []) {
      // A transposition is lines moved, which takes a save of its own, below.
      if (c.kind === 'transposition') continue;
      const made = opsForConjecture(work, stream, segmentId, collation, baseUnits, c);
      if (!made || !disjoint(taken, touching(made))) continue;
      for (const id of touching(made)) taken.add(id);
      ops.push(...made);
      adoptedNow.push(c);
    }
    for (const site of collation.sites) {
      if (site.wanting) continue;
      count(s, 'places');
      const base = site.readings.find((r) => r.base);
      if (!base) continue;
      const alone = [...support(base, collation.baseId)].every((id) => id === baseTranscription);
      if (!alone) continue;
      const best = site.readings
        .filter((r) => !r.base && !r.omission && r.text !== '' && !r.lacunose)
        .sort((a, b) => support(b, collation.baseId).size - support(a, collation.baseId).size)[0];
      if (!best || support(best, collation.baseId).size < 3) continue;
      count(s, 'places where the base stands alone');
      if (!s.rng.chance(MAJORITY_SHARE)) continue;
      const textId = best.textIds.find((id) => !id.includes(':'));
      if (!textId) continue;
      const made = adoptReading(stream, site, baseUnits, best, textId);
      if (made.length === 0 || !disjoint(taken, touching(made))) continue;
      for (const id of touching(made)) taken.add(id);
      ops.push(...made);
      count(s, 'readings of the majority adopted');
    }
  }
  await save(ops, `readings adopted, lines ${from} to ${to}`);
  for (const c of adoptedNow) {
    await recordAdoption(db, editionId, work.conjectureIds.get(c.index)!);
    count(s, `conjectures adopted (${c.kind})`);
  }

  // 2. What the apparatus of the page needs: speakers, headings, cruces, and words the editor types over.
  const stream = context.edition.content;
  const structure: Op[] = [];
  const crossed = new Set<Id>();
  const placeBefore = (line: number, items: Item[]) => {
    const segmentId = s.segmentOf.get(line)!;
    const run = runsOfSegment(stream, segmentId)[0];
    if (!run || run.from === 0) return;
    structure.push({ t: 'insert', after: stream.items[run.from - 1]!.id, items });
  };
  for (const speaker of text.editors.speakers.filter((x) => x.line >= from && x.line <= to)) {
    placeBefore(speaker.line, [
      {
        kind: 'object',
        id: newId(),
        type: 'paratext',
        attrs: { type: 'speaker' },
        text: speaker.text,
      },
    ]);
    count(s, 'speaker labels');
  }
  for (const heading of text.editors.headings.filter((x) => x.line >= from && x.line <= to)) {
    placeBefore(heading.line, [
      {
        kind: 'object',
        id: newId(),
        type: 'paratext',
        attrs: { type: 'head' },
        text: heading.text,
      },
      { kind: 'break', id: newId(), type: 'line' },
    ]);
    count(s, 'headings');
  }
  const typed: { line: number; token: Token; reading: string; register: boolean }[] = [];
  for (const crux of text.editors.cruces.filter((x) => x.line >= from && x.line <= to)) {
    const tokens = tokensOf(stream, s.segmentOf.get(crux.line)!);
    const token = tokens[Math.min(crux.word, tokens.length - 1)];
    if (!token || (token.marks ?? []).length > 0) continue;
    structure.push({ t: 'set', id: token.id, fields: { marks: [{ kind: 'crux' }] } });
    crossed.add(token.id);
    count(s, 'cruces');
  }
  for (const emendation of text.editors.emendations.filter((x) => x.line >= from && x.line <= to)) {
    const tokens = tokensOf(stream, s.segmentOf.get(emendation.line)!);
    const token = tokens[Math.min(emendation.word, tokens.length - 1)];
    if (!token || crossed.has(token.id) || token.form === emendation.reading) continue;
    const change: Op[] = [{ t: 'set', id: token.id, fields: { form: emendation.reading } }];
    structure.push(...change, ...claimTypedWords(stream, change));
    typed.push({
      line: emendation.line,
      token,
      reading: emendation.reading,
      register: emendation.register,
    });
  }
  await save(structure, `speakers, headings and emendations, lines ${from} to ${to}`);
  for (const t of typed) {
    count(s, 'emendations typed');
    if (!t.register) continue;
    const conjecture = await registerConjecture(
      db,
      {
        workId: s.workId,
        segmentId: s.segmentOf.get(t.line)!,
        kind: 'substitution',
        lemma: t.token.form,
        reading: t.reading,
        proposer: 'The editor',
        anchor: { editionId, tokenIds: [t.token.id] },
        visibility: (await publishedAlready(db, editionId)) ? 'published' : 'draft',
      },
      s.ownerId,
    );
    await recordAdoption(db, editionId, conjecture.id);
    count(s, 'emendations registered as conjectures');
  }

  // 3. Notes on the edition's words.
  for (const note of text.editors.notes.filter((x) => x.line >= from && x.line <= to)) {
    const tokens = tokensOf(context.edition.content, s.segmentOf.get(note.line)!);
    const token = note.word === null ? undefined : tokens[Math.min(note.word, tokens.length - 1)];
    await addNote(
      db,
      editionId,
      {
        segmentId: s.segmentOf.get(note.line)!,
        tokenIds: token ? [token.id] : [],
        text: note.text,
        citations: note.cites.map((i) => ({ itemId: s.bibliographyId.get(i)!, prenote: 'cf.' })),
      },
      work.userId,
    );
    count(s, 'notes');
  }

  // 4. Lines the editors move: a transposition adopted, each in a save of its own, since it replaces the lines.
  for (let line = from; line <= to; line++) {
    for (const c of (work.adopting.get(line) ?? []).filter((c) => c.kind === 'transposition')) {
      const first = tokensOf(context.edition.content, s.segmentOf.get(line)!)[0];
      if (!first) continue;
      const moved = moveLinesOps(context.edition.content, [first.id], 1);
      if (await save(moved, `lines ${line} and ${line + 1} transposed`)) {
        await recordAdoption(db, editionId, work.conjectureIds.get(c.index)!);
        count(s, 'conjectures adopted (transposition)');
        count(s, 'lines transposed');
      }
    }
  }
}

async function publishedAlready(db: Database, editionId: string): Promise<boolean> {
  const [row] = await db
    .select({ visibility: editions.visibility })
    .from(editions)
    .where(eq(editions.id, editionId));
  return row?.visibility === 'published';
}

/** The operations that adopt a conjecture the editors take, or none where it cannot be put in the text. */
function opsForConjecture(
  work: Work,
  stream: Stream,
  segmentId: string,
  collation: Collation,
  baseUnits: Unit[],
  c: StressConjecture,
): Op[] | null {
  const conjectureId = work.conjectureIds.get(c.index)!;
  const tokens = tokensOf(stream, segmentId);
  const at = tokens[Math.min(c.anchorWord ?? Math.floor(tokens.length / 2), tokens.length - 1)];
  if (!at) return null;
  // A word added, a lacuna posited and a supplement have no words of the edition to replace: they stand after one.
  if (c.kind === 'addition' || c.kind === 'supplement' || (c.kind === 'lacuna' && c.lemma === '')) {
    const items: Item[] = [];
    if (c.kind === 'lacuna')
      items.push({ kind: 'object', id: newId(), type: 'lacuna', attrs: { conjectureId } });
    else
      for (const form of c.reading.split(/\s+/u).filter((w) => w !== ''))
        items.push({
          kind: 'token',
          id: newId(),
          form,
          source: { kind: 'conjecture', conjectureId },
          ...(c.kind === 'supplement'
            ? { marks: [{ kind: 'supplied', attrs: { resp: conjectureId } }] }
            : {}),
        });
    return items.length ? [{ t: 'insert', after: at.id, items }] : null;
  }
  // The others replace the words their lemma names, where it names words that are there.
  const candidate: AttachmentCandidate = {
    id: conjectureId,
    kind: 'conjecture',
    lemma: c.lemma,
    reading: c.reading,
    name: c.proposer,
    conjectureKind: c.kind,
    ...(c.anchorWord !== null ? { anchorTokenIds: [at.id] } : {}),
  };
  const attached = attachToSites(collation, baseUnits, [candidate], work.context.profile.fold);
  const entry = Object.entries(attached.bySite)[0];
  if (!entry) return null;
  const site: Site | undefined = attached.collation.sites.find((x) => x.index === Number(entry[0]));
  const attachment = entry[1][0];
  if (!site || !attachment) return null;
  const adoption: SegmentForAdoption = {
    segmentId,
    collation: attached.collation,
    baseUnits,
    attachments: attached.bySite,
  };
  const ops = opsForAttachment(stream, adoption, site, attachment);
  return ops.length ? ops : null;
}

/** The last of the editors' work: the kind of some places overruled, a third of the places reviewed, review positions. */
async function finish(work: Work): Promise<void> {
  const { s, context, editionId } = work;
  const { db, ownerId, text } = s;
  const total = text.lines;
  const wanted = Math.max(3, Math.round((20 * total) / 1300));
  // Places where an editor might say otherwise than the letters do: an accent or a division that matters to the sense, or a word that is only another spelling.
  const arguable: { segmentId: string; key: string; kind: 'textual' | 'interpretative' }[] = [];
  for (let line = 1; line <= total; line++) {
    const segmentId = s.segmentOf.get(line)!;
    const collation = await collateSegment(db, context, segmentId);
    const baseUnits = editionUnits(context.edition.content, segmentId);
    for (const site of collation.sites) {
      if (site.wanting || site.readings.length < 2) continue;
      const key = siteKey(site, baseUnits);
      if (s.rng.chance(1 / 3)) {
        await reviewSite(
          db,
          editionId,
          segmentId,
          key,
          s.collaboratorId && s.rng.chance(0.2) ? s.collaboratorId : ownerId,
        );
        count(s, 'places reviewed');
      }
      const base = site.readings.find((r) => r.base);
      const others = site.readings.filter((r) => !r.base && !r.omission && r.text !== '');
      const near =
        base !== undefined &&
        others.length > 0 &&
        others.every(
          (r) => similarity(archetypeLetters(r.text), archetypeLetters(base.text)) >= 0.7,
        );
      if (site.kind === 'interpretative' || near)
        arguable.push({ segmentId, key, kind: site.kind });
    }
  }
  // Spread over the text, as many as were wanted.
  const stride = Math.max(1, Math.floor(arguable.length / wanted));
  let overruled = 0;
  for (let k = 0; k < arguable.length && overruled < wanted; k += stride) {
    const place = arguable[k]!;
    await setSiteKind(
      db,
      editionId,
      place.segmentId,
      place.key,
      place.kind === 'textual' ? 'interpretative' : 'textual',
      ownerId,
    );
    overruled++;
    count(s, 'kinds of places overruled');
  }
  await setReviewFrom(db, 'edition', editionId, ownerId, 1);
  await nameMoment(db, 'edition', editionId, context.edition.version, 'Reviewed', ownerId);
  count(s, 'moments');
}
