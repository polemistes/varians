import { describe, expect, it } from 'vitest';
import {
  attachToSites,
  collate,
  fromText,
  sequentialIds,
  siteKey,
  siteTokenIds,
  units,
  type Token,
} from '@varians/core';
import { countUnreviewed, needsReview } from './adopt-client.ts';
import { countNeeding, outlineOf } from './outline.ts';
import type { SegmentViewClient } from './types.ts';
import { siteShows, stepSite, tokenClassesFor } from './workspace.ts';

function segment(
  segmentId: string,
  editionText: string,
  witnesses: Record<string, string>,
  extra: Partial<SegmentViewClient> = {},
): SegmentViewClient {
  const stream = fromText(editionText, { ids: sequentialIds(`${segmentId}e`) });
  (stream.items[0] as Token).segment = { segmentId };
  const baseUnits = units(stream, 0, stream.items.length);
  const texts = Object.entries(witnesses).map(([siglum, text]) => {
    const s = fromText(text, { ids: sequentialIds(`${segmentId}${siglum}`) });
    return { id: siglum, siglum, units: units(s, 0, s.items.length) };
  });
  const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, texts);
  return {
    segmentId,
    label: segmentId,
    segments: [{ segmentId, label: segmentId, from: 0, to: baseUnits.length, printed: true }],
    collation,
    baseUnits,
    siteSegments: Object.fromEntries(collation.sites.map((s) => [s.index, [segmentId]])),
    entries: [],
    attachments: {},
    unplaced: [],
    absent: [],
    notes: [],
    ...extra,
  };
}

describe('outlineOf', () => {
  const plain = segment('s1', 'the quick brown fox', {
    B: 'the slow fox',
    C: 'the quick brown fox',
  });
  const agreeing = segment('s2', 'one two three', { B: 'one two three' });

  it('keeps the places that show, with their words and keys, in the order they stand', () => {
    const outline = outlineOf(plain);
    const shown = plain.collation.sites.filter((site) => siteShows(plain, site));
    expect(shown.length).toBeGreaterThan(0);
    expect(outline.sites.map((s) => s.index).sort()).toEqual(shown.map((s) => s.index).sort());
    for (const site of outline.sites) {
      const full = plain.collation.sites.find((x) => x.index === site.index)!;
      expect(site.tokens).toEqual(siteTokenIds(full, plain.baseUnits));
      expect(site.key).toBe(siteKey(full, plain.baseUnits));
      expect([site.baseFrom, site.baseTo]).toEqual([full.baseFrom, full.baseTo]);
    }
    const starts = outline.sites.map((s) => s.baseFrom);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(outlineOf(agreeing).sites).toEqual([]);
  });

  it('shows a place that has only a conjecture, which needs attention until it is adopted', () => {
    const agreed = segment('s3', 'the quick brown fox', { B: 'the quick brown fox' });
    // A conjecture on words the witnesses agree about makes a place of its own.
    const attached = attachToSites(
      agreed.collation,
      agreed.baseUnits,
      [
        {
          id: 'c1',
          kind: 'conjecture',
          lemma: 'quick',
          reading: 'swift',
          name: 'Bentley',
          conjectureKind: 'substitution',
        },
      ],
      { caseFold: true, stripPunctuation: true, stripDiacritics: false, latinUV: false },
    );
    const withConjecture = {
      ...agreed,
      collation: attached.collation,
      attachments: attached.bySite,
    };
    const [site] = outlineOf(withConjecture).sites;
    expect(outlineOf(withConjecture).sites).toHaveLength(1);
    expect([site!.tokens, site!.needs]).toEqual([['s3e2'], true]);
    const adopted = {
      ...withConjecture,
      attachments: Object.fromEntries(
        Object.entries(attached.bySite).map(([i, list]) => [
          i,
          list.map((a) => ({ ...a, adopted: true })),
        ]),
      ),
    };
    expect(outlineOf(adopted).sites.map((s) => s.needs)).toEqual([false]);
  });

  it('names the words that have drifted from their source', () => {
    const drifting = { ...plain, drift: [{ tokenId: 's1e2' }, { tokenId: 's1e3' }] };
    expect(outlineOf(drifting).drift).toEqual(['s1e2', 's1e3']);
    expect(outlineOf(plain).drift).toEqual([]);
  });

  it('marks the same words as the segments themselves would, and steps and counts as they did', () => {
    const segments = [plain, agreeing, segment('s3', 'a b c', { B: 'a x c', C: 'a b' })];
    const outlines = Object.fromEntries(segments.map((s) => [s.segmentId, outlineOf(s)]));
    const classes = tokenClassesFor(Object.values(outlines), {
      active: { segmentId: 's1', siteIndex: outlines.s1!.sites[0]!.index },
    });
    // The words of every site that shows are marked, those of no other.
    const expected = new Set<string>();
    for (const s of segments)
      for (const site of s.collation.sites)
        if (siteShows(s, site)) for (const id of siteTokenIds(site, s.baseUnits)) expected.add(id);
    expect(new Set(Object.keys(classes))).toEqual(expected);
    // The count of places needing attention is the one the segments gave.
    const reviewed = new Map([['s1', new Set([outlines.s1!.sites[0]!.key])]]);
    expect(countNeeding(outlines, reviewed)).toBe(countUnreviewed(segments, reviewed));
    expect(countNeeding(outlines, new Map())).toBe(
      segments.reduce(
        (n, s) =>
          n + s.collation.sites.filter((site) => needsReview(s, site, new Set<string>())).length,
        0,
      ),
    );
    // Stepping goes over the places in the order of the text, and round again.
    const order = ['s1', 's2', 's3'];
    const seen: string[] = [];
    let active: { segmentId: string; siteIndex: number } | null = null;
    for (let i = 0; i < 20; i++) {
      const next = stepSite(order, outlines, active, 1, {});
      if (!next) break;
      seen.push(`${next.segmentId}:${next.site.index}`);
      active = { segmentId: next.segmentId, siteIndex: next.site.index };
    }
    const places = order.flatMap((id) => outlines[id]!.sites.map((s) => `${id}:${s.index}`));
    expect(seen.slice(0, places.length)).toEqual(places);
    expect(seen[places.length]).toBe(places[0]);
  });
});
