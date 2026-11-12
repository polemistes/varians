/**
 * What Make New Edition, Edition Settings and the editor's Witnesses and
 * Sigla window read and check: the conspectus with the witnesses and the
 * transcripts it may name, the edition's descriptive fields and conventions.
 */
import {
  editionSigla,
  reportedReadings,
  transcriptionSegments,
  transcriptions,
  users,
  witnesses,
  type Database,
  type Edition,
  type EditionConventions,
} from '@varians/db';
import { and, asc, countDistinct, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { ConspectusRow, ConspectusWitness, SuggestedWitness } from '$lib/edition/conspectus';
import { withoutLatin } from '$lib/edition/conventions';
import { editorNames } from '$lib/edition/editors';
import { draftsOf, type GroupDraft, type GroupProblem } from '$lib/edition/groups';
import { edition as s } from '$lib/strings/edition';
import { canViewTranscription, type Actor, type Grants } from './authz.ts';
import { hasVersionSql } from './versions.ts';
import { GroupsRefused, candidateWitnesses, setSigla } from './editions.ts';

/**
 * The witnesses named, each with the transcripts of it the person may put in
 * a conspectus (their own, published ones, those their editions reach; never
 * another person's draft), whether or not they have text of the work yet.
 * The transcripts in `keep` are listed whatever the person may see: those the
 * conspectus already names.
 */
export async function conspectusWitnesses(
  db: Database,
  viewer: Actor,
  grants: Grants,
  witnessIds: string[],
  workId: string | null,
  keep: Iterable<string> = [],
): Promise<Record<string, ConspectusWitness>> {
  const ids = [...new Set(witnessIds)];
  if (ids.length === 0) return {};
  const kept = new Set(keep);
  const [rows, trs] = await Promise.all([
    db
      .select({
        id: witnesses.id,
        slug: witnesses.slug,
        name: witnesses.name,
        siglum: witnesses.siglum,
        hands: witnesses.hands,
      })
      .from(witnesses)
      .where(inArray(witnesses.id, ids)),
    db
      .select({
        id: transcriptions.id,
        name: transcriptions.name,
        witnessId: transcriptions.witnessId,
        ownerId: transcriptions.ownerId,
        ownerName: users.name,
        hasVersion: hasVersionSql('transcription', transcriptions.id),
      })
      .from(transcriptions)
      .innerJoin(users, eq(users.id, transcriptions.ownerId))
      .where(inArray(transcriptions.witnessId, ids))
      .orderBy(asc(transcriptions.name), asc(transcriptions.createdAt)),
  ]);
  const usable = trs.filter((t) => kept.has(t.id) || canViewTranscription(viewer, t, grants));
  const counts = new Map<string, number>();
  if (workId && usable.length) {
    const found = await db
      .select({
        id: transcriptionSegments.transcriptionId,
        n: countDistinct(transcriptionSegments.segmentId),
      })
      .from(transcriptionSegments)
      .where(
        and(
          eq(transcriptionSegments.workId, workId),
          inArray(
            transcriptionSegments.transcriptionId,
            usable.map((t) => t.id),
          ),
        ),
      )
      .groupBy(transcriptionSegments.transcriptionId);
    for (const c of found) counts.set(c.id, Number(c.n));
  }
  return Object.fromEntries(
    rows.map((w) => [
      w.id,
      {
        ...w,
        transcripts: usable
          .filter((t) => t.witnessId === w.id)
          .map((t) => ({
            id: t.id,
            name: t.name,
            ownerName: t.ownerName,
            own: t.ownerId === viewer.id,
            segments: counts.get(t.id) ?? 0,
          })),
      },
    ]),
  );
}

/**
 * The witnesses offered first when one is added to a conspectus of the
 * work: those with a transcript of it the person may use, by siglum, then
 * those known from reported readings of it.
 */
export async function suggestedWitnesses(
  db: Database,
  viewer: Actor,
  grants: Grants,
  workId: string,
): Promise<SuggestedWitness[]> {
  const transcribed = await candidateWitnesses(db, workId, viewer, grants);
  const seen = new Set<string>();
  const out: SuggestedWitness[] = [];
  const transcribedIds = [...new Set(transcribed.map((c) => c.witnessId))];
  const slugs = new Map(
    (transcribedIds.length
      ? await db
          .select({ id: witnesses.id, slug: witnesses.slug })
          .from(witnesses)
          .where(inArray(witnesses.id, transcribedIds))
      : []
    ).map((w) => [w.id, w.slug]),
  );
  for (const c of transcribed) {
    if (seen.has(c.witnessId)) continue;
    seen.add(c.witnessId);
    out.push({
      id: c.witnessId,
      slug: slugs.get(c.witnessId) ?? '',
      name: c.witnessName,
      siglum: c.siglum,
      reason: 'transcribed',
    });
  }
  const reported = await db
    .selectDistinct({
      id: witnesses.id,
      slug: witnesses.slug,
      name: witnesses.name,
      siglum: witnesses.siglum,
    })
    .from(reportedReadings)
    .innerJoin(witnesses, eq(witnesses.id, reportedReadings.witnessId))
    .where(eq(reportedReadings.workId, workId))
    .orderBy(asc(witnesses.siglum));
  for (const w of reported) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ ...w, reason: 'reported' });
  }
  return out;
}

/** The conspectus of an edition as its rows, with the witnesses they name and the edition's groups. */
export async function editionConspectus(
  db: Database,
  viewer: Actor,
  grants: Grants,
  edition: Pick<Edition, 'id' | 'workId' | 'conventions'>,
): Promise<{
  rows: ConspectusRow[];
  witnesses: Record<string, ConspectusWitness>;
  groups: GroupDraft[];
}> {
  const sigla = await db
    .select()
    .from(editionSigla)
    .where(eq(editionSigla.editionId, edition.id))
    .orderBy(editionSigla.position);
  return {
    rows: sigla.map((x) => ({
      witnessId: x.witnessId,
      transcriptionId: x.transcriptionId,
      siglum: x.siglum,
      states: x.states,
      variantSiglum: x.variantSiglum,
    })),
    witnesses: await conspectusWitnesses(
      db,
      viewer,
      grants,
      sigla.map((x) => x.witnessId),
      edition.workId,
      sigla.map((x) => x.transcriptionId).filter((id): id is string => !!id),
    ),
    groups: draftsOf(edition.conventions.groups, sigla),
  };
}

// The conspectus as a form carries it: rows and groups as JSON.

const siglumText = z.string().trim().min(1).max(20);
const stateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('original'), siglum: siglumText }),
  z.object({ kind: z.literal('stage'), stage: z.number().int().min(1).max(9), siglum: siglumText }),
  z.object({ kind: z.literal('hand'), hand: z.string().trim().min(1).max(64), siglum: siglumText }),
]);
const rowsSchema = z
  .array(
    z.object({
      witnessId: z.string().min(1).max(64),
      transcriptionId: z.string().min(1).max(64).nullable(),
      siglum: siglumText,
      states: z.array(stateSchema).max(10).optional(),
      variantSiglum: z.string().trim().max(20).nullable().optional(),
    }),
  )
  .max(200);
const groupsSchema = z
  .array(
    z.object({
      siglum: z.string().trim().max(20),
      note: z.string().trim().max(200).optional(),
      witnessIds: z.array(z.string().min(1).max(64)).max(200),
    }),
  )
  .max(50);

export type ParsedConspectus =
  | { ok: true; rows: ConspectusRow[]; groups: GroupDraft[] | undefined }
  | { ok: false; message: string };

/**
 * The rows in `sigla` and the groups in `groups`. Without `groups` the
 * edition's own are kept true to the new conspectus. A witness appears once,
 * and no siglum, of a witness, a state or its noted variants, twice.
 */
export function parseConspectus(form: FormData): ParsedConspectus {
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get('sigla') ?? '[]'));
  } catch {
    return { ok: false, message: s.errors.siglaUnreadable };
  }
  const parsed = rowsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: s.errors.siglumRequired };
  let groups: GroupDraft[] | undefined;
  if (form.has('groups')) {
    let rawGroups: unknown;
    try {
      rawGroups = JSON.parse(String(form.get('groups')));
    } catch {
      rawGroups = null;
    }
    const parsedGroups = groupsSchema.safeParse(rawGroups);
    if (!parsedGroups.success) return { ok: false, message: s.errors.groupsUnreadable };
    groups = parsedGroups.data;
  }
  const witnessesSeen = new Set<string>();
  const sigla = new Set<string>();
  for (const row of parsed.data) {
    if (witnessesSeen.has(row.witnessId)) return { ok: false, message: s.errors.witnessTwice };
    witnessesSeen.add(row.witnessId);
    for (const siglum of [
      row.siglum,
      ...(row.states ?? []).map((x) => x.siglum),
      row.variantSiglum,
    ].filter((x): x is string => !!x)) {
      if (sigla.has(siglum)) return { ok: false, message: s.errors.duplicateSiglum(siglum) };
      sigla.add(siglum);
    }
  }
  return {
    ok: true,
    rows: parsed.data.map((row) => ({
      witnessId: row.witnessId,
      transcriptionId: row.transcriptionId,
      siglum: row.siglum,
      // States and noted variants are of a transcript; a witness without one has neither.
      states: row.transcriptionId ? (row.states ?? []) : [],
      variantSiglum: row.transcriptionId ? row.variantSiglum || null : null,
    })),
    groups,
  };
}

/**
 * Why the rows may not be saved, or null: every witness must exist, and
 * every transcript be of its witness and one the person may use, or one the
 * edition's conspectus names already for that witness.
 */
export async function conspectusRefusal(
  db: Database,
  viewer: Actor,
  grants: Grants,
  rows: ConspectusRow[],
  editionId: string | null,
): Promise<string | null> {
  const ids = [...new Set(rows.map((r) => r.witnessId))];
  if (ids.length === 0) return null;
  const known = new Set(
    (await db.select({ id: witnesses.id }).from(witnesses).where(inArray(witnesses.id, ids))).map(
      (w) => w.id,
    ),
  );
  if (rows.some((r) => !known.has(r.witnessId))) return s.errors.unknownWitness;
  const named = rows.map((r) => r.transcriptionId).filter((id): id is string => !!id);
  if (named.length === 0) return null;
  const found = new Map(
    (
      await db
        .select({
          id: transcriptions.id,
          ownerId: transcriptions.ownerId,
          witnessId: transcriptions.witnessId,
          hasVersion: hasVersionSql('transcription', transcriptions.id),
        })
        .from(transcriptions)
        .where(inArray(transcriptions.id, named))
    ).map((t) => [t.id, t]),
  );
  const current = new Set(
    editionId
      ? (
          await db
            .select({ witnessId: editionSigla.witnessId, t: editionSigla.transcriptionId })
            .from(editionSigla)
            .where(eq(editionSigla.editionId, editionId))
        ).map((c) => `${c.witnessId}|${c.t}`)
      : [],
  );
  for (const row of rows) {
    if (!row.transcriptionId) continue;
    const t = found.get(row.transcriptionId);
    if (!t || t.witnessId !== row.witnessId) return s.errors.transcriptNotOfWitness;
    if (
      !current.has(`${row.witnessId}|${row.transcriptionId}`) &&
      !canViewTranscription(viewer, t, grants)
    )
      return s.errors.transcriptNotOfWitness;
  }
  return null;
}

/** What is wrong with a group, in words. */
export function groupMessage(problem: GroupProblem): string {
  if (problem.kind === 'siglum') return s.errors.groupSiglumRequired;
  if (problem.kind === 'too-few') return s.errors.groupTooFew(problem.siglum);
  return s.errors.duplicateSiglum(problem.siglum);
}

/** Saves the conspectus and its groups; a message when the groups cannot be kept, which saves nothing. */
export async function saveConspectus(
  db: Database,
  editionId: string,
  rows: ConspectusRow[],
  groups: GroupDraft[] | undefined,
): Promise<string | null> {
  try {
    await setSigla(db, editionId, rows, groups);
    return null;
  } catch (cause) {
    if (cause instanceof GroupsRefused) return groupMessage(cause.problem);
    throw cause;
  }
}

// The edition's descriptive fields and conventions, as Edition Settings sends them.

const nameSchema = z.object({
  title: z.string().trim().min(1, s.errors.titleRequired).max(200),
  editors: z.array(z.string().max(200, s.errors.editorTooLong)).max(20, s.errors.editorsTooMany),
});

/** The name of an edition and its editors, which Make New Edition asks for too. */
export function parseName(
  form: FormData,
):
  | { ok: true; title: string; editors: string[] }
  | { ok: false; errors: Record<string, string[] | undefined> } {
  const parsed = nameSchema.safeParse({
    title: String(form.get('title') ?? ''),
    editors: editorNames(form.getAll('editors')),
  });
  if (!parsed.success) return { ok: false, errors: z.flattenError(parsed.error).fieldErrors };
  return { ok: true, ...parsed.data };
}

const settingsSchema = nameSchema.extend({
  preface: z.string().max(50000),
  sources: z.string().max(5000),
  rightsNote: z.string().trim().max(300),
  lineation: z.enum(['verse', 'prose']),
  numberEvery: z.coerce.number().int().min(1).max(100),
  speakerDisplay: z.enum(['inline', 'margin', 'own-line']),
});

export type SettingsFields = Pick<
  Edition,
  'title' | 'editors' | 'preface' | 'sources' | 'rightsNote' | 'conventions'
>;

/**
 * The fields of Edition Settings over the edition's conventions as they
 * are: the name, editors, preface, sources, note on rights, and how the
 * text is laid out. What an edition has stored for its print apparatus
 * (`apparatus`, `interpretative`, `rest`, `all`) is not a field of the page
 * and stays as it was. A stored `latin`, which editions made before had, is
 * dropped.
 */
export function parseSettings(
  form: FormData,
  conventions: EditionConventions,
):
  | { ok: true; fields: SettingsFields }
  | { ok: false; errors: Record<string, string[] | undefined> } {
  const text = (name: string) => String(form.get(name) ?? '');
  const parsed = settingsSchema.safeParse({
    title: text('title'),
    editors: editorNames(form.getAll('editors')),
    preface: text('preface'),
    sources: text('sources'),
    rightsNote: text('rightsNote'),
    lineation: text('lineation') || 'verse',
    numberEvery: text('numberEvery') || '5',
    speakerDisplay: text('speakerDisplay') || 'margin',
  });
  if (!parsed.success) return { ok: false, errors: z.flattenError(parsed.error).fieldErrors };
  const data = parsed.data;
  return {
    ok: true,
    fields: {
      title: data.title,
      editors: data.editors,
      preface: data.preface.trim() || null,
      sources: data.sources.trim() || null,
      rightsNote: data.rightsNote || null,
      conventions: {
        ...withoutLatin(conventions),
        lineation: data.lineation,
        numberEvery: data.numberEvery,
        speakerDisplay: data.speakerDisplay,
      },
    },
  };
}
