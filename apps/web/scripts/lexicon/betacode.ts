/**
 * Beta Code to Unicode Greek, as the Perseus lexica write their Greek
 * (a)/nqrwpos for ἄνθρωπος, *a for Α). The conversion is the one of the
 * beta-code package the Anagnosis pipeline uses: the longest sequence of
 * the table that begins at each character is taken, and a sigma that ends
 * a word is written ς. The result is NFC.
 */
import { BETACODE, BETACODE_MAX_KEY } from './betacode-table.ts';

export function betaToUnicode(beta: string): string {
  const chars = [...beta.normalize('NFC')];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    let found = chars[i]!;
    let next = i + 1;
    const max = Math.min(chars.length, i + BETACODE_MAX_KEY);
    for (let last = i + 1; last <= max; last++) {
      const mapped = BETACODE[chars.slice(i, last).join('')];
      if (mapped !== undefined) {
        found = mapped;
        next = last;
      }
    }
    out += found;
    i = next;
  }
  return out.replace(/σ(?=[,.:;·\s]|$)/gu, 'ς').normalize('NFC');
}
