import { describe, expect, it } from 'vitest';
import type { MomentBasis } from '@varians/db';
import { basisForArchive, markOfBasis, marksAtPublication, marksForBasis } from './site-marks.ts';
import type { Marks } from './site-marks.ts';

const at = (iso: string) => new Date(iso);
const marks = (
  rows: [string, string, { kind?: 'textual' | 'interpretative'; minor?: true }, string][],
) => {
  const out: Marks = new Map();
  for (const [segmentId, siteKey, mark, setAt] of rows) {
    const bySite = out.get(segmentId) ?? new Map();
    bySite.set(siteKey, { ...mark, setAt: at(setAt) });
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
    ['s2', 'b', { minor: true }, '2026-01-01T00:00:00Z'],
    ['s1', 'a', { kind: 'interpretative' }, '2026-01-01T00:00:00Z'],
    ['s1', 'c', { kind: 'textual', minor: true }, '2026-03-01T00:00:00Z'],
  ]);

  it('are recorded by a publication, in a stable order, each word only when it is said', () => {
    expect(marksForBasis(current)).toEqual([
      { segmentId: 's1', siteKey: 'a', kind: 'interpretative' },
      { segmentId: 's1', siteKey: 'c', kind: 'textual', minor: true },
      { segmentId: 's2', siteKey: 'b', minor: true },
    ]);
    expect(marksForBasis(new Map())).toEqual([]);
  });

  it('are those the publication recorded, whatever the editors have done since', () => {
    const recorded = basis([{ segmentId: 's1', siteKey: 'a', kind: 'textual', minor: true }]);
    const read = marksAtPublication(current, recorded, at('2026-02-01T00:00:00Z'));
    expect([...read.keys()]).toEqual(['s1']);
    expect(read.get('s1')!.get('a')).toMatchObject({ kind: 'textual', minor: true });
    // Nothing recorded is nothing marked, not what is marked now.
    expect(marksAtPublication(current, basis([]), at('2026-02-01T00:00:00Z')).size).toBe(0);
  });

  it('are, for a version published before they were recorded, those set before it', () => {
    const read = marksAtPublication(current, basis(), at('2026-02-01T00:00:00Z'));
    expect([...read.get('s1')!.keys()]).toEqual(['a']);
    expect([...read.get('s2')!.keys()]).toEqual(['b']);
  });

  it('say minor where a basis of the first marks says `unreported`', () => {
    const recorded = basis([
      { segmentId: 's1', siteKey: 'a', kind: 'unreported' },
      { segmentId: 's1', siteKey: 'b', kind: 'interpretative' },
    ]);
    const read = marksAtPublication(current, recorded, at('2026-02-01T00:00:00Z'));
    expect(read.get('s1')!.get('a')).toEqual({ minor: true, setAt: at('2026-02-01T00:00:00Z') });
    expect(read.get('s1')!.get('b')).toEqual({
      kind: 'interpretative',
      setAt: at('2026-02-01T00:00:00Z'),
    });
    expect(basisForArchive(recorded)!.siteKinds).toEqual([
      { segmentId: 's1', siteKey: 'a', minor: true },
      { segmentId: 's1', siteKey: 'b', kind: 'interpretative' },
    ]);
    expect(basisForArchive(basis())).toEqual(basis());
    expect(basisForArchive(null)).toBeNull();
  });

  it('are read from an archive entry as what it says, and nothing from one that says nothing', () => {
    expect(markOfBasis({ kind: 'unreported' })).toEqual({ minor: true });
    expect(markOfBasis({ kind: 'textual', minor: true })).toEqual({ kind: 'textual', minor: true });
    expect(markOfBasis({ minor: true })).toEqual({ minor: true });
    expect(markOfBasis({ kind: 'major' })).toEqual({});
    expect(markOfBasis({})).toEqual({});
  });
});
