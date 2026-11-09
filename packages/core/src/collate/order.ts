/**
 * Order comparison: where a witness (or the numbering order) has the
 * segments of an edition in a different sequence. Derived by comparison,
 * never stored.
 */

export interface OrderStatement {
  /** The block that stands elsewhere, in the compared sequence's order. */
  moved: string[];
  /** The element the block follows in the compared sequence, or null when it opens it. */
  after: string | null;
  /** The element the block follows in the reference sequence. */
  afterInReference: string | null;
}

/** Longest common subsequence of two sequences of ids. */
export function lcs(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/**
 * The minimal moves that turn the reference order into the compared order,
 * over the elements both have. Elements kept in place are the longest common
 * subsequence; every maximal run of the others, contiguous in the compared
 * sequence, is one statement.
 */
export function compareOrder(reference: string[], compared: string[]): OrderStatement[] {
  const inBoth = new Set(reference.filter((x) => compared.includes(x)));
  const ref = reference.filter((x) => inBoth.has(x));
  const cmp = compared.filter((x) => inBoth.has(x));
  const kept = new Set(lcs(ref, cmp));
  const statements: OrderStatement[] = [];
  let i = 0;
  while (i < cmp.length) {
    if (kept.has(cmp[i]!)) {
      i++;
      continue;
    }
    const start = i;
    while (i < cmp.length && !kept.has(cmp[i]!)) i++;
    const moved = cmp.slice(start, i);
    const after = start > 0 ? cmp[start - 1]! : null;
    const refIndex = ref.indexOf(moved[0]!);
    const afterInReference = refIndex > 0 ? ref[refIndex - 1]! : null;
    statements.push({ moved, after, afterInReference });
  }
  return statements;
}

/** Whether two sequences agree in the order of the elements they share. */
export function sameOrder(reference: string[], compared: string[]): boolean {
  return compareOrder(reference, compared).length === 0;
}
