import { describe, expect, it } from 'vitest';
import {
  applyOps,
  collate,
  collatePassages,
  fromText,
  siteSegments,
  sequentialIds,
  toText,
  units,
  type Stream,
  type Token,
} from '@varians/core';
import { opsForAttachment, opsForReading } from './adopt-client.ts';
import type { SegmentViewClient } from './types.ts';
import { outlineOf, type SegmentOutline } from './outline.ts';
import { unprintedAt } from '$lib/reader/passages';
import {
  activeSiteFor,
  insertedIds,
  insertionSite,
  itemsAround,
  segmentWindow,
  segmentsTouched,
  siteForTokens,
  siteShows,
  sitesInOrder,
  stepSite,
  tokenClassesFor,
  unprintedMarks,
  windowAround,
  witnessIndex,
  witnessTokensAt,
  moveLinesOps,
  claimTypedWords,
  takeCurrentOps,
} from './workspace.ts';

function view(
  segmentId: string,
  editionText: string,
  witnesses: Record<string, string>,
): { stream: Stream; segment: SegmentViewClient } {
  const stream = fromText(editionText, { lang: 'grc', ids: sequentialIds(`${segmentId}e`) });
  (stream.items[0] as Token).segment = { segmentId };
  const baseUnits = units(stream, 0, stream.items.length);
  const texts = Object.entries(witnesses).map(([siglum, text]) => {
    const s = fromText(text, { lang: 'grc', ids: sequentialIds(`${segmentId}${siglum}`) });
    return { id: siglum, siglum, units: units(s, 0, s.items.length) };
  });
  const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, texts);
  return {
    stream,
    segment: {
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
    },
  };
}

describe('segmentWindow', () => {
  it('keeps a window of fixed size around the active segment', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(segmentWindow(order, 'd', 1)).toEqual(['c', 'd', 'e']);
    expect(segmentWindow(order, 'a', 1)).toEqual(['a', 'b', 'c']);
    expect(segmentWindow(order, 'g', 1)).toEqual(['e', 'f', 'g']);
    expect(segmentWindow(order, null, 2)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(segmentWindow([], 'x')).toEqual([]);
  });
});

describe('itemsAround', () => {
  it('holds the stretch from the first word of the segments on show to the last, and nothing outside it', () => {
    const { stream, segment } = view('s1', 'one two three four five', { B: 'one two' });
    const middle = { baseUnits: segment.baseUnits.slice(1, 3) };
    expect(itemsAround(stream, [middle]).map((item) => item.id)).toEqual(['s1e2', 's1e3']);
    expect(itemsAround(stream, [segment]).length).toBe(stream.items.length);
    expect(itemsAround(stream, [])).toEqual([]);
  });
});

describe('sites and selections', () => {
  const { stream, segment } = view('s1', 'the quick brown fox', {
    B: 'the slow fox',
    C: 'the quick brown fox jumps',
  });

  it('finds the active site from the caret', () => {
    expect(activeSiteFor([segment], [], 's1e2')).toEqual({ segmentId: 's1', siteIndex: 0 });
    expect(activeSiteFor([segment], [], 's1e1')).toBeNull();
  });

  it('makes a site over a free selection and an insertion point', () => {
    const site = siteForTokens(segment, ['s1e1'])!;
    expect([site.baseFrom, site.baseTo]).toEqual([0, 1]);
    const covering = siteForTokens(segment, ['s1e2'])!;
    expect(covering.index).toBe(0);
    const insertion = insertionSite(segment, 's1e4');
    expect(insertion.index).toBeGreaterThanOrEqual(0);
    expect([insertion.baseFrom, insertion.baseTo]).toEqual([4, 4]);
    const start = insertionSite(segment, null);
    expect([start.baseFrom, start.baseTo]).toEqual([0, 0]);
  });

  it('keeps a conjecture on one word apart from the site of a witness lacking the segment', () => {
    const stream = fromText('the quick brown fox', { lang: 'en', ids: sequentialIds('w1e') });
    (stream.items[0] as Token).segment = { segmentId: 'w1' };
    const baseUnits = units(stream, 0, stream.items.length);
    const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      { id: 'B', siglum: 'B', units: [], present: true },
    ]);
    const lacking: SegmentViewClient = {
      segmentId: 'w1',
      label: 'w1',
      segments: [{ segmentId: 'w1', label: 'w1', from: 0, to: baseUnits.length, printed: true }],
      collation,
      baseUnits,
      siteSegments: { 0: ['w1'] },
      entries: [],
      attachments: {},
      unplaced: [],
      absent: [],
      notes: [],
    };
    expect(collation.sites.map((x) => x.wanting ?? false)).toEqual([true]);
    const one = siteForTokens(lacking, ['w1e2'])!;
    expect([one.index, one.baseFrom, one.baseTo]).toEqual([-1, 1, 2]);
    expect(siteForTokens(lacking, ['w1e1', 'w1e2', 'w1e3', 'w1e4'])!.wanting).toBe(true);
  });

  it('indexes witness words and finds the words of a witness at a site', () => {
    const index = witnessIndex([segment]);
    expect(index.get('s1B2')?.textId).toBe('B');
    expect(witnessTokensAt(segment.collation.sites[0]!, 'B')).toEqual(['s1B2']);
  });

  it('puts classes on site words and the active site', () => {
    const classes = tokenClassesFor([outlineOf(segment)], {
      active: { segmentId: 's1', siteIndex: 0 },
    });
    expect(classes.s1e2).toBe('vs-site vs-active');
    expect(classes.s1e1).toBeUndefined();
    const withSources = tokenClassesFor([outlineOf(segment)], {
      active: null,
      colourBySource: true,
      stream: { items: [{ kind: 'token', id: 'x', form: 'a', source: { kind: 'editor' } }] },
    });
    expect(withSources.x).toBe('vs-editor');
  });

  it('steps through sites and skips reviewed ones on request', () => {
    const views = { s1: outlineOf(segment) };
    const first = stepSite(['s1'], views, null, 1, {});
    expect(first?.site.baseFrom).toBe(1);
    const second = stepSite(
      ['s1'],
      views,
      { segmentId: 's1', siteIndex: first!.site.index },
      1,
      {},
    );
    expect(second?.site.index).not.toBe(first!.site.index);
  });

  it('steps from the caret’s segment when no place is open, not from the start of the text', () => {
    // Three lines with the same places; the caret is in the second, on a word that has no place.
    const outline = outlineOf(segment);
    const as = (id: string): SegmentOutline => ({
      ...outline,
      segmentId: id,
      segments: [{ segmentId: id, printed: true }],
      sites: outline.sites.map((site) => ({ ...site, segments: [id] })),
    });
    const views = { a: as('a'), b: as('b'), c: as('c') };
    const order = ['a', 'b', 'c'];
    expect(stepSite(order, views, null, 1, {}, false, 'b')?.segmentId).toBe('b');
    expect(stepSite(order, views, null, -1, {}, false, 'b')?.segmentId).toBe('a');
    // With nothing after the caret the step goes round to the start, as it does from the last place.
    expect(stepSite(['a', 'x'], { a: as('a') }, null, 1, {}, false, 'x')?.segmentId).toBe('a');
    // Without a caret it starts at the first place, as before.
    expect(stepSite(order, views, null, 1, {})?.segmentId).toBe('a');
  });

  it('finds the segments an edit touched and the items it brought in', () => {
    const ops = [{ t: 'set' as const, id: 's1e2', fields: { form: 'slow' } }];
    const after = applyOps(stream, ops).stream;
    expect(segmentsTouched(stream, after, ops)).toEqual(['s1']);
    expect(
      insertedIds([{ t: 'insert', after: null, items: [{ kind: 'token', id: 'n', form: 'x' }] }]),
    ).toEqual(['n']);
  });
});

describe('moveLinesOps', () => {
  it('moves a line up and down keeping ids, segment starts and breaks', async () => {
    const {
      applyOps: apply,
      fromText: text,
      sequentialIds: ids,
      toText: show,
    } = await import('@varians/core');
    const s = text('a b\nc d\ne f', { lang: 'en', ids: ids() });
    (s.items[3] as Token).segment = { segmentId: 'seg2' };
    // t1 t2 | t3(br) | t4 t5 | t6(br) | t7 t8
    const up = apply(s, moveLinesOps(s, ['t4'], -1)).stream;
    expect(show(up)).toBe('c d\na b\ne f');
    expect(up.items[0]!.id).toBe('t4');
    expect((up.items[0] as Token).segment).toEqual({ segmentId: 'seg2' });
    const down = apply(s, moveLinesOps(s, ['t4'], 1)).stream;
    expect(show(down)).toBe('a b\ne f\nc d');
    expect(moveLinesOps(s, ['t1'], -1)).toEqual([]);
    expect(moveLinesOps(s, ['t8'], 1)).toEqual([]);
    const block = apply(s, moveLinesOps(s, ['t4', 't7'], -1)).stream;
    expect(show(block)).toBe('c d\ne f\na b');
    expect(new Set(block.items.map((i) => i.id))).toEqual(new Set(s.items.map((i) => i.id)));
  });
});

describe('claimTypedWords', () => {
  const stream: Stream = {
    items: [
      {
        kind: 'token',
        id: 'a',
        form: 'μῆνιν',
        source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
      },
      { kind: 'token', id: 'b', form: 'ἄειδε', source: { kind: 'conjecture', conjectureId: 'c' } },
      { kind: 'token', id: 'c', form: 'θεά', source: { kind: 'editor' } },
      { kind: 'token', id: 'd', form: 'Πηληϊάδεω' },
    ],
  };

  it('makes the editor the source of words whose letters were typed over', () => {
    const ops = claimTypedWords(stream, [
      { t: 'set', id: 'a', fields: { form: 'μῆνιν' } },
      { t: 'set', id: 'b', fields: { form: 'ἄειδεν' } },
      { t: 'set', id: 'c', fields: { form: 'θεὰ' } },
      { t: 'set', id: 'd', fields: { form: 'Πηληιάδεω' } },
      { t: 'set', id: 'b', fields: { form: 'ἄειδε' } },
    ]);
    expect(ops).toEqual([{ t: 'set', id: 'b', fields: { source: { kind: 'editor' } } }]);
  });

  it('leaves marks, word division and adoptions alone', () => {
    expect(
      claimTypedWords(stream, [{ t: 'set', id: 'a', fields: { marks: [{ kind: 'crux' }] } }]),
    ).toEqual([]);
    expect(claimTypedWords(stream, [{ t: 'split', id: 'a', at: 2, newId: 'n' }])).toEqual([]);
    expect(
      claimTypedWords(stream, [
        {
          t: 'set',
          id: 'a',
          fields: { form: 'x', source: { kind: 'witness', transcriptionId: 'B', tokenIds: [] } },
        },
      ]),
    ).toEqual([]);
  });
});

describe('takeCurrentOps', () => {
  const stream: Stream = {
    items: [
      {
        kind: 'token',
        id: 'a',
        form: 'μῆνιν',
        lang: 'grc',
        segment: { segmentId: 's' },
        source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
      },
      {
        kind: 'token',
        id: 'b',
        form: 'ἄειδε',
        source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['y'] },
      },
    ],
  };

  it('gives a word the witness’s present reading, as one word or several', () => {
    expect(takeCurrentOps(stream, { tokenId: 'b', now: 'ἄειδεν' })).toEqual([
      { t: 'set', id: 'b', fields: { form: 'ἄειδεν' } },
    ]);
    const split = takeCurrentOps(stream, { tokenId: 'a', now: 'μῆν ἵν' }, () => 'n');
    expect(split).toEqual([
      {
        t: 'replace',
        ids: ['a'],
        items: [
          {
            kind: 'token',
            id: 'a',
            form: 'μῆν',
            lang: 'grc',
            source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
            segment: { segmentId: 's' },
          },
          {
            kind: 'token',
            id: 'n',
            form: 'ἵν',
            lang: 'grc',
            source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
          },
        ],
      },
    ]);
    expect(
      applyOps(stream, split).stream.items.map((i) => (i.kind === 'token' ? i.form : '')),
    ).toEqual(['μῆν', 'ἵν', 'ἄειδε']);
  });

  it('takes a word the edition keeps divided whole in its first part, the parts after it going', () => {
    const divided: Stream = {
      items: [
        {
          kind: 'token',
          id: 'p',
          form: 'ἀνά',
          joinNext: true,
          segment: { segmentId: 's1' },
          source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
        },
        { kind: 'break', id: 'br', type: 'line' },
        {
          kind: 'token',
          id: 'q',
          form: 'στασις',
          segment: { segmentId: 's2' },
          source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['y'] },
        },
        { kind: 'token', id: 'r', form: 'δε' },
      ],
    };
    const ops = takeCurrentOps(divided, { tokenId: 'p', now: 'ἀνάστασεις' });
    const next = applyOps(divided, ops).stream;
    expect(next.items.map((i) => (i.kind === 'token' ? i.form : '/'))).toEqual([
      'ἀνάστασεις',
      '/',
      'δε',
    ]);
    expect((next.items[0] as Token).joinNext).toBeUndefined();
    // The segment the second part began begins at the next word.
    expect((next.items[2] as Token).segment).toEqual({ segmentId: 's2' });
  });

  it('does nothing when the witness no longer has the word or already agrees', () => {
    expect(takeCurrentOps(stream, { tokenId: 'a', now: '' })).toEqual([]);
    expect(takeCurrentOps(stream, { tokenId: 'a', now: 'μῆνιν' })).toEqual([]);
  });
});

describe('a variant the editor judges minor', () => {
  it('is not dotted in the text, nor stepped to, nor counted', () => {
    const { segment } = view('s', 'the quick fox jumps', {
      A: 'the slow fox jumps',
      B: 'the quick fox leaps',
    });
    const sites = segment.collation.sites;
    expect(sites).toHaveLength(2);
    expect(sitesInOrder(['s'], { s: outlineOf(segment) })).toHaveLength(2);
    const left = {
      ...segment,
      collation: {
        ...segment.collation,
        sites: sites.map((site, i) => (i === 0 ? { ...site, minor: true } : site)),
      },
    };
    expect(siteShows(left, left.collation.sites[0]!)).toBe(false);
    expect(siteShows(left, left.collation.sites[1]!)).toBe(true);
    expect(sitesInOrder(['s'], { s: outlineOf(left) }).map((r) => r.site.index)).toEqual([
      left.collation.sites[1]!.index,
    ]);
    const classes = tokenClassesFor([outlineOf(left)], { active: null });
    expect(Object.keys(classes)).toHaveLength(1);
  });
});

describe('a line the edition does not print', () => {
  /**
   * Lines `l1`, `l2`, `l4` in the edition, each a segment; A reads otherwise at the end of `l1` and
   * of `l4`, and has `l3`, which stands after `l2`: all of it one passage.
   */
  function edition() {
    const lines = (prefix: string, text: [string, string][]) => {
      const items: Stream['items'] = [];
      for (const [k, [label, words]] of text.entries()) {
        if (k > 0) items.push({ kind: 'break', id: `${prefix}br${k}`, type: 'line' });
        const line = fromText(words, { lang: 'grc', ids: sequentialIds(`${prefix}${label}`) });
        (line.items[0] as Token).segment = { segmentId: label };
        items.push(...line.items);
      }
      return { items };
    };
    const stream = lines('e', [
      ['l1', 'l1a l1b'],
      ['l2', 'l2a l2b'],
      ['l4', 'l4a l4b'],
    ]);
    const witness = lines('A', [
      ['l1', 'l1a x'],
      ['l2', 'l2a l2b'],
      ['l3', 'eta theta'],
      ['l4', 'l4a y'],
    ]);
    const { passages } = collatePassages({ id: 'E', siglum: 'ed.', stream }, [
      { id: 'A', siglum: 'A', stream: witness },
    ]);
    expect(passages).toHaveLength(1);
    const passage = passages[0]!;
    const segment: SegmentViewClient = {
      segmentId: passage.segments[0]!.segmentId,
      label: passage.segments[0]!.segmentId,
      segments: passage.segments.map((s) => ({ ...s, label: s.segmentId })),
      collation: passage.collation,
      baseUnits: passage.base.units,
      siteSegments: Object.fromEntries(
        passage.collation.sites.map((s) => [s.index, siteSegments(s, passage.base.units)]),
      ),
      entries: [],
      attachments: {},
      unplaced: [],
      absent: [],
      notes: [],
    };
    const outlines = { [segment.segmentId]: outlineOf(segment) };
    const site = segment.collation.sites.find((s) => unprintedAt(segment, s.index))!;
    return { stream, outlines, segment, site, order: ['l1', 'l2', 'l4'] };
  }

  it('is a variant at a point of the passage of the line it follows', () => {
    const { segment, site, outlines } = edition();
    expect(segment.segments.map((s) => [s.segmentId, s.printed])).toEqual([
      ['l1', true],
      ['l2', true],
      ['l3', false],
      ['l4', true],
    ]);
    expect([site.baseFrom, site.baseTo]).toEqual([4, 4]);
    expect(unprintedAt(segment, site.index)).toEqual({ segmentId: 'l3', after: 'l2' });
    const outline = outlines.l1!.sites.find((s) => s.index === site.index)!;
    expect(outline.unprinted).toEqual({ segmentId: 'l3', after: 'l2' });
    expect(outline.segments).toEqual(['l3']);
  });

  it('is stepped to in its place, after the line it follows', () => {
    const { outlines, order } = edition();
    const where = (ref: ReturnType<typeof stepSite>) =>
      ref!.site.unprinted?.segmentId ?? ref!.site.segments[0];
    const seen: string[] = [];
    let active: { segmentId: string; siteIndex: number } | null = null;
    for (let i = 0; i < 3; i++) {
      const next = stepSite(order, outlines, active, 1, {});
      seen.push(where(next));
      active = { segmentId: next!.segmentId, siteIndex: next!.site.index };
    }
    expect(seen).toEqual(['l1', 'l3', 'l4']);
    // Back from the line after it, and on from the caret in the line before it.
    const four = outlines.l1!.sites.find((s) => s.segments[0] === 'l4')!;
    const fromFour = { segmentId: 'l1', siteIndex: four.index };
    expect(where(stepSite(order, outlines, fromFour, -1, {}))).toBe('l3');
    expect(where(stepSite(order, outlines, null, 1, {}, false, 'l2'))).toBe('l3');
    expect(where(stepSite(order, outlines, null, 1, {}, false, 'l3'))).toBe('l3');
    // To review: it is reached like any other, and passed over once reviewed, under its own segment.
    const one = outlines.l1!.sites.find((s) => s.segments[0] === 'l1')!;
    const three = outlines.l1!.sites.find((s) => s.unprinted)!;
    const reviewed = { l1: [one.key] };
    expect(where(stepSite(order, outlines, null, 1, reviewed, true))).toBe('l3');
    const done = { ...reviewed, l3: [three.key] };
    expect(where(stepSite(order, outlines, null, 1, done, true))).toBe('l4');
  });

  it('is shown in the window around the line it follows, and the window around it is that one', () => {
    const { outlines, order } = edition();
    expect(windowAround(order, outlines, 'l1', 1)).toEqual(['l1', 'l2', 'l4']);
    expect(windowAround(order, outlines, 'l1', 0)).toEqual(['l1']);
    expect(windowAround(order, outlines, 'l3', 0)).toEqual(['l2']);
    expect(windowAround(order, outlines, 'l3', 1)).toEqual(windowAround(order, outlines, 'l2', 1));
  });

  it('is marked after the last word of the line it follows, unless its variant is minor', () => {
    const { stream, outlines, order, segment, site } = edition();
    const three = outlines.l1!.sites.find((s) => s.unprinted)!;
    expect(unprintedMarks(stream, order, outlines)).toEqual([
      { passage: 'l1', segmentId: 'l3', after: 'el22', site: three, inText: false },
    ]);
    const minor = {
      ...segment,
      collation: {
        ...segment.collation,
        sites: segment.collation.sites.map((s) =>
          s.index === site.index ? { ...s, minor: true } : s,
        ),
      },
    };
    expect(unprintedMarks(stream, order, { l1: outlineOf(minor) })).toEqual([]);
  });

  it('is marked in the text, a point after the last word, where the line it follows is in a prose paragraph, and between two lines in verse', () => {
    const { stream, outlines, order } = edition();
    const paragraph = (lineation?: 'verse' | 'prose'): Stream => ({
      items: [
        { kind: 'break', id: 'pb', type: 'paragraph', ...(lineation ? { lineation } : {}) },
        ...stream.items,
      ],
    });
    const inText = (text: Stream, convention?: 'verse' | 'prose') =>
      unprintedMarks(text, order, outlines, convention).map((mark) => mark.inText);
    // The paragraph's own kind decides, whatever the edition says.
    expect(inText(paragraph('prose'))).toEqual([true]);
    expect(inText(paragraph('verse'), 'prose')).toEqual([false]);
    // A paragraph that is not marked is the edition's kind.
    expect(inText(paragraph(), 'prose')).toEqual([true]);
    expect(inText(paragraph(), 'verse')).toEqual([false]);
    expect(inText(stream, 'prose')).toEqual([true]);
  });

  it('is printed in the run of the text where the segment it follows is in prose, as the paragraph says or as the edition does', () => {
    const { stream, segment, site } = edition();
    const reading = site.readings.find((r) => !r.base)!;
    const printed = (text: Stream, lineation?: 'verse' | 'prose') =>
      toText(
        applyOps(text, opsForReading(text, segment, site, reading, 'A', lineation)).stream,
      ).replace(/\n+/g, '/');
    const paragraph = (lineation: 'verse' | 'prose'): Stream => ({
      items: [{ kind: 'break', id: 'pb', type: 'paragraph', lineation }, ...stream.items],
    });
    // In verse, on a line of its own; in prose, in the run, with the line breaks left where they were.
    expect(printed(stream)).toBe('l1a l1b/l2a l2b/eta theta/l4a l4b');
    expect(printed(paragraph('verse'), 'prose')).toBe('/l1a l1b/l2a l2b/eta theta/l4a l4b');
    expect(printed(paragraph('prose'), 'verse')).toBe('/l1a l1b/l2a l2b eta theta/l4a l4b');
    expect(printed(stream, 'prose')).toBe('l1a l1b/l2a l2b eta theta/l4a l4b');
    // The words are the same, and are of the segment the witness gives them.
    const next = applyOps(stream, opsForReading(stream, segment, site, reading, 'A', 'prose'));
    const first = next.stream.items.find((item) => item.kind === 'token' && item.form === 'eta');
    expect((first as Token).segment).toEqual({ segmentId: 'l3' });
  });

  it('is printed by the ordinary adoption of its reading, after the line it follows, with its words from the witness', () => {
    const { stream, segment, site } = edition();
    const reading = site.readings.find((r) => !r.base)!;
    const next = applyOps(stream, opsForReading(stream, segment, site, reading, 'A')).stream;
    expect(toText(next)).toBe('l1a l1b\nl2a l2b\neta theta\nl4a l4b');
    const printed = next.items.filter((i) => i.kind === 'token' && i.source?.kind === 'witness');
    expect(printed.map((t) => (t as Token).source)).toEqual([
      { kind: 'witness', transcriptionId: 'A', tokenIds: ['Al31'] },
      { kind: 'witness', transcriptionId: 'A', tokenIds: ['Al32'] },
    ]);
    expect((printed[0] as Token).segment).toEqual({ segmentId: 'l3' });
    // A deletion of what is not printed changes nothing; a conjecture's words are printed as the line.
    const conjecture = { kind: 'conjecture' as const, id: 'c1', name: 'X' };
    expect(
      opsForAttachment(
        stream,
        segment,
        site,
        { ...conjecture, text: '', conjectureKind: 'deletion' },
        'l3',
      ),
    ).toEqual([]);
    const conjectured = applyOps(
      stream,
      opsForAttachment(
        stream,
        segment,
        site,
        { ...conjecture, text: 'zeta eta', conjectureKind: 'substitution' },
        'l3',
      ),
    ).stream;
    expect(toText(conjectured)).toBe('l1a l1b\nl2a l2b\nzeta eta\nl4a l4b');
  });
});
