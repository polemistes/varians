import { error, fail, redirect } from '@sveltejs/kit';
import { canMaintainWitness, isAdministrator, type Actor } from '$lib/server/authz';
import { requireUser } from '$lib/server/guards';
import { removePageFiles } from '$lib/server/images/storage';
import {
  PageError,
  pagesWithoutRights,
  parseWitnessImageDefaults,
  setWitnessImageDefaults,
} from '$lib/server/pages';
import {
  addMaintainer,
  deleteWitness,
  governs,
  maintainersOf,
  removeMaintainer,
  updateWitness,
  witnessBySlug,
} from '$lib/server/registry';
import { storageRoot } from '$lib/server/startup';
import {
  checked,
  describeDependents,
  field,
  parseEmail,
  parseWitnessForm,
} from '$lib/registry/forms';
import { materialFormValues } from '$lib/registry/witness';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

/** The witness for one of its maintainers; others are refused. */
async function maintained(locals: App.Locals, slug: string, user: Actor) {
  const record = await witnessBySlug(locals.db, slug);
  if (!record) error(404, t.witness.notFound);
  if (!canMaintainWitness(user, record.witness, record.maintainerIds))
    error(403, t.witness.notMaintainer);
  return record;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requireUser(locals, url.pathname + url.search);
  const { witness, maintainerIds } = await maintained(locals, params.slug, user);
  const maintainers = await maintainersOf(locals.db, 'witness', witness.id);
  return {
    crumb: { label: witness.name, href: `/witnesses/${witness.slug}` },
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
      identifiers: JSON.stringify(witness.identifiers),
      dateText: witness.dateText,
      ...materialFormValues(witness.material),
      extent: witness.extent,
      hands: JSON.stringify(witness.hands),
      provenance: witness.provenance,
      description: witness.description,
    },
    images: {
      imageRights: witness.imageRights ?? '',
      imageAttribution: witness.imageAttribution ?? '',
      withoutRights: await pagesWithoutRights(locals.db, witness.id),
    },
    maintainers,
    can: {
      govern: governs(user, witness),
      merge:
        isAdministrator(user) || witness.createdBy === user.id || maintainerIds.includes(user.id),
    },
  };
};

export const actions: Actions = {
  details: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await maintained(locals, params.slug, user);
    const parsed = parseWitnessForm(await request.formData());
    if (!parsed.ok)
      return fail(400, { form: 'details' as const, errors: parsed.errors, values: parsed.values });
    await updateWitness(locals.db, witness.id, parsed.data);
    return { form: 'details' as const, message: t.witness.saved };
  },

  /** The rights statement and credit line new images are given, and, if asked, the images without a statement. */
  images: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await maintained(locals, params.slug, user);
    const form = await request.formData();
    const input = {
      imageRights: field(form, 'imageRights'),
      imageAttribution: field(form, 'imageAttribution'),
    };
    const parsed = parseWitnessImageDefaults(input);
    if (!parsed.ok) {
      return fail(400, {
        form: 'images' as const,
        errors: { [parsed.field]: [parsed.error] },
        values: input,
      });
    }
    try {
      const applied = await setWitnessImageDefaults(
        locals.db,
        witness.id,
        input,
        checked(form, 'apply'),
      );
      return {
        form: 'images' as const,
        message: applied > 0 ? t.witness.imagesApplied(applied) : t.witness.imagesSaved,
      };
    } catch (cause) {
      if (!(cause instanceof PageError)) throw cause;
      return fail(400, {
        form: 'images' as const,
        errors: { imageRights: [cause.message] },
        values: input,
      });
    }
  },

  addMaintainer: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await maintained(locals, params.slug, user);
    if (!governs(user, witness)) error(403, t.witness.notGoverning);
    const parsed = parseEmail(await request.formData());
    if (!parsed.ok) return fail(400, { form: 'maintainers' as const, errors: parsed.errors });
    const result = await addMaintainer(locals.db, 'witness', witness.id, parsed.data.email);
    if (!result.ok) {
      return fail(400, {
        form: 'maintainers' as const,
        errors: {
          email: [result.error === 'no-user' ? t.maintainers.noUser : t.maintainers.already],
        },
      });
    }
    return { form: 'maintainers' as const, name: result.user.name };
  },

  removeMaintainer: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { witness } = await maintained(locals, params.slug, user);
    const userId = field(await request.formData(), 'userId');
    // Anyone may step down; removing others is the creator's or an administrator's.
    if (userId !== user.id && !governs(user, witness)) error(403, t.witness.notGoverning);
    const result = await removeMaintainer(locals.db, 'witness', witness.id, userId);
    if (!result.ok) {
      return fail(400, {
        form: 'maintainers' as const,
        error: result.error === 'creator' ? t.maintainers.cannotRemoveCreator : t.common.forbidden,
      });
    }
    const after = await witnessBySlug(locals.db, witness.slug);
    if (after && !canMaintainWitness(user, after.witness, after.maintainerIds))
      redirect(303, `/witnesses/${witness.slug}`);
    return { form: 'maintainers' as const, name: result.name };
  },

  /** Deleting the witness; asked for on the witness's page. */
  delete: async ({ locals, params }) => {
    const user = requireUser(locals);
    const { witness } = await maintained(locals, params.slug, user);
    const result = await deleteWitness(locals.db, witness.id, user);
    if (!result.ok) {
      if (result.error === 'in-use') {
        return fail(409, {
          form: 'delete' as const,
          error: t.witness.inUse(describeDependents(result.dependents, 'readings')),
        });
      }
      return fail(result.error === 'not-found' ? 404 : 403, {
        form: 'delete' as const,
        error: result.error === 'not-found' ? t.witness.notFound : t.witness.notCreator,
      });
    }
    // The images go after the rows; a file left behind is harmless, a row without its file is not.
    const root = storageRoot();
    await Promise.all(result.pageIds.map((id) => removePageFiles(id, root).catch(() => undefined)));
    redirect(303, '/');
  },
};
