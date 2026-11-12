import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds } from '@varians/core';
import { historyStrings } from '../strings/history.ts';
import { diffStates } from './diff.ts';
import { addCounts, countChanges, countOps, describeCounts, emptyCounts } from './summary.ts';

describe('counting changes', () => {
  const before = fromText('a b c\nd e', { lang: 'en', ids: sequentialIds() });

  it('counts words by what happened to them, and breaks apart', () => {
    const after = applyOps(before, [
      { t: 'set', id: 't2', fields: { form: 'B' } },
      {
        t: 'insert',
        after: 't3',
        items: [
          { kind: 'token', id: 'x', form: 'x' },
          { kind: 'token', id: 'y', form: 'y' },
        ],
      },
      { t: 'delete', ids: ['t4'] },
    ]).stream;
    const counts = countChanges(diffStates(before, after));
    expect(counts).toEqual({ ...emptyCounts(), added: 2, changed: 1, breaksRemoved: 1 });
    expect(describeCounts(counts, historyStrings)).toBe(
      '2 words added, 1 changed, 1 line break removed',
    );
  });

  it('counts a word both moved and re-spelt once, as changed', () => {
    const after = applyOps(before, [
      { t: 'move', ids: ['t1'], after: 't2' },
      { t: 'set', id: 't1', fields: { form: 'A' } },
    ]).stream;
    expect(countChanges(diffStates(before, after))).toMatchObject({
      added: 0,
      removed: 0,
      changed: 1,
      moved: 0,
    });
  });

  it('says so when nothing changed, and adds counts up', () => {
    expect(describeCounts(emptyCounts(), historyStrings)).toBe(historyStrings.noChange);
    const one = { ...emptyCounts(), added: 1 };
    expect(describeCounts(addCounts(one, one), historyStrings)).toBe('2 words added');
    expect(describeCounts(one, historyStrings)).toBe('1 word added');
    expect(describeCounts({ ...emptyCounts(), removed: 1, moved: 2 }, historyStrings)).toBe(
      '1 word removed, 2 moved',
    );
    expect(
      describeCounts({ ...emptyCounts(), breaksAdded: 2, objectsAdded: 1 }, historyStrings),
    ).toBe('2 line breaks added, 1 object added');
    const gap = { kind: 'object' as const, id: 'g', type: 'gap' as const };
    expect(countChanges({ changes: [{ kind: 'removed', item: gap, after: null }] })).toEqual({
      ...emptyCounts(),
      objectsRemoved: 1,
    });
  });

  it('estimates from operations when there is no diff', () => {
    expect(
      countOps([
        { t: 'insert', after: null, items: before.items },
        { t: 'delete', ids: ['q'] },
      ]),
    ).toEqual({
      ...emptyCounts(),
      added: 5,
      removed: 1,
      breaksAdded: 1,
    });
  });
});
