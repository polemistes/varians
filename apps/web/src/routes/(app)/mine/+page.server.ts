import { grantsFor } from '$lib/server/authz';
import {
  editionsOwnedBy,
  sharedWith,
  transcriptionsOwnedBy,
  withEditionRights,
  withTranscriptionRights,
} from '$lib/server/library';
import { requireUser } from '$lib/server/guards';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals, url.pathname);
  const grants = await grantsFor(locals.db, user);
  const [editions, transcriptions, shared] = await Promise.all([
    editionsOwnedBy(locals.db, user.id),
    transcriptionsOwnedBy(locals.db, user.id),
    sharedWith(locals.db, user, grants),
  ]);
  return {
    crumb: { label: site.mine.title },
    editions: withEditionRights(editions, user, grants),
    transcriptions: withTranscriptionRights(transcriptions, user, grants),
    shared: {
      editions: withEditionRights(shared.editions, user, grants),
      transcriptions: withTranscriptionRights(shared.transcriptions, user, grants),
    },
  };
};
