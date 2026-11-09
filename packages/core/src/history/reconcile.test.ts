import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Stream, Token } from '../stream/items.ts';
import { applyOps, type Op } from '../stream/ops.ts';
import { fromText, toText } from '../stream/text.ts';
import type { Changeset } from './changeset.ts';
import { ReconcileError, reconcile, type Reconciliation } from './reconcile.ts';

/**
 * The initial content: t1 the, t2 quick, t3 brown, t4 fox, t5 (line break),
 * t6 jumps, t7 over, t8 the, t9 lazy, t10 dog. Segment s1 begins at t1, s2 at t6.
 */
function initial(): Stream {
  const stream = fromText('the quick brown fox\njumps over the lazy dog', { ids: sequentialIds() });
  (stream.items[0] as Token).segment = { segmentId: 's1' };
  (stream.items[5] as Token).segment = { segmentId: 's2' };
  return stream;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One installation's copy of a document, saving and reconciling as the server would. */
class Installation {
  content: Stream;
  /** Every changeset held, applied or kept for provenance. */
  log: Changeset[] = [];
  /** The applied changesets, in order: what this installation exports. */
  applied: Changeset[] = [];
  constructor(
    public readonly user: string,
    content: Stream = initial(),
    public readonly documentId = 'd',
  ) {
    this.content = content;
  }

  get head(): string | null {
    return this.applied.length ? this.applied[this.applied.length - 1]!.id : null;
  }

  save(id: string, ops: Op[]): Changeset {
    const { stream, reverse } = applyOps(this.content, ops);
    const changeset: Changeset = {
      id,
      documentId: this.documentId,
      version: this.applied.length + 1,
      parentId: this.head,
      userId: this.user,
      at: `2026-11-09T10:${String(this.log.length).padStart(2, '0')}:00Z`,
      ops,
      reverse,
    };
    this.content = stream;
    this.log.push(changeset);
    this.applied.push(changeset);
    return changeset;
  }

  copy(user: string): Installation {
    const other = new Installation(user, clone(this.content), this.documentId);
    other.log = clone(this.log);
    other.applied = other.log.filter((c) => this.applied.some((a) => a.id === c.id));
    return other;
  }

  pullFrom(remote: Installation): Reconciliation {
    return reconcile(this.log, remote.applied, this.content, { head: this.head });
  }

  /** Store a result as the caller is meant to. */
  adopt(result: Reconciliation, mergeId = `m-${this.user}-${this.log.length}`): void {
    const known = new Set(this.log.map((c) => c.id));
    if (result.kind === 'nothing') {
      this.log.push(...result.keep);
    } else if (result.kind === 'fast-forward') {
      for (const c of result.apply) {
        const local = { ...c, version: this.applied.length + 1 };
        if (!known.has(c.id)) this.log.push(local);
        this.applied.push(local);
      }
      this.content = result.content;
    } else if (result.kind === 'merge') {
      this.log.push(...result.theirs.filter((c) => !known.has(c.id)).map((c) => ({ ...c, version: 0 })));
      const merge: Changeset = {
        id: mergeId,
        documentId: this.documentId,
        version: this.applied.length + 1,
        parentId: this.head,
        merged: result.theirs.map((c) => c.id),
        userId: this.user,
        at: '2026-11-09T12:00:00Z',
        ops: result.ops,
        reverse: result.reverse,
      };
      this.log.push(merge);
      this.applied.push(merge);
      this.content = result.content;
    } else throw new Error(`cannot adopt a ${result.kind}`);
  }
}

const set = (id: string, form: string): Op => ({ t: 'set', id, fields: { form } });
const word = (id: string, form: string): Token => ({ kind: 'token', id, form });

function expectKind<K extends Reconciliation['kind']>(result: Reconciliation, kind: K): Extract<Reconciliation, { kind: K }> {
  expect(result.kind).toBe(kind);
  return result as Extract<Reconciliation, { kind: K }>;
}

describe('reconcile: nothing to do', () => {
  it('when the histories are identical', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    a.save('c2', [set('t9', 'idle')]);
    const b = a.copy('v');
    expect(b.pullFrom(a)).toEqual({ kind: 'nothing', keep: [] });
  });

  it('when ours is ahead', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const b = a.copy('v');
    b.save('c2', [set('t9', 'idle')]);
    expect(b.pullFrom(a)).toEqual({ kind: 'nothing', keep: [] });
  });

  it('when either history is empty, or both', () => {
    const a = new Installation('u');
    expect(reconcile([], [], a.content)).toEqual({ kind: 'nothing', keep: [] });
    a.save('c1', [set('t2', 'swift')]);
    expect(reconcile(a.log, [], a.content)).toEqual({ kind: 'nothing', keep: [] });
  });
});

describe('reconcile: fast-forward', () => {
  it('applies the incoming changesets after our head, keeping their ids, authors, times and parents', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const b = a.copy('v');
    a.save('c2', [{ t: 'insert', after: 't9', items: [word('n1', 'sleeping')] }]);
    a.save('c3', [{ t: 'delete', ids: ['t8'] }]);
    const result = expectKind(b.pullFrom(a), 'fast-forward');
    expect(result.apply).toEqual([a.log[1], a.log[2]]);
    expect(result.apply.map((c) => [c.id, c.parentId, c.userId, c.at])).toEqual([
      ['c2', 'c1', 'u', a.log[1]!.at],
      ['c3', 'c2', 'u', a.log[2]!.at],
    ]);
    expect(result.content).toEqual(a.content);
    expect(toText(result.content)).toBe('the swift brown fox\njumps over lazy sleeping dog');
  });

  it('from an empty history, on the initial content', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    a.save('c2', [set('t3', 'red')]);
    const result = expectKind(reconcile([], a.applied, initial()), 'fast-forward');
    expect(result.apply.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result.content).toEqual(a.content);
  });

  it('accepts the incoming changesets in any order', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const b = a.copy('v');
    a.save('c2', [set('t3', 'red')]);
    a.save('c3', [set('t4', 'hare')]);
    const result = expectKind(reconcile(b.log, [...a.applied].reverse(), b.content), 'fast-forward');
    expect(result.apply.map((c) => c.id)).toEqual(['c2', 'c3']);
  });
});

describe('reconcile: merge', () => {
  it('applies disjoint incoming changes on ours, and the result is the same in either order', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const b = a.copy('v');
    const theirs = [
      a.save('r1', [{ t: 'insert', after: 't10', items: [word('n1', 'asleep')] }]),
      a.save('r2', [{ t: 'split', id: 't7', at: 2, newId: 'n2', join: true }]),
    ];
    const ours = [b.save('o1', [set('t3', 'red')]), b.save('o2', [{ t: 'delete', ids: ['t1'] }])];
    const result = expectKind(b.pullFrom(a), 'merge');
    expect(result.base).toBe('c1');
    expect(result.ours).toEqual(ours);
    expect(result.theirs).toEqual(theirs);
    expect(result.ops).toEqual([...theirs[0]!.ops, ...theirs[1]!.ops]);
    // Ours then theirs, and theirs then ours.
    expect(result.content).toEqual(applyOps(b.content, result.ops).stream);
    expect(result.content).toEqual(applyOps(a.content, [...ours[0]!.ops, ...ours[1]!.ops]).stream);
    expect(toText(result.content)).toBe('swift red fox\njumps over the lazy dog asleep');
    // The reverse undoes the merge.
    expect(applyOps(result.content, result.reverse).stream).toEqual(b.content);
  });

  it('from the initial content, when the two first changesets differ', () => {
    const a = new Installation('u');
    const b = a.copy('v');
    a.save('r1', [set('t9', 'idle')]);
    b.save('o1', [set('t2', 'swift')]);
    const result = expectKind(b.pullFrom(a), 'merge');
    expect(result.base).toBeNull();
    expect(toText(result.content)).toBe('the swift brown fox\njumps over the idle dog');
  });

  it('does not count a change to an item merged before as an overlap', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const b = a.copy('v');
    a.save('r1', [set('t9', 'idle')]);
    b.save('o1', [set('t3', 'red')]);
    b.adopt(expectKind(b.pullFrom(a), 'merge'));
    a.save('r2', [set('t9', 'sleepy')]);
    const result = expectKind(b.pullFrom(a), 'merge');
    expect(result.base).toBe('r1');
    expect(result.theirs.map((c) => c.id)).toEqual(['r2']);
    expect(toText(result.content)).toBe('the swift red fox\njumps over the sleepy dog');
  });

  it('settles after two installations have merged each other’s work', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const b = a.copy('v');
    a.save('r1', [set('t9', 'idle')]);
    b.save('o1', [set('t3', 'red')]);

    b.adopt(expectKind(b.pullFrom(a), 'merge'), 'mb');
    const back = expectKind(a.pullFrom(b), 'merge');
    // Of b's history only o1 is new to a: the merge changeset mb carries r1, which a has.
    expect(back.theirs.map((c) => c.id)).toEqual(['o1', 'mb']);
    expect(back.ops).toEqual(b.log.find((c) => c.id === 'o1')!.ops);
    a.adopt(back, 'ma');
    expect(a.content).toEqual(b.content);

    // a's merge changeset brings b nothing new: b keeps it for provenance.
    const settled = expectKind(b.pullFrom(a), 'nothing');
    expect(settled.keep.map((c) => c.id)).toEqual(['ma']);
    b.adopt(settled);
    expect(b.pullFrom(a)).toEqual({ kind: 'nothing', keep: [] });
    expect(a.pullFrom(b)).toEqual({ kind: 'nothing', keep: [] });

    // And work goes on from there in both directions.
    a.save('r3', [set('t10', 'hound')]);
    const onward = expectKind(b.pullFrom(a), 'merge');
    expect(onward.ops).toEqual([set('t10', 'hound')]);
  });

  it('carries the fields it does not know through untouched', () => {
    type Row = Changeset & { personId: string; extra: number };
    const a = new Installation('u');
    const b = a.copy('v');
    a.save('r1', [set('t9', 'idle')]);
    b.save('o1', [set('t2', 'swift')]);
    const incoming: Row[] = a.applied.map((c) => ({ ...c, personId: 'p1', extra: 7 }));
    const local: Row[] = b.log.map((c) => ({ ...c, personId: 'p2', extra: 8 }));
    const result = reconcile(local, incoming, b.content);
    expect(result.kind).toBe('merge');
    if (result.kind === 'merge') expect(result.theirs[0]!.personId).toBe('p1');
  });
});

describe('reconcile: conflict', () => {
  it('refuses overlapping edits and names the items and segments', () => {
    const a = new Installation('u');
    a.save('c1', [set('t3', 'red')]);
    const b = a.copy('v');
    a.save('r1', [set('t2', 'swift')]);
    a.save('r2', [set('t9', 'idle')]);
    b.save('o1', [set('t2', 'fast')]);
    const result = expectKind(b.pullFrom(a), 'conflict');
    expect(result.reason).toBe('overlap');
    expect(result.ids).toEqual(['t2']);
    expect(result.segments).toEqual(['s1']);
    expect(result.theirs.map((c) => c.id)).toEqual(['r1', 'r2']);
  });

  it('refuses an incoming insertion after an item deleted here', () => {
    const a = new Installation('u');
    const b = a.copy('v');
    a.save('r1', [{ t: 'insert', after: 't9', items: [word('n1', 'brown')] }]);
    b.save('o1', [{ t: 'delete', ids: ['t9'] }]);
    const result = expectKind(b.pullFrom(a), 'conflict');
    expect(result.reason).toBe('missing-anchor');
    expect(result.ids).toEqual(['t9']);
    expect(result.segments).toEqual(['s2']);
  });

  it('refuses a split here and a join there of the same word', () => {
    const a = new Installation('u');
    const b = a.copy('v');
    a.save('r1', [{ t: 'join', id: 't3' }]);
    b.save('o1', [{ t: 'split', id: 't3', at: 2, newId: 'n1' }]);
    const result = expectKind(b.pullFrom(a), 'conflict');
    expect(result.reason).toBe('overlap');
    expect(result.ids).toContain('t3');
    expect(result.segments).toEqual(['s1']);
  });

  it('refuses a join here and a split there of the word the join consumed', () => {
    const a = new Installation('u');
    const b = a.copy('v');
    a.save('r1', [{ t: 'split', id: 't4', at: 1, newId: 'n1' }]);
    b.save('o1', [{ t: 'join', id: 't3' }]);
    const result = expectKind(b.pullFrom(a), 'conflict');
    // The join's own operation names only t3; its reverse shows it consumed t4.
    expect(result.reason).toBe('missing-anchor');
    expect(result.ids).toEqual(['t4']);
    expect(result.segments).toEqual(['s1']);
  });

  it('refuses an unrelated document', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const other = new Installation('v', initial(), 'e');
    other.save('x1', [set('t2', 'slow')]);
    const result = expectKind(a.pullFrom(other), 'conflict');
    expect(result.reason).toBe('unrelated');
    expect(result.ids).toEqual([]);
    expect(result.theirs.map((c) => c.id)).toEqual(['x1']);
  });

  it('refuses a history that begins after anything we know', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    const incoming = [{ ...a.log[0]!, id: 'x2', parentId: 'x1' }];
    const b = new Installation('v');
    b.save('o1', [set('t9', 'idle')]);
    expect(expectKind(b.pullFrom({ applied: incoming } as Installation), 'conflict').reason).toBe('unrelated');
  });

  it('refuses a history rewritten on one side', () => {
    const a = new Installation('u');
    a.save('c1', [set('t2', 'swift')]);
    a.save('c2', [set('t3', 'red')]);
    const b = a.copy('v');
    const rewritten = a.applied.map((c) => (c.id === 'c2' ? { ...c, parentId: null } : c)).filter((c) => c.id !== 'c1');
    expect(expectKind(reconcile(b.log, rewritten, b.content), 'conflict').reason).toBe('rewritten');
  });

  it('refuses an incoming merge that folds in some of our changes and some unknown', () => {
    const a = new Installation('u');
    const b = a.copy('v');
    b.save('o1', [set('t2', 'swift')]);
    a.save('r1', [set('t9', 'idle')]);
    const merge = a.save('m1', [set('t2', 'swift'), set('t10', 'hound')]);
    merge.merged = ['o1', 'elsewhere'];
    const result = expectKind(b.pullFrom(a), 'conflict');
    expect(result.reason).toBe('partial-merge');
  });
});

describe('reconcile: errors', () => {
  const entry = (id: string, parentId: string | null | undefined): Changeset => ({
    id,
    documentId: 'd',
    version: 1,
    ...(parentId === undefined ? {} : { parentId }),
    userId: 'u',
    at: '2026-11-09T10:00:00Z',
    ops: [],
    reverse: [],
  });

  it('refuses incoming history that is not a chain', () => {
    const content = initial();
    expect(() => reconcile([], [entry('a', null), entry('b', 'a'), entry('c', 'a')], content)).toThrow(ReconcileError);
    expect(() => reconcile([], [entry('a', null), entry('b', null)], content)).toThrow(/2 beginnings/);
    expect(() => reconcile([], [entry('a', null), entry('b', 'c'), entry('c', 'b')], content)).toThrow(/cycle/);
    expect(() => reconcile([], [entry('a', null), entry('a', null)], content)).toThrow(/twice/);
  });

  it('requires every changeset to name its parent', () => {
    expect(() => reconcile([], [entry('a', undefined)], initial())).toThrow(/names no parent/);
    expect(() => reconcile([entry('a', undefined)], [], initial())).toThrow(/names no parent/);
  });

  it('finds our head, and asks for it when the local history has several', () => {
    const content = initial();
    const local = [entry('a', null), entry('b', 'a')];
    expect(reconcile(local, [entry('a', null)], content).kind).toBe('nothing');
    const forked = [entry('a', null), entry('b', 'a'), entry('c', 'a')];
    expect(() => reconcile(forked, [entry('a', null), entry('d', 'a')], content)).toThrow(/2 heads/);
    expect(reconcile(forked, [entry('a', null), entry('b', 'a'), entry('d', 'b')], content, { head: 'b' }).kind).toBe(
      'fast-forward',
    );
    expect(() => reconcile(local, [entry('a', null), entry('d', 'a')], content, { head: 'zz' })).toThrow(/not in the local/);
  });
});
