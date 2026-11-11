import { error, fail, redirect } from '@sveltejs/kit';
import { canMaintainWork, isAdministrator, type Actor } from '$lib/server/authz';
import { requireUser } from '$lib/server/guards';
import {
  addMaintainer,
  deleteWork,
  maintainersOf,
  RegistryError,
  removeMaintainer,
  updateWork,
  workBySlug,
} from '$lib/server/registry';
import { segmentsOfWork } from '$lib/server/segments';
import { describeDependents, field, parseEmail, parseWorkForm } from '$lib/registry/forms';
import { parseLevels, schemeProblems } from '$lib/registry/scheme';
import { registry as t } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

/**
 * Who decides about the entry itself: its maintainers.
 * Its creator and administrators; other maintainers edit, but do not hand on.
 */
function governs(user: Actor, work: { createdBy: string | null }): boolean {
  return work.createdBy === user.id || isAdministrator(user);
}

/** The work for one of its maintainers; others are refused. */
async function maintained(locals: App.Locals, slug: string, user: Actor) {
  const record = await workBySlug(locals.db, slug);
  if (!record) error(404, t.work.notFound);
  if (!canMaintainWork(user, record.work, record.maintainerIds)) error(403, t.work.notMaintainer);
  return record;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requireUser(locals, url.pathname + url.search);
  const { work, scheme, maintainerIds } = await maintained(locals, params.slug, user);
  const [maintainers, segments] = await Promise.all([
    maintainersOf(locals.db, 'work', work.id),
    segmentsOfWork(locals.db, work.id),
  ]);
  return {
    crumb: { label: work.title, href: `/works/${work.slug}` },
    work: {
      id: work.id,
      slug: work.slug,
      title: work.title,
      author: work.author,
      language: work.language,
      identifier: work.identifier,
      identifiers: JSON.stringify(work.identifiers),
      description: work.description,
    },
    scheme,
    locked: segments.length > 0,
    maintainers,
    can: {
      delete: governs(user, work),
      govern: governs(user, work),
      merge: isAdministrator(user) || work.createdBy === user.id || maintainerIds.includes(user.id),
    },
  };
};

export const actions: Actions = {
  details: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { work } = await maintained(locals, params.slug, user);
    const form = await request.formData();
    const parsed = parseWorkForm(form);
    if (!parsed.ok)
      return fail(400, { form: 'details' as const, errors: parsed.errors, values: parsed.values });
    const { title, author, language, identifier, identifiers, description } = parsed.data;
    await updateWork(locals.db, work.id, {
      title,
      author,
      language,
      identifier,
      identifiers,
      description,
    });
    return { form: 'details' as const, message: t.work.saved };
  },

  scheme: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { work } = await maintained(locals, params.slug, user);
    const levels = parseLevels(field(await request.formData(), 'levels'));
    if (!levels || levels.length === 0)
      return fail(400, { form: 'scheme' as const, errors: { scheme: [t.scheme.invalid] } });
    const problems = schemeProblems(levels);
    if (problems.length)
      return fail(400, { form: 'scheme' as const, errors: { scheme: problems } });
    try {
      await updateWork(locals.db, work.id, { scheme: { levels } });
    } catch (e) {
      if (e instanceof RegistryError) {
        const message =
          e.code === 'scheme-locked'
            ? [t.work.schemeLockedError]
            : e.code === 'label-collision'
              ? [t.work.labelCollision(e.problems.join(', '))]
              : e.problems.length
                ? e.problems
                : [t.scheme.invalid];
        return fail(400, { form: 'scheme' as const, errors: { scheme: message } });
      }
      throw e;
    }
    return { form: 'scheme' as const, message: t.work.schemeSaved };
  },

  addMaintainer: async ({ locals, params, request }) => {
    const user = requireUser(locals);
    const { work } = await maintained(locals, params.slug, user);
    if (!governs(user, work)) error(403, t.work.notGoverning);
    const parsed = parseEmail(await request.formData());
    if (!parsed.ok) return fail(400, { form: 'maintainers' as const, errors: parsed.errors });
    const result = await addMaintainer(locals.db, 'work', work.id, parsed.data.email);
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
    const { work } = await maintained(locals, params.slug, user);
    const userId = field(await request.formData(), 'userId');
    // Anyone may step down; removing others is the creator's or an administrator's.
    if (userId !== user.id && !governs(user, work)) error(403, t.work.notGoverning);
    const result = await removeMaintainer(locals.db, 'work', work.id, userId);
    if (!result.ok) {
      return fail(400, {
        form: 'maintainers' as const,
        error: result.error === 'creator' ? t.maintainers.cannotRemoveCreator : t.common.forbidden,
      });
    }
    // Whoever removed themselves no longer reaches this page.
    const after = await workBySlug(locals.db, work.slug);
    if (after && !canMaintainWork(user, after.work, after.maintainerIds))
      redirect(303, `/works/${work.slug}`);
    return { form: 'maintainers' as const, name: result.name };
  },

  delete: async ({ locals, params }) => {
    const user = requireUser(locals);
    const { work } = await maintained(locals, params.slug, user);
    const result = await deleteWork(locals.db, work.id, user);
    if (!result.ok) {
      if (result.error === 'in-use') {
        return fail(409, {
          form: 'delete' as const,
          error: t.work.inUse(describeDependents(result.dependents, 'conjectures')),
        });
      }
      return fail(result.error === 'not-found' ? 404 : 403, {
        form: 'delete' as const,
        error: result.error === 'not-found' ? t.work.notFound : t.work.notCreator,
      });
    }
    redirect(303, '/');
  },
};
