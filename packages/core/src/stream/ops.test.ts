import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Item, Stream, Token } from './items.ts';
import { applyOp, applyOps, touchedIds, type Op } from './ops.ts';
import { fromText, toText } from './text.ts';

function sample(): Stream {
  return fromText('the quick fox\njumps over', { ids: sequentialIds() });
}

function token(stream: Stream, id: string): Token {
  const item = stream.items.find((i) => i.id === id);
  if (!item || item.kind !== 'token') throw new Error(`no token ${id}`);
  return item;
}

describe('applyOp', () => {
  it('inserts after an item and reverses by deleting', () => {
    const s = sample();
    const items: Item[] = [{ kind: 'token', id: 'n1', form: 'brown' }];
    const { stream, reverse } = applyOp(s, { t: 'insert', after: 't2', items });
    expect(toText(stream)).toBe('the quick brown fox\njumps over');
    expect(toText(applyOps(stream, reverse).stream)).toBe(toText(s));
  });

  it('inserts at the start when after is null', () => {
    const { stream } = applyOp(sample(), {
      t: 'insert',
      after: null,
      items: [{ kind: 'token', id: 'n1', form: 'lo' }],
    });
    expect(toText(stream)).toBe('lo the quick fox\njumps over');
  });

  it('refuses a duplicate id', () => {
    expect(() =>
      applyOp(sample(), { t: 'insert', after: null, items: [{ kind: 'token', id: 't1', form: 'x' }] }),
    ).toThrow(/already present/);
  });

  it('deletes scattered items and reverses them into place', () => {
    const s = sample();
    const { stream, reverse } = applyOp(s, { t: 'delete', ids: ['t1', 't3', 't5'] });
    expect(toText(stream)).toBe('quick\nover');
    const back = applyOps(stream, reverse).stream;
    expect(back.items.map((i) => i.id)).toEqual(s.items.map((i) => i.id));
  });

  it('sets fields and reverses them, removing fields that were absent', () => {
    const s = sample();
    const { stream, reverse } = applyOp(s, { t: 'set', id: 't2', fields: { norm: 'quyck', unchecked: true } });
    expect(token(stream, 't2').norm).toBe('quyck');
    const back = applyOps(stream, reverse).stream;
    expect(token(back, 't2')).toEqual(token(s, 't2'));
    expect('norm' in token(back, 't2')).toBe(false);
  });

  it('moves a run and reverses the move', () => {
    const s = sample();
    const { stream, reverse } = applyOp(s, { t: 'move', ids: ['t5', 't6'], after: 't1' });
    expect(toText(stream)).toBe('the jumps over quick fox\n');
    expect(toText(applyOps(stream, reverse).stream)).toBe(toText(s));
    expect(stream.items.map((i) => i.id)).toEqual(['t1', 't5', 't6', 't2', 't3', 't4']);
  });

  it('refuses to move a non-contiguous run', () => {
    expect(() => applyOp(sample(), { t: 'move', ids: ['t1', 't3'], after: null })).toThrow(/contiguous/);
  });

  it('splits a token, keeping the id on the first half, and joins back exactly', () => {
    const s = sample();
    const before = token(s, 't2');
    const marked: Stream = applyOp(s, {
      t: 'set',
      id: 't2',
      fields: { marks: [{ kind: 'unclear', from: 3, to: 5 }, { kind: 'hi' }], norm: 'quick', joinNext: true },
    }).stream;
    const { stream, reverse } = applyOp(marked, { t: 'split', id: 't2', at: 2, newId: 'n1' });
    const first = token(stream, 't2');
    const second = token(stream, 'n1');
    expect(first.form).toBe('qu');
    expect(second.form).toBe('ick');
    expect(first.joinNext).toBeUndefined();
    expect(second.joinNext).toBe(true);
    expect(first.marks).toEqual([{ kind: 'hi' }]);
    expect(second.marks).toEqual([{ kind: 'unclear', from: 1, to: 3 }, { kind: 'hi' }]);
    expect(first.norm).toBeUndefined();
    expect(first.unchecked).toBe(true);
    const back = applyOps(stream, reverse).stream;
    expect(token(back, 't2')).toEqual(token(marked, 't2'));
    expect(back.items.length).toBe(s.items.length);
    expect(before.form).toBe('quick');
  });

  it('splits a word at a line end as two joined tokens', () => {
    const { stream } = applyOp(sample(), { t: 'split', id: 't2', at: 2, newId: 'n1', join: true });
    expect(token(stream, 't2').joinNext).toBe(true);
    expect(token(stream, 'n1').joinNext).toBeUndefined();
  });

  it('joins two tokens, shifting the marks of the second', () => {
    const s = applyOp(sample(), {
      t: 'set',
      id: 't3',
      fields: { marks: [{ kind: 'unclear', from: 0, to: 1 }] },
    }).stream;
    const { stream, reverse } = applyOp(s, { t: 'join', id: 't2' });
    const joined = token(stream, 't2');
    expect(joined.form).toBe('quickfox');
    expect(joined.marks).toEqual([{ kind: 'unclear', from: 5, to: 6 }]);
    expect(toText(stream)).toBe('the quickfox\njumps over');
    const back = applyOps(stream, reverse).stream;
    expect(back.items.map((i) => i.id)).toEqual(s.items.map((i) => i.id));
    expect(token(back, 't3')).toEqual(token(s, 't3'));
  });

  it('refuses to join across a break', () => {
    expect(() => applyOp(sample(), { t: 'join', id: 't3' })).toThrow(/adjacent tokens/);
  });

  it('reverses a whole changeset in order', () => {
    const s = sample();
    const ops: Op[] = [
      { t: 'set', id: 't1', fields: { form: 'The' } },
      { t: 'delete', ids: ['t2'] },
      { t: 'insert', after: 't1', items: [{ kind: 'token', id: 'n1', form: 'slow' }] },
      { t: 'move', ids: ['t5'], after: null },
      { t: 'split', id: 't6', at: 2, newId: 'n2' },
    ];
    const { stream, reverse } = applyOps(s, ops);
    expect(toText(stream)).toBe('jumps The slow fox\nov er');
    expect(applyOps(stream, reverse).stream).toEqual(s);
  });

  it('names the ids an operation touches', () => {
    expect(touchedIds({ t: 'insert', after: 'a', items: [{ kind: 'token', id: 'b', form: 'x' }] })).toEqual(['a', 'b']);
    expect(touchedIds({ t: 'move', ids: ['a', 'b'], after: 'c' })).toEqual(['a', 'b', 'c']);
    expect(touchedIds({ t: 'join', id: 'a' })).toEqual(['a']);
  });
});

describe('set over JSON', () => {
  it('removes a field set to null and records an absent field as null in the reverse', () => {
    const s = fromText('a b', { ids: sequentialIds() });
    const { stream, reverse } = applyOp(s, { t: 'set', id: 't1', fields: { norm: 'α' } });
    expect(reverse).toEqual([{ t: 'set', id: 't1', fields: { norm: null } }]);
    const wire = JSON.parse(JSON.stringify(reverse)) as Op[];
    const back = applyOps(stream, wire).stream;
    expect('norm' in (back.items[0] as Token)).toBe(false);
    const removed = applyOp(stream, { t: 'set', id: 't1', fields: { norm: null } }).stream;
    expect('norm' in (removed.items[0] as Token)).toBe(false);
  });
});
