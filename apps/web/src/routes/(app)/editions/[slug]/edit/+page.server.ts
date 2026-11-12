import { error, fail, redirect } from '@sveltejs/kit';
import { editions, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { canDeleteEdition, editionRights, grantsFor } from '$lib/server/authz';
import { reviewedSites } from '$lib/server/conjectures';
import { loadEditionAccess } from '$lib/server/edition-access';
import {
  conspectusRefusal,
  editionConspectus,
  parseConspectus,
  saveConspectus,
  suggestedWitnesses,
} from '$lib/server/edition-form';
import { requireUser } from '$lib/server/guards';
import { versionsOf } from '$lib/server/versions';
import { editionView, type SegmentView } from '$lib/server/reader';
import { deleteHistory, viewableTranscriptions } from '$lib/server/registry';
import { OPENING_SEGMENTS } from '$lib/edition/workspace';
import { recordActions } from '$lib/strings/record-actions';
import type { Actions, PageServerLoad } from './$types';

/** Collation columns are server-side only. */
function lighten(views: Record<string, SegmentView>): Record<string, SegmentView> {
  const out: Record<string, SegmentView> = {};
  for (const [id, view] of Object.entries(views))
    out[id] = { ...view, collation: { ...view.collation, columns: [] } };
  return out;
}

async function editable(locals: App.Locals, slug: string) {
  const user = requireUser(locals);
  const access = await loadEditionAccess(locals.db, user, slug);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  return { user, access };
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requireUser(locals, url.pathname);
  const access = await loadEditionAccess(locals.db, user, params.slug);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw redirect(303, `/editions/${access.edition.slug}`);
  const edition = access.edition;
  // The editor opens on the first segments, and asks for the others as the caret reaches them, and for the outline of the whole text once it is open.
  const view = await editionView(locals.db, edition.id, null, {
    first: OPENING_SEGMENTS,
    lines: false,
  });
  const [work] = await locals.db
    .select({ slug: works.slug, title: works.title })
    .from(works)
    .where(eq(works.id, edition.workId));
  const reviewed = Object.fromEntries(
    [...(await reviewedSites(locals.db, edition.id))].map(([segmentId, keys]) => [
      segmentId,
      [...keys],
    ]),
  );
  const grants = await grantsFor(locals.db, user);
  const versions = await versionsOf(locals.db, 'edition', edition.id);
  const conspectus = await editionConspectus(locals.db, user, grants, edition);
  const revision = createHash('sha1')
    .update(
      JSON.stringify([
        edition.title,
        edition.editors,
        edition.preface,
        edition.conventions,
        conspectus.rows,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
  return {
    crumb: { label: work?.title ?? edition.title, href: work ? `/works/${work.slug}` : '/' },
    revision,
    // The editor lays out its own lines from the content; the reader's layout would only double the page's weight.
    view: { ...view, segments: lighten(view.segments) },
    edition: {
      id: edition.id,
      slug: edition.slug,
      title: edition.title,
      /** The number of the latest version that is not withdrawn; null while there is none. */
      latestVersion: versions.find((v) => !v.withdrawn)?.number ?? null,
      conventions: edition.conventions,
    },
    work: { id: edition.workId, slug: work?.slug ?? '', title: work?.title ?? '' },
    reviewed,
    conspectus,
    suggestions: await suggestedWitnesses(locals.db, user, grants, edition.workId),
    sources: await viewableTranscriptions(locals.db, user, grants),
    versions: versions.map((v) => ({
      number: v.number,
      at: v.at.toISOString(),
      note: v.note,
      withdrawn: v.withdrawn !== null,
    })),
    rights: editionRights(user, edition, access.collaboratorIds),
  };
};

export const actions: Actions = {
  /** The conspectus and its groups, from the Witnesses and Sigla window. */
  sigla: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    const conspectus = parseConspectus(await request.formData());
    if (!conspectus.ok) return fail(400, { message: conspectus.message });
    const refusal =
      (await conspectusRefusal(
        locals.db,
        user,
        await grantsFor(locals.db, user),
        conspectus.rows,
        access.edition.id,
      )) ??
      (await saveConspectus(locals.db, access.edition.id, conspectus.rows, conspectus.groups));
    if (refusal) return fail(400, { message: refusal });
    return { ok: true };
  },

  /**
   * Delete the edition, from wherever its menu stands. From its own pages
   * this leads to the work's page; from a list (`stay`) the list stays, and
   * is told.
   */
  delete: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canDeleteEdition(user, access.edition))
      return fail(403, { error: recordActions.edition.onlyOwner });
    const stay = (await request.formData()).get('stay') === '1';
    const [work] = await locals.db
      .select({ slug: works.slug })
      .from(works)
      .where(eq(works.id, access.edition.workId));
    // The edition goes with its history, its moments and any open offer of it.
    await locals.db.transaction(async (tx) => {
      await deleteHistory(tx, 'edition', [access.edition.id]);
      await tx.delete(editions).where(eq(editions.id, access.edition.id));
    });
    if (stay) return { message: recordActions.edition.deleted(access.edition.title) };
    throw redirect(303, work ? `/works/${work.slug}` : '/');
  },
};
