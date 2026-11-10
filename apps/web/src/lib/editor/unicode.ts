/**
 * Code points against UTF-16 units.
 *
 * Mark offsets count code points of a token's written form;
 * CodeMirror positions count UTF-16 units. Polytonic Greek sits in the
 * basic plane, but papyrological and epigraphic scripts do not, so the two
 * are never assumed equal.
 */

export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** The UTF-16 offset of a code point index in a string. */
export function utf16Offset(text: string, codePoints: number): number {
  let units = 0;
  let count = 0;
  for (const ch of text) {
    if (count >= codePoints) break;
    units += ch.length;
    count++;
  }
  return units;
}

/** The code point index of a UTF-16 offset in a string. An offset inside a pair rounds up. */
export function codePointIndex(text: string, utf16: number): number {
  let units = 0;
  let count = 0;
  for (const ch of text) {
    if (units >= utf16) break;
    units += ch.length;
    count++;
  }
  return count;
}
