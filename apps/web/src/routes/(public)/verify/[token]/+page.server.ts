/**
 * Confirming an address with the link from the mail. Opening the link
 * confirms the address but signs no one in: a mail program that opens links
 * ahead of its reader confirms the address (which the mail reaching it shows
 * anyway) and gains nothing else.
 */
import { confirmEmail } from '$lib/server/account-mail';
import { s } from '$lib/strings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
  const confirmed = await confirmEmail(locals.db, params.token);
  return { crumb: { label: s.auth.confirmedTitle }, confirmed, signedIn: locals.user !== null };
};
