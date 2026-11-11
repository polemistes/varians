import { grantsFor } from '$lib/server/authz';
import { publishedEditions, recentWork } from '$lib/server/library';
import type { PageServerLoad } from './$types';

/**
 * The front page. Everyone sees the published editions; a visitor sees
 * what Varians is above them, someone signed in what to start and their
 * own recent work.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  const published = await publishedEditions(locals.db, user);
  if (!user) return { published, recent: null };
  const recent = await recentWork(locals.db, user, await grantsFor(locals.db, user), 4);
  return { published, recent };
};
