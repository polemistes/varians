import { describe, expect, it } from 'vitest';
import { attachToSites, collate, type CollationText, type Unit } from '@varians/core';
import {
  alignedUnits,
  editionTokensAt,
  entriesBySegment,
  entryBySite,
  markSites,
  parseSiteKey,
  siteByToken,
  siteKey,
  witnessTokensAt,
  type SegmentSites,
} from './sites';

/** Units of a text, one token per word, ids prefixed by the text's id. */
function text(id: string, siglum: string, words: string): CollationText {
  const units: Unit[] = words
    .split(' ')
    .filter((w) => w)
    .map((w, i) => ({ text: w, tokenIds: [`${id}${i}`] }));
  return { id, siglum, units };
}

function segment(
  base: CollationText,
  witnesses: CollationText[],
  segmentId = 's1',
  label = '1.1',
): SegmentSites & { collation: ReturnType<typeof collate> } {
  return {
    segmentId,
    label,
    collation: collate(base, witnesses),
    baseUnits: base.units,
    attachments: {},
  };
}

describe('siteByToken', () => {
  it('maps every word of a site to it, and nothing else', () => {
    const ed = text('e', 'ed.', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω');
    const seg = segment(ed, [
      text('a', 'A', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω'),
      text('b', 'B', 'μῆνιν ἄειδε θεοί Πηλεΐδεω'),
    ]);
    const map = siteByToken({ segments: { s1: seg } });
    const sites = seg.collation.sites;
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      for (let i = site.baseFrom; i < site.baseTo; i++) {
        expect(map.get(`e${i}`)).toContainEqual({ segmentId: 's1', siteIndex: site.index });
      }
    }
    expect(map.has('e0')).toBe(false);
    expect(map.has('e1')).toBe(false);
  });

  it('reaches an addition through the word before it, or after it at the start', () => {
    const ed = text('e', 'ed.', 'ἄλγε ἔθηκε');
    const seg = segment(ed, [text('b', 'B', 'ἄλγε ἔθηκε πολλά')]);
    const addition = seg.collation.sites.find((s) => s.baseFrom === s.baseTo)!;
    expect(addition).toBeDefined();
    const map = siteByToken({ segments: [seg] });
    expect(map.get('e1')).toEqual([
      { segmentId: 's1', siteIndex: addition.index, insertion: true },
    ]);

    const atStart = segment(
      text('f', 'ed.', 'ἄλγε ἔθηκε'),
      [text('c', 'C', 'καὶ ἄλγε ἔθηκε')],
      's2',
    );
    const first = atStart.collation.sites.find((s) => s.baseFrom === s.baseTo)!;
    expect(siteByToken({ segments: [atStart] }).get('f0')).toEqual([
      { segmentId: 's2', siteIndex: first.index, insertion: true },
    ]);
    expect(editionTokensAt(atStart, first.index)).toEqual(['f0']);
  });

  it('keys sites by segment and index', () => {
    expect(siteKey('01ABC', 3)).toBe('01ABC:3');
    expect(parseSiteKey('01ABC:3')).toEqual({ segmentId: '01ABC', siteIndex: 3 });
    expect(parseSiteKey('nonsense')).toBeNull();
  });
});

describe('entries under the reader settings', () => {
  it('reports different words only: a grave for an acute is no variant', () => {
    const ed = text('e', 'ed.', 'ἄειδε θεὰ');
    const same = segment(ed, [text('a', 'A', 'ἄειδε θεὰ'), text('b', 'B', 'ἄειδε θεά')]);
    expect(
      entriesBySegment(
        { s1: same },
        { form: 'positive', latin: true, interpretative: 'separate' },
        ['A', 'B'],
      ).get('s1'),
    ).toEqual([]);
    const seg = segment(ed, [text('a', 'A', 'ἄειδε θεὰ'), text('b', 'B', 'ἄειδε θεοί')]);
    const segments = { s1: seg };
    const shown = entriesBySegment(
      segments,
      { form: 'negative', latin: true, interpretative: 'separate' },
      ['A', 'B'],
    );
    expect(shown.get('s1')).toHaveLength(1);
    const byKey = entryBySite(shown);
    expect([...byKey.keys()]).toEqual([siteKey('s1', shown.get('s1')![0]!.siteIndex)]);
  });
});

describe('witnessTokensAt', () => {
  it('gives the units a witness reading was read from, and nothing where it omits', () => {
    const ed = text('e', 'ed.', 'ἄλγε ἔθηκε κύνεσσιν');
    const seg = segment(ed, [text('b', 'B', 'ἄλγεα θῆκε κύνεσσιν'), text('c', 'C', 'κύνεσσιν')]);
    const site = seg.collation.sites[0]!;
    expect(witnessTokensAt(site, 'b')).toEqual(['b0', 'b1']);
    expect(witnessTokensAt(site, 'c')).toEqual([]);
    expect(witnessTokensAt(undefined, 'b')).toEqual([]);
  });

  it('finds the words of a witness at a site opened for a conjecture, through the alignment', () => {
    const ed = text('e', 'ed.', 'οἰωνοῖσί τε πᾶσι');
    const witness = text('a', 'A', 'οἰωνοῖσί τε πᾶσι');
    const collation = collate(ed, [witness]);
    expect(collation.sites).toHaveLength(0);
    const attached = attachToSites(collation, ed.units, [
      { id: 'z', kind: 'conjecture', lemma: 'πᾶσι', reading: 'δαῖτα', name: 'Zenodotus' },
    ]);
    const site = attached.collation.sites[0]!;
    expect(witnessTokensAt(site, 'a')).toEqual([]);
    const aligned = alignedUnits(collation, ed.units.length);
    expect(aligned).toEqual({ a: [0, 1, 2] });
    expect(witnessTokensAt(site, 'a', { aligned: aligned.a, units: witness.units })).toEqual([
      'a2',
    ]);
  });
});

describe('markSites', () => {
  it('marks the words of printed sites only, with their keys and one stop per site', () => {
    const ed = text('e', 'ed.', 'ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος οὐλομένην');
    const seg = segment(ed, [text('a', 'A', 'ἄειδε θεοί Πηληϊάδεω Ἀχιλλῆος οὐλομένην')]);
    expect(seg.collation.sites).toHaveLength(2);
    const segments = { s1: seg };
    const all = entryBySite(
      entriesBySegment(segments, { form: 'positive', latin: true, interpretative: 'separate' }, [
        'A',
      ]),
    );
    expect(all.size).toBe(2);
    const marking = markSites(siteByToken({ segments }), all, segments);
    for (const key of all.keys()) {
      const index = Number(key.split(':')[1]);
      const words = editionTokensAt(seg, index);
      expect(marking.tabStops.has(words[0]!)).toBe(true);
      for (const word of words) {
        expect(marking.marked.has(word)).toBe(true);
        expect(marking.keysOf.get(word)!.split(' ')).toContain(key);
      }
    }
  });
});
