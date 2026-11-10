import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Stream, type Token } from '@varians/core';
import type { SiglumState } from '@varians/db';
import { coverageOf, inputHash, inputsFor, type EditionContext } from './collation.ts';

function segmented(text: string, prefix: string): Stream {
  const stream = fromText(text, { ids: sequentialIds(prefix) });
  (stream.items[0] as Token).segment = { segmentId: 's1' };
  return stream;
}

function context(
  witness: Stream,
  sub: { states?: SiglumState[]; variantSiglum?: string } = {},
): EditionContext {
  return {
    edition: { id: 'e', workId: 'w', content: segmented('the quick brown fox', 'e'), version: 1 },
    profile: { language: 'en', fold: {} } as unknown as EditionContext['profile'],
    sigla: [
      {
        siglum: 'A',
        witnessId: 'wa',
        transcriptionId: 'ta',
        states: sub.states ?? [],
        variantSiglum: sub.variantSiglum ?? null,
      },
    ],
    witnessHands: new Map([
      [
        'wa',
        [
          { id: 'h1', label: 'm1', description: null, main: true },
          { id: 'h2', label: 'm2', description: null, main: false },
        ],
      ],
    ]),
    transcriptions: new Map([['ta', { id: 'ta', content: witness, version: 1, witnessId: 'wa' }]]),
    siteKinds: new Map(),
  };
}

describe('inputsFor', () => {
  it('collates the variants a witness notes under their own siglum, where they make a difference', () => {
    const witness = segmented('the quick brown fox', 'a');
    for (const id of ['a2', 'a3'])
      (witness.items.find((i) => i.id === id) as Token).marks = [
        { kind: 'variant', attrs: { group: 'g', reading: 'swift', place: 'margin' } },
      ];
    const { witnesses } = inputsFor(context(witness, { variantSiglum: 'A v.l.' }), 's1');
    expect(witnesses.map((w) => [w.id, w.siglum, w.units.map((u) => u.text).join(' ')])).toEqual([
      ['ta', 'A', 'the quick brown fox'],
      ['ta:variant', 'A v.l.', 'the swift fox'],
    ]);
    // Without the sub-siglum, or without variants, there is no second text.
    expect(inputsFor(context(witness), 's1').witnesses.map((w) => w.id)).toEqual(['ta']);
    expect(
      inputsFor(
        context(segmented('the quick brown fox', 'b'), { variantSiglum: 'A v.l.' }),
        's1',
      ).witnesses.map((w) => w.id),
    ).toEqual(['ta']);
  });

  it('keeps the state before correction and the variants apart', () => {
    const witness = segmented('the quick brown fox', 'a');
    (witness.items.find((i) => i.id === 'a2') as Token).marks = [
      { kind: 'add', attrs: { place: 'above' } },
    ];
    (witness.items.find((i) => i.id === 'a4') as Token).marks = [
      { kind: 'variant', attrs: { group: 'g', reading: '', place: 'interlinear' } },
    ];
    const ctx = context(witness, {
      states: [{ kind: 'original', siglum: 'A¹' }],
      variantSiglum: 'A v.l.',
    });
    const { base, witnesses } = inputsFor(ctx, 's1');
    expect(witnesses.map((w) => [w.siglum, w.units.map((u) => u.text).join(' ')])).toEqual([
      ['A', 'the quick brown fox'],
      ['A¹', 'the brown fox'],
      ['A v.l.', 'the quick brown'],
    ]);
    expect(inputHash(ctx, base, witnesses)).not.toBe(inputHash(ctx, base, witnesses.slice(0, 2)));
  });
});

describe('inputsFor: states by stage and by hand', () => {
  it('collates the text after a stage, and with the corrections of one hand, under their own sigla', () => {
    const witness = segmented('the quick brown fox', 'a');
    // "quick" added by m2 at stage 2; "brown" deleted by the scribe at stage 1.
    (witness.items.find((i) => i.id === 'a2') as Token).marks = [
      { kind: 'add', attrs: { hand: 'h2', seq: 2 } },
    ];
    (witness.items.find((i) => i.id === 'a3') as Token).marks = [
      { kind: 'del', attrs: { hand: 'scribe', seq: 1 } },
    ];
    const ctx = context(witness, {
      states: [
        { kind: 'original', siglum: 'A¹' },
        { kind: 'stage', stage: 1, siglum: 'A²' },
        { kind: 'stage', stage: 2, siglum: 'A³' },
        { kind: 'hand', hand: 'h2', siglum: 'A m2' },
        { kind: 'hand', hand: 'h1', siglum: 'A m1' },
      ],
    });
    const { witnesses } = inputsFor(ctx, 's1');
    expect(witnesses.map((w) => [w.id, w.siglum, w.units.map((u) => u.text).join(' ')])).toEqual([
      ['ta', 'A', 'the quick fox'],
      ['ta:s0', 'A¹', 'the brown fox'],
      ['ta:s1', 'A²', 'the fox'],
      // After stage 2 the text is the corrected text: no siglum of its own.
      ['ta:s3', 'A m2', 'the quick brown fox'],
      // The main hand's id also catches corrections marked as the scribe's.
      ['ta:s4', 'A m1', 'the fox'],
    ]);
  });
});

describe('coverage', () => {
  const keys = new Map([
    ['s1', '0001'],
    ['s2', '0002'],
    ['s3', '0003'],
    ['s4', '0004'],
    ['s5', '0005'],
  ]);
  /** Lines `label:words`, each beginning its segment; `[gap]` a gap object. */
  function lines(...spec: string[]): Stream {
    const items: Stream['items'] = [];
    let n = 0;
    spec.forEach((line, k) => {
      if (k > 0) items.push({ kind: 'break', id: `l${k}`, type: 'line' });
      const [seg, words] = line.split(':');
      words!.split(' ').forEach((word, i) => {
        if (word === '[gap]') items.push({ kind: 'object', id: `g${++n}`, type: 'gap' });
        else
          items.push({
            kind: 'token',
            id: `w${++n}`,
            form: word,
            ...(i === 0 && seg ? { segment: { segmentId: seg } } : {}),
          });
      });
    });
    return { items };
  }

  it('spans from the first to the last segment, with the segments between a gap lost', () => {
    expect(coverageOf(lines('s2:a b', 's4:c'), keys)).toEqual({
      first: '0002',
      last: '0004',
      lost: new Set(),
    });
    expect(coverageOf(lines('s1:a [gap]', 's4:c'), keys)).toEqual({
      first: '0001',
      last: '0004',
      lost: new Set(['s2', 's3']),
    });
    // A gap within a segment loses nothing beyond it.
    expect(coverageOf(lines('s1:a [gap] b', 's3:c'), keys)!.lost).toEqual(new Set());
    expect(coverageOf(lines(':a b'), keys)).toBeNull();
  });

  it('gives a witness without a segment an omission within its coverage, a lacuna where lost, and nothing outside', () => {
    const edition: Stream = lines('s1:a', 's2:b', 's3:c', 's4:d', 's5:e');
    const witness = lines('s1:a', 's3:c [gap]', 's5:e');
    const ctx: EditionContext = {
      ...context(witness),
      edition: { id: 'e', workId: 'w', content: edition, version: 1 },
      segmentKeys: keys,
      coverage: new Map([['ta', coverageOf(witness, keys)!]]),
    };
    expect(inputsFor(ctx, 's2').witnesses[0]).toMatchObject({ units: [], present: true });
    expect(inputsFor(ctx, 's4').witnesses[0]!.units.map((u) => Boolean(u.gap))).toEqual([true]);
    const narrow = lines('s2:b', 's3:c');
    const outside = inputsFor(
      {
        ...ctx,
        transcriptions: new Map([
          ['ta', { id: 'ta', content: narrow, version: 1, witnessId: 'wa' }],
        ]),
        coverage: new Map([['ta', coverageOf(narrow, keys)!]]),
      },
      's5',
    );
    expect(outside.witnesses[0]).toEqual({ id: 'ta', siglum: 'A', units: [] });
  });
});
