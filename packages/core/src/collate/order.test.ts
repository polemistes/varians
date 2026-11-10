import { describe, expect, it } from 'vitest';
import { compareOrder, lcs, lcsOfOrderings, sameOrder } from './order.ts';

describe('compareOrder', () => {
  it('finds nothing when the orders agree', () => {
    expect(compareOrder(['1', '2', '3'], ['1', '2', '3'])).toEqual([]);
    expect(sameOrder(['1', '2', '3'], ['1', '3'])).toBe(true);
  });

  it('reports one line standing elsewhere', () => {
    const statements = compareOrder(['976', '977', '978', '1000'], ['976', '1000', '977', '978']);
    expect(statements).toEqual([{ moved: ['1000'], after: '976', afterInReference: '978' }]);
  });

  it('reports a block as one statement', () => {
    const statements = compareOrder(['1', '2', '3', '4', '5'], ['1', '4', '5', '2', '3']);
    expect(statements).toEqual([{ moved: ['2', '3'], after: '5', afterInReference: '1' }]);
  });

  it('ignores segments only one side has', () => {
    expect(compareOrder(['1', '2', '3'], ['3', '1'])).toEqual([
      { moved: ['1'], after: '3', afterInReference: null },
    ]);
  });

  it('computes the longest common subsequence', () => {
    expect(lcs(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'])).toHaveLength(3);
  });
});

describe('lcsOfOrderings', () => {
  it('gives what the table gives, for orderings of distinct elements', () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 3000; run++) {
      const n = 1 + Math.floor(next() * 12);
      const reference = Array.from({ length: n }, (_, i) => `s${i}`);
      const compared = [...reference];
      // A few moves, or many.
      const moves = next() < 0.3 ? n * 2 : 1 + Math.floor(next() * 3);
      for (let k = 0; k < moves; k++) {
        const [x] = compared.splice(Math.floor(next() * n), 1);
        compared.splice(Math.floor(next() * n), 0, x!);
      }
      expect(lcsOfOrderings(reference, compared), compared.join(' ')).toEqual(
        lcs(reference, compared),
      );
    }
  });
});
