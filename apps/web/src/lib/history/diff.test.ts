import { describe, expect, it } from 'vitest';
import { applyOps, diffStreams, fromText, sequentialIds, type Op, type Stream } from '@varians/core';
import { deepEqual, diffStates, sameItem } from './diff.ts';

const text = (): Stream => fromText('a b c d\ne f g h\ni j k l', { ids: sequentialIds() });

function summary(diff: ReturnType<typeof diffStreams>) {
  const changes = diff.changes
    .map((c) => {
      switch (c.kind) {
        case 'added':
          return `+${c.item.id}`;
        case 'removed':
          return `-${c.item.id}@${c.after}`;
        case 'changed':
          return `~${c.after.id}:${c.fields.join('/')}`;
        case 'moved':
          return `>${c.item.id}`;
      }
    })
    .sort();
  return { changes, added: diff.added, removed: diff.removed, changed: diff.changed, moved: diff.moved };
}

describe('deepEqual and sameItem', () => {
  it('ignore key order and undefined keys', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: [1] }, { a: { 0: 1 } })).toBe(false);
    expect(sameItem({ kind: 'token', id: 'x', form: 'a' }, { form: 'a', id: 'x', kind: 'token' })).toBe(true);
    expect(sameItem({ kind: 'token', id: 'x', form: 'a' }, { kind: 'token', id: 'y', form: 'a' })).toBe(false);
  });
});

describe('diffStates', () => {
  const cases: [string, Op[]][] = [
    ['a word re-spelt in the middle', [{ t: 'set', id: 't6', fields: { form: 'E' } }]],
    ['a word added at the start', [{ t: 'insert', after: null, items: [{ kind: 'token', id: 'n1', form: 'new' }] }]],
    ['words removed at the start', [{ t: 'delete', ids: ['t1', 't2'] }]],
    ['a word removed after a kept head', [{ t: 'delete', ids: ['t8'] }]],
    ['a line removed with its break', [{ t: 'delete', ids: ['t5', 't6', 't7', 't8', 't9'] }]],
    ['a word moved to the start of its line', [{ t: 'move', ids: ['t9'], after: 't5' }]],
    ['a line moved up', [{ t: 'move', ids: ['t11', 't12', 't13', 't14'], after: 't5' }]],
    [
      'several edits at once',
      [
        { t: 'set', id: 't2', fields: { form: 'B' } },
        { t: 'insert', after: 't12', items: [{ kind: 'token', id: 'n2', form: 'x' }] },
        { t: 'delete', ids: ['t7'] },
      ],
    ],
  ];

  for (const [name, ops] of cases) {
    it(`agrees with diffStreams: ${name}`, () => {
      const before = text();
      const after = applyOps(before, ops).stream;
      expect(summary(diffStates(before, after))).toEqual(summary(diffStreams(before, after)));
    });
  }

  it('anchors removals after the common head on its last item', () => {
    const before = text();
    const after = applyOps(before, [{ t: 'delete', ids: ['t6', 't7'] }]).stream;
    const removed = diffStates(before, after).changes.filter((c) => c.kind === 'removed');
    expect(removed.map((c) => (c.kind === 'removed' ? c.after : null))).toEqual(['t5', 't5']);
  });

  it('names the last item of the head as where a moved item now stands', () => {
    const before = text();
    const after = applyOps(before, [{ t: 'move', ids: ['t9'], after: 't5' }]).stream;
    const moved = diffStates(before, after).changes.find((c) => c.kind === 'moved');
    expect(moved && moved.kind === 'moved' ? [moved.item.id, moved.from, moved.to] : null).toEqual(['t9', 't8', 't5']);
  });

  it('finds nothing between equal states, even rebuilt with keys in another order', () => {
    const before = text();
    const copy: Stream = { items: before.items.map((i) => JSON.parse(JSON.stringify(i, Object.keys(i).sort()))) };
    const diff = diffStates(before, copy);
    expect(diff.changes).toEqual([]);
  });

  it('handles empty states on either side', () => {
    const full = text();
    expect(diffStates({ items: [] }, full).added).toBe(14);
    expect(diffStates(full, { items: [] }).removed).toBe(14);
  });
});
