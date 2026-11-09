/**
 * GET /api/editions/[id]/units?ids=a,b,c
 * The collation units of an edition's text for some segments: its editors
 * get the draft, everyone else the published version.
 */
import { error, json } from '@sveltejs/kit';
import { runsOfSegment, units, type Unit } from '@varians/core';
import { documentAt } from '$lib/server/documents/service';
import { loadEditionAccess } from '$lib/server/edition-access';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  const { edition } = access;
  let content = edition.content;
  if (!access.canEdit) {
    if (edition.publishedVersion === null) throw error(404, 'No such edition');
    if (edition.publishedVersion !== edition.version) content = await documentAt(locals.db, 'edition', edition.id, edition.publishedVersion);
  }
  const out: Record<string, { units: Unit[] }> = {};
  for (const id of (url.searchParams.get('ids') ?? '').split(',').filter((s) => s).slice(0, 500)) {
    out[id] = { units: runsOfSegment(content, id).flatMap((run) => units(content, run.from, run.to)) };
  }
  return json({ segments: out });
};
