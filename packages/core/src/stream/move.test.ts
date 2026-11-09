import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Break, Item, Stream, Token } from './items.ts';
import { conformPages, insertIntoPage, moveRun, moveToPage, pageBreakPlace, repairSegmentStarts, repairSegmentStartsFrom } from './move.ts';
import { applyOps, type Op } from './ops.ts';
import { runsOfSegment, segmentAt, segmentUnits } from './words.ts';

/**
 * A stream in a short notation, items divided by spaces:
 * `a` a token with id and form `a`; `a@s1` with a start of segment s1;
 * `a@s1.2` with part 2; `a@-` with a start of no segment; `/` a line break;
 * `#p1` a page break naming p1; `#?` one naming no page; `#p1:12r` one with a label.
 */
function build(spec: string): Stream {
  let line = 0;
  const items: Item[] = spec
    .split(/\s+/u)
    .filter(Boolean)
    .map((word): Item => {
      if (word === '/') return { kind: 'break', id: `l${++line}`, type: 'line' };
      if (word.startsWith('#')) {
        const [page, label] = word.slice(1).split(':');
        const brk: Break = { kind: 'break', id: `b-${page}${label ? '-' + label : ''}-${++line}`, type: 'page' };
        if (page && page !== '?') brk.pageId = page;
        if (label) brk.label = label;
        return brk;
      }
      const [id, start] = word.split('@');
      const token: Token = { kind: 'token', id: id!, form: id! };
      if (start === '-') token.segment = { segmentId: null };
      else if (start) {
        const [segmentId, part] = start.split('.');
        token.segment = part ? { segmentId: segmentId!, part: Number(part) } : { segmentId: segmentId! };
      }
      return token;
    });
  return { items };
}

/** The notation back, with line breaks as `/` and page breaks as `#page`. */
function show(stream: Stream): string {
  return stream.items
    .map((item) => {
      if (item.kind === 'break') {
        if (item.type !== 'page') return '/';
        return `#${item.pageId ?? '?'}${item.label ? ':' + item.label : ''}`;
      }
      if (item.kind !== 'token' || !item.segment) return item.id;
      const s = item.segment;
      return `${item.id}@${s.segmentId ?? '-'}${s.part ? '.' + s.part : ''}`;
    })
    .join(' ');
}

/** The segment of every token by flow. */
function members(stream: Stream): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  stream.items.forEach((item, i) => {
    if (item.kind === 'token') out[item.id] = segmentAt(stream, i)?.segmentId ?? null;
  });
  return out;
}

/** The words of a segment in content order. */
function content(stream: Stream, segmentId: string): string {
  return segmentUnits(stream, segmentId)
    .map((u) => u.text)
    .join(' ');
}

function run(stream: Stream, ops: Op[]): Stream {
  const after = applyOps(stream, ops).stream;
  expect(members(after)).toEqual(members(stream));
  return after;
}

describe('moveRun', () => {
  it('places pages in order from a fully segmented text on no page, as the owner described', () => {
    const start = build('a@s1 b c d@s2 e f g@s3 h #p1 #p2');
    const one = run(start, moveRun(start, ['a', 'b', 'c', 'd'], 'b-p1-1'));
    expect(show(one)).toBe('e@s2.2 f g@s3 h #p1 a@s1 b c d@s2.1 #p2');
    expect(content(one, 's2')).toBe('d e f');
    const two = run(one, moveRun(one, ['e', 'f', 'g', 'h'], 'b-p2-2'));
    expect(show(two)).toBe('#p1 a@s1 b c d@s2 #p2 e f g@s3 h');
  });

  it('places a later page before an earlier one with part numbers in the old content order', () => {
    const start = build('a@s1 b c d e@s2 f #p1 #p2');
    const late = run(start, moveRun(start, ['c', 'd'], 'b-p2-2'));
    expect(show(late)).toBe('a@s1.1 b e@s2 f #p1 #p2 c@s1.2 d');
    expect(content(late, 's1')).toBe('a b c d');
    const both = run(late, moveRun(late, ['a', 'b'], 'b-p1-1'));
    expect(show(both)).toBe('e@s2 f #p1 a@s1 b #p2 c d');
  });

  it('needs no start where the placed text still follows its segment, pages between or not', () => {
    const start = build('a@s1 b c d #p1 #p2');
    const late = run(start, moveRun(start, ['c', 'd'], 'b-p2-2'));
    expect(show(late)).toBe('a@s1 b #p1 #p2 c d');
  });

  it('moves half a line out of the middle of a run, which then has two parts', () => {
    const start = build('a@s1 b c d e f / x@s2 y');
    const moved = run(start, moveRun(start, ['c', 'd'], 'y'));
    expect(show(moved)).toBe('a@s1.1 b e f / x@s2 y c@s1.2 d');
    expect(content(moved, 's1')).toBe('a b e f c d');
    expect(content(moved, 's2')).toBe('x y');
  });

  it('moves a run within itself: one run in the new order, no parts', () => {
    const start = build('x@s0 a@s1 b / c d / y@s2');
    const moved = run(start, moveRun(start, ['c', 'd'], 'x'));
    expect(show(moved)).toBe('x@s0 c@s1 d a b / / y@s2');
    expect(runsOfSegment(moved, 's1')).toHaveLength(1);
  });

  it('rejoins two parts of a segment when what stood between them leaves', () => {
    const start = build('a@s1.1 b x@s2 y c@s1.2 d #p1');
    const moved = run(start, moveRun(start, ['x', 'y'], 'b-p1-1'));
    expect(show(moved)).toBe('a@s1 b c d #p1 x@s2 y');
  });

  it('gives the start of a moved run to the word that continued its segment', () => {
    const start = build('a@s1 b c@s2 d e');
    const moved = run(start, moveRun(start, ['c', 'd'], null));
    expect(show(moved)).toBe('c@s2.1 d a@s1 b e@s2.2');
    expect(content(moved, 's2')).toBe('c d e');
  });

  it('marks unassigned text moved after a segment, and needs no mark before everything', () => {
    const start = build('u v a@s1 b');
    const after = run(start, moveRun(start, ['u', 'v'], 'b'));
    expect(show(after)).toBe('a@s1 b u@- v');
    const back = run(after, moveRun(after, ['u', 'v'], null));
    expect(show(back)).toBe('u v a@s1 b');
  });

  it('moves across the boundary of the text on no page in both directions', () => {
    const start = build('a@s1 b #p1 c d@s2 e');
    const into = run(start, moveRun(start, ['b'], 'c'));
    expect(show(into)).toBe('a@s1 #p1 c b d@s2 e');
    const out = run(into, moveRun(into, ['d', 'e'], null));
    expect(show(out)).toBe('d@s2 e a@s1 #p1 c b');
  });

  it('keeps the segment of the word after the new place', () => {
    const start = build('a@s1 b c d@s2 e');
    const moved = run(start, moveRun(start, ['d', 'e'], 'a'));
    expect(show(moved)).toBe('a@s1.1 d@s2 e b@s1.2 c');
  });

  it('refuses a run with a page break and a run moved after itself', () => {
    const s = build('a #p1 b');
    expect(() => moveRun(s, ['a', 'b-p1-1'], 'b')).toThrow();
    expect(() => moveRun(s, ['a'], 'a')).toThrow();
    expect(moveRun(s, ['b'], 'b-p1-1')).toEqual([]);
  });
});

describe('moveToPage', () => {
  const ids = () => sequentialIds('n');

  it('creates the page break in the witness order and moves the text to it', () => {
    const start = build('a@s1 b / c d #p3 z');
    const ops = moveToPage(start, ['a', 'b'], 'p2', { pageOrder: ['p1', 'p2', 'p3'], ids: ids() });
    // The orphaned line break goes; a b still follow s1's words, so the segment is one run in the new order.
    expect(show(run(start, ops))).toBe('c@s1 d #p2 a b #p3 z');
    const two = build('a@s1 b / c d@s2 #p3 z');
    const ops2 = moveToPage(two, ['a', 'b'], 'p2', { pageOrder: ['p1', 'p2', 'p3'], ids: ids() });
    expect(show(run(two, ops2))).toBe('c@s1.2 d@s2.1 #p2 a@s1.1 b #p3 z@s2.2');
  });

  it('appends after a line break when the page has text, and drops the orphaned break', () => {
    const start = build('a b / c #p1 x');
    const moved = run(start, moveToPage(start, ['c'], 'p1', { pageOrder: ['p1'], ids: ids() }));
    expect(show(moved)).toBe('a b #p1 x / c');
    const lead = build('a / b #p1 x');
    const moved2 = run(lead, moveToPage(lead, ['a'], 'p1', { pageOrder: ['p1'], ids: ids() }));
    expect(show(moved2)).toBe('b #p1 x / a');
  });

  it('moves to Not on a page and leaves a run already at the end alone', () => {
    const start = build('u #p1 a@s1 b');
    const moved = run(start, moveToPage(start, ['a', 'b'], null, { pageOrder: ['p1'], ids: ids() }));
    expect(show(moved)).toBe('u / a@s1 b #p1');
    expect(moveToPage(moved, ['a', 'b'], null, { pageOrder: ['p1'] })).toEqual([]);
  });

  it('finds the place of a missing page break', () => {
    const s = build('u #p1 a #p3 b');
    expect(pageBreakPlace(s, 'p2', ['p1', 'p2', 'p3'])).toBe('a');
    expect(pageBreakPlace(s, 'p0', ['p0', 'p1', 'p3'])).toBe('u');
    expect(pageBreakPlace(build('#p1 a'), 'p0', ['p0', 'p1'])).toBe(null);
  });
});

describe('conformPages', () => {
  const order = ['p1', 'p2', 'p3'];

  it('makes no ops for a stream already in shape, or one without pages', () => {
    const s = build('u #p1 a@s1 b #p3 c');
    expect(conformPages(s, order)).toEqual([]);
    expect(conformPages(build('a@s1 b / c'), [])).toEqual([]);
    expect(conformPages(build(''), order)).toEqual([]);
  });

  it('sends the text of a break naming no page, or a page that is gone, to Not on a page', () => {
    const s = build('u #? a@s1 b #p9 c #p1 d');
    const out = run(s, conformPages(s, order, sequentialIds('n')));
    expect(show(out)).toBe('u / a@s1 b / c #p1 d');
  });

  it('sends the text of a second break naming a page to that page', () => {
    const s = build('#p1 a@s1 #p2 b@s2 #p1 c');
    const out = run(s, conformPages(s, order, sequentialIds('n')));
    // b and c of s2 now stand together, so they are one run in their new order.
    expect(show(out)).toBe('#p1 a@s1 / c@s2 #p2 b');
  });

  it('puts the pages in the witness order', () => {
    const s = build('#p3 c@s3 #p1 a@s1 #p2 b@s2');
    const out = run(s, conformPages(s, order));
    expect(show(out)).toBe('#p1 a@s1 #p2 b@s2 #p3 c@s3');
  });

  it('removes a label from a page break', () => {
    const s = build('#p1:12r a');
    expect(show(run(s, conformPages(s, order)))).toBe('#p1 a');
  });

  it('does everything at once, and a second pass does nothing', () => {
    const s = build('u@s1 #p3:x c #? d@s2 #p1 a #p3 e #p2 b');
    const ops = conformPages(s, order, sequentialIds('n'));
    const out = run(s, ops);
    expect(show(out)).toBe('u@s1.1 / d@s2.1 #p1 a #p2 b #p3 c@s1.2 / e@s2.2');
    expect(content(out, 's2')).toBe('d a b e');
    expect(conformPages(out, order)).toEqual([]);
  });
});

describe('repairSegmentStarts', () => {
  it('changes nothing when no word has a new neighbour', () => {
    const s = build('a@s1 b / c');
    expect(repairSegmentStarts(s, s)).toEqual([]);
  });
});

describe('insertIntoPage', () => {
  it('appends to a page with text after a line break, and creates a missing page in its place', () => {
    const s = build('u #p1 a #p3 c');
    const items = build('x y').items;
    const onP1 = applyOps(s, insertIntoPage(s, items, 'p1', { pageOrder: ['p1', 'p2', 'p3'], ids: sequentialIds('n') })).stream;
    expect(show(onP1)).toBe('u #p1 a / x y #p3 c');
    const onP2 = applyOps(s, insertIntoPage(s, build('x y').items, 'p2', { pageOrder: ['p1', 'p2', 'p3'], ids: sequentialIds('n') })).stream;
    expect(show(onP2)).toBe('u #p1 a #p2 x y #p3 c');
    const unplaced = applyOps(build('#p1 a'), insertIntoPage(build('#p1 a'), build('x').items, null, { pageOrder: ['p1'] })).stream;
    expect(show(unplaced)).toBe('x #p1 a');
  });
});

describe('repairSegmentStartsFrom', () => {
  it('keeps the segments an imported text gave its words, wherever they are placed', () => {
    const current = build('a@s1 b #p1 c');
    const imported = build('x y@s2 z');
    // x has no segment in the import; placed after b it would join s1 by flow.
    const placed = { items: [...current.items.slice(0, 2), ...imported.items, ...current.items.slice(2)] };
    const after = applyOps(placed, repairSegmentStartsFrom([current, imported], placed)).stream;
    expect(show(after)).toBe('a@s1.1 b x@- y@s2 z #p1 c@s1.2');
  });
});
