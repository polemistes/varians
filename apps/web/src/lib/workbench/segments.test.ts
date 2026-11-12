import { describe, expect, it } from 'vitest';
import {
  applyOps,
  fromText,
  sequentialIds,
  type Scheme,
  type Stream,
  type Token,
} from '@varians/core';
import {
  otherRuns,
  partFor,
  proposeLabel,
  segmentOp,
  startBefore,
  unknownSegments,
} from './segments.ts';

const bookLine: Scheme = {
  levels: [
    { key: 'book', label: 'Book', type: 'number', separator: '' },
    { key: 'line', label: 'Line', type: 'number', separator: '.' },
  ],
};

const segments = {
  s1: { label: '1.1', workId: 'w' },
  s2: { label: '1.2', workId: 'w' },
};

/** Three lines: t1 t2 / t4 t5 / t7 t8, with 1.1 at t1 and 1.2 at t4. */
function verse(): Stream {
  const s = fromText('a b\nc d\ne f', { lang: 'en', ids: sequentialIds() });
  (s.items[0] as Token).segment = { segmentId: 's1' };
  (s.items[3] as Token).segment = { segmentId: 's2' };
  return s;
}

const schemeOf = (workId: string) => (workId === 'w' ? bookLine : undefined);

describe('proposeLabel', () => {
  it('proposes the label after the previous start', () => {
    expect(proposeLabel(verse(), 't7', segments, schemeOf)).toEqual({
      label: '1.3',
      workId: 'w',
      current: false,
    });
    expect(proposeLabel(verse(), 't5', segments, schemeOf)).toEqual({
      label: '1.3',
      workId: 'w',
      current: false,
    });
  });

  it('shows the label a token carries', () => {
    expect(proposeLabel(verse(), 't4', segments, schemeOf)).toEqual({
      label: '1.2',
      workId: 'w',
      current: true,
    });
  });

  it('proposes nothing before the first start or after an unassigned one', () => {
    const s = verse();
    expect(proposeLabel(s, 't2', {}, schemeOf)).toEqual({
      label: '',
      workId: null,
      current: false,
    });
    // A start whose label is not known is still a start.
    expect(proposeLabel(s, 't1', {}, schemeOf)).toEqual({ label: '', workId: null, current: true });
    (s.items[3] as Token).segment = { segmentId: null };
    expect(proposeLabel(s, 't7', segments, schemeOf).label).toBe('');
  });

  it('finds the start before an item', () => {
    expect(startBefore(verse(), 't5')).toEqual({ itemId: 't4', start: { segmentId: 's2' } });
    expect(startBefore(verse(), 't1')).toBeNull();
  });
});

describe('parts and operations', () => {
  it('numbers a second run of a segment as its next part', () => {
    const s = verse();
    expect(partFor(s, 's1', 't7')).toBe(2);
    expect(partFor(s, 's1', 't1')).toBeUndefined();
    expect(partFor(s, 's9', 't7')).toBeUndefined();
    expect(otherRuns(s, 's1', 't7')).toEqual(['t1']);
  });

  it('sets, unassigns and removes a start; removal survives JSON', () => {
    const s = verse();
    const set = segmentOp('t7', 's3', 2);
    expect(set).toEqual({ t: 'set', id: 't7', fields: { segment: { segmentId: 's3', part: 2 } } });
    expect(segmentOp('t7', null)).toEqual({
      t: 'set',
      id: 't7',
      fields: { segment: { segmentId: null } },
    });
    const remove = JSON.parse(JSON.stringify(segmentOp('t4', undefined)));
    const after = applyOps(s, [remove]).stream;
    expect((after.items[3] as Token).segment).toBeUndefined();
  });

  it('lists the segments the label map does not know', () => {
    expect(unknownSegments(verse(), { s1: segments.s1 })).toEqual(['s2']);
  });
});
