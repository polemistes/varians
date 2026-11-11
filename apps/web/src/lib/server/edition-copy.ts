/**
 * Copying an edition: a draft of one's own, made from the
 * edition as the copier may see it. Its editors copy the draft as it
 * stands; anyone else copies the published version, with the conspectus
 * it was published with. What comes along: the text with its sources, the
 * conspectus, the adopted conjectures, the notes and their references, the
 * alignments, the kinds set on sites, the conventions. What does not: the history, collaborators,
 * reviews and published versions. The copy remembers where it came from.
 */
import { isToken, newId, type Stream } from '@varians/core';
import {
  alignmentConstraints,
  citations,
  editionAdoptions,
  editionSigla,
  editionSiteKinds,
  editions,
  notes,
  transcriptions,
  type Database,
  type Edition,
  type EditionOrigin,
} from '@varians/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { withoutLatin } from '$lib/edition/conventions';
import { canViewTranscription, grantsFor, type Actor } from './authz.ts';
import { replaceContent } from './documents/service.ts';
import { loadEditionAccess } from './edition-access.ts';
import { uniqueEditionSlug } from './editions.ts';
import { loadEditionContext } from './collation.ts';
import { contextAt } from './reader.ts';
import { publishedVersions } from './publish.ts';
import { deleteHistory } from './registry.ts';

export type CopyRefusal = 'not-found' | 'forbidden';

export interface EditionCopy {
  edition: Edition;
  /** Witnesses whose transcription the copier may not see: in the copy without one. */
  withoutTranscription: number;
}

/** Make a copy of an edition for `user`, under `title`. */
export async function copyEdition(
  db: Database,
  user: Actor,
  sourceId: string,
  title: string,
): Promise<EditionCopy | CopyRefusal> {
  const access = await loadEditionAccess(db, user, sourceId);
  if (!access) return 'not-found';
  const source = access.edition;
  // Editors copy the draft; readers the published version, and only that.
  const asEditor = access.canEdit;
  if (!asEditor && (!access.canView || source.publishedVersion === null)) return 'forbidden';
  const { context } = asEditor
    ? { context: await loadEditionContext(db, source.id) }
    : await contextAt(db, source.id, source.publishedVersion);
  const content: Stream = context.edition.content;
  const version = asEditor ? source.version : source.publishedVersion!;

  // The conspectus: each witness with its transcription, where the copier may see it.
  const grants = await grantsFor(db, user);
  const named = context.sigla
    .map((s) => s.transcriptionId)
    .filter((id): id is string => id !== null);
  const rows = named.length
    ? await db
        .select({
          id: transcriptions.id,
          ownerId: transcriptions.ownerId,
          visibility: transcriptions.visibility,
        })
        .from(transcriptions)
        .where(inArray(transcriptions.id, named))
    : [];
  const visible = new Set(
    rows.filter((r) => canViewTranscription(user, r, grants)).map((r) => r.id),
  );
  let withoutTranscription = 0;
  const sigla = context.sigla.map((s, position) => {
    const keep = s.transcriptionId !== null && visible.has(s.transcriptionId);
    if (s.transcriptionId !== null && !keep) withoutTranscription++;
    return {
      witnessId: s.witnessId,
      transcriptionId: keep ? s.transcriptionId : null,
      siglum: s.siglum,
      states: s.states,
      variantSiglum: s.variantSiglum,
      position,
    };
  });

  const id = newId();
  const number = asEditor
    ? null
    : ((await publishedVersions(db, source.id)).find((m) => m.version === version)?.number ?? null);
  const origin: EditionOrigin = {
    editionId: source.id,
    title: source.title,
    editors: source.editors,
    version,
    published: !asEditor,
    number,
  };
  await db.insert(editions).values({
    id,
    workId: source.workId,
    slug: await uniqueEditionSlug(db, title),
    title: title.trim(),
    // The names printed are the original's editors': kept for an editor's own copy, left for the new editor to give otherwise.
    editors: asEditor ? source.editors : [],
    preface: source.preface,
    sources: source.sources,
    rightsNote: source.rightsNote,
    ownerId: user.id,
    conventions: withoutLatin(source.conventions),
    copiedFrom: origin,
  });
  try {
    if (content.items.length)
      await replaceContent(
        db,
        'edition',
        id,
        user.id,
        0,
        content,
        `copied from ${source.title}, version ${version}`,
      );
    if (sigla.length)
      await db.insert(editionSigla).values(sigla.map((s) => ({ editionId: id, ...s })));

    const adopted = await db
      .select({ conjectureId: editionAdoptions.conjectureId })
      .from(editionAdoptions)
      .where(eq(editionAdoptions.editionId, source.id));
    if (adopted.length)
      await db
        .insert(editionAdoptions)
        .values(adopted.map((a) => ({ editionId: id, conjectureId: a.conjectureId })));

    // Notes and alignments come along where the words they are about are in the copied text.
    const present = new Set(content.items.filter(isToken).map((t) => t.id));
    const sourceNotes = await db.select().from(notes).where(eq(notes.editionId, source.id));
    const noteIds = new Map<string, string>();
    const keptNotes = sourceNotes.filter((n) => n.tokenIds.every((t) => present.has(t)));
    for (const n of keptNotes) noteIds.set(n.id, newId());
    if (keptNotes.length) {
      await db.insert(notes).values(
        keptNotes.map((n) => ({
          id: noteIds.get(n.id)!,
          editionId: id,
          segmentId: n.segmentId,
          tokenIds: n.tokenIds,
          text: n.text,
          authorId: n.authorId,
        })),
      );
    }
    const sourceCitations = await db
      .select()
      .from(citations)
      .where(eq(citations.editionId, source.id));
    const noteCitations = keptNotes.length
      ? await db
          .select()
          .from(citations)
          .where(
            inArray(
              citations.noteId,
              keptNotes.map((n) => n.id),
            ),
          )
      : [];
    const copiedCitations = [
      ...sourceCitations.filter((c) => c.noteId === null),
      ...noteCitations,
    ].map((c) => ({
      id: newId(),
      itemId: c.itemId,
      conjectureId: c.conjectureId,
      reportedReadingId: c.reportedReadingId,
      noteId: c.noteId ? (noteIds.get(c.noteId) ?? null) : null,
      editionId: c.editionId ? id : null,
      segmentId: c.segmentId,
      prenote: c.prenote,
      postnote: c.postnote,
      position: c.position,
    }));
    if (copiedCitations.length) await db.insert(citations).values(copiedCitations);

    const constraints = await db
      .select()
      .from(alignmentConstraints)
      .where(eq(alignmentConstraints.editionId, source.id));
    const keptConstraints = constraints.filter(
      (c) =>
        c.baseTokenIds.every((t) => present.has(t)) &&
        (c.transcriptionId === null || visible.has(c.transcriptionId)),
    );
    if (keptConstraints.length) {
      await db.insert(alignmentConstraints).values(
        keptConstraints.map((c) => ({
          id: newId(),
          editionId: id,
          segmentId: c.segmentId,
          baseTokenIds: c.baseTokenIds,
          transcriptionId: c.transcriptionId,
          witnessTokenIds: c.witnessTokenIds,
        })),
      );
    }

    const kinds = [...context.siteKinds].flatMap(([segmentId, bySite]) =>
      [...bySite].map(([siteKey, k]) => ({
        editionId: id,
        segmentId,
        siteKey,
        kind: k.kind ?? null,
        minor: k.minor ?? false,
        setBy: user.id,
      })),
    );
    if (kinds.length) await db.insert(editionSiteKinds).values(kinds);
  } catch (cause) {
    // No half-made copy: its history goes, and all else hangs on the edition row and goes with it.
    await db.transaction(async (tx) => {
      await deleteHistory(tx, 'edition', [id]);
      await tx.delete(editions).where(and(eq(editions.id, id), isNull(editions.publishedVersion)));
    });
    throw cause;
  }
  const [row] = await db.select().from(editions).where(eq(editions.id, id));
  return { edition: row!, withoutTranscription };
}
