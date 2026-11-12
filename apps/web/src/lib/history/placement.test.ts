import { describe, expect, it } from 'vitest';
import {
  applyOps,
  fromText,
  sequentialIds,
  type Item,
  type Op,
  type Stream,
  type Token,
} from '@varians/core';
import { diffStates } from './diff.ts';
import { cellText, renderLines, spaceAfter, type RenderLine } from './placement.ts';
import { serializeDiff } from './types.ts';

const text = (): Stream => fromText('a b c\nd e f\ng h', { lang: 'en', ids: sequentialIds() });

function render(ops: Op[], authors: Record<string, string> = {}): RenderLine[] {
  const before = text();
  const after = applyOps(before, ops).stream;
  return renderLines(
    after,
    serializeDiff(diffStates(before, after)),
    (id) => id.toUpperCase(),
    {},
    authors,
  );
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
    expect(render([{ t: 'delete', ids: ['t1', 't2'] }]).map(show)).toEqual([
      '-a- -b- c',
      'd e f',
      'g h',
    ]);
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
    const lines = render(
      [{ t: 'insert', after: 't2', items: [{ kind: 'break', id: 'nb', type: 'line' }] }],
      { nb: 'ann' },
    );
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

describe('renderLines, an edition with prose', () => {
  /** `/` a line break, `//` a paragraph break (`//p` marked as prose, `//v` as verse), `+` a joined word, `@s` where a segment begins. */
  function edition(spec: string): Stream {
    const items: Item[] = [];
    let n = 0;
    for (const word of spec.split(/\s+/u)) {
      if (word === '/' || word.startsWith('//')) {
        const paragraph = word.startsWith('//');
        const lineation = word === '//p' ? 'prose' : word === '//v' ? 'verse' : undefined;
        items.push({
          kind: 'break',
          id: `b${++n}`,
          type: paragraph ? 'paragraph' : 'line',
          ...(lineation ? { lineation } : {}),
        });
        continue;
      }
      const [form, start] = word.split('@');
      const joined = form!.endsWith('+');
      items.push({
        kind: 'token',
        id: `t${++n}`,
        form: joined ? form!.slice(0, -1) : form!,
        ...(joined ? { joinNext: true } : {}),
        ...(start ? { segment: { segmentId: start } } : {}),
      });
    }
    return { items };
  }
  const label = (id: string) => `L${id}`;
  const words = (line: RenderLine) => line.cells.map((c) => cellText(c.item)).join(' ');

  it('runs a prose paragraph on as one line, its labels in the run, and breaks no word', () => {
    // t1 a@s1, t2 b ana+, / , stasis@s2, c, / , d@s3 e
    const stream = edition('a@s1 b ana+ / stasis c / d@s3 e');
    const lines = renderLines(stream, null, label, { lineation: 'prose' });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.lineation).toBe('prose');
    // The line breaks are in the text and are not drawn; the divided word has no hyphen, and no space inside it.
    expect(words(lines[0]!)).toBe('a b ana stasis c d e');
    expect(lines[0]!.hyphen).toBe(false);
    expect(spaceAfter(lines[0]!.cells[2]!)).toBe(false);
    // The paragraph's first segment has its label in the margin, the others stand in the run where they begin.
    expect(lines[0]!.label).toBe('Ls1');
    expect([...lines[0]!.inlineLabels]).toEqual([['t8', 'Ls3']]);
  });

  it('shows verse in the lines the breaks make, a word divided where a line ends with its hyphen', () => {
    const stream = edition('a@s1 ana+ / stasis@s2 c');
    const lines = renderLines(stream, null, label, { lineation: 'verse' });
    expect(lines.map(words)).toEqual(['a ana', 'stasis c']);
    expect(lines.map((l) => l.hyphen)).toEqual([true, false]);
    expect(lines.every((l) => l.lineation === 'verse' && l.inlineLabels.size === 0)).toBe(true);
  });

  it('takes each paragraph by its own kind: prose runs on, verse in lines, a hyphen only in verse', () => {
    const stream = edition('a b / c d+ //p e f / g h+ / i j //v k l+ / m');
    const lines = renderLines(stream, null, label, { lineation: 'verse' });
    expect(lines.map((l) => `${l.lineation}: ${words(l)}`)).toEqual([
      'verse: a b',
      'verse: c d',
      'prose: e f g h i j',
      'verse: k l',
      'verse: m',
    ]);
    expect(lines.map((l) => l.hyphen)).toEqual([false, true, false, true, false]);
    expect(lines[2]!.paragraph).toBe(true);
  });

  it('draws a line break of a prose paragraph only where a change touched it, and says so', () => {
    const before = edition('a b / c d');
    const added = applyOps(before, [
      { t: 'insert', after: 't4', items: [{ kind: 'break', id: 'nb', type: 'line' }] },
    ]).stream;
    const lines = renderLines(
      added,
      serializeDiff(diffStates(before, added)),
      label,
      { lineation: 'prose' },
      { nb: 'ann' },
    );
    expect(lines).toHaveLength(1);
    // The break that was there stays out of sight; the one added is marked in the run.
    expect(lines[0]!.cells.map((c) => (c.added ? '+¶+' : cellText(c.item)))).toEqual([
      'a',
      'b',
      'c',
      '+¶+',
      'd',
    ]);
    expect(lines[0]!.cells[3]!.author).toBe('ann');
    // A break removed is put back as one, as it is in verse.
    const removed = applyOps(before, [{ t: 'delete', ids: ['b3'] }]).stream;
    const gone = renderLines(removed, serializeDiff(diffStates(before, removed)), label, {
      lineation: 'prose',
    });
    expect(gone[0]!.cells.map((c) => (c.removed ? '-¶-' : cellText(c.item)))).toEqual([
      'a',
      'b',
      '-¶-',
      'c',
      'd',
    ]);
  });

  it('puts no space after the mark of a break that stands inside a divided word', () => {
    const before = edition('a ana+ stasis b');
    const divided = applyOps(before, [
      { t: 'insert', after: 't2', items: [{ kind: 'break', id: 'nb', type: 'line' }] },
    ]).stream;
    const [line] = renderLines(divided, serializeDiff(diffStates(before, divided)), label, {
      lineation: 'prose',
    });
    const cells = line!.cells;
    expect(cells.map((c) => cellText(c.item))).toEqual(['a', 'ana', '¶', 'stasis', 'b']);
    expect(spaceAfter(cells[1]!)).toBe(false);
    expect(spaceAfter(cells[2]!, cells[1])).toBe(false);
    // Between two words, the mark of a break is followed by a space as a word is.
    expect(spaceAfter(cells[2]!, cells[0])).toBe(true);
  });
});

describe('cellText', () => {
  it('shows the read form when asked, gaps in brackets and breaks as pilcrows', () => {
    expect(cellText({ kind: 'token', id: 'a', form: 'ΚΑΙ', norm: 'καὶ' }, 'read')).toBe('καὶ');
    expect(cellText({ kind: 'object', id: 'g', type: 'gap', attrs: { quantity: 3 } })).toBe(
      '[...]',
    );
    expect(cellText({ kind: 'break', id: 'b', type: 'line' })).toBe('¶');
  });
});
