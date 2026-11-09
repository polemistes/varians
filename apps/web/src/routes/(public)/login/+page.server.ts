import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { SESSION_COOKIE, cookieOptions, login } from '$lib/server/auth';
import { safeRedirect } from '$lib/server/guards';
import { sendVerification } from '$lib/server/account-mail';
import { mailConfigured, mailer, siteOf } from '$lib/server/mail';
import { limits } from '$lib/server/rate-limit';
import { s } from '$lib/strings';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
  email: z.email(s.auth.emailInvalid).max(254, s.auth.emailTooLong),
  password: z.string().min(1, s.auth.passwordRequired).max(1024),
});

type LoginErrors = { email?: string[]; password?: string[]; form?: string };

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
  return { crumb: { label: s.auth.logInTitle } };
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress, locals }) => {
    const form = await request.formData();
    const raw = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const values = { email: raw.email };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errors: LoginErrors = z.flattenError(parsed.error).fieldErrors;
      return fail(400, { values, errors });
    }
    // Guessing passwords takes time: a few attempts per account and per address, then a pause.
    const address = getClientAddress();
    const account = parsed.data.email.toLowerCase();
    if (!limits.loginByAddress.take(address) || !limits.loginByAccount.take(account)) {
      const wait = Math.max(limits.loginByAddress.retryAfter(address), limits.loginByAccount.retryAfter(account));
      const errors: LoginErrors = { form: s.auth.tooManyAttempts(Math.max(1, Math.ceil(wait / 60))) };
      return fail(429, { values, errors });
    }
    const result = await login(parsed.data.email, parsed.data.password, { requireConfirmed: mailConfigured() });
    if (result.ok) limits.loginByAccount.clear(account);
    if (!result.ok && result.error === 'unconfirmed') {
      // The password was right: say so only now, and send a new link, a few times an hour at most.
      limits.loginByAccount.clear(account);
      const send = mailer();
      let sent = false;
      if (send && limits.mailByAccount.take(account)) {
        try {
          await sendVerification(locals.db, send, result.user, siteOf(url.origin));
          sent = true;
        } catch (error) {
          console.error('The confirmation could not be sent:', error instanceof Error ? error.message : error);
        }
      }
      const errors: LoginErrors = { form: sent ? s.auth.unconfirmedSent : s.auth.unconfirmed };
      return fail(403, { values, errors });
    }
    if (!result.ok) {
      const errors: LoginErrors = { form: s.auth.invalidCredentials };
      return fail(400, { values, errors });
    }
    cookies.set(SESSION_COOKIE, result.token, cookieOptions());
    redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
  },
};
