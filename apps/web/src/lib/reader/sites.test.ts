import { describe, expect, it } from 'vitest';
import {
  applySiteKinds,
  attachToSites,
  collate,
  siteKey as coreSiteKey,
  type Attachment,
  type CollationText,
  type Site,
  type Unit,
} from '@varians/core';
import {
  alignedUnits,
  editionTokensAt,
  entriesBySegment,
  entryBySite,
  isOrderKey,
  markSites,
  orderKey,
  parseOrderKey,
  parseSiteKey,
  shownSites,
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

  it('leaves the words beside a point between two words unmarked: the point has its own mark', () => {
    const ed = text('e', 'ed.', 'ἄλγε ἔθηκε');
    const seg = segment(ed, [text('b', 'B', 'ἄλγε ἔθηκε πολλά')]);
    const addition = seg.collation.sites.find((s) => s.baseFrom === s.baseTo)!;
    expect(addition).toBeDefined();
    expect(siteByToken({ segments: [seg] }).size).toBe(0);
    expect(editionTokensAt(seg, addition.index)).toEqual(['e1']);

    const atStart = segment(
      text('f', 'ed.', 'ἄλγε ἔθηκε'),
      [text('c', 'C', 'καὶ ἄλγε ἔθηκε')],
      's2',
    );
    const first = atStart.collation.sites.find((s) => s.baseFrom === s.baseTo)!;
    expect(siteByToken({ segments: [atStart] }).size).toBe(0);
    expect(editionTokensAt(atStart, first.index)).toEqual(['f0']);
  });

  it('keys sites by segment and index', () => {
    expect(siteKey('01ABC', 3)).toBe('01ABC:3');
    expect(parseSiteKey('01ABC:3')).toEqual({ segmentId: '01ABC', siteIndex: 3 });
    expect(parseSiteKey('nonsense')).toBeNull();
  });

  it('keys the variants over the order of whole segments apart from the sites', () => {
    expect(orderKey(2)).toBe('order:2');
    expect(parseOrderKey('order:2')).toBe(2);
    expect(isOrderKey('order:0')).toBe(true);
    expect(isOrderKey('01ABC:3')).toBe(false);
    expect(parseOrderKey('order:x')).toBeNull();
    expect(parseSiteKey('order:2')).toBeNull();
  });

  it('leaves out the site over a whole line that some witnesses do not have: it is marked in the margin, and its words keep their own variants', () => {
    const ed = text('e', 'ed.', 'μῆνιν ἄειδε θεὰ');
    const seg = segment(ed, [
      text('a', 'A', 'μῆνιν ἄειδε θεός'),
      { ...text('b', 'B', ''), present: true },
    ]);
    const whole = seg.collation.sites.find((site) => site.wanting)!;
    const own = seg.collation.sites.find((site) => !site.wanting)!;
    expect(whole).toBeDefined();
    const map = siteByToken({ segments: { s1: seg } });
    expect([...map.keys()]).toEqual(['e2']);
    expect(map.get('e2')).toEqual([{ segmentId: 's1', siteIndex: own.index }]);

    const entries = new Map([
      [siteKey('s1', whole.index), {}],
      [siteKey('s1', own.index), {}],
    ]);
    const marking = markSites(map, entries, { s1: seg });
    expect([...marking.marked]).toEqual(['e2']);
    expect(marking.keysOf.get('e2')).toBe(siteKey('s1', own.index));
    // The first word of the line is no stop for the variant over the whole of it.
    expect([...marking.tabStops]).toEqual(['e2']);
  });
});

describe('variants over whole segments in prose', () => {
  const ed = text('e', 'ed.', 'μῆνιν ἄειδε θεὰ');
  const wholeSegment = () =>
    segment(ed, [text('a', 'A', 'μῆνιν ἄειδε θεὰ'), { ...text('b', 'B', ''), present: true }]);

  it('marks the words of the segment that stand in prose, with one stop, and leaves those in verse to the margin', () => {
    const seg = wholeSegment();
    const whole = seg.collation.sites.find((site) => site.wanting)!;
    const key = siteKey('s1', whole.index);
    // The first two words stand in verse, the last in prose.
    const prose = new Set(['e2']);
    const map = siteByToken({ segments: { s1: seg } }, prose);
    expect([...map.keys()]).toEqual(['e2']);
    expect(map.get('e2')).toEqual([{ segmentId: 's1', siteIndex: whole.index }]);
    const marking = markSites(map, new Map([[key, {}]]), { s1: seg }, prose);
    expect([...marking.marked]).toEqual(['e2']);
    expect(marking.keysOf.get('e2')).toBe(key);
    expect([...marking.tabStops]).toEqual(['e2']);
    // All in prose: every word, the first the stop.
    const all = siteByToken({ segments: { s1: seg } }, new Set(['e0', 'e1', 'e2']));
    expect([...all.keys()]).toEqual(['e0', 'e1', 'e2']);
    const every = markSites(all, new Map([[key, {}]]), { s1: seg }, new Set(['e0', 'e1', 'e2']));
    expect([...every.tabStops]).toEqual(['e0']);
  });

  /** A passage of the segment s1 (words e0 to e2) and the segment u the edition does not print after it. */
  function withUnprintedSegment(): SegmentSites {
    return {
      segmentId: 's1',
      label: '1.1',
      segments: [
        { segmentId: 's1', from: 0, to: 3, printed: true },
        { segmentId: 'u', from: 3, to: 3, printed: false },
      ],
      siteSegments: { 0: ['u'] },
      collation: { sites: [{ index: 0, baseFrom: 3, baseTo: 3 } as Site] },
      baseUnits: ed.units,
      attachments: {},
    };
  }

  it('marks a segment the edition does not print at the point after the last word of the segment before it, in prose only', () => {
    const seg = withUnprintedSegment();
    const entries = new Map([['s1:0', {}]]);
    const margin = markSites(siteByToken({ segments: [seg] }), entries, { s1: seg });
    expect(margin.after.size + margin.before.size).toBe(0);
    const found = markSites(
      siteByToken({ segments: [seg] }),
      entries,
      { s1: seg },
      new Set(['e2']),
    );
    expect([...found.after]).toEqual([['e2', { keys: 's1:0', side: 'after', word: 'θεὰ' }]]);
    // A segment before it that ends in verse is marked in the margin, whatever else is prose.
    const elsewhere = markSites(
      siteByToken({ segments: [seg] }),
      entries,
      { s1: seg },
      new Set(['e0']),
    );
    expect(elsewhere.after.size).toBe(0);
  });
});

describe('the marks at points between two words', () => {
  const printed = (segments: Record<string, ReturnType<typeof segment>>) =>
    markSites(siteByToken({ segments }), shownSites(segments, true), segments);

  it('follows the word before the point, and is no stop of a word', () => {
    const ed = text('e', 'ed.', 'ἄλγε ἔθηκε κύνεσσιν');
    const seg = segment(ed, [text('b', 'B', 'ἄλγε πολλά ἔθηκε κύνεσσιν')]);
    const point = seg.collation.sites.find((s) => s.baseFrom === s.baseTo)!;
    const marking = printed({ s1: seg });
    expect([...marking.after]).toEqual([
      ['e0', { keys: `s1:${point.index}`, side: 'after', word: 'ἄλγε' }],
    ]);
    expect(marking.before.size).toBe(0);
    expect(marking.marked.size).toBe(0);
    expect(marking.tabStops.size).toBe(0);
  });

  it('precedes the first word at the start of a segment, and follows the last at its end', () => {
    const ed = text('e', 'ed.', 'ἄλγε ἔθηκε');
    const seg = segment(ed, [
      text('b', 'B', 'καὶ ἄλγε ἔθηκε'),
      text('c', 'C', 'ἄλγε ἔθηκε πολλά,'),
    ]);
    const marking = printed({ s1: seg });
    expect([...marking.before].map(([id, mark]) => [id, mark.side, mark.word])).toEqual([
      ['e0', 'before', 'ἄλγε'],
    ]);
    expect([...marking.after].map(([id, mark]) => [id, mark.side, mark.word])).toEqual([
      ['e1', 'after', 'ἔθηκε'],
    ]);
  });

  it('keeps the keys of two variants at one point together', () => {
    const seg = segment(text('e', 'ed.', 'a b'), []);
    const reading = (ids: string[], words: string) => ({
      text: words,
      fold: words,
      textIds: ids,
      sigla: ids,
      units: {},
      omission: words === '',
      lacunose: false,
      base: ids[0] === 'e',
    });
    const site = (index: number) => ({
      index,
      columnFrom: 0,
      columnTo: 0,
      baseFrom: 1,
      baseTo: 1,
      kind: 'textual' as const,
      readings: [reading(['e'], ''), reading(['a'], 'x')],
    });
    const two = { ...seg, collation: { ...seg.collation, sites: [site(0), site(1)] } };
    const marking = markSites(
      siteByToken({ segments: { s1: two } }),
      new Map([
        ['s1:0', {}],
        ['s1:1', {}],
      ]),
      { s1: two },
    );
    expect(marking.after.get('e0')!.keys).toBe('s1:0 s1:1');
  });
});

describe('the entries of the print apparatus of a page', () => {
  it('reports different words only: a grave for an acute is no variant', () => {
    const ed = text('e', 'ed.', 'ἄειδε θεὰ');
    const same = segment(ed, [text('a', 'A', 'ἄειδε θεὰ'), text('b', 'B', 'ἄειδε θεά')]);
    expect(
      entriesBySegment({ s1: same }, { form: 'positive', interpretative: 'separate' }, [
        'A',
        'B',
      ]).get('s1'),
    ).toEqual([]);
    const seg = segment(ed, [text('a', 'A', 'ἄειδε θεὰ'), text('b', 'B', 'ἄειδε θεοί')]);
    const segments = { s1: seg };
    const shown = entriesBySegment(segments, { form: 'negative', interpretative: 'separate' }, [
      'A',
      'B',
    ]);
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
    const all = shownSites(segments, true);
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
    interpretative: 'separate' as const,
  };

  it('is not shown and so marks no words, though its site is still in the data', () => {
    const { dog, segments } = marked();
    // The page works with the segments it was sent, less the minor variants.
    const asked = withMinor(segments, false);
    const shown = shownSites(asked, true);
    expect([...shown]).toHaveLength(1);
    expect(shown.has(siteKey('s1', dog.index))).toBe(false);
    const marking = markSites(siteByToken({ segments: asked }), shown, asked);
    expect(marking.marked.has('e1')).toBe(false);
    expect(marking.marked.has('e2')).toBe(true);
    // The print apparatus leaves it out by its flag.
    expect(entriesBySegment(segments, conventions, ['A', 'B']).get('s1')).toHaveLength(1);
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
  });

  it('stands in a page that has asked for it, flagged, and listed like any other', () => {
    const { dog, segments } = marked();
    const shown = withMinor(segments, true);
    // The flag stays, so that the window can say the place is minor.
    expect(shown.s1.collation.sites.some((site) => site.minor)).toBe(true);
    expect(shown.s1.collation.sites).toHaveLength(segments.s1.collation.sites.length);
    expect(shown.s1.attachments[dog.index]).toHaveLength(1);
    const sites = shownSites(shown, true);
    expect(sites.has(siteKey('s1', dog.index))).toBe(true);
    expect(markSites(siteByToken({ segments: shown }), sites, shown).marked.has('e1')).toBe(true);
    // The sent segments keep their flag.
    expect(segments.s1.collation.sites.find((site) => site.index === dog.index)!.minor).toBe(true);
  });
});

describe('shownSites', () => {
  /** A textual variant (fox, cat), an interpretative one (ὅτι, ὅ τι: the same letters, divided otherwise) and a place that only a conjecture opens. */
  function mixed() {
    const ed = text('e', 'ed.', 'ὅτι red fox runs');
    const seg = segment(ed, [
      text('a', 'A', 'ὅ τι red cat runs'),
      text('b', 'B', 'ὅτι red fox runs'),
    ]);
    const textual = seg.collation.sites.find((site) =>
      site.readings.some((r) => r.text === 'cat'),
    )!;
    const interpretative = seg.collation.sites.find((site) =>
      site.readings.some((r) => r.text === 'ὅ τι'),
    )!;
    return { seg, textual, interpretative };
  }

  it('lists every place where some witness reads otherwise, the interpretative ones among them', () => {
    const { seg, textual, interpretative } = mixed();
    expect(textual.kind).toBe('textual');
    expect(interpretative.kind).toBe('interpretative');
    const shown = shownSites({ s1: seg }, true);
    expect([...shown].sort()).toEqual(
      [siteKey('s1', textual.index), siteKey('s1', interpretative.index)].sort(),
    );
  });

  it('leaves the interpretative ones out when they are not shown, and no others', () => {
    const { seg, textual, interpretative } = mixed();
    const shown = shownSites({ s1: seg }, false);
    expect(shown.has(siteKey('s1', interpretative.index))).toBe(false);
    expect([...shown]).toEqual([siteKey('s1', textual.index)]);
  });

  it('counts a place a conjecture of other words opens as textual, whatever the witnesses have', () => {
    const { seg, interpretative } = mixed();
    const attachment: Attachment = { kind: 'conjecture', id: 'c1', text: 'ὅττι', name: 'Quill' };
    const withConjecture = { ...seg, attachments: { [interpretative.index]: [attachment] } };
    expect(shownSites({ s1: withConjecture }, false).has(siteKey('s1', interpretative.index))).toBe(
      true,
    );
  });

  it('is independent of the order the passages are given in and spans passages', () => {
    const one = mixed().seg;
    const ed = text('f', 'ed.', 'blue sky');
    const two = segment(ed, [text('c', 'C', 'blue sea')], 's2', '1.2');
    const shown = shownSites({ s2: two, s1: one }, true);
    expect([...shown].filter((key) => key.startsWith('s2:'))).toHaveLength(1);
    expect([...shown].filter((key) => key.startsWith('s1:'))).toHaveLength(2);
  });
});
