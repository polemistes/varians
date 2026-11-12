import { error, fail } from '@sveltejs/kit';
import { licenceInfo } from '@varians/core';
import { users, works, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { canGrantOnEdition, editionRights, grantsFor } from '$lib/server/authz';
import { addCollaborator, listCollaborators, removeCollaborator } from '$lib/server/collaborators';
import { loadEditionAccess } from '$lib/server/edition-access';
import {
  conspectusRefusal,
  editionConspectus,
  parseConspectus,
  parseSettings,
  saveConspectus,
  suggestedWitnesses,
} from '$lib/server/edition-form';
import { windowActions } from '$lib/server/edition-page';
import { updateEditionMeta } from '$lib/server/editions';
import { requireUser } from '$lib/server/guards';
import { offerOwnership, openOfferOf } from '$lib/server/ownership';
import { viewableTranscriptions } from '$lib/server/registry';
import { dataLicence } from '$lib/server/settings';
import { edition as s } from '$lib/strings/edition';
import { recordActions } from '$lib/strings/record-actions';
import type { Actions, PageServerLoad } from './$types';

/** The edition, when the person may change its settings: the right the editor's forms ask for. */
async function editable(locals: App.Locals, slug: string, returnTo?: string) {
  const user = requireUser(locals, returnTo);
  const access = await loadEditionAccess(locals.db, user, slug);
  if (!access || !access.canView) throw error(404, 'No such edition');
  if (!access.canEdit) throw error(403, 'You may not edit this edition');
  return { user, access };
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { user, access } = await editable(locals, params.slug, url.pathname);
  const edition = access.edition;
  const grants = await grantsFor(locals.db, user);
  const [work] = await locals.db
    .select({ id: works.id, slug: works.slug, title: works.title, author: works.author })
    .from(works)
    .where(eq(works.id, edition.workId));
  const conspectus = await editionConspectus(locals.db, user, grants, edition);
  const grant = canGrantOnEdition(user, edition);
  // Changes whenever something the page shows is saved, so that the page starts afresh from it.
  const revision = createHash('sha1')
    .update(
      JSON.stringify([
        edition.title,
        edition.editors,
        edition.preface,
        edition.sources,
        edition.rightsNote,
        edition.conventions,
        conspectus.rows,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
  return {
    crumb: { label: s.settingsTitle },
    revision,
    work: work ?? null,
    rights: editionRights(user, edition, access.collaboratorIds),
    people: grant ? await peopleOf(locals.db, edition.id, edition.ownerId) : null,
    edition: {
      id: edition.id,
      slug: edition.slug,
      published: access.edition.hasVersion,
      title: edition.title,
      editors: edition.editors,
      preface: edition.preface,
      sources: edition.sources,
      rightsNote: edition.rightsNote,
      licence: licenceInfo(edition.licenceId)?.name ?? null,
      installationLicence: licenceInfo(dataLicence())!.name,
      conventions: edition.conventions,
    },
    conspectus,
    suggestions: await suggestedWitnesses(locals.db, user, grants, edition.workId),
    sources: await viewableTranscriptions(locals.db, user, grants),
  };
};

/** The owner, the collaborators and an open offer of the ownership, for those who may grant. */
async function peopleOf(db: Database, editionId: string, ownerId: string) {
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, ownerId));
  return {
    owner: owner?.name ?? '',
    collaborators: await listCollaborators(db, editionId),
    offer: await openOfferOf(db, 'edition', editionId),
  };
}

/** The edition, when the person may invite, remove and offer: its owner or an administrator. */
async function grantable(locals: App.Locals, slug: string) {
  const { user, access } = await editable(locals, slug);
  if (!canGrantOnEdition(user, access.edition)) return null;
  return { user, access };
}

const people = recordActions.edition.people;

class Refused extends Error {
  constructor(readonly sigla: string) {
    super(sigla);
  }
}

export const actions: Actions = {
  /**
   * Save: the name, editors, preface, sources, note on rights and conventions,
   * and the conspectus with its groups when the form carries it. Nothing is
   * saved while anything is refused.
   */
  save: async ({ locals, params, request }) => {
    const { user, access } = await editable(locals, params.slug);
    const form = await request.formData();
    const settings = parseSettings(form, access.edition.conventions);
    const conspectus = form.has('sigla') ? parseConspectus(form) : null;
    let sigla = conspectus && !conspectus.ok ? conspectus.message : null;
    if (conspectus?.ok)
      sigla = await conspectusRefusal(
        locals.db,
        user,
        await grantsFor(locals.db, user),
        conspectus.rows,
        access.edition.id,
      );
    if (!settings.ok || sigla)
      return fail(400, {
        errors: { ...(settings.ok ? {} : settings.errors), ...(sigla ? { sigla: [sigla] } : {}) },
      });
    try {
      await locals.db.transaction(async (tx) => {
        const db = tx as unknown as Database;
        await updateEditionMeta(db, access.edition.id, settings.fields);
        if (conspectus?.ok) {
          const problem = await saveConspectus(
            db,
            access.edition.id,
            conspectus.rows,
            conspectus.groups,
          );
          if (problem) throw new Refused(problem);
        }
      });
    } catch (cause) {
      if (cause instanceof Refused) return fail(400, { errors: { sigla: [cause.sigla] } });
      throw cause;
    }
    return { ok: true };
  },
  /** Owner and Collaborators acts at once, not through Save: collaborators and offers are records of their own. */
  addCollaborator: async ({ locals, params, request }) => {
    const granted = await grantable(locals, params.slug);
    if (!granted) return fail(403, { error: recordActions.edition.onlyOwner });
    const email = String((await request.formData()).get('email') ?? '').trim();
    if (!email) return fail(400, { error: people.emailRequired });
    const result = await addCollaborator(
      locals.db,
      granted.access.edition.id,
      email,
      granted.user.id,
    );
    if (!result.ok)
      return fail(400, {
        error:
          result.error === 'no-user'
            ? people.noAccount
            : result.error === 'owner'
              ? people.isOwner
              : people.already,
      });
    return { message: people.invited(result.collaborator.name) };
  },

  removeCollaborator: async ({ locals, params, request }) => {
    const granted = await grantable(locals, params.slug);
    if (!granted) return fail(403, { error: recordActions.edition.onlyOwner });
    const userId = String((await request.formData()).get('userId') ?? '');
    const [person] = (await listCollaborators(locals.db, granted.access.edition.id)).filter(
      (c) => c.userId === userId,
    );
    if (!person) return fail(400, { error: people.notACollaborator });
    await removeCollaborator(locals.db, granted.access.edition.id, userId);
    return { message: people.removed(person.name) };
  },

  offerOwnership: async ({ locals, params, request }) => {
    const granted = await grantable(locals, params.slug);
    if (!granted) return fail(403, { error: recordActions.edition.onlyOwner });
    const email = String((await request.formData()).get('email') ?? '').trim();
    if (!email) return fail(400, { error: people.emailRequired });
    const edition = granted.access.edition;
    // An administrator offers it in the owner's name.
    const result = await offerOwnership(locals.db, 'edition', edition.id, edition.ownerId, email);
    if (!result.ok)
      return fail(400, {
        error: {
          'no-user': people.noAccount,
          self: people.ownsAlready,
          'open-offer': people.offerOpen,
          'not-owner': recordActions.edition.onlyOwner,
        }[result.error],
      });
    return { message: people.offered };
  },
  ...windowActions,
};
