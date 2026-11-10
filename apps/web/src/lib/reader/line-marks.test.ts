import { describe, expect, it } from 'vitest';
import type { OrderVariant, Site } from '@varians/core';
import { lineMarks, MARGIN_LANES, type MarginPart } from './line-marks';
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

function segment(id: string, sites: Partial<Site>[]): SegmentSites {
  return {
    segmentId: id,
    label: labelOf[id] ?? id,
    collation: {
      sites: sites.map((site, index) => ({ index, baseFrom: 0, baseTo: 1, ...site }) as Site),
    },
    baseUnits: [],
    attachments: {},
  };
}

const wanting = (id: string) => segment(id, [{ baseFrom: 0, baseTo: 3, wanting: true }]);
const unprintedLine = (id: string) => segment(id, [{ baseFrom: 0, baseTo: 0 }]);

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
    unprinted?: { segmentId: string; after: string }[];
    orders?: OrderVariant[];
    shown?: { has(key: string): boolean };
    segmentsOfLine?: string[][];
  } = {},
) {
  return lineMarks({
    segmentsOfLine: input.segmentsOfLine ?? segmentsOfLine,
    segments: input.segments ?? {},
    shown: input.shown ?? all,
    unprinted: input.unprinted ?? [],
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
});

describe('a line the edition does not print', () => {
  it('has a caret on the line it follows, named for that line', () => {
    const map = marks({
      segments: { u: unprintedLine('u') },
      unprinted: [{ segmentId: 'u', after: 's1' }],
    });
    expect(listed(map)).toEqual(['1 unprinted solo 0 first u:0']);
    expect(map.get(1)![0]!.name).toBe('Variant after 1.2');
  });

  it('has one caret for the lines that follow the same line, opening all their variants', () => {
    const map = marks({
      segments: { u: unprintedLine('u'), v: unprintedLine('v') },
      unprinted: [
        { segmentId: 'u', after: 's1' },
        { segmentId: 'v', after: 's1' },
      ],
    });
    expect(listed(map)).toEqual(['1 unprinted solo 0 first u:0 v:0']);
  });

  it('is left unmarked where the line it follows is not in the text, or its variant is not shown', () => {
    const segments = { u: unprintedLine('u') };
    expect(marks({ segments, unprinted: [{ segmentId: 'u', after: 'gone' }] }).size).toBe(0);
    expect(
      marks({
        segments,
        unprinted: [{ segmentId: 'u', after: 's1' }],
        shown: { has: () => false },
      }).size,
    ).toBe(0);
    // A segment that has not come yet has no site to open.
    expect(marks({ unprinted: [{ segmentId: 'u', after: 's1' }] }).size).toBe(0);
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
      segments: { u: unprintedLine('u') },
      unprinted: [{ segmentId: 'u', after: 's1' }],
      orders: [order_(['s2', 's3'])],
    });
    // The caret is below line 1, where the bracket begins on line 2: they take two lanes.
    expect(listed(map)).toEqual([
      '1 unprinted solo 1 first u:0',
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
