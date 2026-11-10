import { describe, expect, it } from 'vitest';
import type { Rect } from '@varians/core';
import {
  boundaryPairs,
  boundsOf,
  boxesInFrame,
  frameLimits,
  frameOf,
  geometriesFromFrame,
  moveBoundary,
  moveBoxes,
  pointFromFrame,
  pointToFrame,
  rectFromFrame,
  rectToFrame,
  rippleResize,
  scaleBoxes,
  turnBoxes,
  type GroupBox,
} from './group';

const r = (x: number, y: number, w: number, h = 0.05): Rect => ({ x, y, w, h });
const near = (rects: Rect[]) =>
  rects.map((q) => [q.x, q.y, q.w, q.h].map((v) => Math.round(v * 1e6) / 1e6));

describe('moveBoxes', () => {
  it('moves every box by the same amount', () => {
    expect(near(moveBoxes([r(0.1, 0.1, 0.1), r(0.3, 0.1, 0.2)], 0.05, -0.02))).toEqual([
      [0.15, 0.08, 0.1, 0.05],
      [0.35, 0.08, 0.2, 0.05],
    ]);
  });

  it('stops at the edge of the image, keeping the boxes apart as they were', () => {
    const moved = moveBoxes([r(0.1, 0.1, 0.1), r(0.7, 0.1, 0.2)], 0.5, 0);
    expect(near(moved)).toEqual([
      [0.2, 0.1, 0.1, 0.05],
      [0.8, 0.1, 0.2, 0.05],
    ]);
  });
});

describe('scaleBoxes', () => {
  it('stretches a line evenly from its right side, the left side staying', () => {
    const scaled = scaleBoxes([r(0.1, 0.1, 0.1), r(0.3, 0.1, 0.1)], 'right', 0.7);
    expect(near(scaled)).toEqual([
      [0.1, 0.1, 0.2, 0.05],
      [0.5, 0.1, 0.2, 0.05],
    ]);
  });

  it('squeezes from the left side', () => {
    const scaled = scaleBoxes([r(0.1, 0.1, 0.1), r(0.3, 0.1, 0.1)], 'left', 0.25);
    expect(near(scaled)).toEqual([
      [0.25, 0.1, 0.05, 0.05],
      [0.35, 0.1, 0.05, 0.05],
    ]);
  });

  it('scales lines apart from each other, and their heights, from the top or bottom', () => {
    const scaled = scaleBoxes([r(0.1, 0.1, 0.1, 0.1), r(0.1, 0.3, 0.1, 0.1)], 'bottom', 0.7);
    expect(near(scaled)).toEqual([
      [0.1, 0.1, 0.1, 0.2],
      [0.1, 0.5, 0.1, 0.2],
    ]);
    expect(boundsOf(scaleBoxes([r(0.1, 0.2, 0.1, 0.1)], 'top', 0.5)).h).toBeGreaterThan(0);
  });
});

describe('rippleResize', () => {
  const line = (direction: 'ltr' | 'rtl'): GroupBox[] => [
    { id: 'a', rect: r(0.1, 0.1, 0.1), line: 0, at: 0, direction },
    { id: 'b', rect: r(0.2, 0.1, 0.1), line: 0, at: 1, direction },
    { id: 'c', rect: r(0.3, 0.1, 0.1), line: 0, at: 2, direction },
    { id: 'next', rect: r(0.1, 0.2, 0.1), line: 1, at: 0, direction },
  ];

  it('widens a box and moves the boxes after it on its line, keeping their size', () => {
    const out = rippleResize(line('ltr'), 'b', 0.35);
    expect([...out.keys()]).toEqual(['b', 'c']);
    expect(near([out.get('b')!, out.get('c')!])).toEqual([
      [0.2, 0.1, 0.15, 0.05],
      [0.35, 0.1, 0.1, 0.05],
    ]);
  });

  it('narrows a box and pulls the boxes after it back', () => {
    const out = rippleResize(line('ltr'), 'a', 0.15);
    expect(near([out.get('a')!, out.get('b')!, out.get('c')!])).toEqual([
      [0.1, 0.1, 0.05, 0.05],
      [0.15, 0.1, 0.1, 0.05],
      [0.25, 0.1, 0.1, 0.05],
    ]);
  });

  it('pushes nothing off the image', () => {
    const out = rippleResize(line('ltr'), 'a', 0.9);
    expect(out.get('c')!.x + out.get('c')!.w).toBeCloseTo(1);
  });

  it('works from right to left: the box grows to the left, and the boxes after it, further left, follow', () => {
    const boxes: GroupBox[] = [
      { id: 'first', rect: r(0.5, 0.1, 0.1), line: 0, at: 0, direction: 'rtl' },
      { id: 'second', rect: r(0.3, 0.1, 0.1), line: 0, at: 1, direction: 'rtl' },
    ];
    const out = rippleResize(boxes, 'first', 0.45);
    expect(near([out.get('first')!, out.get('second')!])).toEqual([
      [0.45, 0.1, 0.15, 0.05],
      [0.25, 0.1, 0.1, 0.05],
    ]);
  });
});

describe('boundaries', () => {
  const boxes: GroupBox[] = [
    { id: 'a', rect: r(0.1, 0.1, 0.1), line: 0, at: 0, direction: 'ltr' },
    { id: 'b', rect: r(0.22, 0.1, 0.1), line: 0, at: 2, direction: 'ltr' },
    { id: 'c', rect: r(0.1, 0.2, 0.1), line: 1, at: 0, direction: 'ltr' },
  ];

  it('pairs neighbouring boxes on one line only', () => {
    expect(boundaryPairs(boxes).map(([a, b]) => [a.id, b.id])).toEqual([['a', 'b']]);
  });

  it('makes the first box end and the second begin at the boundary, closing the gap', () => {
    const out = moveBoundary(boxes[0]!, boxes[1]!, 0.25);
    expect(near([out.get('a')!, out.get('b')!])).toEqual([
      [0.1, 0.1, 0.15, 0.05],
      [0.25, 0.1, 0.07, 0.05],
    ]);
  });

  it('leaves each box some width', () => {
    const out = moveBoundary(boxes[0]!, boxes[1]!, 0.9);
    expect(out.get('b')!.w).toBeGreaterThan(0);
    expect(out.get('a')!.x + out.get('a')!.w).toBeLessThan(0.32);
  });
});

describe('the turned frame', () => {
  const aspect = 1.5; // 2000 by 3000 pixels

  it('takes rectangles and points into the frame and back unchanged', () => {
    const frame = { aspect, angle: 7, pivot: [0.4, 0.5] as [number, number] };
    const rect = r(0.2, 0.3, 0.1, 0.02);
    const back = rectFromFrame(rectToFrame(rect, frame), frame);
    expect(near([back])).toEqual(near([rect]));
    const p = pointFromFrame(pointToFrame([0.7, 0.2], frame), frame);
    expect(p[0]).toBeCloseTo(0.7);
    expect(p[1]).toBeCloseTo(0.2);
  });

  it('turns a line about the middle of its boxes, each box with it', () => {
    const line: GroupBox[] = [
      { id: 'a', rect: r(0.1, 0.1, 0.1, 0.02), line: 0, at: 0, direction: 'ltr' },
      { id: 'b', rect: r(0.3, 0.1, 0.1, 0.02), line: 0, at: 1, direction: 'ltr' },
    ];
    const frame = frameOf(line, aspect);
    expect(frame.angle).toBe(0);
    const turned = turnBoxes(line, frame, 90);
    const a = turned.get('a')!;
    const b = turned.get('b')!;
    expect(a.rotate).toBe(90);
    // A quarter turn clockwise: the first word now stands above the second, at the same x.
    expect(a.rect!.x).toBeCloseTo(b.rect!.x);
    expect(a.rect!.y).toBeLessThan(b.rect!.y);
    // 0.2 of the width apart before, 0.2 of the width (0.1333 of the height) apart after.
    expect(b.rect!.y - a.rect!.y).toBeCloseTo(0.2 / aspect);
    // Turned back, the boxes are where they were.
    const back = turnBoxes(
      [
        { ...line[0]!, ...a, rotate: 90 } as GroupBox,
        { ...line[1]!, ...b, rotate: 90 } as GroupBox,
      ],
      frameOf(
        [
          { ...line[0]!, rect: a.rect!, rotate: 90 },
          { ...line[1]!, rect: b.rect!, rotate: 90 },
        ],
        aspect,
      ),
      -90,
    );
    expect(near([back.get('a')!.rect!, back.get('b')!.rect!])).toEqual(
      near(line.map((x) => x.rect)),
    );
    expect(back.get('a')!.rotate).toBeUndefined();
  });

  it('resizes along a sloping line: the boxes after follow the slope', () => {
    const slope = 10;
    const flat: GroupBox[] = [
      { id: 'a', rect: r(0.1, 0.1, 0.1, 0.02), line: 0, at: 0, direction: 'ltr' },
      { id: 'b', rect: r(0.2, 0.1, 0.1, 0.02), line: 0, at: 1, direction: 'ltr' },
    ];
    const turned = turnBoxes(flat, frameOf(flat, aspect), slope);
    const boxes = flat.map((b) => ({ ...b, rect: turned.get(b.id)!.rect!, rotate: slope }));
    const frame = frameOf(boxes, aspect);
    expect(frame.angle).toBeCloseTo(slope);
    const local = boxesInFrame(boxes, frame);
    // In the frame the line is level again.
    expect(local[0]!.rect.y).toBeCloseTo(local[1]!.rect.y);
    const a = local[0]!.rect;
    const out = geometriesFromFrame(
      boxes,
      rippleResize(local, 'a', a.x + a.w + 0.05, undefined, frameLimits(frame)),
      frame,
    );
    const movedB = out.get('b')!;
    expect(movedB.rotate).toBe(slope);
    // B moved 0.05 along the slope: right by 0.05·cos, down by 0.05·sin (in widths, so / aspect in fractions).
    const rad = (slope * Math.PI) / 180;
    expect(movedB.rect!.x - boxes[1]!.rect.x).toBeCloseTo(0.05 * Math.cos(rad));
    expect(movedB.rect!.y - boxes[1]!.rect.y).toBeCloseTo((0.05 * Math.sin(rad)) / aspect);
  });
});
