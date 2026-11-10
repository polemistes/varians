/**
 * Setting a new password with a link. Opening the link only checks it; the
 * link is used up when the new password is set, so that a mail program that
 * opens links ahead of its reader does not spend it.
 */
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE,
  cookieOptions,
  createSession,
} from '$lib/server/auth';
import { resetPassword } from '$lib/server/account-mail';
import { findEmailToken } from '$lib/server/email-tokens';
import { mailConfigured } from '$lib/server/mail';
import { limits } from '$lib/server/rate-limit';
import { s } from '$lib/strings';
import type { Actions, PageServerLoad } from './$types';

const schema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, s.auth.passwordTooShort)
      .max(PASSWORD_MAX_LENGTH, s.auth.passwordTooLong),
    repeat: z.string(),
  })
  .refine((v) => v.password === v.repeat, { path: ['repeat'], message: s.auth.passwordsDiffer });

type ResetErrors = { password?: string[]; repeat?: string[]; form?: string };

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
  // The token is in the address: no other site is told it.
  setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
  const valid = await findEmailToken(locals.db, params.token, 'reset');
  return { crumb: { label: s.auth.resetTitle }, valid: valid !== null, mail: mailConfigured() };
};

export const actions: Actions = {
  default: async ({ params, request, locals, cookies, getClientAddress }) => {
    // Attempts count with the logins from the same address.
    const address = getClientAddress();
    if (!limits.loginByAddress.take(address)) {
      const errors: ResetErrors = {
        form: s.auth.tooManyAttempts(
          Math.max(1, Math.ceil(limits.loginByAddress.retryAfter(address) / 60)),
        ),
      };
      return fail(429, { errors });
    }
    const form = await request.formData();
    const parsed = schema.safeParse({
      password: String(form.get('password') ?? ''),
      repeat: String(form.get('repeat') ?? ''),
    });
    if (!parsed.success) {
      const errors: ResetErrors = z.flattenError(parsed.error).fieldErrors;
      return fail(400, { errors });
    }
    const result = await resetPassword(locals.db, params.token, parsed.data.password);
    if (!result)
      return fail(400, {
        invalid: true as const,
        errors: { form: s.auth.resetInvalid } as ResetErrors,
      });
    cookies.set(SESSION_COOKIE, await createSession(result.userId, locals.db), cookieOptions());
    redirect(303, '/');
  },
};
