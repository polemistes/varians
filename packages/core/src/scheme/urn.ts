/**
 * CTS URNs of passages: the work's URN, a colon, and the values of the
 * address joined by full stops, in the order of the scheme's levels
 * (urn:cts:greekLit:tlg0012.tlg001:1.5). Varians Data Format 2, 4.3.
 */

import type { Address, Level } from './scheme.ts';

/** Whether an identifier is a CTS URN of a work (without a passage). */
export function isCtsWorkUrn(identifier: string | null | undefined): identifier is string {
  return typeof identifier === 'string' && /^urn:cts:[^:\s]+:[^:\s]+$/u.test(identifier.trim());
}

/** The passage URN of an address, or null when the work has no CTS URN or the address lacks a level. */
export function passageUrn(workUrn: string | null | undefined, address: Address, levels: Level[]): string | null {
  if (!isCtsWorkUrn(workUrn)) return null;
  const values: string[] = [];
  for (const level of levels) {
    const value = address[level.key];
    if (value === undefined || value === null || String(value).trim() === '') break;
    values.push(String(value).trim());
  }
  if (values.length === 0) return null;
  return `${workUrn.trim()}:${values.join('.')}`;
}
