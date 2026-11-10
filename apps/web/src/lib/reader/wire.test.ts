import { describe, expect, it } from 'vitest';
import { collate, fromText, sequentialIds, units, type Collation } from '@varians/core';
import {
  detailOf,
  packSegments,
  unpackSegment,
  unpackSegments,
  withDetail,
  type PackableSegment,
} from './wire.ts';
import { alignedUnits, entriesBySegment } from './sites.ts';

function packable(
  segmentId: string,
  editionText: string,
  witnesses: Record<string, string | null>,
): { segment: PackableSegment; collation: Collation } {
  const edition = fromText(editionText, { ids: sequentialIds(`${segmentId}e`) });
  const baseUnits = units(edition, 0, edition.items.length);
  const texts = Object.entries(witnesses).map(([siglum, text]) => {
    if (text === null) return { id: `t${siglum}`, siglum, units: [], present: true };
    const s = fromText(text, { ids: sequentialIds(`${segmentId}${siglum}`) });
    return { id: `t${siglum}`, siglum, units: units(s, 0, s.items.length) };
  });
  const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, texts);
  return {
    collation,
    segment: {
      segmentId,
      label: segmentId,
      collation,
      baseUnits,
      attachments: {},
      unplaced: [],
      absent: [],
      notes: [{ id: 'n', tokenIds: [`${segmentId}e1`], text: 'a note', author: null, cites: [] }],
      cites: { c: ['cf. X'] },
    },
  };
}

describe('packSegments and unpackSegments', () => {
  const one = packable('s1', 'the quick brown fox', {
    B: 'the slow fox',
    C: 'the quick brown fox jumps',
    D: 'fox brown quick the',
    E: null,
  });
  const two = packable('s2', 'over the lazy dog', { B: 'over a lazy dog', C: 'over the lazy dog' });

  it('names the texts once and gives the page back every reading with its texts, sigla and flags', () => {
    const { segments, texts } = packSegments([one.segment, two.segment]);
    // Each text of the collations is named once, though many readings and both segments name it.
    expect(new Set(texts.map(([id, siglum]) => `${id}|${siglum}`)).size).toBe(texts.length);
    expect(texts.filter(([id]) => id === 'tB')).toHaveLength(1);
    const back = unpackSegments(segments, texts, 'E');
    for (const [original, id] of [
      [one, 's1'],
      [two, 's2'],
    ] as const) {
      const sites = original.collation.sites;
      expect(back[id]!.collation.sites).toHaveLength(sites.length);
      sites.forEach((site, i) => {
        const got = back[id]!.collation.sites[i]!;
        expect([got.index, got.baseFrom, got.baseTo, got.kind, got.wanting]).toEqual([
          site.index,
          site.baseFrom,
          site.baseTo,
          site.kind,
          site.wanting,
        ]);
        expect(got.transposition).toEqual(site.transposition);
        site.readings.forEach((reading, k) => {
          const r = got.readings[k]!;
          expect([r.text, r.fold, r.textIds, r.sigla, r.omission, r.lacunose, r.base]).toEqual([
            reading.text,
            reading.fold,
            reading.textIds,
            reading.sigla,
            reading.omission,
            reading.lacunose,
            reading.base,
          ]);
          expect(r.units).toEqual({});
        });
      });
      expect(back[id]!.baseUnits).toEqual(original.segment.baseUnits);
      expect(back[id]!.collation.baseId).toBe('E');
      expect(back[id]!.notes).toEqual(original.segment.notes);
      expect(back[id]!.cites).toEqual(original.segment.cites);
    }
  });

  it('prints the same apparatus from what was sent as from the full collation', () => {
    const { segments, texts } = packSegments([one.segment]);
    const back = unpackSegment(segments.s1!, texts, 'E');
    const conventions = { form: 'positive', latin: true, interpretative: 'separate' } as const;
    const order = ['A', 'B', 'C', 'D', 'E'];
    const printed = (segment: PackableSegment) =>
      entriesBySegment({ s1: { ...segment, attachments: {} } }, conventions, order).get('s1');
    // The reader has never had the columns of the collation, and prints without them.
    const asReaderHadIt = {
      ...one.segment,
      collation: { ...one.collation, columns: [] },
    };
    expect(printed(back)).toEqual(printed(asReaderHadIt));
    expect(printed(back)!.length).toBeGreaterThan(0);
  });

  it('puts the units and the alignment back from the detail of a segment', () => {
    const { segments, texts } = packSegments([one.segment]);
    const back = unpackSegment(segments.s1!, texts, 'E');
    const aligned = alignedUnits(one.collation, one.segment.baseUnits.length);
    const full = withDetail(back, detailOf(one.collation, aligned));
    expect(full.aligned).toEqual(aligned);
    full.collation.sites.forEach((site, i) =>
      site.readings.forEach((reading, k) =>
        expect(reading.units).toEqual(one.collation.sites[i]!.readings[k]!.units),
      ),
    );
    // And the segment as it was sent is not changed by it.
    expect(back.collation.sites[0]!.readings[0]!.units).toEqual({});
  });

  it('is much smaller than the collation it replaces', () => {
    const { segments, texts } = packSegments([one.segment]);
    const sent = JSON.stringify({ segments, texts }).length;
    const full = JSON.stringify(one.collation.sites).length;
    expect(sent).toBeLessThan(full);
  });
});
