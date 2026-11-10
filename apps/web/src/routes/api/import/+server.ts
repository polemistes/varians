/**
 * POST /api/import: a package pushed by another installation,
 * with a bearer token of an account here. It is imported as that account,
 * restricted as on the import page, keeping the text here where the two
 * conflict; the report comes back as JSON.
 */
import { error, json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { importPackage, WEB_LIMITS } from '$lib/server/archive/import-package';
import { limits } from '$lib/server/rate-limit';
import { summary } from '$lib/server/sync';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, 'A token of an account here is needed');
  if (!request.body) error(400, 'Send a package');
  if (!limits.importsByUser.take(user.id)) error(429, 'Too many imports; try again later');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'varians-push-'));
  try {
    const file = path.join(dir, 'package.zip');
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), createWriteStream(file));
    const report = await importPackage(locals.db, file, user.id, { ...(user.role === 'administrator' ? {} : { actor: user }), onConflict: 'keep', source: 'a push', limits: WEB_LIMITS });
    return json(summary(report), { status: report.refused ? 422 : 200 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
