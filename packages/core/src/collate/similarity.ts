/** Edit distance between two strings, by code points. */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let previous = new Array<number>(y.length + 1);
  let current = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) previous[j] = j;
  for (let i = 1; i <= x.length; i++) {
    current[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[y.length]!;
}

/** 1 for identical strings, 0 for nothing in common: one minus the edit distance over the longer length. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(Array.from(a).length, Array.from(b).length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}
