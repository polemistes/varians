import { describe, expect, it } from 'vitest';
import type { Lineation, OrderVariant, Site } from '@varians/core';
import { labelMarks, lineMarks, MARGIN_LANES, type LabelLine, type MarginPart } from './line-marks';
import type { SegmentSites } from './sites';

// Lines 0 to 5 hold the segments s0 to s5, one each; labels 1.1 to 1.6.
const segmentsOfLine = [['s0'], ['s1'], ['s2'], ['s3'], ['s4'], ['s5']];
const labelOf: Record<string, string> = {
  s0: '1.1',
  s1: '1.2',
  s2: '1.3',
  s3: '1.4',
  s4: '1.5',
  s5: '1.6',
  u: '1.2a',
  v: '1.2b',
};
const order = ['s0', 's1', 's2', 's3', 's4', 's5'];
const context = { labelOf, order };

/** A passage of one segment (three words) with these sites, each over the segment's words. */
function segment(id: string, sites: Partial<Site>[]): SegmentSites {
  return {
    segmentId: id,
    label: labelOf[id] ?? id,
    segments: [{ segmentId: id, from: 0, to: 3, printed: true }],
    siteSegments: Object.fromEntries(sites.map((_, index) => [index, [id]])),
    collation: {
      sites: sites.map((site, index) => ({ index, baseFrom: 0, baseTo: 1, ...site }) as Site),
    },
    baseUnits: [],
    attachments: {},
  };
}

const wanting = (id: string) => segment(id, [{ baseFrom: 0, baseTo: 3, wanting: true }]);

/** A passage of the segment `after` (three words) and the segments the edition does not print after it, a variant at the point of each. */
function withUnprinted(after: string, ...ids: string[]): SegmentSites {
  return {
    segmentId: after,
    label: labelOf[after] ?? after,
    segments: [
      { segmentId: after, from: 0, to: 3, printed: true },
      ...ids.map((id) => ({ segmentId: id, from: 3, to: 3, printed: false })),
    ],
    siteSegments: Object.fromEntries(ids.map((id, index) => [index, [id]])),
    collation: {
      sites: ids.map((_, index) => ({ index, baseFrom: 3, baseTo: 3 }) as Site),
    },
    baseUnits: [],
    attachments: {},
  };
}

function order_(segments: string[], far = false): OrderVariant {
  const reading = { base: false, textIds: ['t'], sigla: ['A'] };
  return far
    ? { far: true, segments, readings: [{ ...reading, moved: segments, after: 's0' }] }
    : { far: false, segments, readings: [{ ...reading, segments: [...segments].reverse() }] };
}

const all = { has: () => true };

function marks(
  input: {
    segments?: Record<string, SegmentSites>;
    orders?: OrderVariant[];
    shown?: { has(key: string): boolean };
    segmentsOfLine?: string[][];
    lineation?: Lineation[];
  } = {},
) {
  return lineMarks({
    segmentsOfLine: input.segmentsOfLine ?? segmentsOfLine,
    ...(input.lineation ? { lineation: input.lineation } : {}),
    segments: input.segments ?? {},
    shown: input.shown ?? all,
    orders: input.orders ?? [],
    context,
  });
}

/** The marks as lines of text: line, kind, edge, lane, whether first, keys. */
function listed(map: Map<number, MarginPart[]>): string[] {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([line, parts]) =>
      parts.map(
        (p) => `${line} ${p.kind} ${p.edge} ${p.lane} ${p.first ? 'first' : 'next'} ${p.keys}`,
      ),
    );
}

describe('a line that some witnesses do not have', () => {
  it('has a plain rule in the margin at its line, named for the line', () => {
    const map = marks({ segments: { s3: wanting('s3') } });
    expect(listed(map)).toEqual(['3 wanting solo 0 first s3:0']);
    expect(map.get(3)![0]!.name).toBe('Variant at 1.4');
  });

  it('is marked only while the reader is shown the site', () => {
    expect(marks({ segments: { s3: wanting('s3') }, shown: { has: () => false } }).size).toBe(0);
  });

  it('is left unmarked where the segment stands on no line, and a site of words is left to its words', () => {
    expect(marks({ segments: { x: wanting('x') } }).size).toBe(0);
    expect(marks({ segments: { s1: segment('s1', [{ baseFrom: 0, baseTo: 1 }]) } }).size).toBe(0);
  });

  it('runs along every line a segment stands on, from the first to the last', () => {
    const map = marks({
      segments: { s1: wanting('s1') },
      segmentsOfLine: [['s0'], ['s1'], ['s1'], ['s1'], ['s2']],
    });
    expect(listed(map)).toEqual([
      '1 wanting start 0 first s1:0',
      '2 wanting middle 0 next s1:0',
      '3 wanting end 0 next s1:0',
    ]);
  });

  it('runs along the lines of every segment its words lie in, in a passage of several, named for them', () => {
    const passage: SegmentSites = {
      segmentId: 's1',
      label: '1.2',
      segments: [
        { segmentId: 's1', from: 0, to: 3, printed: true },
        { segmentId: 's2', from: 3, to: 6, printed: true },
        { segmentId: 's3', from: 6, to: 9, printed: true },
      ],
      // A witness is without 1.3 and 1.4: the variant over their words.
      siteSegments: { 0: ['s2', 's3'] },
      collation: { sites: [{ index: 0, baseFrom: 3, baseTo: 9, wanting: true } as Site] },
      baseUnits: [],
      attachments: {},
    };
    const map = marks({ segments: { s1: passage } });
    expect(listed(map)).toEqual(['2 wanting start 0 first s1:0', '3 wanting end 0 next s1:0']);
    expect(map.get(2)![0]!.name).toBe('Variant at 1.3–1.4');
  });
});

describe('a line the edition does not print', () => {
  it('has a caret on the line it follows, named for that line', () => {
    const map = marks({ segments: { s1: withUnprinted('s1', 'u') } });
    expect(listed(map)).toEqual(['1 unprinted solo 0 first s1:0']);
    expect(map.get(1)![0]!.name).toBe('Variant after 1.2');
  });

  it('has one caret for the lines that follow the same line, opening all their variants', () => {
    const map = marks({ segments: { s1: withUnprinted('s1', 'u', 'v') } });
    expect(listed(map)).toEqual(['1 unprinted solo 0 first s1:0 s1:1']);
  });

  it('is left unmarked where the line it follows is not in the text, or its variant is not shown', () => {
    expect(marks({ segments: { gone: withUnprinted('gone', 'u') } }).size).toBe(0);
    expect(
      marks({ segments: { s1: withUnprinted('s1', 'u') }, shown: { has: () => false } }).size,
    ).toBe(0);
    // A passage that has not come yet has no site to open.
    expect(marks({}).size).toBe(0);
  });
});

describe('lines in another order', () => {
  it('have a bracket along the stretch, one mark with one stop, named for the stretch', () => {
    const map = marks({ orders: [order_(['s2', 's3', 's4'])] });
    expect(listed(map)).toEqual([
      '2 order start 0 first order:0',
      '3 order middle 0 next order:0',
      '4 order end 0 next order:0',
    ]);
    expect(map.get(2)![0]!.name).toBe('Variant at 1.3–1.5');
  });

  it('have a bracket along the block of a block far from its place', () => {
    const map = marks({ orders: [order_(['s4', 's5'], true)] });
    expect(listed(map)).toEqual(['4 order start 0 first order:0', '5 order end 0 next order:0']);
    expect(map.get(4)![0]!.name).toBe('Variant at 1.5–1.6');
  });

  it('are always marked, and each by its place among the edition’s', () => {
    const map = marks({
      orders: [order_(['s0', 's1']), order_(['s4', 's5'])],
      shown: { has: () => false },
    });
    expect(listed(map)).toEqual([
      '0 order start 0 first order:0',
      '1 order end 0 next order:0',
      '4 order start 0 first order:1',
      '5 order end 0 next order:1',
    ]);
  });

  it('have a bracket on a line alone where the segments stand on one line', () => {
    const map = marks({
      orders: [order_(['s0', 's1'])],
      segmentsOfLine: [['s0', 's1'], ['s2']],
    });
    expect(listed(map)).toEqual(['0 order solo 0 first order:0']);
  });
});

describe('marks that would stand over one another', () => {
  it('are set side by side, the wider first nearest the text', () => {
    const map = marks({
      segments: { s3: wanting('s3') },
      orders: [order_(['s2', 's3', 's4'])],
    });
    expect(listed(map)).toEqual([
      '2 order start 0 first order:0',
      '3 order middle 0 next order:0',
      '3 wanting solo 1 first s3:0',
      '4 order end 0 next order:0',
    ]);
  });

  it('leave a lane free where the lines do not meet', () => {
    const map = marks({
      segments: { s0: wanting('s0'), s5: wanting('s5') },
      orders: [order_(['s2', 's3'])],
    });
    expect(listed(map).map((l) => l.split(' ')[3])).toEqual(['0', '0', '0', '0']);
  });

  it('move a caret over the line a bracket stands on, which it also touches below', () => {
    const map = marks({
      segments: { s1: withUnprinted('s1', 'u') },
      orders: [order_(['s2', 's3'])],
    });
    // The caret is below line 1, where the bracket begins on line 2: they take two lanes.
    expect(listed(map)).toEqual([
      '1 unprinted solo 1 first s1:0',
      '2 order start 0 first order:0',
      '3 order end 0 next order:0',
    ]);
  });

  it('share the last lane when more would meet than the margin has room for', () => {
    const map = marks({
      segments: { s2: wanting('s2') },
      orders: [order_(['s1', 's2']), order_(['s2', 's3'])],
    });
    const lanes = [...map.values()].flat().map((p) => p.lane);
    expect(Math.max(...lanes)).toBe(MARGIN_LANES - 1);
    expect(lanes.length).toBe(2 + 2 + 1);
  });
});

describe('by the kind of the paragraph', () => {
  // Lines 3 and 4 are prose; the others are verse.
  const lineation: Lineation[] = ['verse', 'verse', 'verse', 'prose', 'prose', 'verse'];

  /** A passage of s1, s2 and s3 (three words each) with a variant over the words of the segments `from` to `to` of those. */
  function wide(from: number, to: number): SegmentSites {
    const ids = ['s1', 's2', 's3'];
    return {
      segmentId: 's1',
      label: '1.2',
      segments: ids.map((segmentId, k) => ({
        segmentId,
        from: k * 3,
        to: k * 3 + 3,
        printed: true,
      })),
      siteSegments: { 0: ids.slice(from, to + 1) },
      collation: {
        sites: [{ index: 0, baseFrom: from * 3, baseTo: to * 3 + 3, wanting: true } as Site],
      },
      baseUnits: [],
      attachments: {},
    };
  }

  it('leaves a segment some witnesses do not have to its words in prose, and marks it in the margin in verse', () => {
    expect(listed(marks({ segments: { s3: wanting('s3') }, lineation }))).toEqual([]);
    expect(listed(marks({ segments: { s2: wanting('s2') }, lineation }))).toEqual([
      '2 wanting solo 0 first s2:0',
    ]);
    // The same text, all verse, is marked as it was.
    expect(listed(marks({ segments: { s3: wanting('s3') } }))).toEqual([
      '3 wanting solo 0 first s3:0',
    ]);
  });

  it('marks a stretch over both kinds in the verse and leaves the prose to its words', () => {
    // 1.3 (verse, line 2) and 1.4 (prose, line 3): the rule is along line 2 only.
    expect(listed(marks({ segments: { s1: wide(1, 2) }, lineation }))).toEqual([
      '2 wanting solo 0 first s1:0',
    ]);
  });

  it('breaks a mark where a paragraph of the other kind comes between, with one stop for the whole', () => {
    // Lines 1 and 3 are verse, line 2 prose: two strokes, the first the stop.
    const kinds: Lineation[] = ['verse', 'verse', 'prose', 'verse', 'verse', 'verse'];
    expect(listed(marks({ segments: { s1: wide(0, 2) }, lineation: kinds }))).toEqual([
      '1 wanting solo 0 first s1:0',
      '3 wanting solo 0 next s1:0',
    ]);
  });

  it('marks a segment the edition does not print in the margin after a line of verse, and not after prose', () => {
    expect(listed(marks({ segments: { s1: withUnprinted('s1', 'u') }, lineation }))).toEqual([
      '1 unprinted solo 0 first s1:0',
    ]);
    expect(listed(marks({ segments: { s3: withUnprinted('s3', 'u') }, lineation }))).toEqual([]);
  });

  it('puts a bracket along the lines of verse of segments in another order, and leaves their labels in prose to labelMarks', () => {
    const map = marks({ orders: [order_(['s2', 's3', 's4'])], lineation });
    expect(listed(map)).toEqual(['2 order solo 0 first order:0']);
    expect(listed(marks({ orders: [order_(['s3', 's4'])], lineation }))).toEqual([]);
  });
});

describe('the labels in prose that mark segments in another order', () => {
  // A prose paragraph (line 0) in which 1.1 begins at its first item and 1.2, 1.3 in it; a verse line (line 1) for 1.4.
  const lines: LabelLine[] = [
    {
      lineation: 'prose',
      from: 10,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      starts: [
        { segmentId: 's0', itemIndex: 10 },
        { segmentId: 's1', itemIndex: 12 },
        { segmentId: 's2', itemIndex: 13 },
      ],
    },
    {
      lineation: 'verse',
      from: 14,
      items: [{ id: 'e' }],
      starts: [{ segmentId: 's3', itemIndex: 14 }],
    },
  ];

  it('stand on the label in the margin of the paragraph that begins with the segment, and on each in the text', () => {
    const found = labelMarks(lines, [order_(['s0', 's1'])]);
    expect([...found.margin]).toEqual([[0, 'order:0']]);
    expect([...found.inline]).toEqual([['c', 'order:0']]);
    // The first of the variant's labels is its stop.
    expect([...found.stops.margin]).toEqual([0]);
    expect([...found.stops.inline]).toEqual([]);
  });

  it('are the stop of the first label only, and keep the keys of two variants on one label together', () => {
    const found = labelMarks(lines, [order_(['s1', 's2']), order_(['s2'])]);
    expect([...found.inline]).toEqual([
      ['c', 'order:0'],
      ['d', 'order:0 order:1'],
    ]);
    expect([...found.stops.inline].sort()).toEqual(['c', 'd']);
  });

  it('leave the segments in verse to the bracket in the margin', () => {
    const found = labelMarks(lines, [order_(['s3'])]);
    expect(found.margin.size + found.inline.size).toBe(0);
  });
});
