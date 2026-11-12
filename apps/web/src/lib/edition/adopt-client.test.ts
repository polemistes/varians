import { describe, expect, it } from 'vitest';
import {
  applyOps,
  collate,
  fromText,
  sequentialIds,
  toText,
  units,
  type Attachment,
} from '@varians/core';
import {
  countUnreviewed,
  insertionSitesAfter,
  keyOfSite,
  needsReview,
  opsForAttachment,
  opsForReading,
  sitesByToken,
  type SegmentForAdoption,
} from './adopt-client.ts';

function segment(
  editionText: string,
  witnessTexts: Record<string, string>,
  attachments: Record<number, Attachment[]> = {},
) {
  const edition = fromText(editionText, { lang: 'grc', ids: sequentialIds('e') });
  const baseUnits = units(edition, 0, edition.items.length);
  const witnesses = Object.entries(witnessTexts).map(([siglum, text]) => {
    const s = fromText(text, { lang: 'grc', ids: sequentialIds(siglum) });
    return { id: siglum, siglum, units: units(s, 0, s.items.length) };
  });
  const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, witnesses);
  const seg: SegmentForAdoption = { segmentId: 's1', collation, baseUnits, attachments };
  return { edition, seg };
}

describe('adopt-client', () => {
  it('maps tokens to their sites and adopts a reading', () => {
    const { edition, seg } = segment('the quick brown fox', { B: 'the slow fox' });
    const map = sitesByToken([seg]);
    expect(map.get('e2')?.site.index).toBe(0);
    expect(map.get('e3')?.site.index).toBe(0);
    expect(map.has('e1')).toBe(false);
    const site = seg.collation.sites[0]!;
    const reading = site.readings.find((r) => r.sigla.includes('B'))!;
    const next = applyOps(edition, opsForReading(edition, seg, site, reading, 'B')).stream;
    expect(toText(next)).toBe('the slow fox');
  });

  it('adopts a conjecture attachment and a reported reading', () => {
    const conj: Attachment = {
      kind: 'conjecture',
      id: 'c1',
      text: 'swift',
      name: 'Bentley',
      conjectureKind: 'substitution',
    };
    const { edition, seg } = segment('the quick fox', { B: 'the slow fox' }, { 0: [conj] });
    const site = seg.collation.sites[0]!;
    expect(toText(applyOps(edition, opsForAttachment(edition, seg, site, conj)).stream)).toBe(
      'the swift fox',
    );
    const reported: Attachment = { kind: 'reported', id: 'r1', text: 'rapid', name: 'T' };
    expect(toText(applyOps(edition, opsForAttachment(edition, seg, site, reported)).stream)).toBe(
      'the rapid fox',
    );
  });

  it('gives the words of a conjecture and of a reported reading the language of the place', () => {
    const conj: Attachment = {
      kind: 'conjecture',
      id: 'c1',
      text: 'ὠκύς',
      name: 'Bentley',
      conjectureKind: 'substitution',
    };
    const reported: Attachment = { kind: 'reported', id: 'r1', text: 'ταχύς ποδ', name: 'T' };
    const { edition, seg } = segment('ὁ βραδύς ἵππος', { B: 'ὁ ταχύς ἵππος' }, { 0: [conj] });
    const site = seg.collation.sites[0]!;
    for (const attachment of [conj, reported]) {
      const next = applyOps(edition, opsForAttachment(edition, seg, site, attachment)).stream;
      const langs = next.items.map((item) => (item.kind === 'token' ? item.lang : null));
      expect(langs.every((lang) => lang === 'grc')).toBe(true);
    }
  });

  it('adopts a deletion by marking the words for brackets, not removing them', () => {
    const del: Attachment = {
      kind: 'conjecture',
      id: 'c9',
      text: '',
      name: 'Bentley',
      conjectureKind: 'deletion',
    };
    const { edition, seg } = segment('the quick fox', { B: 'the slow fox' }, { 0: [del] });
    const site = seg.collation.sites[0]!;
    const next = applyOps(edition, opsForAttachment(edition, seg, site, del)).stream;
    expect(toText(next)).toBe('the quick fox');
    expect((next.items[1] as { marks?: unknown }).marks).toEqual([
      { kind: 'surplus', attrs: { resp: 'c9' } },
    ]);
  });

  it('finds insertion sites after a token and counts what needs review', () => {
    const { seg } = segment('the quick fox', { C: 'the quick brown fox', D: 'the quick fox' });
    const after = insertionSitesAfter(seg, 'e2');
    expect(after).toHaveLength(1);
    const reviewed = new Map<string, Set<string>>();
    expect(countUnreviewed([seg], reviewed)).toBe(1);
    reviewed.set('s1', new Set([keyOfSite(seg, after[0]!)]));
    expect(countUnreviewed([seg], reviewed)).toBe(0);
    expect(needsReview(seg, after[0]!, reviewed.get('s1')!)).toBe(false);
  });

  it('does not count a variant the editor judges minor', () => {
    const { seg } = segment('the quick fox', { C: 'the quick brown fox', D: 'the slow fox' });
    expect(countUnreviewed([seg], new Map())).toBe(2);
    const sites = seg.collation.sites.map((site, i) => (i === 0 ? { ...site, minor: true } : site));
    const left = { ...seg, collation: { ...seg.collation, sites } };
    expect(countUnreviewed([left], new Map())).toBe(1);
    expect(needsReview(left, sites[0]!, new Set())).toBe(false);
  });

  it('does not count orthographic differences as needing review', () => {
    const { seg } = segment('μῆνιν ἄειδε θεὰ', { A: 'μῆνιν ἄειδε θεά' });
    expect(countUnreviewed([seg], new Map())).toBe(0);
  });
});
