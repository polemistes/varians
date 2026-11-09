/**
 * The history panel's development page: the sample edition (or one of the
 * transcriptions of its conspectus, chosen by ?kind=&id=) with the labels of
 * its work's segments.
 */
import { error } from '@sveltejs/kit';
import { asc, editionSigla, editions, eq, segments, transcriptions, witnesses } from '@varians/db';
import type { PageServerLoad } from './$types';
import { isDocumentKind, loadDocumentAccess } from '$lib/server/document-access';
import { requireUser } from '$lib/server/guards';
import { historyStrings as t } from '$lib/strings/history';

const SAMPLE = 'iliad-1-working-edition';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals, url.pathname + url.search);
  const db = locals.db;
  const [edition] = await db
    .select({ id: editions.id, title: editions.title, workId: editions.workId, conventions: editions.conventions })
    .from(editions)
    .where(eq(editions.slug, SAMPLE));
  if (!edition) error(404, `No edition "${SAMPLE}": seed the database first.`);

  const sigla = await db
    .select({ id: transcriptions.id, name: transcriptions.name, siglum: editionSigla.siglum })
    .from(editionSigla)
    .innerJoin(transcriptions, eq(transcriptions.id, editionSigla.transcriptionId))
    .innerJoin(witnesses, eq(witnesses.id, transcriptions.witnessId))
    .where(eq(editionSigla.editionId, edition.id))
    .orderBy(asc(editionSigla.position));
  const documents = [
    { kind: 'edition' as const, id: edition.id, label: t.dev.edition(edition.title) },
    ...sigla.map((s) => ({ kind: 'transcription' as const, id: s.id, label: t.dev.transcription(s.siglum, s.name) })),
  ];

  const kindParam = url.searchParams.get('kind') ?? 'edition';
  const kind = isDocumentKind(kindParam) ? kindParam : 'edition';
  const id = url.searchParams.get('id') ?? edition.id;
  const access = await loadDocumentAccess(db, user, kind, id);
  if (!access || !access.canView) error(404, 'No such document');

  const labels = Object.fromEntries(
    (await db.select({ id: segments.id, label: segments.label }).from(segments).where(eq(segments.workId, edition.workId))).map((s) => [s.id, s.label]),
  );
  return {
    documents,
    selected: { kind: access.kind, id: access.id, canEdit: access.canEdit },
    labels,
    numberEvery: access.kind === 'edition' ? edition.conventions.numberEvery : 1,
  };
};
