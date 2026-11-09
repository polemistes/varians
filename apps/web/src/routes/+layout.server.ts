import { env } from '$env/dynamic/private';
import { COMMIT, VERSION, sourceUrl } from '$lib/version';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user,
  /** For the footer: the running version and the address of its source. */
  release: { version: VERSION, source: sourceUrl(COMMIT, env.SOURCE_URL) },
});
