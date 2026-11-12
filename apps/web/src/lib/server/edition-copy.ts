/**
 * Copying an edition: a draft of one's own, made from the
 * edition as the copier may see it. Its editors copy the draft as it
 * stands; anyone else copies its latest version, from the version's
 * snapshot, with the conspectus it was published with. What comes along: the text with its sources, the
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
  type EditionSnapshot,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { withoutLatin } from '$lib/edition/conventions';
import { canViewTranscription, grantsFor, type Actor } from './authz.ts';
import { replaceContent } from './documents/service.ts';
import { loadEditionAccess } from './edition-access.ts';
import { uniqueEditionSlug } from './editions.ts';
import { draftSource, versionSource } from './reader.ts';
import { deleteHistory } from './registry.ts';
import { hasVersionSql, latestVersionWithSnapshot } from './versions.ts';

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
  // A draft one may not see is answered as if there were none.
  if (!access || !access.canView) return 'not-found';
  const source = access.edition;
  // Editors copy the draft; readers the latest version, and only that.
  const asEditor = access.canEdit;
  const latest = asEditor ? null : await latestVersionWithSnapshot(db, 'edition', source.id);
  if (!asEditor && !latest) return 'forbidden';
  const read = latest ? await versionSource(db, source, latest) : await draftSource(db, source.id);
  const snapshot = latest ? (latest.snapshot as EditionSnapshot) : null;
  const { context, meta } = read;
  const content: Stream = context.edition.content;
  const version = context.edition.version;

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
          hasVersion: hasVersionSql('transcription', transcriptions.id),
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
  const number = latest?.number ?? null;
  const origin: EditionOrigin = {
    editionId: source.id,
    title: meta.title,
    editors: meta.editors,
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
    editors: asEditor ? meta.editors : [],
    preface: meta.preface,
    sources: meta.sources,
    rightsNote: meta.rightsNote,
    ownerId: user.id,
    conventions: withoutLatin(meta.conventions),
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
        `copied from ${meta.title}, version ${version}`,
      );
    if (sigla.length)
      await db.insert(editionSigla).values(sigla.map((s) => ({ editionId: id, ...s })));

    const adopted = snapshot
      ? snapshot.adoptions
      : await db
          .select({ conjectureId: editionAdoptions.conjectureId })
          .from(editionAdoptions)
          .where(eq(editionAdoptions.editionId, source.id));
    if (adopted.length)
      await db
        .insert(editionAdoptions)
        .values(adopted.map((a) => ({ editionId: id, conjectureId: a.conjectureId })));

    // Notes and alignments come along where the words they are about are in the copied text.
    const present = new Set(content.items.filter(isToken).map((t) => t.id));
    // Of a version, its notes as they stood, by their persons; of the draft, with their authors' accounts.
    const sourceNotes = snapshot
      ? snapshot.notes.map((n) => ({ ...n, authorId: null }))
      : await db.select().from(notes).where(eq(notes.editionId, source.id));
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
          personId: n.personId,
        })),
      );
    }
    const keptNoteIds = new Set(keptNotes.map((n) => n.id));
    const sourceCitations = snapshot
      ? snapshot.citations.filter((c) => c.editionId === source.id)
      : await db.select().from(citations).where(eq(citations.editionId, source.id));
    const noteCitations = snapshot
      ? snapshot.citations.filter((c) => c.noteId !== null && keptNoteIds.has(c.noteId))
      : keptNotes.length
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

    const constraints = snapshot
      ? snapshot.constraints
      : await db
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
      await tx.delete(editions).where(eq(editions.id, id));
    });
    throw cause;
  }
  const [row] = await db.select().from(editions).where(eq(editions.id, id));
  return { edition: row!, withoutTranscription };
}
