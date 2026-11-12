import { describe, expect, it } from 'vitest';
import {
  applyOps,
  fromText,
  nextLabel,
  sequentialIds,
  type Scheme,
  type Token,
} from '@varians/core';
import { labelSequence, lineStarts, numberingOps } from './numbering.ts';

const bookLine: Scheme = {
  levels: [
    { key: 'book', label: 'Book', type: 'number', separator: '' },
    { key: 'line', label: 'Line', type: 'number', separator: '.' },
  ],
};

describe('lineStarts', () => {
  // t1 t2 / (empty) / t5 t6 / t8 / t10 t11
  const page = () => fromText('a b\n\nc d\ne\nf g', { lang: 'en', ids: sequentialIds() });

  it('takes the first word of each line from the caret line to the end, passing empty lines', () => {
    expect(lineStarts(page(), 't2')).toEqual(['t1', 't5', 't8', 't10']);
    expect(lineStarts(page(), 't6')).toEqual(['t5', 't8', 't10']);
  });

  it('stops after a count', () => {
    expect(lineStarts(page(), 't1', 2)).toEqual(['t1', 't5']);
  });

  it('passes a line whose first word continues the previous line', () => {
    const s = page();
    (s.items[5] as Token).joinNext = true; // d continues on the next line
    expect(lineStarts(s, 't1')).toEqual(['t1', 't5', 't10']);
  });

  it('is empty for an item not on the page', () => {
    expect(lineStarts(page(), 'zz')).toEqual([]);
  });
});

describe('numbering', () => {
  it('counts labels on through the scheme and stops where none follows', () => {
    expect(labelSequence('1.9', 3, (l) => nextLabel(bookLine, l))).toEqual(['1.9', '1.10', '1.11']);
    expect(labelSequence('x', 3, () => null)).toEqual(['x']);
  });

  it('makes one set operation per line', () => {
    const s = fromText('a b\nc d', { lang: 'en', ids: sequentialIds() });
    const ops = numberingOps(lineStarts(s, 't1'), ['s1', 's2']);
    const after = applyOps(s, ops).stream;
    expect((after.items[0] as Token).segment).toEqual({ segmentId: 's1' });
    expect((after.items[3] as Token).segment).toEqual({ segmentId: 's2' });
  });
});
