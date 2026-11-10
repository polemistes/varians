/**
 * The canonical identifiers of works and witnesses (Varians Data
 * Format 2, section 7): a scheme and a value, checked and normalized here,
 * with the address of a resolver where the scheme has one. Pure, and safe in
 * the browser: the form shows the rows, the server checks them.
 */
import { isCtsWorkUrn } from '@varians/core';
import type { CanonicalIdentifier, IdentifierScheme } from '@varians/db';
import { registry as t } from '$lib/strings/registry';

export type { CanonicalIdentifier, IdentifierScheme };

/** The schemes in the order the form offers them; the same list as the schema's. */
export const IDENTIFIER_SCHEMES = [
  'cts',
  'diktyon',
  'trismegistos',
  'wikidata',
  'viaf',
  'url',
  'other',
] as const satisfies readonly IdentifierScheme[];

export const MAX_IDENTIFIERS = 20;
export const MAX_IDENTIFIER_LENGTH = 300;

export function isIdentifierScheme(value: unknown): value is IdentifierScheme {
  return typeof value === 'string' && (IDENTIFIER_SCHEMES as readonly string[]).includes(value);
}

const DIGITS = /^\d+$/u;
const WIKIDATA = /^Q[1-9]\d*$/u;

/** One identifier checked and normalized: trimmed, a Wikidata item with a capital Q. */
export function normalizeIdentifier(
  scheme: IdentifierScheme,
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  let value = raw.trim();
  if (!value) return { ok: false, error: t.identifiers.empty };
  if (value.length > MAX_IDENTIFIER_LENGTH) return { ok: false, error: t.identifiers.tooLong };
  switch (scheme) {
    case 'cts':
      if (!isCtsWorkUrn(value)) return { ok: false, error: t.identifiers.invalid.cts };
      break;
    case 'wikidata':
      value = value.replace(/^q/u, 'Q');
      if (!WIKIDATA.test(value)) return { ok: false, error: t.identifiers.invalid.wikidata };
      break;
    case 'diktyon':
    case 'trismegistos':
    case 'viaf':
      if (!DIGITS.test(value))
        return { ok: false, error: t.identifiers.invalid.digits(t.identifiers.schemes[scheme]) };
      break;
    case 'url':
      if (!isWebAddress(value)) return { ok: false, error: t.identifiers.invalid.url };
      break;
    case 'other':
      break;
  }
  return { ok: true, value };
}

function isWebAddress(value: string): boolean {
  if (/\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** The rows of a JSON list as they are, for showing them again; anything unreadable is left out. */
export function identifierRows(
  raw: string | null | undefined,
): { scheme: string; value: string }[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      scheme: typeof row.scheme === 'string' ? row.scheme : 'other',
      value: typeof row.value === 'string' ? row.value : '',
    }));
}

/**
 * The identifiers as the form sends them, one JSON field `identifiers`: each
 * row checked, empty rows dropped, duplicates (the same scheme and value)
 * kept once. The first problem is reported with the value it concerns.
 */
export function parseIdentifiers(
  raw: string,
): { ok: true; identifiers: CanonicalIdentifier[] } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, identifiers: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: t.identifiers.unreadable };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: t.identifiers.unreadable };
  const out: CanonicalIdentifier[] = [];
  const seen = new Set<string>();
  for (const row of parsed) {
    if (!row || typeof row !== 'object') return { ok: false, error: t.identifiers.unreadable };
    const { scheme, value } = row as { scheme?: unknown; value?: unknown };
    if (typeof value !== 'string' || !value.trim()) continue;
    if (!isIdentifierScheme(scheme)) return { ok: false, error: t.identifiers.unknownScheme };
    const checked = normalizeIdentifier(scheme, value);
    if (!checked.ok)
      return { ok: false, error: t.identifiers.problem(value.trim(), checked.error) };
    const key = `${scheme}\u0000${checked.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scheme, value: checked.value });
  }
  if (out.length > MAX_IDENTIFIERS)
    return { ok: false, error: t.identifiers.tooMany(MAX_IDENTIFIERS) };
  return { ok: true, identifiers: out };
}

/** Two lists as one, each scheme and value once, the first list's first. */
export function unionIdentifiers(
  a: CanonicalIdentifier[],
  b: CanonicalIdentifier[],
): CanonicalIdentifier[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((i) => {
    const key = `${i.scheme}\u0000${i.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Where an identifier can be looked up, for the schemes with a resolver; null for the others. */
export function identifierHref(identifier: CanonicalIdentifier): string | null {
  const value = identifier.value.trim();
  switch (identifier.scheme) {
    case 'wikidata':
      return WIKIDATA.test(value) ? `https://www.wikidata.org/wiki/${value}` : null;
    case 'viaf':
      return DIGITS.test(value) ? `https://viaf.org/viaf/${value}` : null;
    case 'trismegistos':
      return DIGITS.test(value) ? `https://www.trismegistos.org/text/${value}` : null;
    case 'diktyon':
      return DIGITS.test(value) ? `https://pinakes.irht.cnrs.fr/notices/cote/${value}/` : null;
    case 'url':
      return isWebAddress(value) ? value : null;
    default:
      return null;
  }
}
