import { grantsFor } from '$lib/server/authz';
import { publishedEditions, recentWork, withEditionRights } from '$lib/server/library';
import type { PageServerLoad } from './$types';

/**
 * The front page. Everyone sees the published editions; a visitor sees
 * what Varians is above them, someone signed in what to start and their
 * own recent work.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  const grants = await grantsFor(locals.db, user);
  const published = withEditionRights(await publishedEditions(locals.db), user, grants);
  if (!user) return { published, recent: null };
  const recent = await recentWork(locals.db, user, grants, 4);
  return {
    published,
    recent: {
      total: recent.total,
      items: recent.items.map((item) =>
        item.kind === 'edition' ? withEditionRights([item], user, grants)[0]! : item,
      ),
    },
  };
};
