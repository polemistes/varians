import { requireUser } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/** Everything under (app) needs a user; visitors go to the login and come back. */
export const load: LayoutServerLoad = ({ locals, url }) => {
  requireUser(locals, url.pathname + url.search);
  return {};
};
