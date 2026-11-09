import { describe, expect, it } from 'vitest';
import { compose, conflictingIds, sessions, thin, undoConflicts, type Changeset } from './changeset.ts';

function cs(version: number, userId: string, at: string, ids: string[]): Changeset {
  return {
    id: `c${version}`,
    documentId: 'd',
    version,
    parentId: version === 1 ? null : `c${version - 1}`,
    userId,
    at,
    ops: ids.map((id) => ({ t: 'set', id, fields: { form: 'x' } })),
    reverse: ids.map((id) => ({ t: 'set', id, fields: { form: 'y' } })),
  };
}

describe('conflicts', () => {
  it('finds shared ids and judges an undo safe when there are none', () => {
    const a = cs(1, 'u', '2026-10-02T10:00:00Z', ['t1', 't2']);
    const b = cs(2, 'v', '2026-10-02T10:05:00Z', ['t3']);
    const c = cs(3, 'v', '2026-10-02T10:06:00Z', ['t2']);
    expect(conflictingIds(a.ops, b.ops)).toEqual([]);
    expect(undoConflicts(a, [b])).toEqual([]);
    expect(undoConflicts(a, [b, c])).toEqual(['t2']);
  });
});

describe('compose and sessions', () => {
  it('composes in order and reverses backwards', () => {
    const a = cs(1, 'u', '2026-10-02T10:00:00Z', ['t1']);
    const b = cs(2, 'u', '2026-10-02T10:01:00Z', ['t2']);
    const composed = compose([a, b]);
    expect(composed.ops.map((o) => (o as { id: string }).id)).toEqual(['t1', 't2']);
    expect(composed.reverse.map((o) => (o as { id: string }).id)).toEqual(['t2', 't1']);
  });

  it('groups one person’s work before a pause', () => {
    const list = [
      cs(1, 'u', '2026-10-02T10:00:00Z', ['t1']),
      cs(2, 'u', '2026-10-02T10:10:00Z', ['t2']),
      cs(3, 'v', '2026-10-02T10:12:00Z', ['t3']),
      cs(4, 'u', '2026-10-02T12:00:00Z', ['t4']),
    ];
    const s = sessions(list);
    expect(s.map((x) => [x.userId, x.fromVersion, x.toVersion])).toEqual([
      ['u', 1, 2],
      ['v', 3, 3],
      ['u', 4, 4],
    ]);
  });
});

describe('thin', () => {
  it('merges old changesets by hour and keeps named versions apart', () => {
    const now = Date.parse('2026-12-01T00:00:00Z');
    const list = [
      cs(1, 'u', '2026-10-02T10:00:00Z', ['t1']),
      cs(2, 'u', '2026-10-02T10:20:00Z', ['t2']),
      cs(3, 'u', '2026-10-02T10:40:00Z', ['t3']),
      cs(4, 'u', '2026-10-02T11:10:00Z', ['t4']),
      cs(5, 'u', '2026-11-30T23:00:00Z', ['t5']),
    ];
    const thinned = thin(list, {
      hourlyAfterMs: 7 * 24 * 3600 * 1000,
      dailyAfterMs: 90 * 24 * 3600 * 1000,
      keep: new Set([2]),
      now,
    });
    expect(thinned.map((c) => c.version)).toEqual([2, 3, 4, 5]);
    expect(thinned[0]!.ops).toHaveLength(2);
    expect(thinned[0]!.reverse.map((o) => (o as { id: string }).id)).toEqual(['t2', 't1']);
    // The parent links still form a chain: the merged changeset takes its first member's parent.
    expect(thinned.map((c) => [c.id, c.parentId])).toEqual([
      ['c2', null],
      ['c3', 'c2'],
      ['c4', 'c3'],
      ['c5', 'c4'],
    ]);
  });
});
