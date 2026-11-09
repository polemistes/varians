import { describe, expect, it } from 'vitest';
import type { Shape } from '@annotorious/openseadragon';
import {
  expandRect,
  geometryEquals,
  geometryToSelector,
  selectorToGeometry,
  zoneToAnnotation,
} from './geometry';

const size = { width: 2000, height: 3000 };

describe('geometryToSelector', () => {
  it('scales a rectangle to image pixels with bounds', () => {
    const selector = geometryToSelector({ rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 } }, size)!;
    expect(selector.type).toBe('RECTANGLE');
    expect(selector.geometry).toEqual({
      x: 200,
      y: 600,
      w: 1000,
      h: 300,
      bounds: { minX: 200, minY: 600, maxX: 1200, maxY: 900 },
    });
  });

  it('scales a polygon and prefers it over a rect', () => {
    const selector = geometryToSelector(
      {
        rect: { x: 0, y: 0, w: 1, h: 1 },
        polygon: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.3],
        ],
      },
      size,
    )!;
    expect(selector.type).toBe('POLYGON');
    expect(selector.geometry).toEqual({
      points: [
        [200, 300],
        [1000, 300],
        [1000, 900],
      ],
      bounds: { minX: 200, minY: 300, maxX: 1000, maxY: 900 },
    });
  });

  it('returns null for empty geometry', () => {
    expect(geometryToSelector({}, size)).toBeNull();
    expect(geometryToSelector({ polygon: [[0, 0]] }, size)).toBeNull();
  });
});

describe('selectorToGeometry', () => {
  it('turns a rectangle back into fractions, clamped to the image', () => {
    const selector = {
      type: 'RECTANGLE',
      geometry: {
        x: -10,
        y: 600,
        w: 1010,
        h: 2500,
        bounds: { minX: -10, minY: 600, maxX: 1000, maxY: 3100 },
      },
    } as unknown as Shape;
    expect(selectorToGeometry(selector, size)).toEqual({ rect: { x: 0, y: 0.2, w: 0.5, h: 0.8 } });
  });

  it('round-trips a rectangle and a polygon', () => {
    const rect = { rect: { x: 0.123456, y: 0.2, w: 0.5, h: 0.1 } };
    expect(selectorToGeometry(geometryToSelector(rect, size)!, size)).toEqual(rect);
    const polygon = {
      polygon: [
        [0.1, 0.1],
        [0.5, 0.1],
        [0.5, 0.3],
        [0.2, 0.4],
      ] as [number, number][],
    };
    expect(selectorToGeometry(geometryToSelector(polygon, size)!, size)).toEqual(polygon);
  });

  it('keeps a rotated rectangle a rectangle, with its turn in degrees clockwise, both ways', () => {
    const selector = {
      type: 'RECTANGLE',
      geometry: {
        x: 800,
        y: 1400,
        w: 400,
        h: 200,
        rot: Math.PI / 2,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      },
    } as unknown as Shape;
    const g = selectorToGeometry(selector, size)!;
    expect(g).toEqual({ rect: { x: 0.4, y: 0.466667, w: 0.2, h: 0.066667 }, rotate: 90 });
    const back = geometryToSelector(g, size)!.geometry as unknown as { rot: number; bounds: { minX: number; maxX: number } };
    expect(back.rot).toBeCloseTo(Math.PI / 2);
    // Centre (1000, 1500); a quarter turn makes it 200 wide.
    expect(back.bounds.minX).toBeCloseTo(900, 0);
    expect(back.bounds.maxX).toBeCloseTo(1100, 0);
    expect(geometryEquals(g, { ...g, rotate: 91 })).toBe(false);
  });

  it('reduces other shapes to their bounds and rejects empty ones', () => {
    const ellipse = {
      type: 'ELLIPSE',
      geometry: {
        cx: 500,
        cy: 600,
        rx: 100,
        ry: 300,
        bounds: { minX: 400, minY: 300, maxX: 600, maxY: 900 },
      },
    } as unknown as Shape;
    expect(selectorToGeometry(ellipse, size)).toEqual({ rect: { x: 0.2, y: 0.1, w: 0.1, h: 0.2 } });
    const multi = {
      type: 'MULTIPOLYGON',
      geometry: {
        polygons: [
          {
            rings: [
              {
                points: [
                  [0, 0],
                  [1000, 0],
                  [0, 1500],
                ],
              },
            ],
            bounds: {},
          },
        ],
        bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1500 },
      },
    } as unknown as Shape;
    expect(selectorToGeometry(multi, size)).toEqual({
      polygon: [
        [0, 0],
        [0.5, 0],
        [0, 0.5],
      ],
    });
    const flat = {
      type: 'RECTANGLE',
      geometry: { x: 10, y: 10, w: 0, h: 50, bounds: { minX: 10, minY: 10, maxX: 10, maxY: 60 } },
    } as unknown as Shape;
    expect(selectorToGeometry(flat, size)).toBeNull();
  });
});

describe('zoneToAnnotation', () => {
  it('carries the id and kind', () => {
    const a = zoneToAnnotation(
      {
        id: 'z1',
        geometry: { rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        tokenIds: ['t1'],
        kind: 'line',
      },
      size,
    )!;
    expect(a.id).toBe('z1');
    expect(a.target.annotation).toBe('z1');
    expect(a.target.selector.type).toBe('RECTANGLE');
    expect(a.properties).toEqual({ kind: 'line' });
    expect(zoneToAnnotation({ id: 'z2', geometry: {}, tokenIds: [] }, size)).toBeNull();
  });
});

describe('geometryEquals', () => {
  it('compares within a tolerance', () => {
    const a = { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } };
    expect(geometryEquals(a, { rect: { x: 0.100001, y: 0.2, w: 0.3, h: 0.4 } })).toBe(true);
    expect(geometryEquals(a, { rect: { x: 0.11, y: 0.2, w: 0.3, h: 0.4 } })).toBe(false);
    const p = {
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
      ] as [number, number][],
    };
    expect(
      geometryEquals(p, {
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      }),
    ).toBe(true);
    expect(
      geometryEquals(p, {
        polygon: [
          [0, 0],
          [1, 0],
          [1, 0.5],
        ],
      }),
    ).toBe(false);
    expect(geometryEquals(p, a)).toBe(false);
    expect(geometryEquals(null, null)).toBe(true);
    expect(geometryEquals(a, null)).toBe(false);
  });
});

describe('expandRect', () => {
  it('grows a rectangle and keeps it inside the image', () => {
    const grown = expandRect({ x: 0.2, y: 0.2, w: 0.2, h: 0.1 }, 0.5);
    expect(grown.x).toBeCloseTo(0.1);
    expect(grown.y).toBeCloseTo(0.15);
    expect(grown.w).toBeCloseTo(0.4);
    expect(grown.h).toBeCloseTo(0.2);
    const clamped = expandRect({ x: 0, y: 0.9, w: 0.5, h: 0.1 }, 1);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBeCloseTo(0.8);
    expect(clamped.w).toBe(1);
    expect(clamped.h).toBeCloseTo(0.2);
  });
});
