/** GET /admin/package.zip: the whole installation as a package, for administrators. */
import { error, redirect } from '@sveltejs/kit';
import { buildPackage } from '$lib/server/archive/package';
import { isAdministrator } from '$lib/server/authz';
import { loginUrl } from '$lib/server/guards';
import { PACKAGE_AGENT, packageOrigin, packageResponse } from '$lib/server/package-response';
import { limits } from '$lib/server/rate-limit';
import { storageRoot } from '$lib/server/startup';
import { registry as t } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) redirect(303, loginUrl('/admin'));
  if (!isAdministrator(user)) error(403, 'Only administrators may export the installation');
  if (!limits.archiveByUser.take(user.id)) error(429, t.work.archiveTooOften);
  try {
    return packageResponse(await buildPackage(locals.db, user, [{ kind: 'installation' }], { storageRoot: storageRoot(), origin: packageOrigin(url.origin), agent: PACKAGE_AGENT }));
  } catch (e) {
    console.error('installation package failed', e);
    error(500, t.work.archiveFailed);
  }
};
