import { grantsFor } from '$lib/server/authz';
import { publishedEditions, recentWork } from '$lib/server/library';
import type { PageServerLoad } from './$types';

/**
 * The front page. Visitors see what Varians is and what is published;
 * someone signed in sees the ways to start and their own recent work.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    const published = await publishedEditions(locals.db, null);
    return { published: published.slice(0, 6), recent: null };
  }
  const recent = await recentWork(locals.db, user, await grantsFor(locals.db, user), 4);
  return { published: [], recent };
};
