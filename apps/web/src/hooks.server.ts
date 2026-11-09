/**
 * Every request: read the session cookie, set locals.user and locals.db, and
 * stamp the user's theme and text face on <html> for the first paint.
 */
import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, cookieOptions, getSessionUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { startBackgroundWork } from '$lib/server/startup';
import { htmlAttributeString } from '$lib/preferences';

startBackgroundWork();

/** Request bodies larger than this are refused, except where large files are sent. */
const BODY_LIMIT = 1024 * 1024;

/** Where larger bodies are expected, and how large they may be. */
const LARGE_BODIES: [RegExp, number][] = [
  [/^\/witnesses\/[^/]+\/pages$/u, 100 * 1024 * 1024], // image uploads
  [/^\/transcriptions\/[^/]+$/u, 25 * 1024 * 1024], // imports
  [/^\/api\/documents\/[^/]+\/[^/]+\/ops$/u, 25 * 1024 * 1024], // a large first save or paste
  [/^\/bibliography$/u, 6 * 1024 * 1024], // a .bib file
];

function bodyLimit(pathname: string): number {
  return LARGE_BODIES.find(([pattern]) => pattern.test(pathname))?.[1] ?? BODY_LIMIT;
}

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.db = db;
  event.locals.user = null;

  const { request, url } = event;
  if (CHANGES.has(request.method)) {
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > bodyLimit(url.pathname)) {
      return new Response('The request is too large.', { status: 413, headers: { 'content-type': 'text/plain' } });
    }
    // The JSON endpoints change things for the signed-in user: only this site may call them, and only with JSON
    // (SvelteKit checks the origin of form posts itself; a body without a type would slip past that check).
    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return new Response('Cross-site requests are not allowed.', { status: 403, headers: { 'content-type': 'text/plain' } });
      if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        return new Response('Send JSON.', { status: 415, headers: { 'content-type': 'text/plain' } });
      }
    }
  }

  const token = event.cookies.get(SESSION_COOKIE);
  if (token) {
    const session = await getSessionUser(token);
    if (session) {
      event.locals.user = session.user;
      if (session.refreshed) event.cookies.set(SESSION_COOKIE, token, cookieOptions());
    } else {
      event.cookies.delete(SESSION_COOKIE, { path: '/' });
    }
  }

  const attributes = htmlAttributeString(event.locals.user?.preferences);
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%varians.html%', attributes),
  });
  // Sensible defaults for every answer: no guessing of types, no framing by other sites, no full addresses sent onwards.
  try {
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    if (!response.headers.has('content-security-policy')) response.headers.set('content-security-policy', "frame-ancestors 'self'");
  } catch {
    // A response with immutable headers keeps them as they are.
  }
  return response;
};
