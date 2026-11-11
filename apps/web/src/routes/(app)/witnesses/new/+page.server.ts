import { error, fail, redirect } from '@sveltejs/kit';
import { requireUser, safeRedirect } from '$lib/server/guards';
import { witnessFromForm } from '$lib/server/registry-forms';
import { withParam } from '$lib/registry/forms';
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
    const made = await witnessFromForm(locals.db, user, await request.formData());
    if (!made.ok) {
      if (made.status === 403) error(403, made.error ?? t.common.forbidden);
      return fail(made.status, { errors: made.errors ?? {}, values: made.values ?? {} });
    }
    const witness = made.record;
    const back = returnTarget(url);
    // The page we came from learns which witness was made, so that it can use it straight away.
    redirect(303, back ? withParam(back, 'witness', witness.id) : `/witnesses/${witness.slug}`);
  },
};
