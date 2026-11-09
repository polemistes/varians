/**
 * Guards for loads and actions: who must be signed in, who must administer.
 * Actions run without the layout's load, so every action calls these itself.
 */
import { error, redirect } from '@sveltejs/kit';
import { s } from '$lib/strings';
import type { CurrentUser } from '$lib/types';
import { isAdministrator } from './authz';

/** Where to send a visitor so that they come back after logging in. */
export function loginUrl(returnTo?: string): string {
  const local = returnTo ? safeRedirect(returnTo) : '/';
  return local !== '/' || returnTo === '/' ? `/login?redirectTo=${encodeURIComponent(local)}` : '/login';
}

const LOCAL = 'http://varians.invalid';

/**
 * A local path to go to after login; anything else becomes the library.
 * The target is read as a browser would read it (which drops tabs and line
 * breaks and turns backslashes into slashes), and kept only when it stays
 * on this site.
 */
export function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith('/')) return '/';
  // Control characters, spaces and backslashes have no place in a path we send people to.
  if (/[\u0000-\u0020\u007f\\]/u.test(target)) return '/';
  try {
    const url = new URL(target, LOCAL);
    if (url.origin !== LOCAL) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export function requireUser(locals: App.Locals, returnTo?: string): CurrentUser {
  if (!locals.user) redirect(303, loginUrl(returnTo));
  return locals.user;
}

export function requireAdministrator(locals: App.Locals, returnTo?: string): CurrentUser {
  const user = requireUser(locals, returnTo);
  if (!isAdministrator(user)) error(403, s.errors.forbiddenText);
  return user;
}
