import { error, fail, redirect } from '@sveltejs/kit';
import { workMaintainers, works, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import { field } from '$lib/registry/forms';
import { canViewWork, grantsFor, type Actor, type Grants } from '$lib/server/authz';
import {
  conspectusRefusal,
  parseConspectus,
  parseName,
  saveConspectus,
  suggestedWitnesses,
} from '$lib/server/edition-form';
import { windowActions } from '$lib/server/edition-page';
import { createEdition } from '$lib/server/editions';
import { requireUser } from '$lib/server/guards';
import { searchWorks } from '$lib/server/library';
import { viewableTranscriptions } from '$lib/server/registry';
import { edition as s } from '$lib/strings/edition';
import type { Actions, PageServerLoad } from './$types';

/** The work by slug or id, when it exists and the person may see it. */
async function visibleWork(
  db: Database,
  user: Actor,
  grants: Grants,
  key: { slug?: string; id?: string },
) {
  const [work] = await db
    .select()
    .from(works)
    .where(key.id ? eq(works.id, key.id) : eq(works.slug, key.slug ?? ''));
  if (!work) return null;
  const maintainerIds = (
    await db
      .select({ userId: workMaintainers.userId })
      .from(workMaintainers)
      .where(eq(workMaintainers.workId, work.id))
  ).map((m) => m.userId);
  return canViewWork(user, work, maintainerIds, grants) ? work : null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals, url.pathname + url.search);
  const grants = await grantsFor(locals.db, user);
  const slug = url.searchParams.get('work');
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const work = slug ? await visibleWork(locals.db, user, grants, { slug }) : null;
  if (slug && !work) throw error(404, s.errors.workUnknown);
  return {
    crumb: { label: s.newTitle },
    q,
    work: work ? { id: work.id, slug: work.slug, title: work.title, author: work.author } : null,
    // The registry's works to choose from, while none is chosen.
    works: work ? [] : await searchWorks(locals.db, user, q),
    suggestions: work ? await suggestedWitnesses(locals.db, user, grants, work.id) : [],
    sources: await viewableTranscriptions(locals.db, user, grants),
    editors: user.name ? [user.name] : [],
  };
};

/** Refusing to save, with the errors by field and a message for the conspectus. */
class Refused extends Error {
  constructor(readonly sigla: string) {
    super(sigla);
  }
}

export const actions: Actions = {
  /** Save: the edition made with its name, editors and conspectus, and an empty text. */
  create: async ({ locals, request }) => {
    const user = requireUser(locals);
    const grants = await grantsFor(locals.db, user);
    const form = await request.formData();
    const errors: Record<string, string[] | undefined> = {};
    const workId = field(form, 'workId');
    const work = workId ? await visibleWork(locals.db, user, grants, { id: workId }) : null;
    if (!work) errors.work = [workId ? s.errors.workUnknown : s.errors.workRequired];
    const name = parseName(form);
    if (!name.ok) Object.assign(errors, name.errors);
    const conspectus = parseConspectus(form);
    let sigla = conspectus.ok ? null : conspectus.message;
    if (conspectus.ok)
      sigla = await conspectusRefusal(locals.db, user, grants, conspectus.rows, null);
    if (!work || !name.ok || !conspectus.ok || sigla)
      return fail(400, { errors: { ...errors, ...(sigla ? { sigla: [sigla] } : {}) } });

    let slug: string;
    try {
      slug = await locals.db.transaction(async (tx) => {
        const db = tx as unknown as Database;
        const made = await createEdition(
          db,
          {
            workId: work.id,
            title: name.title,
            editors: name.editors,
            baseTranscriptionId: null,
            sigla: [],
          },
          user.id,
        );
        const problem = await saveConspectus(db, made.id, conspectus.rows, conspectus.groups);
        if (problem) throw new Refused(problem);
        return made.slug;
      });
    } catch (cause) {
      if (cause instanceof Refused) return fail(400, { errors: { sigla: [cause.sigla] } });
      throw cause;
    }
    redirect(303, `/editions/${slug}/settings`);
  },
  ...windowActions,
};
