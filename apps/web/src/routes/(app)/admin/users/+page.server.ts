import { fail } from '@sveltejs/kit';
import { ROLES } from '@varians/db';
import { z } from 'zod';
import { listUsers, setRole } from '$lib/server/admin';
import { requireAdministrator } from '$lib/server/guards';
import { s } from '$lib/strings';
import type { Actions, PageServerLoad } from './$types';

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLES),
});

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdministrator(locals, url.pathname);
  return { crumb: { label: s.admin.title }, users: await listUsers() };
};

export const actions: Actions = {
  role: async ({ request, locals }) => {
    requireAdministrator(locals);
    const form = await request.formData();
    const parsed = roleSchema.safeParse({ userId: form.get('userId'), role: form.get('role') });
    if (!parsed.success) return fail(400, { ok: false as const, error: s.common.invalidForm });
    const result = await setRole(parsed.data.userId, parsed.data.role);
    if (!result.ok) {
      return fail(400, {
        ok: false as const,
        error:
          result.error === 'last-administrator' ? s.admin.lastAdministrator : s.admin.userNotFound,
      });
    }
    return { ok: true as const, name: result.name, role: parsed.data.role };
  },
};
