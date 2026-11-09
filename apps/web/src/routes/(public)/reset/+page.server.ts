/**
 * Asking for a new password. The answer is the same whether or not an
 * account has the address, and comes at once: the link is made and sent
 * after the answer, so that its timing tells nothing either.
 */
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requestPasswordReset } from '$lib/server/account-mail';
import { mailConfigured, mailer, siteOf } from '$lib/server/mail';
import { limits } from '$lib/server/rate-limit';
import { s } from '$lib/strings';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({ email: z.email(s.auth.emailInvalid).max(254, s.auth.emailTooLong) });

type ResetErrors = { email?: string[]; form?: string };

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/account');
  return { crumb: { label: s.auth.resetTitle }, mail: mailConfigured() };
};

export const actions: Actions = {
  default: async ({ request, getClientAddress, locals, url }) => {
    const send = mailer();
    if (!send) return fail(404, { values: { email: '' }, errors: { form: s.auth.resetWithoutMail } as ResetErrors });
    const form = await request.formData();
    const values = { email: String(form.get('email') ?? '') };
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errors: ResetErrors = z.flattenError(parsed.error).fieldErrors;
      return fail(400, { values, errors });
    }
    const address = getClientAddress();
    if (!limits.resetByAddress.take(address)) {
      const errors: ResetErrors = { form: s.auth.tooManyAttempts(Math.max(1, Math.ceil(limits.resetByAddress.retryAfter(address) / 60))) };
      return fail(429, { values, errors });
    }
    // Past the limit for this address, nothing more is sent to it, and the answer stays the same.
    const account = parsed.data.email.trim().toLowerCase();
    if (limits.mailByAccount.take(account)) {
      void requestPasswordReset(locals.db, send, parsed.data.email, siteOf(url.origin)).catch((error: unknown) => {
        console.error('A link to set a new password could not be sent:', error instanceof Error ? error.message : error);
      });
    }
    return { sent: true as const };
  },
};
