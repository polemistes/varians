import { error, fail, redirect } from '@sveltejs/kit';
import { canCreateRegistryEntry } from '$lib/server/authz';
import { requireUser, safeRedirect } from '$lib/server/guards';
import { createWitness } from '$lib/server/registry';
import { parseWitnessForm, WITNESS_FIELDS, field, withParam } from '$lib/registry/forms';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

/** Where to go after creating: a local path given as ?return=, or nowhere. */
function returnTarget(url: URL): string | null {
  const target = url.searchParams.get('return');
  return target && safeRedirect(target) === target ? target : null;
}

export const load: PageServerLoad = ({ locals, url }) => {
  requireUser(locals, url.pathname + url.search);
  return { crumb: { label: t.witness.newTitle }, returnTo: returnTarget(url) };
};

export const actions: Actions = {
  default: async ({ locals, request, url }) => {
    const user = requireUser(locals);
    if (!canCreateRegistryEntry(user)) error(403, t.common.forbidden);
    const form = await request.formData();
    const parsed = parseWitnessForm(form);
    if (!parsed.ok) {
      return fail(400, {
        errors: parsed.errors,
        values: Object.fromEntries(WITNESS_FIELDS.map((name) => [name, field(form, name)])),
      });
    }
    const witness = await createWitness(locals.db, parsed.data, user.id);
    const back = returnTarget(url);
    // The page we came from learns which witness was made, so that it can use it straight away.
    redirect(303, back ? withParam(back, 'witness', witness.id) : `/witnesses/${witness.slug}`);
  },
};
