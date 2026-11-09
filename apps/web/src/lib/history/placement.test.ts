import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds, type Op, type Stream, type Token } from '@varians/core';
import { diffStates } from './diff.ts';
import { cellText, renderLines, spaceAfter, type RenderLine } from './placement.ts';
import { serializeDiff } from './types.ts';

const text = (): Stream => fromText('a b c\nd e f\ng h', { ids: sequentialIds() });

function render(ops: Op[], authors: Record<string, string> = {}): RenderLine[] {
  const before = text();
  const after = applyOps(before, ops).stream;
  return renderLines(after, serializeDiff(diffStates(before, after)), (id) => id.toUpperCase(), {}, authors);
}

/** A line as text: removed words in -minus-, added in +plus+, changed in ~tilde~, moved in >. */
const show = (line: RenderLine) =>
  line.cells
    .map((c) => {
      const t = cellText(c.item);
      if (c.removed) return `-${t}-`;
      if (c.added) return `+${t}+`;
      if (c.changed) return `~${t}~`;
      if (c.moved) return `>${t}`;
      return t;
    })
    .join(' ');

describe('renderLines', () => {
  it('lays out a stream without a diff as plain lines', () => {
    const lines = renderLines(text(), null, () => '');
    expect(lines.map(show)).toEqual(['a b c', 'd e f', 'g h']);
    expect(lines.every((l) => l.cells.every((c) => !c.added && !c.removed))).toBe(true);
  });

  it('puts removed words back where they stood: mid-line, at a line start, at the very start', () => {
    expect(render([{ t: 'delete', ids: ['t2'] }]).map(show)).toEqual(['a -b- c', 'd e f', 'g h']);
    expect(render([{ t: 'delete', ids: ['t5'] }]).map(show)).toEqual(['a b c', '-d- e f', 'g h']);
    expect(render([{ t: 'delete', ids: ['t1', 't2'] }]).map(show)).toEqual(['-a- -b- c', 'd e f', 'g h']);
  });

  it('shows a line removed with its break as struck words and a struck pilcrow', () => {
    const lines = render([{ t: 'delete', ids: ['t4', 't5', 't6', 't7'] }]);
    expect(lines.map(show)).toEqual(['a b c -¶- -d- -e- -f-', 'g h']);
  });

  it('puts the words of a line left empty on a ghost line in its place', () => {
    const lines = render([{ t: 'delete', ids: ['t5', 't6', 't7'] }]);
    expect(lines.map(show)).toEqual(['a b c', '-d- -e- -f-', 'g h']);
    expect(lines[1]!.ghost).toBe(true);
  });

  it('marks added, re-spelt and moved words, with the old spelling and the author', () => {
    const lines = render(
      [
        { t: 'set', id: 't2', fields: { form: 'B' } },
        { t: 'insert', after: 't7', items: [{ kind: 'token', id: 'n', form: 'x' }] },
        { t: 'move', ids: ['t10'], after: 't8' },
      ],
      { t2: 'ann', n: 'bob', t9: 'ann' },
    );
    // Of two words that swapped places, the diff calls one of them moved.
    expect(lines.map(show)).toEqual(['a ~B~ c', 'd e f +x+', 'h >g']);
    expect(lines[2]!.cells[1]!.author).toBe('ann');
    const respelt = lines[0]!.cells[1]!;
    expect(respelt.was?.form).toBe('b');
    expect(respelt.fields).toEqual(['form']);
    expect(respelt.author).toBe('ann');
    expect(lines[1]!.cells[3]!.author).toBe('bob');
    expect(lines[0]!.cells[0]!.author).toBeNull();
  });

  it('marks a line whose break was added', () => {
    const lines = render([{ t: 'insert', after: 't2', items: [{ kind: 'break', id: 'nb', type: 'line' }] }], { nb: 'ann' });
    expect(lines.map(show)).toEqual(['a b', 'c', 'd e f', 'g h']);
    expect(lines[1]!.opener).toEqual({ added: true, moved: false, author: 'ann' });
    expect(lines[0]!.opener).toBeNull();
  });

  it('prints labels from the layout and joins divided words', () => {
    const s = text();
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[1] as Token).joinNext = true;
    const lines = renderLines(s, null, (id) => `L${id}`);
    expect(lines[0]!.label).toBe('Ls1');
    expect(spaceAfter(lines[0]!.cells[1]!)).toBe(false);
    expect(spaceAfter(lines[0]!.cells[0]!)).toBe(true);
  });
});

describe('cellText', () => {
  it('shows the read form when asked, gaps in brackets and breaks as pilcrows', () => {
    expect(cellText({ kind: 'token', id: 'a', form: 'ΚΑΙ', norm: 'καὶ' }, 'read')).toBe('καὶ');
    expect(cellText({ kind: 'object', id: 'g', type: 'gap', attrs: { quantity: 3 } })).toBe('[...]');
    expect(cellText({ kind: 'break', id: 'b', type: 'line' })).toBe('¶');
  });
});
