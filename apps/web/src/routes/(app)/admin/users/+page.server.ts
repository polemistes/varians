import { fail } from '@sveltejs/kit';
import { ROLES } from '@varians/db';
import { z } from 'zod';
import { makeResetLink, sendResetLink } from '$lib/server/account-mail';
import { listUsers, setRole } from '$lib/server/admin';
import { requireAdministrator } from '$lib/server/guards';
import { mailConfigured, mailer, siteOf } from '$lib/server/mail';
import { s } from '$lib/strings';
import type { Actions, PageServerLoad } from './$types';

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLES),
});

const userSchema = z.object({ userId: z.string().min(1).max(64) });

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdministrator(locals, url.pathname);
  return { crumb: { label: s.admin.title }, users: await listUsers(), mail: mailConfigured() };
};

export const actions: Actions = {
  role: async ({ request, locals }) => {
    requireAdministrator(locals);
    const form = await request.formData();
    const parsed = roleSchema.safeParse({ userId: form.get('userId'), role: form.get('role') });
    if (!parsed.success) return fail(400, { action: 'role' as const, ok: false as const, error: s.common.invalidForm });
    const result = await setRole(parsed.data.userId, parsed.data.role);
    if (!result.ok) {
      return fail(400, {
        action: 'role' as const,
        ok: false as const,
        error:
          result.error === 'last-administrator' ? s.admin.lastAdministrator : s.admin.userNotFound,
      });
    }
    return { action: 'role' as const, ok: true as const, name: result.name, role: parsed.data.role };
  },

  /**
   * A link to set a new password for someone: sent to their address when
   * the installation sends mail, otherwise shown here, for the administrator
   * to pass on.
   */
  reset: async ({ request, locals, url }) => {
    requireAdministrator(locals);
    const form = await request.formData();
    const parsed = userSchema.safeParse({ userId: form.get('userId') });
    if (!parsed.success) return fail(400, { action: 'reset' as const, ok: false as const, error: s.common.invalidForm });
    const site = siteOf(url.origin);
    const send = mailer();
    if (send) {
      try {
        const sent = await sendResetLink(locals.db, send, parsed.data.userId, site);
        if (!sent) return fail(404, { action: 'reset' as const, ok: false as const, error: s.admin.userNotFound });
        return { action: 'reset' as const, ok: true as const, name: sent.name, link: null };
      } catch (error) {
        console.error('A reset link could not be sent:', error instanceof Error ? error.message : error);
        return fail(502, { action: 'reset' as const, ok: false as const, error: s.admin.resetLinkNotSent });
      }
    }
    const made = await makeResetLink(locals.db, parsed.data.userId, site);
    if (!made) return fail(404, { action: 'reset' as const, ok: false as const, error: s.admin.userNotFound });
    return { action: 'reset' as const, ok: true as const, name: made.account.name, link: made.link };
  },
};
