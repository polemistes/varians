import { describe, expect, it } from 'vitest';
import type { MomentBasis, SiteKindMark } from '@varians/db';
import { marksAtPublication, marksForBasis } from './site-marks.ts';

const at = (iso: string) => new Date(iso);
const marks = (rows: [string, string, SiteKindMark, string][]) => {
  const out = new Map<string, Map<string, { kind: SiteKindMark; setAt: Date }>>();
  for (const [segmentId, siteKey, kind, setAt] of rows) {
    const bySite = out.get(segmentId) ?? new Map();
    bySite.set(siteKey, { kind, setAt: at(setAt) });
    out.set(segmentId, bySite);
  }
  return out;
};
const basis = (siteKinds?: MomentBasis['siteKinds']): MomentBasis => ({
  sigla: [],
  versions: {},
  ...(siteKinds ? { siteKinds } : {}),
});

describe('the editors’ marks of a published version', () => {
  const current = marks([
    ['s2', 'b', 'unreported', '2026-01-01T00:00:00Z'],
    ['s1', 'a', 'interpretative', '2026-01-01T00:00:00Z'],
    ['s1', 'c', 'unreported', '2026-03-01T00:00:00Z'],
  ]);

  it('are recorded by a publication, in a stable order', () => {
    expect(marksForBasis(current)).toEqual([
      { segmentId: 's1', siteKey: 'a', kind: 'interpretative' },
      { segmentId: 's1', siteKey: 'c', kind: 'unreported' },
      { segmentId: 's2', siteKey: 'b', kind: 'unreported' },
    ]);
    expect(marksForBasis(new Map())).toEqual([]);
  });

  it('are those the publication recorded, whatever the editors have done since', () => {
    const recorded = basis([{ segmentId: 's1', siteKey: 'a', kind: 'unreported' }]);
    const read = marksAtPublication(current, recorded, at('2026-02-01T00:00:00Z'));
    expect([...read.keys()]).toEqual(['s1']);
    expect(read.get('s1')!.get('a')!.kind).toBe('unreported');
    // Nothing recorded is nothing marked, not what is marked now.
    expect(marksAtPublication(current, basis([]), at('2026-02-01T00:00:00Z')).size).toBe(0);
  });

  it('are, for a version published before they were recorded, those set before it', () => {
    const read = marksAtPublication(current, basis(), at('2026-02-01T00:00:00Z'));
    expect([...read.get('s1')!.keys()]).toEqual(['a']);
    expect([...read.get('s2')!.keys()]).toEqual(['b']);
  });
});
