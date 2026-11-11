import { error, fail, redirect } from '@sveltejs/kit';
import { editions, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { canDeleteEdition, canGrantOnEdition, grantsFor } from '$lib/server/authz';
import { addCollaborator, listCollaborators, removeCollaborator } from '$lib/server/collaborators';
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
import { offerOwnership } from '$lib/server/ownership';
import { publishedVersions } from '$lib/server/publish';
import { editionView, type SegmentView } from '$lib/server/reader';
import { deleteHistory, viewableTranscriptions } from '$lib/server/registry';
import { OPENING_SEGMENTS } from '$lib/edition/workspace';
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
  const view = await editionView(
    locals.db,
    edition.id,
    null,
    { kind: 'editor', viewer: user },
    { first: OPENING_SEGMENTS, lines: false },
  );
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
      visibility: edition.visibility,
      publishedVersion: edition.publishedVersion,
      conventions: edition.conventions,
    },
    work: { id: edition.workId, slug: work?.slug ?? '', title: work?.title ?? '' },
    reviewed,
    conspectus,
    suggestions: await suggestedWitnesses(locals.db, user, grants, edition.workId),
    sources: await viewableTranscriptions(locals.db, user, grants),
    versions: await publishedVersions(locals.db, edition.id),
    collaborators: canGrantOnEdition(user, edition)
      ? await listCollaborators(locals.db, edition.id)
      : [],
    can: {
      publish: access.canPublish,
      grant: canGrantOnEdition(user, edition),
      delete: canDeleteEdition(user, edition),
    },
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

  addCollaborator: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canGrantOnEdition(user, access.edition))
      throw error(403, 'Only the owner may invite collaborators');
    const email = String((await request.formData()).get('email') ?? '').trim();
    if (!email)
      return fail(400, { form: 'collaborators' as const, message: 'Give an email address.' });
    const result = await addCollaborator(locals.db, access.edition.id, email, user.id);
    if (!result.ok) {
      const message =
        result.error === 'no-user'
          ? 'Nobody with that address has an account.'
          : result.error === 'owner'
            ? 'That is the owner.'
            : 'Already a collaborator.';
      return fail(400, { form: 'collaborators' as const, message });
    }
    return { form: 'collaborators' as const, ok: true, added: result.collaborator.name };
  },

  removeCollaborator: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canGrantOnEdition(user, access.edition))
      throw error(403, 'Only the owner may remove collaborators');
    const userId = String((await request.formData()).get('userId') ?? '');
    await removeCollaborator(locals.db, access.edition.id, userId);
    return { form: 'collaborators' as const, ok: true };
  },

  offerOwnership: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canGrantOnEdition(user, access.edition))
      throw error(403, 'Only the owner may hand the edition on');
    const email = String((await request.formData()).get('email') ?? '').trim();
    const result = await offerOwnership(
      locals.db,
      'edition',
      access.edition.id,
      access.edition.ownerId,
      email,
    );
    if (!result.ok) {
      const message = {
        'no-user': 'Nobody with that address has an account.',
        self: 'You own it already.',
        'open-offer': 'An offer is already open; withdraw it on your account page first.',
        'not-owner': 'Only the owner may hand the edition on.',
      }[result.error];
      return fail(400, { form: 'ownership' as const, message });
    }
    return { form: 'ownership' as const, ok: true };
  },

  delete: async ({ locals, params }) => {
    const { user, access } = await editable(locals, params.slug);
    if (!canDeleteEdition(user, access.edition))
      throw error(403, 'Only the owner may delete the edition');
    const [work] = await locals.db
      .select({ slug: works.slug })
      .from(works)
      .where(eq(works.id, access.edition.workId));
    // The edition goes with its history, its moments and any open offer of it.
    await locals.db.transaction(async (tx) => {
      await deleteHistory(tx, 'edition', [access.edition.id]);
      await tx.delete(editions).where(eq(editions.id, access.edition.id));
    });
    throw redirect(303, work ? `/works/${work.slug}` : '/');
  },
};
