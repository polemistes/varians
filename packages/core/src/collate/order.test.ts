import { describe, expect, it } from 'vitest';
import { compareOrder, lcs, sameOrder } from './order.ts';

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
    expect(compareOrder(['1', '2', '3'], ['3', '1'])).toEqual([{ moved: ['1'], after: '3', afterInReference: null }]);
  });

  it('computes the longest common subsequence', () => {
    expect(lcs(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'])).toHaveLength(3);
  });
});
