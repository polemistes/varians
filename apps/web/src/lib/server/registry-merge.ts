/**
 * Merging registry entries: one witness into another, or one
 * work into another. A preview says what moves and what prevents the merge;
 * the merge moves everything in one transaction, removes the merged entry
 * and records it in registry_merges, so that its id still leads to the
 * survivor and later imports naming it land there.
 *
 * Moving a segment id inside a stored stream (a transcription's or an
 * edition's text, its checkpoints and the operations of its history) is not
 * a change of the text: the id of a segment is metadata. It is rewritten in
 * place and nothing is recorded in the history.
 */
import {
  formatLabel,
  sortKey,
  type Address,
  type Level,
  type Scheme,
  type Stream,
} from '@varians/core';
import {
  and,
  asc,
  changesets,
  checkpoints,
  collationCache,
  conjectures,
  editionSigla,
  editions,
  eq,
  inArray,
  moments,
  or,
  pages,
  referenceSchemes,
  registryMerges,
  reportedReadings,
  segments,
  sql,
  transcriptionSegments,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  workMaintainers,
  works,
  type CanonicalIdentifier,
  type Database,
  type SQL,
  type WitnessHand,
} from '@varians/db';
import { unionIdentifiers } from '$lib/registry/identifiers';
import type {
  MergeEntryRef,
  MergeKind,
  MergePreview,
  MergeRecord,
  WitnessMergePreview,
  WorkMergePreview,
} from '$lib/registry/merge';
import { canMergeEntries, type Actor } from './authz';
import { forgetPastVersions, rebuildSegmentIndex } from './documents/service.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;

export type {
  MergeEntryRef,
  MergeKind,
  MergePreview,
  MergeRecord,
  WitnessMergePreview,
  WorkMergePreview,
};

export type MergeResult =
  | { ok: true; preview: MergePreview }
  | { ok: false; error: 'not-found' | 'same' | 'forbidden' }
  | { ok: false; error: 'blocked'; preview: MergePreview };

/** Whether anything prevents the merge. */
export function isBlocked(preview: MergePreview): boolean {
  if (preview.kind === 'witness')
    return preview.blocks.bothInEdition.length > 0 || preview.blocks.pageConflicts.length > 0;
  return preview.blocks.schemeDiffers || preview.blocks.labelCollisions.length > 0;
}

// Entries and who maintains them

interface Entry {
  id: string;
  slug: string;
  name: string;
  createdBy: string | null;
  maintainerIds: string[];
}

async function loadEntry(db: Db, kind: MergeKind, id: string, lock = false): Promise<Entry | null> {
  if (kind === 'work') {
    const query = db
      .select({ id: works.id, slug: works.slug, name: works.title, createdBy: works.createdBy })
      .from(works)
      .where(eq(works.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) return null;
    const rows = await db
      .select({ userId: workMaintainers.userId })
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, id));
    return { ...row, maintainerIds: rows.map((r) => r.userId) };
  }
  const query = db
    .select({
      id: witnesses.id,
      slug: witnesses.slug,
      name: witnesses.name,
      createdBy: witnesses.createdBy,
    })
    .from(witnesses)
    .where(eq(witnesses.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) return null;
  const rows = await db
    .select({ userId: witnessMaintainers.userId })
    .from(witnessMaintainers)
    .where(eq(witnessMaintainers.witnessId, id));
  return { ...row, maintainerIds: rows.map((r) => r.userId) };
}

const ref = (e: Entry): MergeEntryRef => ({ id: e.id, slug: e.slug, name: e.name });

/** Everyone who maintains an entry: its creator and its maintainers. */
const maintainersOfEntry = (e: Entry) => [
  ...new Set([...(e.createdBy ? [e.createdBy] : []), ...e.maintainerIds]),
];

/** The names of those who maintain `from` and not `into`, in the order of their names. */
async function newMaintainers(
  db: Db,
  from: Entry,
  into: Entry,
): Promise<{ ids: string[]; names: string[] }> {
  const already = new Set(maintainersOfEntry(into));
  const ids = maintainersOfEntry(from).filter((id) => !already.has(id));
  if (ids.length === 0) return { ids, names: [] };
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.name));
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

/** Whether the user may merge the one entry into the other; null when either is missing. */
export async function mayMerge(
  db: Database,
  user: Actor | null,
  kind: MergeKind,
  fromId: string,
  intoId: string,
): Promise<boolean | null> {
  const [from, into] = await Promise.all([
    loadEntry(db, kind, fromId),
    loadEntry(db, kind, intoId),
  ]);
  if (!from || !into) return null;
  return canMergeEntries(user, from, into);
}

/** The earlier merges into an entry, oldest first, for its page. */
export async function mergesInto(
  db: Database,
  kind: MergeKind,
  id: string,
): Promise<MergeRecord[]> {
  const rows = await db
    .select({
      oldId: registryMerges.oldId,
      label: registryMerges.label,
      mergedAt: registryMerges.mergedAt,
    })
    .from(registryMerges)
    .where(and(eq(registryMerges.kind, kind), eq(registryMerges.survivorId, id)))
    .orderBy(asc(registryMerges.mergedAt), asc(registryMerges.label));
  return rows.map((r) => ({ ...r, mergedAt: r.mergedAt.toISOString() }));
}

/** Records the merge, and points earlier merges into the merged entry at the survivor, so that chains stay one step long. */
async function recordMerge(
  tx: Tx,
  kind: MergeKind,
  from: Entry,
  intoId: string,
  userId: string,
): Promise<void> {
  await tx
    .update(registryMerges)
    .set({ survivorId: intoId })
    .where(and(eq(registryMerges.kind, kind), eq(registryMerges.survivorId, from.id)));
  await tx
    .insert(registryMerges)
    .values({ oldId: from.id, kind, survivorId: intoId, label: from.name, mergedBy: userId });
}

/** Adds the maintainers of the merged entry to the survivor, keeping the date each became a maintainer. */
async function addMaintainers(
  tx: Tx,
  kind: MergeKind,
  from: Entry,
  intoId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  if (kind === 'work') {
    const since = await tx
      .select()
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, from.id));
    const at = new Map(since.map((r) => [r.userId, r.createdAt] as const));
    await tx
      .insert(workMaintainers)
      .values(
        ids.map((userId) => ({
          workId: intoId,
          userId,
          ...(at.has(userId) ? { createdAt: at.get(userId)! } : {}),
        })),
      )
      .onConflictDoNothing();
  } else {
    const since = await tx
      .select()
      .from(witnessMaintainers)
      .where(eq(witnessMaintainers.witnessId, from.id));
    const at = new Map(since.map((r) => [r.userId, r.createdAt] as const));
    await tx
      .insert(witnessMaintainers)
      .values(
        ids.map((userId) => ({
          witnessId: intoId,
          userId,
          ...(at.has(userId) ? { createdAt: at.get(userId)! } : {}),
        })),
      )
      .onConflictDoNothing();
  }
}

const identifierText = (i: CanonicalIdentifier) => i.value;

/** The identifiers of `from` that `into` lacks. */
function addedIdentifiers(
  from: CanonicalIdentifier[],
  into: CanonicalIdentifier[],
): CanonicalIdentifier[] {
  const have = new Set(into.map((i) => `${i.scheme}\u0000${i.value}`));
  return unionIdentifiers([], from).filter((i) => !have.has(`${i.scheme}\u0000${i.value}`));
}

// Witnesses

async function witnessPreview(db: Db, from: Entry, into: Entry): Promise<WitnessMergePreview> {
  const [fromRow] = await db
    .select({ hands: witnesses.hands, identifiers: witnesses.identifiers })
    .from(witnesses)
    .where(eq(witnesses.id, from.id));
  const [intoRow] = await db
    .select({ hands: witnesses.hands, identifiers: witnesses.identifiers })
    .from(witnesses)
    .where(eq(witnesses.id, into.id));
  const [{ n: transcriptionCount }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transcriptions)
    .where(eq(transcriptions.witnessId, from.id))) as [{ n: number }];
  const [{ n: readingCount }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reportedReadings)
    .where(eq(reportedReadings.witnessId, from.id))) as [{ n: number }];
  const siglaRows = await db
    .select({
      editionId: editionSigla.editionId,
      witnessId: editionSigla.witnessId,
      title: editions.title,
    })
    .from(editionSigla)
    .innerJoin(editions, eq(editions.id, editionSigla.editionId))
    .where(inArray(editionSigla.witnessId, [from.id, into.id]))
    .orderBy(asc(editions.title));
  const naming = (witnessId: string) =>
    new Set(siglaRows.filter((r) => r.witnessId === witnessId).map((r) => r.editionId));
  const namesFrom = naming(from.id);
  const namesInto = naming(into.id);
  const titleOf = new Map(siglaRows.map((r) => [r.editionId, r.title] as const));
  const sigla = [...namesFrom].map((id) => titleOf.get(id)!).sort((a, b) => a.localeCompare(b));
  const bothInEdition = [...namesFrom]
    .filter((id) => namesInto.has(id))
    .map((id) => titleOf.get(id)!)
    .sort((a, b) => a.localeCompare(b));

  const pageRows = await db
    .select({ witnessId: pages.witnessId, label: pages.label })
    .from(pages)
    .where(inArray(pages.witnessId, [from.id, into.id]))
    .orderBy(asc(pages.position));
  const intoLabels = new Set(
    pageRows.filter((p) => p.witnessId === into.id).map((p) => p.label.trim()),
  );
  const fromPages = pageRows.filter((p) => p.witnessId === from.id);
  const pageConflicts = [
    ...new Set(fromPages.map((p) => p.label.trim()).filter((label) => intoLabels.has(label))),
  ];

  const intoHandIds = new Set((intoRow?.hands ?? []).map((h) => h.id));
  const hands = (fromRow?.hands ?? []).filter((h) => !intoHandIds.has(h.id)).map((h) => h.label);
  const identifiers = addedIdentifiers(fromRow?.identifiers ?? [], intoRow?.identifiers ?? []).map(
    identifierText,
  );
  const maintainers = await newMaintainers(db, from, into);

  return {
    kind: 'witness',
    from: ref(from),
    into: ref(into),
    moves: {
      transcriptions: transcriptionCount,
      readings: readingCount,
      sigla,
      maintainers: maintainers.names,
      pages: fromPages.length,
      hands,
      identifiers,
    },
    blocks: { bothInEdition, pageConflicts },
  };
}

/** What merging one witness into another would move, and what prevents it; null when either is missing. */
export async function previewWitnessMerge(
  db: Database,
  fromId: string,
  intoId: string,
): Promise<WitnessMergePreview | null> {
  const [from, into] = await Promise.all([
    loadEntry(db, 'witness', fromId),
    loadEntry(db, 'witness', intoId),
  ]);
  if (!from || !into || from.id === into.id) return null;
  return witnessPreview(db, from, into);
}

/**
 * Merges one witness into another: its transcriptions, reported readings,
 * sigla, maintainers and pages (after the survivor's) go to the survivor,
 * with the hands and identifiers the survivor lacks; then it is removed and
 * the merge recorded. Refused for anyone but an administrator or a
 * maintainer of both, and while the preview names anything that prevents it.
 */
export async function mergeWitnesses(
  db: Database,
  fromId: string,
  intoId: string,
  user: Actor | null,
): Promise<MergeResult> {
  if (fromId === intoId) return { ok: false, error: 'same' };
  return db.transaction(async (tx): Promise<MergeResult> => {
    // Locked in a fixed order, so that two merges of the same pair cannot deadlock.
    const [first, second] = [fromId, intoId].sort();
    const a = await loadEntry(tx, 'witness', first!, true);
    const b = await loadEntry(tx, 'witness', second!, true);
    const from = a?.id === fromId ? a : b;
    const into = a?.id === intoId ? a : b;
    if (!a || !b || !from || !into) return { ok: false, error: 'not-found' };
    if (!user || !canMergeEntries(user, from, into)) return { ok: false, error: 'forbidden' };
    const preview = await witnessPreview(tx, from, into);
    if (isBlocked(preview)) return { ok: false, error: 'blocked', preview };

    // Pages after the survivor's, in their own order.
    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${pages.position}), 0)::float8` })
      .from(pages)
      .where(eq(pages.witnessId, into.id))) as [{ max: number }];
    const fromPages = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.witnessId, from.id))
      .orderBy(asc(pages.position), asc(pages.createdAt));
    for (let i = 0; i < fromPages.length; i += 500) {
      const rows = fromPages
        .slice(i, i + 500)
        .map((p, k) => sql`(${p.id}::text, ${Number(max) + i + k + 1}::float8)`);
      await tx.execute(
        sql`update ${pages} set witness_id = ${into.id}, position = v.position from (values ${sql.join(rows, sql`, `)}) as v(id, position) where ${pages.id} = v.id`,
      );
    }
    await tx
      .update(transcriptions)
      .set({ witnessId: into.id })
      .where(eq(transcriptions.witnessId, from.id));
    await tx
      .update(reportedReadings)
      .set({ witnessId: into.id })
      .where(eq(reportedReadings.witnessId, from.id));
    await tx
      .update(editionSigla)
      .set({ witnessId: into.id })
      .where(eq(editionSigla.witnessId, from.id));
    // A published edition's basis names its witnesses: it keeps naming the same one under its new id.
    await tx.execute(
      sql`update ${moments} set basis = replace(basis::text, ${JSON.stringify(from.id)}, ${JSON.stringify(into.id)})::jsonb where basis is not null and strpos(basis::text, ${JSON.stringify(from.id)}) > 0`,
    );

    const maintainers = await newMaintainers(tx, from, into);
    await addMaintainers(tx, 'witness', from, into.id, maintainers.ids);

    const [fromRow] = await tx
      .select({ hands: witnesses.hands, identifiers: witnesses.identifiers })
      .from(witnesses)
      .where(eq(witnesses.id, from.id));
    const [intoRow] = await tx
      .select({ hands: witnesses.hands, identifiers: witnesses.identifiers })
      .from(witnesses)
      .where(eq(witnesses.id, into.id));
    const haveHands = new Set(intoRow!.hands.map((h) => h.id));
    // The marks of corrections in the moved transcripts name their hands by id: those hands come along, none as the scribe.
    const hands: WitnessHand[] = [
      ...intoRow!.hands,
      ...fromRow!.hands.filter((h) => !haveHands.has(h.id)).map((h) => ({ ...h, main: false })),
    ];
    await tx
      .update(witnesses)
      .set({ hands, identifiers: unionIdentifiers(intoRow!.identifiers, fromRow!.identifiers) })
      .where(eq(witnesses.id, into.id));

    await tx.delete(witnesses).where(eq(witnesses.id, from.id));
    await recordMerge(tx, 'witness', from, into.id, user.id);
    return { ok: true, preview };
  });
}

// Works

/** Whether two schemes have the same levels: the same keys and types in the same order. Labels and separators may differ. */
export function sameLevels(a: Level[], b: Level[]): boolean {
  return (
    a.length === b.length &&
    a.every((level, i) => level.key === b[i]!.key && level.type === b[i]!.type)
  );
}

/** An address as a key: the values of the scheme's levels in order, so that the same address gives the same key. */
export function addressKey(levels: Level[], address: Address): string {
  return JSON.stringify(levels.map((level) => String(address[level.key] ?? '').trim()));
}

interface WorkPlan {
  preview: WorkMergePreview;
  /** Old segment id to the survivor's segment of the same address. */
  matched: Map<string, string>;
  /** Segments that move, with their labels and sort keys under the survivor's scheme. */
  moved: { id: string; label: string; sortKey: string }[];
  fromSchemeId: string;
  fromIdentifier: string | null;
  intoIdentifier: string | null;
  fromIdentifiers: CanonicalIdentifier[];
  intoIdentifiers: CanonicalIdentifier[];
  newMaintainerIds: string[];
  transcriptionIds: string[];
  editionIds: string[];
}

async function workPlan(db: Db, from: Entry, into: Entry): Promise<WorkPlan> {
  const rows = await db
    .select({
      id: works.id,
      schemeId: works.schemeId,
      levels: referenceSchemes.levels,
      identifier: works.identifier,
      identifiers: works.identifiers,
    })
    .from(works)
    .innerJoin(referenceSchemes, eq(referenceSchemes.id, works.schemeId))
    .where(inArray(works.id, [from.id, into.id]));
  const fromRow = rows.find((r) => r.id === from.id)!;
  const intoRow = rows.find((r) => r.id === into.id)!;
  const schemeDiffers = !sameLevels(fromRow.levels, intoRow.levels);
  const intoScheme: Scheme = { levels: intoRow.levels };

  const segmentRows = await db
    .select({
      id: segments.id,
      workId: segments.workId,
      address: segments.address,
      label: segments.label,
    })
    .from(segments)
    .where(inArray(segments.workId, [from.id, into.id]));
  const matched = new Map<string, string>();
  const moved: WorkPlan['moved'] = [];
  const labelCollisions = new Set<string>();
  if (!schemeDiffers) {
    const intoByAddress = new Map<string, string>();
    const intoLabels = new Set<string>();
    for (const s of segmentRows.filter((s) => s.workId === into.id)) {
      intoByAddress.set(addressKey(intoRow.levels, s.address), s.id);
      intoLabels.add(s.label);
    }
    for (const s of segmentRows.filter((s) => s.workId === from.id)) {
      const survivor = intoByAddress.get(addressKey(intoRow.levels, s.address));
      if (survivor) {
        matched.set(s.id, survivor);
        continue;
      }
      const label = formatLabel(intoScheme, s.address);
      if (intoLabels.has(label)) labelCollisions.add(label);
      intoLabels.add(label);
      moved.push({ id: s.id, label, sortKey: sortKey(intoScheme, s.address) });
    }
  }

  const count = async (table: typeof conjectures | typeof reportedReadings) => {
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.workId, from.id))) as [{ n: number }];
    return n;
  };
  const editionRows = await db
    .select({ id: editions.id, title: editions.title })
    .from(editions)
    .where(eq(editions.workId, from.id))
    .orderBy(asc(editions.title));
  const viaText = await db
    .selectDistinct({ id: transcriptionSegments.transcriptionId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, from.id));
  const transcriptionIds = viaText.map((r) => r.id);
  const maintainers = await newMaintainers(db, from, into);
  const extra = [
    ...(fromRow.identifier && fromRow.identifier !== intoRow.identifier
      ? [primaryAsIdentifier(fromRow.identifier)]
      : []),
  ];
  const identifiers = addedIdentifiers(
    [...extra, ...fromRow.identifiers],
    [
      ...(intoRow.identifier ? [primaryAsIdentifier(intoRow.identifier)] : []),
      ...intoRow.identifiers,
    ],
  );

  return {
    preview: {
      kind: 'work',
      from: ref(from),
      into: ref(into),
      moves: {
        segmentsMatched: matched.size,
        segmentsMoved: moved.length,
        conjectures: await count(conjectures),
        readings: await count(reportedReadings),
        editions: editionRows.map((e) => e.title),
        transcriptions: transcriptionIds.length,
        maintainers: maintainers.names,
        identifiers: identifiers.map(identifierText),
      },
      blocks: { schemeDiffers, labelCollisions: [...labelCollisions].sort() },
    },
    matched,
    moved,
    fromSchemeId: fromRow.schemeId,
    fromIdentifier: fromRow.identifier,
    intoIdentifier: intoRow.identifier,
    fromIdentifiers: fromRow.identifiers,
    intoIdentifiers: intoRow.identifiers,
    newMaintainerIds: maintainers.ids,
    transcriptionIds,
    editionIds: editionRows.map((e) => e.id),
  };
}

/** A work's primary identifier as a typed one: a CTS URN, or Other when it is something else. */
function primaryAsIdentifier(value: string): CanonicalIdentifier {
  return { scheme: /^urn:cts:/u.test(value) ? 'cts' : 'other', value };
}

/** What merging one work into another would move, and what prevents it; null when either is missing. */
export async function previewWorkMerge(
  db: Database,
  fromId: string,
  intoId: string,
): Promise<WorkMergePreview | null> {
  const [from, into] = await Promise.all([
    loadEntry(db, 'work', fromId),
    loadEntry(db, 'work', intoId),
  ]);
  if (!from || !into || from.id === into.id) return null;
  return (await workPlan(db, from, into)).preview;
}

/** Replaces, anywhere in a JSON value, every string that is a key of the map by its value. */
export function replaceIds<T>(value: T, map: Map<string, string>): T {
  if (typeof value === 'string') return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = replaceIds(v, map);
      if (r !== v) changed = true;
      return r;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = replaceIds(v, map);
      if (r !== v) changed = true;
      out[k] = r;
    }
    return (changed ? out : value) as T;
  }
  return value;
}

/**
 * Numbers the runs of a segment again where two runs of it in one stream
 * now carry the same part (a stream that assigned text to both works at the
 * same address): in the order of their parts, then of the stream.
 */
export function renumberParts(stream: Stream, segmentIds: Set<string>): Stream {
  const runs = new Map<string, { index: number; part: number }[]>();
  stream.items.forEach((item, index) => {
    if (
      item.kind === 'break' ||
      !item.segment?.segmentId ||
      !segmentIds.has(item.segment.segmentId)
    )
      return;
    const id = item.segment.segmentId;
    runs.set(id, [...(runs.get(id) ?? []), { index, part: item.segment.part ?? 1 }]);
  });
  let items = stream.items;
  for (const list of runs.values()) {
    if (new Set(list.map((r) => r.part)).size === list.length) continue;
    if (items === stream.items) items = [...stream.items];
    [...list]
      .sort((a, b) => a.part - b.part || a.index - b.index)
      .forEach((run, k) => {
        const item = items[run.index]!;
        if (item.kind !== 'break' && item.segment)
          items[run.index] = { ...item, segment: { ...item.segment, part: k + 1 } };
      });
  }
  return items === stream.items ? stream : { items };
}

/** Moves every reference to an old segment id to the survivor's segment, in a table with a segment_id column. */
async function remapColumn(tx: Tx, table: SQL, pairs: [string, string][]): Promise<void> {
  for (let i = 0; i < pairs.length; i += 500) {
    const rows = pairs.slice(i, i + 500).map(([o, n]) => sql`(${o}::text, ${n}::text)`);
    await tx.execute(
      sql`update ${table} as t set segment_id = m.new_id from (values ${sql.join(rows, sql`, `)}) as m(old_id, new_id) where t.segment_id = m.old_id`,
    );
  }
}

/** The same for a table keyed by edition, segment and site: a row the survivor's segment already has wins. */
async function remapKeyed(tx: Tx, table: SQL, pairs: [string, string][]): Promise<void> {
  for (let i = 0; i < pairs.length; i += 500) {
    const values = sql`(values ${sql.join(
      pairs.slice(i, i + 500).map(([o, n]) => sql`(${o}::text, ${n}::text)`),
      sql`, `,
    )})`;
    await tx.execute(
      sql`delete from ${table} as t using ${values} as m(old_id, new_id) where t.segment_id = m.old_id and exists (select 1 from ${table} as u where u.edition_id = t.edition_id and u.segment_id = m.new_id and u.site_key = t.site_key)`,
    );
    await tx.execute(
      sql`update ${table} as t set segment_id = m.new_id from ${values} as m(old_id, new_id) where t.segment_id = m.old_id`,
    );
  }
}

/** Rewrites the segment ids in a document's stored text, checkpoints and history; records nothing. */
async function rewriteDocument(
  tx: Tx,
  kind: 'transcription' | 'edition',
  id: string,
  map: Map<string, string>,
  targets: Set<string>,
): Promise<Stream | null> {
  const table = kind === 'transcription' ? transcriptions : editions;
  const [row] = await tx.select({ content: table.content }).from(table).where(eq(table.id, id));
  if (!row) return null;
  const content = renumberParts(replaceIds(row.content, map), targets);
  if (content !== row.content) await tx.update(table).set({ content }).where(eq(table.id, id));
  const kept = await tx
    .select({ version: checkpoints.version, content: checkpoints.content })
    .from(checkpoints)
    .where(and(eq(checkpoints.documentKind, kind), eq(checkpoints.documentId, id)));
  for (const checkpoint of kept) {
    const rewritten = replaceIds(checkpoint.content, map);
    if (rewritten !== checkpoint.content)
      await tx
        .update(checkpoints)
        .set({ content: rewritten })
        .where(
          and(
            eq(checkpoints.documentKind, kind),
            eq(checkpoints.documentId, id),
            eq(checkpoints.version, checkpoint.version),
          ),
        );
  }
  const history = await tx
    .select({ id: changesets.id, ops: changesets.ops, reverse: changesets.reverse })
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, id),
        or(
          sql`strpos(${changesets.ops}::text, '"segmentId"') > 0`,
          sql`strpos(${changesets.reverse}::text, '"segmentId"') > 0`,
        ),
      ),
    );
  for (const c of history) {
    const ops = replaceIds(c.ops, map);
    const reverse = replaceIds(c.reverse, map);
    if (ops !== c.ops || reverse !== c.reverse)
      await tx.update(changesets).set({ ops, reverse }).where(eq(changesets.id, c.id));
  }
  return content;
}

/**
 * Merges one work into another. Segments are matched by address: a matched
 * segment's references all move to the survivor's segment (in the texts of
 * transcriptions and editions, the segment index, conjectures, reported
 * readings, notes, citations, alignment constraints, site reviews and site
 * kinds; cached collations are dropped), and the others move to the
 * survivor with labels in its scheme. Conjectures, reported readings,
 * editions, the transcriptions made for the work and its maintainers move;
 * the work is removed with its scheme when no other work uses it, and the
 * merge recorded. Refused for anyone but an administrator or a maintainer of
 * both, and while the preview names anything that prevents it.
 */
export async function mergeWorks(
  db: Database,
  fromId: string,
  intoId: string,
  user: Actor | null,
): Promise<MergeResult> {
  if (fromId === intoId) return { ok: false, error: 'same' };
  const rewritten: { kind: 'transcription' | 'edition'; id: string }[] = [];
  const result = await db.transaction(async (tx): Promise<MergeResult> => {
    const [first, second] = [fromId, intoId].sort();
    const a = await loadEntry(tx, 'work', first!, true);
    const b = await loadEntry(tx, 'work', second!, true);
    const from = a?.id === fromId ? a : b;
    const into = a?.id === intoId ? a : b;
    if (!a || !b || !from || !into) return { ok: false, error: 'not-found' };
    if (!user || !canMergeEntries(user, from, into)) return { ok: false, error: 'forbidden' };
    const plan = await workPlan(tx, from, into);
    if (isBlocked(plan.preview)) return { ok: false, error: 'blocked', preview: plan.preview };

    const pairs = [...plan.matched];
    const targets = new Set(plan.matched.values());
    // The editions of either work: their cached collations go, as their witnesses' segments change.
    const allEditionIds = (
      await tx
        .select({ id: editions.id })
        .from(editions)
        .where(inArray(editions.workId, [from.id, into.id]))
    ).map((e) => e.id);
    if (allEditionIds.length)
      await tx.delete(collationCache).where(inArray(collationCache.editionId, allEditionIds));

    if (pairs.length) {
      await remapColumn(tx, sql`conjectures`, pairs);
      await remapColumn(tx, sql`reported_readings`, pairs);
      await remapColumn(tx, sql`notes`, pairs);
      await remapColumn(tx, sql`citations`, pairs);
      await remapColumn(tx, sql`alignment_constraints`, pairs);
      await remapKeyed(tx, sql`edition_site_reviews`, pairs);
      await remapKeyed(tx, sql`edition_site_kinds`, pairs);
      // A transposition names the segments it reorders.
      const sequences = await tx
        .select({ id: conjectures.id, sequence: conjectures.sequence })
        .from(conjectures)
        .where(
          and(
            inArray(conjectures.workId, [from.id, into.id]),
            sql`${conjectures.sequence} is not null`,
          ),
        );
      for (const c of sequences) {
        const sequence = replaceIds(c.sequence, plan.matched);
        if (sequence !== c.sequence)
          await tx.update(conjectures).set({ sequence }).where(eq(conjectures.id, c.id));
      }
    }

    // Segments the survivor lacks move to it, labelled in its scheme.
    for (let i = 0; i < plan.moved.length; i += 500) {
      const rows = plan.moved
        .slice(i, i + 500)
        .map((m) => sql`(${m.id}::text, ${m.label}::text, ${m.sortKey}::text)`);
      await tx.execute(
        sql`update ${segments} set work_id = ${into.id}, label = v.label, sort_key = v.sort_key from (values ${sql.join(rows, sql`, `)}) as v(id, label, sort_key) where ${segments.id} = v.id`,
      );
    }

    await tx.update(conjectures).set({ workId: into.id }).where(eq(conjectures.workId, from.id));
    await tx
      .update(reportedReadings)
      .set({ workId: into.id })
      .where(eq(reportedReadings.workId, from.id));
    await tx.update(editions).set({ workId: into.id }).where(eq(editions.workId, from.id));
    // The texts: segment ids moved in place, and the index of each transcription built again.
    for (const id of plan.transcriptionIds) {
      const content = pairs.length
        ? await rewriteDocument(tx, 'transcription', id, plan.matched, targets)
        : null;
      if (pairs.length) rewritten.push({ kind: 'transcription', id });
      const stream =
        content ??
        (
          await tx
            .select({ content: transcriptions.content })
            .from(transcriptions)
            .where(eq(transcriptions.id, id))
        )[0]?.content;
      if (stream) await rebuildSegmentIndex(tx as unknown as Database, id, stream);
    }
    if (pairs.length) {
      for (const id of plan.editionIds) {
        await rewriteDocument(tx, 'edition', id, plan.matched, targets);
        rewritten.push({ kind: 'edition', id });
      }
    }

    await addMaintainers(tx, 'work', from, into.id, plan.newMaintainerIds);
    // The survivor keeps its own primary identifier; the merged work's goes with the others.
    const intoIdentifier = plan.intoIdentifier ?? plan.fromIdentifier;
    const fromPrimary =
      plan.fromIdentifier && plan.fromIdentifier !== intoIdentifier
        ? [primaryAsIdentifier(plan.fromIdentifier)]
        : [];
    await tx
      .update(works)
      .set({
        identifier: intoIdentifier,
        identifiers: unionIdentifiers(plan.intoIdentifiers, [
          ...fromPrimary,
          ...plan.fromIdentifiers,
        ]),
      })
      .where(eq(works.id, into.id));

    // What is left of the merged work: its matched segments, now referred to by nothing.
    if (pairs.length) await tx.delete(segments).where(and(eq(segments.workId, from.id)));
    await tx.delete(works).where(eq(works.id, from.id));
    const [{ n: sharers }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(works)
      .where(eq(works.schemeId, plan.fromSchemeId))) as [{ n: number }];
    if (sharers === 0)
      await tx.delete(referenceSchemes).where(eq(referenceSchemes.id, plan.fromSchemeId));
    await recordMerge(tx, 'work', from, into.id, user.id);
    return { ok: true, preview: plan.preview };
  });
  if (result.ok) for (const d of rewritten) forgetPastVersions(d.kind, d.id);
  return result;
}
