import { describe, expect, it } from 'vitest';
import {
  applyOps,
  collate,
  fromText,
  sequentialIds,
  toText,
  units,
  type Stream,
  type Token,
} from '@varians/core';
import { opsForAttachment, opsForReading } from './adopt-client.ts';
import type { SegmentViewClient } from './types.ts';
import { outlineOf } from './outline.ts';
import {
  activeSiteFor,
  insertedIds,
  insertionSite,
  segmentWindow,
  segmentsTouched,
  siteForTokens,
  siteShows,
  sitesInOrder,
  stepSite,
  tokenClassesFor,
  unprintedMarks,
  windowWithUnprinted,
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
  const stream = fromText(editionText, { ids: sequentialIds(`${segmentId}e`) });
  (stream.items[0] as Token).segment = { segmentId };
  const baseUnits = units(stream, 0, stream.items.length);
  const texts = Object.entries(witnesses).map(([siglum, text]) => {
    const s = fromText(text, { ids: sequentialIds(`${segmentId}${siglum}`) });
    return { id: siglum, siglum, units: units(s, 0, s.items.length) };
  });
  const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, texts);
  return {
    stream,
    segment: {
      segmentId,
      label: segmentId,
      collation,
      baseUnits,
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
    const stream = fromText('the quick brown fox', { ids: sequentialIds('w1e') });
    (stream.items[0] as Token).segment = { segmentId: 'w1' };
    const baseUnits = units(stream, 0, stream.items.length);
    const collation = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      { id: 'B', siglum: 'B', units: [], present: true },
    ]);
    const lacking: SegmentViewClient = {
      segmentId: 'w1',
      label: 'w1',
      collation,
      baseUnits,
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
    const views = { a: outline, b: outline, c: outline };
    const order = ['a', 'b', 'c'];
    expect(stepSite(order, views, null, 1, {}, false, 'b')?.segmentId).toBe('b');
    expect(stepSite(order, views, null, -1, {}, false, 'b')?.segmentId).toBe('a');
    // With nothing after the caret the step goes round to the start, as it does from the last place.
    expect(stepSite(['a', 'x'], { a: outline }, null, 1, {}, false, 'x')?.segmentId).toBe('a');
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
    const s = text('a b\nc d\ne f', { ids: ids() });
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
            source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
            segment: { segmentId: 's' },
          },
          {
            kind: 'token',
            id: 'n',
            form: 'ἵν',
            source: { kind: 'witness', transcriptionId: 'A', tokenIds: ['x'] },
          },
        ],
      },
    ]);
    expect(
      applyOps(stream, split).stream.items.map((i) => (i.kind === 'token' ? i.form : '')),
    ).toEqual(['μῆν', 'ἵν', 'ἄειδε']);
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
  /** Lines `l1`, `l2`, `l4` in the edition, each a segment; `l3` only in A, standing after `l2`. */
  function edition() {
    const items: Stream['items'] = [];
    for (const [k, label] of ['l1', 'l2', 'l4'].entries()) {
      if (k > 0) items.push({ kind: 'break', id: `br${k}`, type: 'line' });
      const line = fromText(`${label}a ${label}b`, { ids: sequentialIds(`${label}e`) });
      (line.items[0] as Token).segment = { segmentId: label };
      items.push(...line.items);
    }
    const stream: Stream = { items };
    const outlines = Object.fromEntries(
      ['l1', 'l2', 'l4'].map((id) => [id, outlineOf(view(id, 'a b c', { A: 'a x c' }).segment)]),
    );
    const witness = fromText('eta theta', { ids: sequentialIds('A') });
    const collation = collate({ id: 'E', siglum: 'ed.', units: [] }, [
      { id: 'A', siglum: 'A', units: units(witness, 0, witness.items.length) },
    ]);
    const unprinted: SegmentViewClient = {
      segmentId: 'l3',
      label: 'l3',
      collation,
      baseUnits: [],
      entries: [],
      attachments: {},
      unplaced: [],
      absent: [],
      notes: [],
      unprinted: { after: 'l2' },
    };
    outlines.l3 = outlineOf(unprinted);
    return { stream, outlines, unprinted, order: ['l1', 'l2', 'l4'] };
  }

  it('is stepped to in its place, after the line it follows', () => {
    const { outlines, order } = edition();
    expect(outlines.l3!.sites).toHaveLength(1);
    const seen: string[] = [];
    let active: { segmentId: string; siteIndex: number } | null = null;
    for (let i = 0; i < 4; i++) {
      const next = stepSite(order, outlines, active, 1, {});
      seen.push(next!.segmentId);
      active = { segmentId: next!.segmentId, siteIndex: next!.site.index };
    }
    expect(seen).toEqual(['l1', 'l2', 'l3', 'l4']);
    // Back from the line after it, and on from the caret in the line before it.
    const fromFour = { segmentId: 'l4', siteIndex: outlines.l4!.sites[0]!.index };
    expect(stepSite(order, outlines, fromFour, -1, {})?.segmentId).toBe('l3');
    expect(stepSite(order, outlines, null, 1, {}, false, 'l3')?.segmentId).toBe('l3');
    // To review: it is reached like any other, and passed over once reviewed.
    const reviewed = { l1: [outlines.l1!.sites[0]!.key], l2: [outlines.l2!.sites[0]!.key] };
    expect(stepSite(order, outlines, null, 1, reviewed, true)?.segmentId).toBe('l3');
    const done = { ...reviewed, l3: [outlines.l3!.sites[0]!.key] };
    expect(stepSite(order, outlines, null, 1, done, true)?.segmentId).toBe('l4');
  });

  it('is shown in the window around the line it follows, after it, and the window around it is that one', () => {
    const { outlines, order } = edition();
    expect(windowWithUnprinted(order, outlines, 'l1', 1)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(windowWithUnprinted(order, outlines, 'l1', 0)).toEqual(['l1']);
    expect(windowWithUnprinted(order, outlines, 'l3', 1)).toEqual(
      windowWithUnprinted(order, outlines, 'l2', 1),
    );
    expect(windowWithUnprinted(order, outlines, 'l4', 0)).toEqual(['l4']);
  });

  it('is marked after the last word of the line it follows, unless its variant is minor', () => {
    const { stream, outlines, order, unprinted } = edition();
    expect(unprintedMarks(stream, order, outlines)).toEqual([
      { segmentId: 'l3', after: 'l2e2', site: outlines.l3!.sites[0] },
    ]);
    const minor = {
      ...unprinted,
      collation: {
        ...unprinted.collation,
        sites: unprinted.collation.sites.map((s) => ({ ...s, minor: true })),
      },
    };
    expect(unprintedMarks(stream, order, { ...outlines, l3: outlineOf(minor) })).toEqual([]);
  });

  it('is printed by adopting its reading, after the line it follows, with its words from the witness', () => {
    const { stream, unprinted } = edition();
    const site = unprinted.collation.sites[0]!;
    const reading = site.readings.find((r) => !r.base)!;
    const next = applyOps(stream, opsForReading(stream, unprinted, site, reading, 'A')).stream;
    expect(toText(next)).toBe('l1a l1b\nl2a l2b\neta theta\nl4a l4b');
    const printed = next.items.filter((i) => i.kind === 'token' && i.source?.kind === 'witness');
    expect(printed.map((t) => (t as Token).source)).toEqual([
      { kind: 'witness', transcriptionId: 'A', tokenIds: ['A1'] },
      { kind: 'witness', transcriptionId: 'A', tokenIds: ['A2'] },
    ]);
    expect((printed[0] as Token).segment).toEqual({ segmentId: 'l3' });
    // A deletion of what is not printed changes nothing; a conjecture's words are printed as the line.
    const conjecture = { kind: 'conjecture' as const, id: 'c1', name: 'X' };
    expect(
      opsForAttachment(stream, unprinted, site, {
        ...conjecture,
        text: '',
        conjectureKind: 'deletion',
      }),
    ).toEqual([]);
    const conjectured = applyOps(
      stream,
      opsForAttachment(stream, unprinted, site, {
        ...conjecture,
        text: 'zeta eta',
        conjectureKind: 'substitution',
      }),
    ).stream;
    expect(toText(conjectured)).toBe('l1a l1b\nl2a l2b\nzeta eta\nl4a l4b');
  });
});
