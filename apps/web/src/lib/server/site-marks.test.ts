import { describe, expect, it } from 'vitest';
import { markOfBasis, marksOfSnapshot } from './site-marks.ts';

describe('the editors’ marks of a version', () => {
  it('are those its snapshot recorded, by segment and place', () => {
    const marks = marksOfSnapshot([
      { segmentId: 's1', siteKey: 'a', kind: 'interpretative', personId: null, setAt: null },
      {
        segmentId: 's2',
        siteKey: 'b',
        minor: true,
        personId: 'p',
        setAt: '2026-01-01T00:00:00.000Z',
      },
      { segmentId: 's2', siteKey: 'c', personId: null, setAt: null },
    ]);
    expect([...marks.keys()]).toEqual(['s1', 's2']);
    expect(marks.get('s1')!.get('a')).toMatchObject({ kind: 'interpretative' });
    expect(marks.get('s2')!.get('b')).toEqual({
      minor: true,
      setAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    // A mark that says nothing is none.
    expect(marks.get('s2')!.has('c')).toBe(false);
  });

  it('read a mark of the earlier kind as the minor place it is', () => {
    expect(markOfBasis({ kind: 'unreported' })).toEqual({ minor: true });
    expect(markOfBasis({ kind: 'textual', minor: true })).toEqual({ kind: 'textual', minor: true });
    expect(markOfBasis({ minor: true })).toEqual({ minor: true });
    expect(markOfBasis({ kind: 'major' })).toEqual({});
    expect(markOfBasis({})).toEqual({});
  });
});
