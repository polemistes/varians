import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, logout } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

/** Logging out is a POST; a GET goes back to the library. */
export const load: PageServerLoad = () => {
  redirect(303, '/');
};

export const actions: Actions = {
  default: async ({ cookies }) => {
    const token = cookies.get(SESSION_COOKIE);
    if (token) await logout(token);
    cookies.delete(SESSION_COOKIE, { path: '/' });
    redirect(303, '/');
  },
};
