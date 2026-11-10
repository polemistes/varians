/**
 * ORCID iDs: sixteen characters, the last a check character by
 * ISO 7064 MOD 11-2, stored in the 19-character form with hyphens.
 */

/** The check character of the first fifteen digits. */
export function orcidCheckCharacter(digits: string): string {
  let total = 0;
  for (const d of digits) total = (total + Number(d)) * 2;
  const result = (12 - (total % 11)) % 11;
  return result === 10 ? 'X' : String(result);
}

/**
 * An ORCID iD in its 19-character form (0000-0002-1825-0097), from what a
 * person typed: with or without hyphens or spaces, as an https://orcid.org/
 * address, a lower-case x. Null when it is not one, or its check fails.
 */
export function normalizeOrcid(input: string): string | null {
  const bare = input
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//iu, '')
    .replace(/[\s-]/gu, '')
    .toUpperCase();
  if (!/^\d{15}[\dX]$/u.test(bare)) return null;
  if (orcidCheckCharacter(bare.slice(0, 15)) !== bare[15]) return null;
  return `${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8, 12)}-${bare.slice(12)}`;
}

/** The address of an ORCID iD. */
export function orcidUrl(orcid: string): string {
  return `https://orcid.org/${orcid}`;
}
