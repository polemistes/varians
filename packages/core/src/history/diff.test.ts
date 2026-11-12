import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { applyOps } from '../stream/ops.ts';
import { fromText } from '../stream/text.ts';
import { diffStreams, summarizeDiff } from './diff.ts';

describe('diffStreams', () => {
  it('reports a retyped word as one change, an insertion as added, a deletion as removed', () => {
    const a = fromText('the quick fox\njumps', { lang: 'en', ids: sequentialIds() });
    const b = applyOps(a, [
      { t: 'set', id: 't2', fields: { form: 'slow' } },
      { t: 'insert', after: 't3', items: [{ kind: 'token', id: 'n1', form: 'now' }] },
      { t: 'delete', ids: ['t5'] },
    ]).stream;
    const diff = diffStreams(a, b);
    expect(diff.changed).toBe(1);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.moved).toBe(0);
    const removed = diff.changes.find((c) => c.kind === 'removed');
    expect(removed && removed.kind === 'removed' ? removed.after : null).toBe('t4');
    expect(summarizeDiff(diff)).toBe('1 item added, 1 removed, 1 changed');
    expect([...diff.touched].sort()).toEqual(['n1', 't2']);
  });

  it('reports a moved line as moves, not as removals and additions', () => {
    const a = fromText('a b\nc d', { lang: 'en', ids: sequentialIds() });
    const b = applyOps(a, [{ t: 'move', ids: ['t4', 't5'], after: null }]).stream;
    const diff = diffStreams(a, b);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.moved).toBeGreaterThan(0);
  });

  it('finds no change between identical states', () => {
    const a = fromText('a b', { lang: 'en', ids: sequentialIds() });
    expect(summarizeDiff(diffStreams(a, { items: [...a.items] }))).toBe('no change');
  });
});
