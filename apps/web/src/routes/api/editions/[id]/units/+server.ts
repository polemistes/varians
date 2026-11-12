/**
 * GET /api/editions/[id]/units?ids=a,b,c
 * The collation units of an edition's text for some segments: its editors
 * get the draft, everyone else the latest version.
 */
import { error, json } from '@sveltejs/kit';
import { runsOfSegment, units, type Unit } from '@varians/core';
import { loadEditionAccess } from '$lib/server/edition-access';
import { latestVersionWithSnapshot } from '$lib/server/versions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const access = await loadEditionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such edition');
  const { edition } = access;
  let content = edition.content;
  if (!access.canEdit) {
    const latest = await latestVersionWithSnapshot(locals.db, 'edition', edition.id);
    if (!latest) throw error(404, 'No such edition');
    content = latest.snapshot.content;
  }
  const out: Record<string, { units: Unit[] }> = {};
  for (const id of (url.searchParams.get('ids') ?? '')
    .split(',')
    .filter((s) => s)
    .slice(0, 500)) {
    out[id] = {
      units: runsOfSegment(content, id).flatMap((run) => units(content, run.from, run.to)),
    };
  }
  return json({ segments: out });
};
