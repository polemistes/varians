/**
 * A work as the workbench needs it.
 *   GET   id, slug, title, language, the levels of its reference scheme and
 *         its normalization profile
 *
 * The workbench asks for it when a work is chosen where text is assigned to
 * segments (naming a segment, numbering lines, importing). Works are public.
 */
import { error, json } from '@sveltejs/kit';
import { workbenchWorks } from '$lib/server/workbench';
import { registry } from '$lib/strings/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const [work] = await workbenchWorks(locals.db, [params.id]);
  if (!work) throw error(404, registry.work.notFound);
  return json(work);
};
