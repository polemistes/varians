import { error, fail, redirect } from '@sveltejs/kit';
import {
  canViewConjecture,
  canViewTranscription,
  grantsFor,
  transcriptionRights,
  witnessRights,
  type Actor,
} from '$lib/server/authz';
import { citationsByRecord } from '$lib/server/bibliography';
import { requireUser } from '$lib/server/guards';
import { transcriptionFromForm } from '$lib/server/registry-forms';
import {
  isDepended,
  maintainersOf,
  pagesOfWitness,
  readingsOfWitness,
  transcriptionsOfWitness,
  viewableTranscriptions,
  witnessBySlug,
  witnessDependents,
  workOptions,
  worksOfWitness,
} from '$lib/server/registry';
import { mergesInto } from '$lib/server/registry-merge';
import { describeDependents } from '$lib/registry/forms';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

async function witnessOr404(locals: App.Locals, slug: string) {
  const record = await witnessBySlug(locals.db, slug);
  if (!record) error(404, t.witness.notFound);
  return record;
}

/** The witness page is public like the registry; what it offers to do needs a user. */
export const load: PageServerLoad = async ({ locals, params }) => {
  const user = locals.user;
  const { witness, maintainerIds } = await witnessOr404(locals, params.slug);
  const db = locals.db;
  const grants = await grantsFor(db, user);
  const rights = witnessRights(user, witness, maintainerIds);
  const [
    maintainers,
    pageRows,
    transcriptionRows,
    workRows,
    readingRows,
    workChoices,
    sources,
    merged,
  ] = await Promise.all([
    maintainersOf(db, 'witness', witness.id),
    pagesOfWitness(db, witness.id),
    transcriptionsOfWitness(db, witness.id),
    worksOfWitness(db, witness.id, user, grants),
    readingsOfWitness(db, witness.id),
    user ? workOptions(db) : Promise.resolve([]),
    user ? viewableTranscriptions(db, user, grants) : Promise.resolve([]),
    mergesInto(db, 'witness', witness.id),
  ]);
  const context = { workMaintainerIds: [] as string[], grants };
  const readings = readingRows.filter((r) => canViewConjecture(user, r, context));
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
      .map((r) => ({ ...r, can: transcriptionRights(user, r, grants) })),
    works: workRows,
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
    rights,
    /** Why the witness cannot be deleted now, for those who may delete it; the menu says so. */
    deletion: user && rights.delete ? await deletionOf(locals, witness.id, user) : null,
    can: { newTranscription: !!user },
  };
};

/** The checks deleteWitness makes, made in advance so that the menu can say why it is refused. */
async function deletionOf(
  locals: App.Locals,
  witnessId: string,
  user: Actor,
): Promise<string | null> {
  const dependents = await witnessDependents(locals.db, witnessId, user);
  return isDepended(dependents)
    ? t.witness.inUse(describeDependents(dependents, 'readings'))
    : null;
}

export const actions: Actions = {
  newTranscription: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await witnessOr404(locals, params.slug);
    const made = await transcriptionFromForm(locals.db, user, witness.id, await request.formData());
    if (!made.ok)
      return fail(made.status, {
        errors: made.errors ?? {},
        values: made.values,
        ...(made.error ? { error: made.error } : {}),
      });
    redirect(303, `/transcriptions/${made.record.id}`);
  },
};
