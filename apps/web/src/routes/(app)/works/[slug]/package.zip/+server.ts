/**
 * GET /works/[slug]/package.zip: the work as a package, with
 * what the visitor may see of it: anyone for a public work, the accounts
 * that see it for a private one (by session, or by token for another
 * installation pulling it).
 */
import { error, redirect } from '@sveltejs/kit';
import { buildPackage } from '$lib/server/archive/package';
import { canViewWork, grantsFor } from '$lib/server/authz';
import { loginUrl } from '$lib/server/guards';
import { PACKAGE_AGENT, packageOrigin, packageResponse } from '$lib/server/package-response';
import { limits } from '$lib/server/rate-limit';
import { workBySlug } from '$lib/server/registry';
import { storageRoot } from '$lib/server/startup';
import { registry as t } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url, getClientAddress }) => {
  const user = locals.user;
  const record = await workBySlug(locals.db, params.slug);
  if (!record) error(404, t.work.notFound);
  if (!canViewWork(user, record.work, record.maintainerIds, await grantsFor(locals.db, user))) {
    if (!user) redirect(303, loginUrl(`/works/${params.slug}`));
    error(404, t.work.notFound);
  }
  // Writing a package is heavy work: a few downloads an hour per person or address.
  if (!limits.archiveByUser.take(user?.id ?? `address:${getClientAddress()}`))
    error(429, t.work.archiveTooOften);
  try {
    return packageResponse(
      await buildPackage(locals.db, user, [{ kind: 'work', workId: record.work.id }], {
        storageRoot: storageRoot(),
        origin: packageOrigin(url.origin),
        agent: PACKAGE_AGENT,
      }),
    );
  } catch (e) {
    console.error('package for download failed', e);
    error(500, t.work.archiveFailed);
  }
};
