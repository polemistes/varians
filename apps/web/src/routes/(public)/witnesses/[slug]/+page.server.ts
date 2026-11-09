import { error, fail, redirect } from '@sveltejs/kit';
import { eq, transcriptions, works } from '@varians/db';
import {
  canDeleteTranscription,
  canMaintainWitness,
  canViewConjecture,
  canViewTranscription,
  canViewWork,
  grantsFor,
  type Actor,
  type Grants,
} from '$lib/server/authz';
import { citationsByRecord } from '$lib/server/bibliography';
import { requireUser } from '$lib/server/guards';
import {
  createTranscription,
  deleteTranscription,
  maintainersOf,
  pagesOfWitness,
  readingsOfWitness,
  RegistryError,
  renameTranscription,
  transcriptionsOfWitness,
  viewableTranscriptions,
  witnessBySlug,
  workOptions,
  worksOfWitness,
} from '$lib/server/registry';
import { mergesInto } from '$lib/server/registry-merge';
import { field, parseName, parseTranscriptionForm } from '$lib/registry/forms';
import type { WorkRef } from '$lib/registry/types';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

async function witnessOr404(locals: App.Locals, slug: string) {
  const record = await witnessBySlug(locals.db, slug);
  if (!record) error(404, t.witness.notFound);
  return record;
}

/** Whether the user sees a work; the grants hold the works they maintain or reach through an edition. */
const seesWork =
  (user: Actor | null, grants: Grants) => (work: Pick<WorkRef, 'id' | 'visibility' | 'createdBy'>) =>
    canViewWork(user, work, [], grants);

/** The witness page is public like the registry; what it offers to do needs a user. */
export const load: PageServerLoad = async ({ locals, params }) => {
  const user = locals.user;
  const { witness, maintainerIds } = await witnessOr404(locals, params.slug);
  const db = locals.db;
  const grants = await grantsFor(db, user);
  const sees = seesWork(user, grants);
  const [maintainers, pageRows, transcriptionRows, workRows, readingRows, workChoices, sources, merged] =
    await Promise.all([
      maintainersOf(db, 'witness', witness.id),
      pagesOfWitness(db, witness.id),
      transcriptionsOfWitness(db, witness.id),
      worksOfWitness(db, witness.id),
      readingsOfWitness(db, witness.id),
      user ? workOptions(db, user, grants) : Promise.resolve([]),
      user ? viewableTranscriptions(db, user, grants) : Promise.resolve([]),
      mergesInto(db, 'witness', witness.id),
    ]);
  const context = { workMaintainerIds: [] as string[], grants };
  const readings = readingRows.filter((r) => sees(r.work) && canViewConjecture(user, r, context));
  const citations = await citationsByRecord(
    db,
    'reported',
    readings.map((r) => r.id),
  );
  return {
    crumb: { label: witness.name },
    witness: {
      id: witness.id,
      slug: witness.slug,
      siglum: witness.siglum,
      name: witness.name,
      category: witness.category,
      format: witness.format,
      sourceAuthor: witness.sourceAuthor,
      sourceWork: witness.sourceWork,
      repository: witness.repository,
      settlement: witness.settlement,
      shelfmark: witness.shelfmark,
      identifier: witness.identifier,
      identifiers: witness.identifiers,
      dateText: witness.dateText,
      material: witness.material,
      extent: witness.extent,
      hands: witness.hands,
      provenance: witness.provenance,
      description: witness.description,
      iiifManifest: witness.iiifManifest,
    },
    maintainers: maintainers.map((m) => ({ id: m.id, name: m.name })),
    merged,
    pages: pageRows,
    transcriptions: transcriptionRows
      .filter((r) => canViewTranscription(user, r, grants))
      .map((r) => ({
        ...r,
        works: r.works.filter(sees),
        assigned: r.assigned.filter(sees),
        can: { rename: canDeleteTranscription(user, r), delete: canDeleteTranscription(user, r) },
      })),
    works: workRows.filter(sees),
    readings: readings.map((r) => ({
      ...r,
      citations: (citations.get(r.id) ?? []).map(({ itemId, label, prenote, postnote, text }) => ({
        itemId,
        label,
        prenote,
        postnote,
        text,
      })),
    })),
    workOptions: workChoices,
    sources,
    can: {
      maintain: canMaintainWitness(user, witness, maintainerIds),
      newTranscription: !!user,
    },
  };
};

export const actions: Actions = {
  newTranscription: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await witnessOr404(locals, params.slug);
    const parsed = parseTranscriptionForm(await request.formData());
    if (!parsed.ok) return fail(400, { errors: parsed.errors, values: parsed.values });
    const d = parsed.data;
    const grants = await grantsFor(locals.db, user);
    if (d.fromTranscriptionId) {
      const [source] = await locals.db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.id, d.fromTranscriptionId));
      if (!source || !canViewTranscription(user, source, grants)) {
        return fail(403, { errors: { fromTranscriptionId: [t.transcription.sourceNotAllowed] } });
      }
    }
    if (d.workId) {
      const [work] = await locals.db.select().from(works).where(eq(works.id, d.workId));
      if (!work || !seesWork(user, grants)(work))
        return fail(400, { errors: { workId: [t.work.notFound] } });
    }
    let id: string;
    try {
      const created = await createTranscription(
        locals.db,
        {
          witnessId: witness.id,
          workIds: d.workId ? [d.workId] : undefined,
          name: d.name,
          keepsWrittenForm: d.keepsWrittenForm,
          fromTranscriptionId: d.fromTranscriptionId,
        },
        user.id,
      );
      id = created.id;
    } catch (e) {
      throw e;
    }
    redirect(303, `/transcriptions/${id}`);
  },

  renameTranscription: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await witnessOr404(locals, params.slug);
    const form = await request.formData();
    const [row] = await locals.db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, field(form, 'id')));
    if (!row || row.witnessId !== witness.id) return fail(404, { error: t.transcription.notFound });
    if (!canDeleteTranscription(user, row)) return fail(403, { error: t.transcription.notOwner });
    const parsed = parseName(form);
    if (!parsed.ok) return fail(400, { errors: parsed.errors });
    await renameTranscription(locals.db, row.id, parsed.data.name);
    return { message: t.transcription.renamed };
  },

  deleteTranscription: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await witnessOr404(locals, params.slug);
    const form = await request.formData();
    const [row] = await locals.db
      .select({ id: transcriptions.id, witnessId: transcriptions.witnessId })
      .from(transcriptions)
      .where(eq(transcriptions.id, field(form, 'id')));
    if (!row || row.witnessId !== witness.id) return fail(404, { error: t.transcription.notFound });
    const result = await deleteTranscription(locals.db, row.id, user);
    if (!result.ok) {
      if (result.error === 'in-conspectus') {
        return fail(409, {
          error: t.transcription.inConspectus(t.common.and(result.editions.map((e) => e.title))),
        });
      }
      return fail(result.error === 'forbidden' ? 403 : 404, {
        error: result.error === 'forbidden' ? t.transcription.notOwner : t.transcription.notFound,
      });
    }
    return { message: t.transcription.deleted };
  },
};
