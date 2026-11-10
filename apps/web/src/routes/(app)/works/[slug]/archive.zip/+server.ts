/**
 * GET /works/[slug]/archive.zip
 * The server's own archive of the work, its git repository with
 * its history, for administrators. Everyone else is sent to the work's
 * package (package.zip), which holds what they may see: the server's archive
 * holds every draft, other people's included.
 */
import { error, redirect } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { canViewWork, grantsFor, isAdministrator } from '$lib/server/authz';
import { loginUrl } from '$lib/server/guards';
import { limits } from '$lib/server/rate-limit';
import { archiveZip, workBySlug } from '$lib/server/registry';
import { archiveRoot, storageRoot } from '$lib/server/startup';
import { registry as t } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) redirect(303, loginUrl(`/works/${params.slug}`));
  const record = await workBySlug(locals.db, params.slug);
  if (!record) error(404, t.work.notFound);
  const grants = await grantsFor(locals.db, user);
  if (!canViewWork(user, record.work, record.maintainerIds, grants)) error(404, t.work.notFound);
  // Writing an archive is heavy work: a few downloads an hour per person.
  if (!limits.archiveByUser.take(user.id)) error(429, t.work.archiveTooOften);

  if (!isAdministrator(user))
    redirect(308, `/works/${encodeURIComponent(params.slug)}/package.zip`);
  let zip: Readable;
  try {
    zip = await archiveZip(locals.db, record.work, archiveRoot(), storageRoot());
  } catch (e) {
    console.error('archive for download failed', e);
    error(500, t.work.archiveFailed);
  }
  return new Response(Readable.toWeb(zip) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${record.work.slug}-archive.zip"`,
      'cache-control': 'private, no-store',
    },
  });
};
