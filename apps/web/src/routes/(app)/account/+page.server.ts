import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE,
  changePassword,
  updateName,
  updatePreferences,
} from '$lib/server/auth';
import { requireUser } from '$lib/server/guards';
import { answerOffer, offersOf } from '$lib/server/ownership';
import { s } from '$lib/strings';
import { FONTS, THEMES } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

const nameSchema = z.object({
  name: z.string().trim().min(1, s.auth.nameRequired).max(120, s.auth.nameTooLong),
});

const passwordSchema = z
  .object({
    current: z.string().min(1, s.auth.passwordRequired),
    next: z
      .string()
      .min(PASSWORD_MIN_LENGTH, s.auth.passwordTooShort)
      .max(PASSWORD_MAX_LENGTH, s.auth.passwordTooLong),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ['confirm'], message: s.account.passwordsDiffer });

const preferencesSchema = z.object({
  font: z.enum(FONTS),
  theme: z.enum(THEMES),
});

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  return { crumb: { label: s.account.title }, offers: await offersOf(locals.db, user.id) };
};

export const actions: Actions = {
  name: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const parsed = nameSchema.safeParse({ name: text(form, 'name') });
    if (!parsed.success) {
      return fail(400, {
        form: 'name' as const,
        errors: z.flattenError(parsed.error).fieldErrors,
        values: { name: text(form, 'name') },
      });
    }
    await updateName(user.id, parsed.data.name);
    return { form: 'name' as const, ok: true };
  },

  password: async ({ request, locals, cookies }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const parsed = passwordSchema.safeParse({
      current: text(form, 'current'),
      next: text(form, 'next'),
      confirm: text(form, 'confirm'),
    });
    if (!parsed.success)
      return fail(400, {
        form: 'password' as const,
        errors: z.flattenError(parsed.error).fieldErrors,
      });
    const result = await changePassword(user.id, parsed.data.current, parsed.data.next, cookies.get(SESSION_COOKIE));
    if (!result.ok)
      return fail(400, {
        form: 'password' as const,
        errors: { current: [s.account.wrongPassword] },
      });
    return { form: 'password' as const, ok: true };
  },

  preferences: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const parsed = preferencesSchema.safeParse({
      font: text(form, 'font'),
      theme: text(form, 'theme'),
    });
    if (!parsed.success)
      return fail(400, {
        form: 'preferences' as const,
        errors: z.flattenError(parsed.error).fieldErrors,
      });
    await updatePreferences(user.id, parsed.data);
    return { form: 'preferences' as const, ok: true };
  },

  offer: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const answer = text(form, 'answer');
    if (answer !== 'accept' && answer !== 'decline' && answer !== 'withdraw') return fail(400, { form: 'offer' as const });
    const done = await answerOffer(locals.db, text(form, 'offerId'), user.id, answer);
    if (!done) return fail(400, { form: 'offer' as const });
    return { form: 'offer' as const, ok: true, answer };
  },
};
