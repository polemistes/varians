import { describe, expect, it } from 'vitest';
import { applyOps, fromText, indexOf, sequentialIds, type Op, type Stream, type Token } from '@varians/core';
import { diffStates } from './diff.ts';
import { cellText } from './placement.ts';
import { clipCells, positionIn, slimLine, touchedLines } from './review.ts';
import type { Cell, CompactLine } from './types.ts';

const text = (): Stream => {
  const s = fromText('a b c\nd e f\ng h i j k l m n o p', { ids: sequentialIds() });
  (s.items[0] as Token).segment = { segmentId: 'one' };
  (s.items[4] as Token).segment = { segmentId: 'two' };
  return s;
};

const show = (line: CompactLine) =>
  line.cells
    .map((c) => {
      if (c === null) return '…';
      const t = cellText(c.item);
      if (c.removed) return `-${t}-`;
      if (c.added) return `+${t}+`;
      if (c.changed) return `~${t}~`;
      if (c.moved) return `>${t}`;
      if (c.away) return `<${t}`;
      return t;
    })
    .join(' ');

function touched(ops: Op[], options = {}) {
  const before = text();
  const after = applyOps(before, ops).stream;
  return touchedLines(before, after, diffStates(before, after), options);
}

describe('touchedLines', () => {
  it('shows a re-spelt word on its line, before and after', () => {
    const lines = touched([{ t: 'set', id: 't6', fields: { form: 'E' } }]);
    expect(lines.before.map(show)).toEqual(['d ~e~ f']);
    expect(lines.after.map(show)).toEqual(['d ~E~ f']);
    expect(lines.before[0]!.segmentId).toBe('two');
    expect(lines.total).toBe(1);
  });

  it('shows a removal struck in the old line and the line it left', () => {
    const lines = touched([{ t: 'delete', ids: ['t2'] }]);
    expect(lines.before.map(show)).toEqual(['a -b- c']);
    expect(lines.after.map(show)).toEqual(['a c']);
  });

  it('shows an addition in the new line and the old line it went into', () => {
    const lines = touched([{ t: 'insert', after: 't4', items: [{ kind: 'token', id: 'n', form: 'x' }] }]);
    expect(lines.before.map(show)).toEqual(['d e f']);
    expect(lines.after.map(show)).toEqual(['+x+ d e f']);
  });

  it('shows a removed line break at the end of the line it closed, and an added one at the start of the line it opens', () => {
    const joined = touched([{ t: 'delete', ids: ['t4'] }]);
    expect(joined.before.map(show)).toEqual(['a b c -¶-']);
    expect(joined.after.map(show)).toEqual(['a b c d e f']);
    const divided = touched([{ t: 'insert', after: 't2', items: [{ kind: 'break', id: 'nb', type: 'line' }] }]);
    expect(divided.after.map(show)).toEqual(['+¶+ c']);
    expect(divided.before.map(show)).toEqual(['a b c']);
  });

  it('clips long lines around the change and caps the lines shown', () => {
    const lines = touched([{ t: 'set', id: 't14', fields: { form: 'L' } }], { context: 2 });
    expect(lines.after.map(show)).toEqual(['… j k ~L~ m n …']);
    const many = touched(
      [
        { t: 'set', id: 't1', fields: { form: 'A' } },
        { t: 'set', id: 't5', fields: { form: 'D' } },
        { t: 'set', id: 't9', fields: { form: 'G' } },
      ],
      { max: 2 },
    );
    expect(many.after).toHaveLength(2);
    expect(many.total).toBe(3);
  });

  it('shows a moved word moved away in the old line and moved here in the new', () => {
    const lines = touched([{ t: 'move', ids: ['t2'], after: 't6' }]);
    expect(lines.before.map(show)).toEqual(['a <b c']);
    expect(lines.after.map(show)).toEqual(['d e >b f']);
  });

  it('shows nothing for a side that is empty', () => {
    const before: Stream = { items: [] };
    const after = text();
    const lines = touchedLines(before, after, diffStates(before, after));
    expect(lines.before).toEqual([]);
    expect(lines.after.length).toBeGreaterThan(0);
  });
});

describe('clipCells', () => {
  const cell = (id: string, marked = false): Cell => ({
    item: { kind: 'token', id, form: id },
    index: 0,
    added: marked,
    removed: false,
    changed: false,
    moved: false,
    was: null,
    fields: [],
    author: null,
  });
  it('keeps changes with their context and folds the rest into one ellipsis each', () => {
    const cells = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id) => cell(id, id === 'b' || id === 'h'));
    expect(clipCells(cells, 1).map((c) => (c ? c.item.id : '…'))).toEqual(['a', 'b', 'c', '…', 'g', 'h', 'i']);
    // One word left out at the edge, or between two kept stretches, stays.
    const short = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => cell(id, id === 'c' || id === 'g'));
    expect(clipCells(short, 1).map((c) => (c ? c.item.id : '…'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
});

describe('positionIn', () => {
  it('orders changes by where they stand in the current text', () => {
    const before = text();
    const early = applyOps(before, [{ t: 'set', id: 't2', fields: { form: 'B' } }]).stream;
    const late = applyOps(early, [{ t: 'delete', ids: ['t10'] }]).stream;
    const current = indexOf(late);
    expect(positionIn(current, diffStates(before, early))).toBe(1);
    // A removal stands just after the word it followed.
    expect(positionIn(current, diffStates(early, late))).toBe(8.5);
  });

  it('places a change whose words are gone after the nearest word still standing', () => {
    const before = text();
    const added = applyOps(before, [{ t: 'insert', after: 't2', items: [{ kind: 'token', id: 'n', form: 'x' }] }]).stream;
    const gone = applyOps(added, [{ t: 'delete', ids: ['n'] }]).stream;
    const current = indexOf(gone);
    expect(positionIn(current, diffStates(before, added), added)).toBe(1.5);
    expect(positionIn(current, diffStates(before, added))).toBe(Number.MAX_SAFE_INTEGER);
    const first = applyOps(before, [{ t: 'insert', after: null, items: [{ kind: 'token', id: 'm', form: 'y' }] }]).stream;
    const firstGone = applyOps(first, [{ t: 'delete', ids: ['m'] }]).stream;
    expect(positionIn(indexOf(firstGone), diffStates(before, first), first)).toBe(-0.5);
  });
});

describe('slimLine', () => {
  it('leaves out the provenance of tokens and nothing else', () => {
    const token: Token = { kind: 'token', id: 'a', form: 'a', source: { kind: 'editor' }, segment: { segmentId: 's' } };
    const line: CompactLine = {
      key: 'a0',
      segmentId: 's',
      cells: [{ item: token, index: 0, added: true, removed: false, changed: false, moved: false, was: token, fields: [], author: null }, null],
    };
    const slim = slimLine(line);
    expect(slim.cells[0]!.item).toEqual({ kind: 'token', id: 'a', form: 'a', segment: { segmentId: 's' } });
    expect(slim.cells[0]!.was).toEqual({ kind: 'token', id: 'a', form: 'a', segment: { segmentId: 's' } });
    expect(slim.cells[1]).toBeNull();
    expect(token.source).toEqual({ kind: 'editor' });
  });
});
