import { error, fail, redirect } from '@sveltejs/kit';
import { canCreateRegistryEntry } from '$lib/server/authz';
import { requireUser } from '$lib/server/guards';
import { createWork, RegistryError } from '$lib/server/registry';
import { field, parseSchemeChoice, parseWorkForm } from '$lib/registry/forms';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

const FIELDS = [
  'title',
  'author',
  'language',
  'languageCode',
  'identifier',
  'identifiers',
  'description',
  'visibility',
  'scheme',
  'levels',
];

export const load: PageServerLoad = ({ locals, url }) => {
  requireUser(locals, url.pathname + url.search);
  return { crumb: { label: t.work.newTitle } };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    const user = requireUser(locals);
    if (!canCreateRegistryEntry(user)) error(403, t.common.forbidden);
    const form = await request.formData();
    const values = Object.fromEntries(FIELDS.map((name) => [name, field(form, name)]));
    const parsed = parseWorkForm(form);
    const scheme = parseSchemeChoice(form);
    if (!parsed.ok || !scheme.ok) {
      return fail(400, {
        errors: {
          ...(parsed.ok ? {} : parsed.errors),
          ...(scheme.ok ? {} : { scheme: scheme.errors }),
        },
        values,
      });
    }
    let slug: string;
    try {
      const work = await createWork(locals.db, { ...parsed.data, scheme: scheme.scheme }, user.id);
      slug = work.slug;
    } catch (e) {
      if (
        e instanceof RegistryError &&
        (e.code === 'invalid-scheme' || e.code === 'unknown-preset')
      ) {
        return fail(400, {
          errors: { scheme: e.problems.length ? e.problems : [t.scheme.invalid] },
          values,
        });
      }
      throw e;
    }
    redirect(303, `/works/${slug}`);
  },
};
