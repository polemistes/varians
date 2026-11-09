import { grantsFor } from '$lib/server/authz';
import { editionsOwnedBy, sharedWith, transcriptionsOwnedBy } from '$lib/server/library';
import { requireUser } from '$lib/server/guards';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals, url.pathname);
  const [editions, transcriptions, shared] = await Promise.all([
    editionsOwnedBy(locals.db, user.id),
    transcriptionsOwnedBy(locals.db, user.id),
    sharedWith(locals.db, user, await grantsFor(locals.db, user)),
  ]);
  return { crumb: { label: site.mine.title }, editions, transcriptions, shared };
};
