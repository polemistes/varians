import { error, fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/guards';
import { workFromForm } from '$lib/server/registry-forms';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  requireUser(locals, url.pathname + url.search);
  return { crumb: { label: t.work.newTitle } };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    const user = requireUser(locals);
    const made = await workFromForm(locals.db, user, await request.formData());
    if (!made.ok) {
      if (made.status === 403) error(403, made.error ?? t.common.forbidden);
      return fail(made.status, { errors: made.errors ?? {}, values: made.values ?? {} });
    }
    redirect(303, `/works/${made.record.slug}`);
  },
};
