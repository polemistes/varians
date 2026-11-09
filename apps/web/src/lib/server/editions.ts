/**
 * Creating editions: a text started from one witness's transcription for a
 * range of segments, with a conspectus, saved as the first changeset.
 */
import { deriveEdition, newId, segmentIds as segmentIdsOf, type Stream } from '@varians/core';
import {
  editionSigla,
  editions,
  segments,
  transcriptionSegments,
  transcriptions,
  witnesses,
  type Database,
  type Edition,
  type EditionConventions,
  type SiglumState,
} from '@varians/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { replaceContent } from './documents/service.ts';
import { canViewTranscription, type Actor, type Grants, type Maybe } from './authz.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';

export interface NewEdition {
  workId: string;
  title: string;
  slug?: string;
  editors?: string[];
  preface?: string | null;
  /** The transcription whose read forms become the first text. */
  baseTranscriptionId: string | null;
  /** Segment ids to take from the base; all of its segments of the work when empty. */
  segmentIds?: string[];
  /** The conspectus: witnesses with their transcription and siglum, in order. */
  sigla: { witnessId: string; transcriptionId: string | null; siglum: string }[];
  conventions?: Partial<EditionConventions>;
}

function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'edition'
  );
}

export async function uniqueEditionSlug(db: Database, base: string): Promise<string> {
  const wanted = slugify(base);
  let slug = wanted;
  for (let n = 2; n < 1000; n++) {
    const [row] = await db.select({ id: editions.id }).from(editions).where(eq(editions.slug, slug));
    if (!row) return slug;
    slug = `${wanted}-${n}`;
  }
  return `${wanted}-${newId().slice(-6).toLowerCase()}`;
}

/** Create an edition and its first text. */
export async function createEdition(db: Database, input: NewEdition, ownerId: string): Promise<Edition> {
  const id = newId();
  const slug = await uniqueEditionSlug(db, input.slug ?? input.title);
  let content: Stream = { items: [] };
  if (input.baseTranscriptionId) {
    const [base] = await db.select().from(transcriptions).where(eq(transcriptions.id, input.baseTranscriptionId));
    if (!base) throw new Error('no such base transcription');
    // Only this work's segments come along: a transcription may assign to several works.
    const ofWork = new Set(
      (await db.select({ id: segments.id }).from(segments).where(eq(segments.workId, input.workId))).map((s) => s.id),
    );
    const chosen = new Set((input.segmentIds?.length ? input.segmentIds : segmentIdsOf(base.content)).filter((sid) => ofWork.has(sid)));
    content = deriveEdition(base.content, base.id, { segmentIds: chosen });
  }
  const conventions: EditionConventions = { ...DEFAULT_CONVENTIONS, ...(input.conventions ?? {}) };
  await db.insert(editions).values({
    id,
    workId: input.workId,
    slug,
    title: input.title.trim(),
    editors: input.editors ?? [],
    preface: input.preface?.trim() || null,
    ownerId,
    conventions,
  });
  if (content.items.length) await replaceContent(db, 'edition', id, ownerId, 0, content, 'based on the first witness');
  if (input.sigla.length) {
    await db.insert(editionSigla).values(
      input.sigla.map((s, i) => ({ editionId: id, witnessId: s.witnessId, transcriptionId: s.transcriptionId, siglum: s.siglum.trim() || `W${i + 1}`, position: i })),
    );
  }
  const [row] = await db.select().from(editions).where(eq(editions.id, id));
  return row!;
}

/** The transcriptions assigning text to a work, with their witnesses, for the new-edition form. */
export interface CandidateWitness {
  transcriptionId: string;
  transcriptionName: string;
  witnessId: string;
  witnessName: string;
  siglum: string;
  segments: number;
}

/**
 * The transcriptions of a work that a person may put in a conspectus: those
 * they may view (their own, published ones, and those their editions reach),
 * never another person's drafts.
 */
export async function candidateWitnesses(db: Database, workId: string, viewer: Maybe<Actor>, grants: Grants): Promise<CandidateWitness[]> {
  const rows = await db
    .select({ transcriptionId: transcriptionSegments.transcriptionId, segmentId: transcriptionSegments.segmentId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId));
  const counts = new Map<string, Set<string>>();
  for (const r of rows) counts.set(r.transcriptionId, (counts.get(r.transcriptionId) ?? new Set()).add(r.segmentId));
  const ids = [...counts.keys()];
  if (ids.length === 0) return [];
  const trs = await db
    .select({
      transcriptionId: transcriptions.id,
      transcriptionName: transcriptions.name,
      witnessId: witnesses.id,
      witnessName: witnesses.name,
      siglum: witnesses.siglum,
      visibility: transcriptions.visibility,
      ownerId: transcriptions.ownerId,
    })
    .from(transcriptions)
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .where(inArray(transcriptions.id, ids))
    .orderBy(asc(witnesses.siglum));
  return trs
    .filter((t) => canViewTranscription(viewer, { id: t.transcriptionId, ownerId: t.ownerId, visibility: t.visibility }, grants))
    .map(({ visibility: _visibility, ownerId: _ownerId, ...t }) => ({ ...t, segments: counts.get(t.transcriptionId)?.size ?? 0 }));
}

export async function updateEditionMeta(
  db: Database,
  editionId: string,
  fields: Partial<Pick<Edition, 'title' | 'editors' | 'preface' | 'sources' | 'licence' | 'conventions'>>,
): Promise<void> {
  await db.update(editions).set(fields).where(eq(editions.id, editionId));
}

/** Replace the conspectus. */
export async function setSigla(db: Database, editionId: string, sigla: { witnessId: string; transcriptionId: string | null; siglum: string; states?: SiglumState[]; variantSiglum?: string | null }[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(editionSigla).where(eq(editionSigla.editionId, editionId));
    if (sigla.length) {
      await tx.insert(editionSigla).values(
        sigla.map((s, i) => ({ editionId, witnessId: s.witnessId, transcriptionId: s.transcriptionId, siglum: s.siglum.trim(), position: i, states: s.states ?? [], variantSiglum: s.variantSiglum ?? null })),
      );
    }
  });
}

export async function editionsOfWork(db: Database, workId: string): Promise<Edition[]> {
  return db.select().from(editions).where(and(eq(editions.workId, workId))).orderBy(asc(editions.createdAt));
}
