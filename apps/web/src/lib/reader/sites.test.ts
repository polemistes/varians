import { describe, expect, it } from 'vitest';
import {
  applySiteKinds,
  attachToSites,
  collate,
  siteKey as coreSiteKey,
  type Attachment,
  type CollationText,
  type Unit,
} from '@varians/core';
import {
  alignedUnits,
  anyMinor,
  editionTokensAt,
  entriesBySegment,
  entryBySite,
  markSites,
  minorAsOthers,
  parseSiteKey,
  siteByToken,
  siteKey,
  withMinor,
  withoutMinor,
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

describe('a minor variant', () => {
  /** Two places, the first of which is marked minor. */
  function marked() {
    const ed = text('e', 'ed.', 'red fox runs');
    const seg = segment(ed, [text('a', 'A', 'red dog runs'), text('b', 'B', 'red fox walks')]);
    const dog = seg.collation.sites.find((site) => site.readings.some((r) => r.text === 'dog'))!;
    const collation = applySiteKinds(
      seg.collation,
      ed.units,
      new Map([[coreSiteKey(dog, ed.units), { minor: true }]]),
    );
    const attachment: Attachment = { kind: 'conjecture', id: 'c1', text: 'cat', name: 'Quill' };
    return {
      dog,
      segments: {
        s1: {
          ...seg,
          collation,
          attachments: { [dog.index]: [attachment] },
        },
      },
    };
  }
  const conventions = {
    form: 'positive' as const,
    latin: true,
    interpretative: 'separate' as const,
  };

  it('has no print entry and so no marked words, though its site is still in the data', () => {
    const { dog, segments } = marked();
    const entries = entryBySite(entriesBySegment(segments, conventions, ['A', 'B']));
    expect([...entries.keys()]).toHaveLength(1);
    expect(entries.has(siteKey('s1', dog.index))).toBe(false);
    const marking = markSites(siteByToken({ segments }), entries, segments);
    expect(marking.marked.has('e1')).toBe(false);
    expect(marking.marked.has('e2')).toBe(true);
  });

  it('is left out, with what stood at it, of a page that has not asked for it', () => {
    const { dog, segments } = marked();
    const given = withoutMinor(segments.s1);
    expect(given.collation.sites.map((site) => site.index)).not.toContain(dog.index);
    expect(given.collation.sites).toHaveLength(segments.s1.collation.sites.length - 1);
    expect(given.attachments).toEqual({});
    // The segment as it was sent is left as it is, and a segment with no such place is the same object.
    expect(segments.s1.collation.sites.some((site) => site.minor)).toBe(true);
    const plain = segment(text('e', 'ed.', 'a b'), [text('a', 'A', 'a c')]);
    expect(withoutMinor(plain)).toBe(plain);
    expect(minorAsOthers(plain)).toBe(plain);
  });

  it('stands like any other place of a page that has asked for it, which the print apparatus still leaves out', () => {
    const { dog, segments } = marked();
    expect(anyMinor(segments)).toBe(true);
    expect(anyMinor(withMinor(segments, false))).toBe(false);
    const shown = withMinor(segments, true);
    expect(anyMinor(shown)).toBe(false);
    expect(shown.s1.collation.sites).toHaveLength(segments.s1.collation.sites.length);
    expect(shown.s1.attachments[dog.index]).toHaveLength(1);
    const entries = entryBySite(entriesBySegment(shown, conventions, ['A', 'B']));
    expect(entries.has(siteKey('s1', dog.index))).toBe(true);
    expect(markSites(siteByToken({ segments: shown }), entries, shown).marked.has('e2')).toBe(true);
    // The sent segments, whose sites keep their flag, print nothing of it.
    expect(entriesBySegment(segments, conventions, ['A', 'B']).get('s1')).toHaveLength(1);
    // Taking the flag off leaves the sent site as it was.
    expect(segments.s1.collation.sites.find((site) => site.index === dog.index)!.minor).toBe(true);
  });
});
