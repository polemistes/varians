import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Break, type Id, type Item, type Token } from '@varians/core';
import { render } from './bridge.ts';
import { breakTarget, lineAt, lineIndex } from './lines.ts';

describe('lineIndex', () => {
  it('describes each line: opener, first item, segment starts, number in the page', () => {
    const stream = fromText('a b\nc d\n\ne f', { ids: sequentialIds() });
    // t3 break after b, t6 break after d (make it a page break), t7 break (empty line)
    (stream.items[5] as Break).type = 'page';
    (stream.items[5] as Break).pageId = 'p2';
    (stream.items[0] as Token).segment = { segmentId: 's1' };
    (stream.items[4] as Token).segment = { segmentId: 's2' };
    const ledger = render(stream, 'written');
    const byId = new Map<Id, Item>(stream.items.map((i) => [i.id, i]));
    const lines = lineIndex(ledger, byId);
    expect(lines.map((l) => [l.from, l.to])).toEqual([
      [0, 3],
      [4, 7],
      [8, 8],
      [9, 12],
    ]);
    expect(lines[0]!.opener).toBeNull();
    expect(lines[0]!.first?.id).toBe('t1');
    expect(lines[0]!.starts.map((s) => s.span.id)).toEqual(['t1']);
    expect(lines[1]!.opener?.id).toBe('t3');
    expect(lines[1]!.starts.map((s) => s.span.id)).toEqual(['t5']);
    expect(lines[1]!.numberInPage).toBe(2);
    expect(lines[2]!.opener?.id).toBe('t6');
    expect(lines[2]!.first).toBeNull();
    expect(lines[2]!.numberInPage).toBe(1);
    expect(lines[3]!.numberInPage).toBe(2);
    expect(lineAt(lines, 5)).toBe(lines[1]);
    expect(lineAt(lines, 8)).toBe(lines[2]);
    expect(lineAt(lines, 12)).toBe(lines[3]);
  });

  it('handles an empty document', () => {
    const lines = lineIndex({ text: '', spans: [] }, new Map());
    expect(lines).toEqual([
      { from: 0, to: 0, opener: null, first: null, starts: [], numberInPage: 1 },
    ]);
  });
});

describe('breakTarget', () => {
  const brk = (type: Break['type'], extra: Partial<Break> = {}): Break => ({
    kind: 'break',
    id: 'b',
    type,
    ...extra,
  });

  it('turns the line break before the line into the new break', () => {
    for (const type of ['column', 'paragraph'] as const) {
      expect(breakTarget(brk('line'), type)).toEqual({ t: 'set', id: 'b' });
    }
  });

  it('inserts a break before the first line of the text', () => {
    expect(breakTarget(null, 'column')).toEqual({ t: 'insert' });
    expect(breakTarget(null, 'paragraph')).toEqual({ t: 'insert' });
  });

  it('keeps the page break of a line that begins a page', () => {
    expect(breakTarget(brk('page', { pageId: 'p1' }), 'column')).toEqual({
      t: 'none',
      reason: 'page',
    });
    expect(breakTarget(brk('page'), 'paragraph')).toEqual({ t: 'none', reason: 'page' });
  });

  it('changes a column or paragraph break into another kind, and leaves the same kind alone', () => {
    expect(breakTarget(brk('paragraph'), 'column')).toEqual({ t: 'set', id: 'b' });
    expect(breakTarget(brk('column'), 'paragraph')).toEqual({ t: 'set', id: 'b' });
    expect(breakTarget(brk('column'), 'column')).toEqual({ t: 'none', reason: 'same' });
  });
});
