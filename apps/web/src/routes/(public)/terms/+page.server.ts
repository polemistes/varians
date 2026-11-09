import { fail, redirect } from '@sveltejs/kit';
import { users } from '@varians/db';
import { eq } from 'drizzle-orm';
import { hasAcceptedTerms, safeNext, terms, TERMS_VERSION } from '$lib/server/terms';
import { site } from '$lib/strings/site';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => ({
  crumb: { label: site.terms.title },
  html: terms.rendered.html,
  version: TERMS_VERSION,
  /** Whether the visitor is signed in and has yet to accept this version; null for a visitor not signed in. */
  toAccept: locals.user ? !hasAcceptedTerms(locals.user) : null,
  /** Whether they accepted an earlier version. */
  changed: !!locals.user && locals.user.termsVersion !== null && locals.user.termsVersion !== TERMS_VERSION,
  next: safeNext(url.searchParams.get('next')),
});

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.user) redirect(303, '/login');
    const form = await request.formData();
    if (Number(form.get('version')) !== TERMS_VERSION) return fail(409, { stale: true });
    await locals.db.update(users).set({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() }).where(eq(users.id, locals.user.id));
    redirect(303, safeNext(String(form.get('next') ?? '/')));
  },
};
