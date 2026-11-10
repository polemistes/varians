/**
 * Making a copy of an edition: posted from the reader or the
 * editor, it makes a draft of the user's own and opens it in the editor.
 * There is no page to show here.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { copyEdition } from '$lib/server/edition-copy';
import { registry } from '$lib/strings/registry';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  redirect(303, `/editions/${encodeURIComponent(params.slug)}`);
};

export const actions: Actions = {
  default: async ({ locals, params, request }) => {
    const user = locals.user;
    if (!user) return fail(401, { copyError: registry.copy.signIn });
    const form = await request.formData();
    const title = String(form.get('name') ?? '').trim().slice(0, 200);
    if (!title) return fail(400, { copyError: registry.copy.titleRequired });
    const made = await copyEdition(locals.db, user, params.slug, title);
    if (made === 'not-found') error(404, 'No such edition');
    if (made === 'forbidden') return fail(403, { copyError: registry.copy.notAllowed });
    const without = made.withoutTranscription ? `?without=${made.withoutTranscription}` : '';
    redirect(303, `/editions/${encodeURIComponent(made.edition.slug)}/edit${without}`);
  },
};
