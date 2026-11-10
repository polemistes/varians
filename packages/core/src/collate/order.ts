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
 * The longest common subsequence of two orderings of the same distinct
 * elements, the one `lcs` gives, in O(n log n) time and linear space: the
 * longest run of the compared sequence increasing in the reference's
 * positions, and of those the one earliest in the compared sequence. `lcs`
 * would take a table of n² cells, which a long edition cannot afford.
 */
export function lcsOfOrderings(reference: string[], compared: string[]): string[] {
  const position = new Map(reference.map((x, i) => [x, i] as const));
  const seq = compared.map((x) => position.get(x)!);
  // longest[k]: the longest increasing run of seq that starts at k, found from the right.
  const longest = new Array<number>(seq.length).fill(0);
  const tails: number[] = [];
  for (let k = seq.length - 1; k >= 0; k--) {
    // Read from the right, a run increasing from k decreases: kept as an increasing run of the negated values.
    const v = -seq[k]!;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    longest[k] = lo + 1;
  }
  const out: string[] = [];
  let need = tails.length;
  let last = -1;
  for (let k = 0; k < seq.length && need > 0; k++) {
    if (longest[k] === need && seq[k]! > last) {
      out.push(compared[k]!);
      last = seq[k]!;
      need--;
    }
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
  const inCompared = new Set(compared);
  const inBoth = new Set(reference.filter((x) => inCompared.has(x)));
  const ref = reference.filter((x) => inBoth.has(x));
  const cmp = compared.filter((x) => inBoth.has(x));
  // The segments of an order are distinct, and the fast way serves; the table only for sequences that repeat.
  const distinct = new Set(ref).size === ref.length && new Set(cmp).size === cmp.length;
  const kept = new Set(distinct ? lcsOfOrderings(ref, cmp) : lcs(ref, cmp));
  const refIndexOf = new Map<string, number>();
  ref.forEach((x, k) => {
    if (!refIndexOf.has(x)) refIndexOf.set(x, k);
  });
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
    const refIndex = refIndexOf.get(moved[0]!)!;
    const afterInReference = refIndex > 0 ? ref[refIndex - 1]! : null;
    statements.push({ moved, after, afterInReference });
  }
  return statements;
}

/** Whether two sequences agree in the order of the elements they share. */
export function sameOrder(reference: string[], compared: string[]): boolean {
  return compareOrder(reference, compared).length === 0;
}
