import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Break, Item, Token } from '../stream/items.ts';
import { fromText } from '../stream/text.ts';
import { hyphenatedWords, layoutLines, lineationOf, paragraphKinds, runOn } from './layout.ts';

function verse(): ReturnType<typeof fromText> {
  const lines = Array.from({ length: 12 }, (_, i) => `word${i + 1} more`);
  const s = fromText(lines.join('\n'), { ids: sequentialIds() });
  let n = 1;
  for (const item of s.items) {
    if (item.kind === 'token' && item.form.startsWith('word'))
      (item as Token).segment = { segmentId: `s${n++}` };
  }
  return s;
}

describe('layoutLines', () => {
  it('prints every fifth label and the first', () => {
    const lines = layoutLines(verse(), (id) => `1.${id.slice(1)}`, { numberEvery: 5 });
    expect(lines).toHaveLength(12);
    expect(lines.map((l) => l.label)).toEqual([
      '1.1',
      null,
      null,
      null,
      '1.5',
      null,
      null,
      null,
      null,
      '1.10',
      null,
      null,
    ]);
    expect(lines[4]!.starts[0]!.segmentId).toBe('s5');
  });

  it('prints every label when asked, and notes paragraphs and pages', () => {
    const s = fromText('a b\nc d', { ids: sequentialIds() });
    (s.items[0] as Token).segment = { segmentId: 'x' };
    (s.items[3] as Token).segment = { segmentId: 'y' };
    s.items[2] = { kind: 'break', id: 'pb', type: 'page', pageId: 'p1' };
    const lines = layoutLines(s, (id) => id.toUpperCase());
    expect(lines.map((l) => l.label)).toEqual(['X', 'Y']);
    expect(lines[1]!.pageId).toBe('p1');
    expect(lines[0]!.items.map((i) => i.id)).toEqual(['t1', 't2']);
  });
});

/** Tokens and breaks from a spec: words separated by spaces, `/` a line break, `//` a paragraph break, a trailing `+` a join. */
function text(spec: string): ReturnType<typeof fromText> {
  const items: Item[] = [];
  let n = 0;
  for (const word of spec.split(/\s+/u)) {
    if (word === '/' || word === '//') {
      items.push({ kind: 'break', id: `b${++n}`, type: word === '//' ? 'paragraph' : 'line' });
      continue;
    }
    const joined = word.endsWith('+');
    items.push({
      kind: 'token',
      id: `t${++n}`,
      form: joined ? word.slice(0, -1) : word,
      ...(joined ? { joinNext: true } : {}),
    });
  }
  return { items };
}

describe('lineationOf and paragraphKinds', () => {
  it("takes a paragraph break's own kind, else the convention", () => {
    expect(lineationOf(undefined, 'prose')).toBe('prose');
    expect(
      lineationOf({ kind: 'break', id: 'b', type: 'paragraph', lineation: 'verse' }, 'prose'),
    ).toBe('verse');
    const s = text('a / b // c');
    (s.items[3] as Break).lineation = 'prose';
    const kinds = paragraphKinds(s.items, 'verse');
    expect(kinds.get(null)).toBe('verse');
    expect(kinds.get('b4')).toBe('prose');
  });

  it('lets a paragraph break at the start of the text give the first paragraph its kind', () => {
    const s = text('// a b');
    (s.items[0] as Break).lineation = 'prose';
    expect(paragraphKinds(s.items, 'verse').get(null)).toBe('prose');
    const lines = layoutLines(s, (id) => id);
    expect(lines.map((l) => l.lineation)).toEqual(['prose']);
  });
});

describe('hyphenatedWords', () => {
  it('draws a hyphen where a break follows a joined token in verse, and nowhere else', () => {
    const s = text('ana+ / stasis de ana+ sta');
    expect([...hyphenatedWords(s.items)]).toEqual(['t1']);
  });

  it('draws none in a prose paragraph, and has the next paragraph its own kind', () => {
    const s = text('ana+ / stasis // de+ / mos');
    (s.items[3] as Break).lineation = 'prose';
    expect([...hyphenatedWords(s.items, 'verse')]).toEqual(['t1']);
    expect([...hyphenatedWords(s.items, 'prose')]).toEqual([]);
    (s.items[3] as Break).lineation = 'verse';
    expect([...hyphenatedWords(s.items, 'prose')]).toEqual(['t5']);
  });
});

describe('the lines of a text with verse and prose paragraphs', () => {
  function mixed(): ReturnType<typeof fromText> {
    // A prose paragraph, then verse lines, then prose again.
    const s = text('a b / c d+ / e f // g+ / h // i j / k');
    (s.items[0] as Token).segment = { segmentId: 's1' };
    (s.items[6] as Token).segment = { segmentId: 's2' };
    (s.items[9] as Token).segment = { segmentId: 's3' };
    (s.items[11] as Token).segment = { segmentId: 's4' };
    (s.items[13] as Token).segment = { segmentId: 's5' };
    (s.items[8] as Break).lineation = 'verse';
    (s.items[12] as Break).lineation = 'prose';
    return s;
  }

  it('gives each line the kind of its paragraph, and a hyphen only in verse', () => {
    const lines = layoutLines(mixed(), (id) => id, { numberEvery: 5, lineation: 'prose' });
    expect(lines.map((l) => l.lineation)).toEqual([
      'prose',
      'prose',
      'prose',
      'verse',
      'verse',
      'prose',
      'prose',
    ]);
    expect(lines.map((l) => l.hyphen)).toEqual([false, false, false, true, false, false, false]);
  });

  it('runs a prose paragraph on as one line that keeps its breaks, and leaves verse lines alone', () => {
    const s = mixed();
    const shown = runOn(
      s,
      layoutLines(s, (id) => id, { numberEvery: 5, lineation: 'prose' }),
    );
    expect(shown.map((l) => l.lineation)).toEqual(['prose', 'verse', 'verse', 'prose']);
    const [first, , , last] = shown;
    expect(first!.items.map((i) => i.id)).toEqual(['t1', 't2', 'b3', 't4', 't5', 'b6', 't7', 't8']);
    expect([first!.from, first!.to]).toEqual([0, 8]);
    expect(first!.starts.map((x) => x.segmentId)).toEqual(['s1', 's2']);
    expect(first!.label).toBe('s1');
    expect(last!.items.filter((i) => i.kind === 'token')).toHaveLength(3);
  });

  it('prints the label of a prose paragraph in the margin only where its first word begins a segment', () => {
    const s = text('a b / c d');
    (s.items[1] as Token).segment = { segmentId: 'x' };
    const shown = runOn(
      s,
      layoutLines(s, (id) => id, { lineation: 'prose' }),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]!.label).toBeNull();
    expect(shown[0]!.starts).toHaveLength(1);
  });

  it('prints every label in prose and as the convention says in verse', () => {
    const s = text('a / b / c / d / e / f');
    s.items.forEach((item, i) => {
      if (item.kind === 'token') (item as Token).segment = { segmentId: `1.${i / 2 + 1}` };
    });
    const labels = (lineation: 'verse' | 'prose') =>
      layoutLines(s, (id) => id, { numberEvery: 5, lineation }).map((l) => l.label);
    expect(labels('verse')).toEqual(['1.1', null, null, null, '1.5', null]);
    expect(labels('prose')).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);
  });
});
