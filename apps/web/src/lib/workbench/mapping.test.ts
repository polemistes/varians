import { describe, expect, it } from 'vitest';
import { fromText, sequentialIds, type Obj, type Token } from '@varians/core';
import {
  groupBoxes,
  clipRect,
  divideGuideBox,
  evenBands,
  lineDirection,
  lineTokens,
  lineWordBoxes,
  replacedZones,
  selectedLines,
  unmappedTokens,
  zonesOfTokens,
  type ZoneLike,
} from './mapping.ts';

const rect = (x: number, y: number, w: number, h: number) => ({ rect: { x, y, w, h } });

describe('zones and words', () => {
  const page = fromText('aa bb\ncc', { lang: 'en', ids: sequentialIds() }); // t1 t2 / t4
  const zones: ZoneLike[] = [
    { id: 'z1', tokenIds: ['t1'], geometry: rect(0, 0, 0.1, 0.1) },
    { id: 'z2', tokenIds: ['t2', 't4'], geometry: rect(0.2, 0, 0.1, 0.1) },
    { id: 'f', tokenIds: [], geometry: rect(0.5, 0.5, 0.1, 0.1), feature: { kind: 'figure' } },
  ];

  it('counts the words of a page without a zone', () => {
    expect(unmappedTokens(page, zones)).toEqual([]);
    expect(unmappedTokens(page, zones.slice(1))).toEqual(['t1']);
  });

  it('finds the zones words light and the zones mapping them again replaces', () => {
    expect(zonesOfTokens(zones, ['t4'])).toEqual(['z2']);
    expect(zonesOfTokens(zones, [])).toEqual([]);
    expect(replacedZones(zones, ['t1', 't2'])).toEqual(['z1']);
    expect(replacedZones(zones, ['t1', 't2', 't4'])).toEqual(['z1', 'z2']);
  });
});

describe('selectedLines', () => {
  it('takes whole lines touched by the selection, with gaps as spacers', () => {
    const s = fromText('aa bb\ncc dd\nee', { lang: 'en', ids: sequentialIds() }); // t1 t2 / t4 t5 / t7
    const gap: Obj = {
      kind: 'object',
      id: 'g',
      type: 'gap',
      attrs: { quantity: 4, unit: 'character' },
    };
    s.items.splice(4, 0, gap); // cc [gap] dd
    const lines = selectedLines(s, ['t2', 't4']);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.parts.map((p) => p.text)).toEqual(['aa', 'bb']);
    expect(lines[1]!.parts.map((p) => [p.text, p.spacer ?? false])).toEqual([
      ['cc', false],
      ['xxxx', true],
      ['dd', false],
    ]);
  });

  it('gives the parts of a word divided across lines every token of the word', () => {
    const s = fromText('aa bb\ncc dd', { lang: 'en', ids: sequentialIds() }); // t1 t2 / t4 t5
    (s.items[1] as Token).joinNext = true;
    const lines = selectedLines(s, ['t1', 't5']);
    expect(lines[0]!.parts[1]!.tokenIds).toEqual(['t2', 't4']);
    expect(lines[1]!.parts[0]!.tokenIds).toEqual(['t2', 't4']);
  });

  it('finds the tokens on the line of a token', () => {
    const s = fromText('aa bb\ncc', { lang: 'en', ids: sequentialIds() });
    expect(lineTokens(s, 't2')).toEqual(['t1', 't2']);
    expect(lineTokens(s, 't4')).toEqual(['t4']);
  });
});

describe('divideGuideBox', () => {
  const box = { x: 0.1, y: 0.2, w: 0.4, h: 0.2 };
  const lines = [
    {
      parts: [
        { tokenIds: ['a'], text: 'aaa' },
        { tokenIds: ['b'], text: 'b' },
      ],
    },
    { parts: [{ tokenIds: ['c'], text: 'cc' }] },
  ];

  it('divides the box into one band per line and each band by letters', () => {
    const zones = divideGuideBox(box, lines);
    expect(zones.map((z) => z.tokenIds)).toEqual([['a'], ['b'], ['c']]);
    const [a, b, c] = zones.map((z) => z.geometry.rect!);
    expect(a!.y).toBeCloseTo(0.2);
    expect(a!.h).toBeCloseTo(0.1);
    expect(c!.y).toBeCloseTo(0.3);
    expect(c!.w).toBeCloseTo(0.4);
    // aaa and b with one letter of space: aaa takes 3.5 of 5 letters.
    expect(a!.w).toBeCloseTo(0.4 * 0.7);
    expect(b!.x).toBeCloseTo(0.1 + 0.4 * 0.7);
  });

  it('uses the lines found on the image when there are as many', () => {
    const detected = [
      { x: 0.12, y: 0.21, w: 0.3, h: 0.05 },
      { x: 0.11, y: 0.3, w: 0.35, h: 0.06 },
    ];
    const zones = divideGuideBox(box, lines, { detected });
    expect(zones[2]!.geometry.rect).toEqual({ x: 0.11, y: 0.3, w: 0.35, h: 0.06 });
    const fewer = divideGuideBox(box, lines, { detected: detected.slice(0, 1) });
    expect(fewer[2]!.geometry.rect!.y).toBeCloseTo(0.3);
  });

  it('runs right to left for a right-to-left line and gives spacers no zone', () => {
    const zones = divideGuideBox(box, [
      {
        parts: [
          { tokenIds: ['x'], text: 'אב' },
          { tokenIds: [], text: 'xx', spacer: true },
          { tokenIds: ['y'], text: 'גד' },
        ],
      },
    ]);
    expect(zones.map((z) => z.tokenIds)).toEqual([['x'], ['y']]);
    expect(zones[0]!.geometry.rect!.x).toBeGreaterThan(zones[1]!.geometry.rect!.x);
  });

  it('knows directions, bands and clipping', () => {
    expect(lineDirection('μῆνιν')).toBe('ltr');
    expect(lineDirection('123 שלום')).toBe('rtl');
    expect(evenBands({ x: 0, y: 0, w: 1, h: 1 }, 4)[3]).toEqual({ x: 0, y: 0.75, w: 1, h: 0.25 });
    expect(clipRect({ x: 0, y: 0, w: 1, h: 1 }, box)).toEqual(box);
    expect(clipRect({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, box)).toBeNull();
  });
});

describe('lineWordBoxes', () => {
  it('orders the rectangle zones of a line and boxes them', () => {
    const zones: ZoneLike[] = [
      { id: 'z2', tokenIds: ['t2'], geometry: rect(0.3, 0.1, 0.1, 0.05) },
      { id: 'z1', tokenIds: ['t1'], geometry: rect(0.1, 0.12, 0.15, 0.04) },
      {
        id: 'p',
        tokenIds: ['t3'],
        geometry: {
          polygon: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        },
      },
    ];
    const boxes = lineWordBoxes(zones, ['t1', 't2', 't3']);
    expect(boxes?.words.map((w) => w.id)).toEqual(['z1', 'z2']);
    expect(boxes?.line.x).toBeCloseTo(0.1);
    expect(boxes?.line.w).toBeCloseTo(0.3);
    expect(boxes?.line.y).toBeCloseTo(0.1);
    expect(boxes?.line.h).toBeCloseTo(0.06);
    expect(lineWordBoxes(zones, ['t1'])).toBeNull();
  });
});

describe('groupBoxes', () => {
  const box = (id: string, tokenIds: string[], x: number, y: number): ZoneLike => ({
    id,
    tokenIds,
    geometry: { rect: { x, y, w: 0.1, h: 0.04 } },
  });

  it('takes the boxes of the selected words, with their lines and places, in reading order', () => {
    const page = fromText('aa bb cc\ndd ee', { lang: 'en', ids: sequentialIds() }); // t1 t2 t3 / t5 t6
    const zones = [
      box('z3', ['t3'], 0.3, 0.1),
      box('z1', ['t1'], 0.1, 0.1),
      box('z5', ['t5'], 0.1, 0.2),
      box('z2', ['t2'], 0.2, 0.1),
    ];
    const group = groupBoxes(page, zones, ['z2', 'z3', 'z5']);
    expect(group.map((b) => [b.id, b.line, b.at])).toEqual([
      ['z2', 0, 1],
      ['z3', 0, 2],
      ['z5', 1, 0],
    ]);
    expect(group[0]!.direction).toBe('ltr');
    expect(group.map((b) => b.text)).toEqual(['bb', 'cc', 'dd']);
  });

  it('leaves out features, polygons and boxes not chosen', () => {
    const page = fromText('aa bb', { lang: 'en', ids: sequentialIds() });
    const zones: ZoneLike[] = [
      box('z1', ['t1'], 0.1, 0.1),
      {
        id: 'f',
        tokenIds: ['t1'],
        geometry: { rect: { x: 0, y: 0, w: 0.1, h: 0.1 } },
        feature: { kind: 'damage' },
      },
      {
        id: 'p',
        tokenIds: ['t2'],
        geometry: {
          rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
          polygon: [
            [0, 0],
            [0.1, 0],
            [0.1, 0.1],
          ],
        },
      },
      box('z2', ['t2'], 0.2, 0.1),
    ];
    expect(groupBoxes(page, zones, ['z1', 'f', 'p']).map((b) => b.id)).toEqual(['z1']);
  });

  it('puts each part of a word divided across lines on the line it stands on', () => {
    const page = fromText('aa bb\ncc dd', { lang: 'en', ids: sequentialIds() }); // t1 t2 / t4 t5; bb-cc one word
    const zones = [
      box('a', ['t1'], 0.1, 0.1),
      box('first', ['t2', 't4'], 0.2, 0.1),
      box('second', ['t2', 't4'], 0.1, 0.2),
      box('d', ['t5'], 0.2, 0.2),
    ];
    const group = groupBoxes(page, zones, ['a', 'first', 'second', 'd']);
    expect(group.map((b) => [b.id, b.line, b.at])).toEqual([
      ['a', 0, 0],
      ['first', 0, 1],
      ['second', 1, 0],
      ['d', 1, 1],
    ]);
  });

  it('puts boxes whose words are gone in lines by where they stand, after the lines of the text', () => {
    const page = fromText('aa', { lang: 'en', ids: sequentialIds() }); // t1
    const zones = [
      box('kept', ['t1'], 0.1, 0.05),
      box('r2b', ['gone4'], 0.3, 0.205),
      box('r1b', ['gone2'], 0.3, 0.1),
      box('r1a', ['gone1'], 0.1, 0.101),
      box('r2a', [], 0.1, 0.2),
    ];
    const group = groupBoxes(
      page,
      zones,
      zones.map((z) => z.id),
    );
    expect(group.map((b) => [b.id, b.line, b.at])).toEqual([
      ['kept', 0, 0],
      ['r1a', 1, 0],
      ['r1b', 1, 1],
      ['r2a', 2, 0],
      ['r2b', 2, 1],
    ]);
  });
});
