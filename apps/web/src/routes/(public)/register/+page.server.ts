import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE,
  cookieOptions,
  register,
} from '$lib/server/auth';
import { sendVerification } from '$lib/server/account-mail';
import { mailer, siteOf } from '$lib/server/mail';
import { limits } from '$lib/server/rate-limit';
import { TERMS_VERSION } from '$lib/server/terms';
import { s } from '$lib/strings';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
  name: z.string().trim().min(1, s.auth.nameRequired).max(120, s.auth.nameTooLong),
  email: z.email(s.auth.emailInvalid).max(254, s.auth.emailTooLong),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, s.auth.passwordTooShort)
    .max(PASSWORD_MAX_LENGTH, s.auth.passwordTooLong),
});

type RegisterErrors = { name?: string[]; email?: string[]; password?: string[]; terms?: string[]; form?: string };

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/');
  return { crumb: { label: s.auth.registerTitle } };
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress, locals, url }) => {
    const form = await request.formData();
    const raw = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const values = { name: raw.name, email: raw.email };
    const parsed = schema.safeParse(raw);
    const accepted = form.get('terms') === 'accepted';
    if (!parsed.success || !accepted) {
      const errors: RegisterErrors = parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
      if (!accepted) errors.terms = [s.auth.termsRequired];
      return fail(400, { values, errors });
    }
    const address = getClientAddress();
    if (!limits.registerByAddress.take(address)) {
      const errors: RegisterErrors = { form: s.auth.tooManyAttempts(Math.max(1, Math.ceil(limits.registerByAddress.retryAfter(address) / 60))) };
      return fail(429, { values, errors });
    }
    // With mail, the address is confirmed before the account can be used; without, the account is ready at once.
    const send = mailer();
    const result = await register(parsed.data.email, parsed.data.name, parsed.data.password, { session: !send, termsVersion: TERMS_VERSION });
    if (!result.ok) {
      const errors: RegisterErrors = { email: [s.auth.emailTaken] };
      return fail(400, { values, errors });
    }
    if (send) {
      limits.mailByAccount.take(result.user.email.toLowerCase());
      try {
        await sendVerification(locals.db, send, result.user, siteOf(url.origin));
        return { confirm: { email: result.user.email, sent: true } };
      } catch (error) {
        console.error('The confirmation could not be sent:', error instanceof Error ? error.message : error);
        return { confirm: { email: result.user.email, sent: false } };
      }
    }
    if (result.token) cookies.set(SESSION_COOKIE, result.token, cookieOptions());
    redirect(303, '/');
  },
};
