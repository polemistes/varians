import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE,
  cookieOptions,
  register,
} from '$lib/server/auth';
import { limits } from '$lib/server/rate-limit';
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

type RegisterErrors = { name?: string[]; email?: string[]; password?: string[]; form?: string };

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/');
  return { crumb: { label: s.auth.registerTitle } };
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const form = await request.formData();
    const raw = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const values = { name: raw.name, email: raw.email };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errors: RegisterErrors = z.flattenError(parsed.error).fieldErrors;
      return fail(400, { values, errors });
    }
    const address = getClientAddress();
    if (!limits.registerByAddress.take(address)) {
      const errors: RegisterErrors = { form: s.auth.tooManyAttempts(Math.max(1, Math.ceil(limits.registerByAddress.retryAfter(address) / 60))) };
      return fail(429, { values, errors });
    }
    const result = await register(parsed.data.email, parsed.data.name, parsed.data.password);
    if (!result.ok) {
      const errors: RegisterErrors = { email: [s.auth.emailTaken] };
      return fail(400, { values, errors });
    }
    cookies.set(SESSION_COOKIE, result.token, cookieOptions());
    redirect(303, '/');
  },
};
