import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds, toText, type Op, type Stream } from '@varians/core';
import { revertOps, salvageOps, wordsOf } from './undo.ts';

const text = (): Stream => fromText('a b c d\ne f', { ids: sequentialIds() });

describe('revertOps', () => {
  it('brings a text back with one replacement that keeps ids', () => {
    const before = text();
    const now = applyOps(before, [
      { t: 'set', id: 't2', fields: { form: 'B' } },
      { t: 'delete', ids: ['t3'] },
      { t: 'insert', after: 't7', items: [{ kind: 'token', id: 'n', form: 'g' }] },
    ]).stream;
    const ops = revertOps(now, before);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.t).toBe('replace');
    const back = applyOps(now, ops).stream;
    expect(back).toEqual(before);
  });

  it('inserts or deletes when one side is empty, and does nothing when both are', () => {
    const full = text();
    expect(applyOps({ items: [] }, revertOps({ items: [] }, full)).stream).toEqual(full);
    expect(applyOps(full, revertOps(full, { items: [] })).stream.items).toEqual([]);
    expect(revertOps({ items: [] }, { items: [] })).toEqual([]);
  });
});

describe('salvageOps', () => {
  it('applies a reverse untouched when nothing later stands in its way', () => {
    const before = text();
    const applied = applyOps(before, [{ t: 'delete', ids: ['t2', 't3'] }]);
    const result = salvageOps(applied.stream, applied.reverse, [before]);
    expect(result.skipped).toBe(0);
    expect(toText(result.stream)).toBe(toText(before));
  });

  it('puts removed words back after the nearest word that still stands when their neighbour is gone', () => {
    const before = text();
    const target = applyOps(before, [{ t: 'delete', ids: ['t3'] }]);
    // Later someone removed b, the word c followed.
    const later = applyOps(target.stream, [{ t: 'delete', ids: ['t2'] }]).stream;
    const result = salvageOps(later, target.reverse, [before]);
    expect(result.skipped).toBe(0);
    expect(toText(result.stream)).toBe('a c d\ne f');
  });

  it('drops ids that are gone and items already back, and counts what cannot apply', () => {
    const before = text();
    const target = applyOps(before, [
      {
        t: 'insert',
        after: 't1',
        items: [
          { kind: 'token', id: 'x', form: 'X' },
          { kind: 'token', id: 'y', form: 'Y' },
        ],
      },
      { t: 'set', id: 't4', fields: { form: 'D' } },
    ]);
    // Later: y removed, d removed.
    const later = applyOps(target.stream, [{ t: 'delete', ids: ['y', 't4'] }]).stream;
    const result = salvageOps(later, target.reverse, [before]);
    // The reverse is [set t4 back, delete x y]: the set cannot apply, the delete takes only x.
    expect(result.skipped).toBe(1);
    expect(result.ops).toEqual([{ t: 'delete', ids: ['x'] }]);
    expect(toText(result.stream)).toBe('a b c\ne f');
  });

  it('skips a move whose run no longer stands together, and a put-back with nowhere to go', () => {
    const before = text();
    const ops: Op[] = [
      { t: 'move', ids: ['t2', 't3'], after: 't6' },
      { t: 'insert', after: 'nowhere', items: [{ kind: 'token', id: 'z', form: 'Z' }] },
    ];
    const split = applyOps(before, [
      { t: 'insert', after: 't2', items: [{ kind: 'token', id: 'm', form: 'M' }] },
    ]).stream;
    const result = salvageOps(split, ops, [before]);
    expect(result.skipped).toBe(2);
    expect(result.ops).toEqual([]);
  });
});

describe('wordsOf', () => {
  it('names ids by their text now, else as operations last carried them', () => {
    const now = text();
    const words = wordsOf(
      ['t1', 't5', 'gone', 'lost'],
      [now],
      [{ t: 'insert', after: null, items: [{ kind: 'token', id: 'gone', form: 'old' }] }],
    );
    expect(words).toEqual({ t1: 'a', t5: '¶', gone: 'old' });
  });
});
