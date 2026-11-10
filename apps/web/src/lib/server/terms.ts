/**
 * The terms of contribution: docs/terms.md, with its version in
 * the front matter, rendered as the guide is. An account that has not
 * accepted the current version may read everything and change nothing until
 * it does.
 */

import source from '../../../../../docs/terms.md?raw';
import { render, type Rendered } from '$lib/guide/markdown';

interface Terms {
  version: number;
  rendered: Rendered;
}

/** The front matter's version, and the text after it. */
export function parseTerms(text: string): { version: number; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(text);
  const front = match ? match[1]! : '';
  const version = Number(/^version:\s*(\d+)\s*$/mu.exec(front)?.[1] ?? NaN);
  if (!Number.isInteger(version) || version < 1)
    throw new Error('docs/terms.md names no version in its front matter');
  return { version, body: match ? text.slice(match[0].length) : text };
}

const parsed = parseTerms(source);

export const terms: Terms = { version: parsed.version, rendered: render(parsed.body) };

export const TERMS_VERSION = terms.version;

/** Whether an account has accepted the current terms. */
export function hasAcceptedTerms(
  user: { termsVersion: number | null } | null | undefined,
): boolean {
  return !!user && user.termsVersion === TERMS_VERSION;
}

/**
 * Where a request goes that an account without the current terms may not
 * make: null when it may go on. Reading is always allowed; so are signing
 * out, the account's own settings and the terms themselves.
 */
export function termsGate(method: string, pathname: string, search = ''): 'api' | 'page' | null {
  const writes = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  // The account's own settings, but not taking on someone's edition through an offer.
  const ownAccount = pathname === '/account' && !search.includes('/offer');
  if (
    pathname === '/terms' ||
    pathname.startsWith('/logout') ||
    ownAccount ||
    pathname.startsWith('/reset') ||
    pathname.startsWith('/verify')
  )
    return null;
  if (writes) return pathname.startsWith('/api/') ? 'api' : 'page';
  // The editor of an edition is where publishing and editing start.
  if (/^\/editions\/[^/]+\/edit(\/|$)/u.test(pathname)) return 'page';
  return null;
}

/** Where to go back to after accepting: a path on this site, nothing else. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
