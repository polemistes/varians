import { describe, expect, it } from 'vitest';
import { applyBoundary, boundariesOf, boundaryBetween, clampBoundary } from './dividers';

const a = { x: 0.1, y: 0, w: 0.2, h: 0.1 }; // 0.1 .. 0.3
const b = { x: 0.3, y: 0, w: 0.3, h: 0.1 }; // 0.3 .. 0.6

describe('boundaryBetween', () => {
  it('is the shared edge of touching boxes, and the midpoint of a gap', () => {
    expect(boundaryBetween(a, b)).toBeCloseTo(0.3);
    expect(boundaryBetween(a, { ...b, x: 0.4, w: 0.2 })).toBeCloseTo(0.35);
  });

  it('reads rtl pairs from the right', () => {
    const first = { x: 0.5, y: 0, w: 0.2, h: 0.1 }; // 0.5 .. 0.7
    const second = { x: 0.2, y: 0, w: 0.3, h: 0.1 }; // 0.2 .. 0.5
    expect(boundaryBetween(first, second, 'rtl')).toBeCloseTo(0.5);
    expect(boundariesOf([first, second], 'rtl')).toEqual([0.5]);
  });

  it('lists one boundary per adjacent pair', () => {
    const c = { x: 0.6, y: 0, w: 0.1, h: 0.1 };
    expect(boundariesOf([a, b, c]).map((v) => Math.round(v * 100) / 100)).toEqual([0.3, 0.6]);
    expect(boundariesOf([a])).toEqual([]);
  });
});

describe('clampBoundary', () => {
  it('keeps both words at least minWidth wide', () => {
    expect(clampBoundary(0.45, a, b, 'ltr', 0.01)).toBeCloseTo(0.45);
    expect(clampBoundary(0.05, a, b, 'ltr', 0.01)).toBeCloseTo(0.11);
    expect(clampBoundary(0.9, a, b, 'ltr', 0.01)).toBeCloseTo(0.59);
  });

  it('clamps rtl pairs the other way round', () => {
    const first = { x: 0.5, y: 0, w: 0.2, h: 0.1 };
    const second = { x: 0.2, y: 0, w: 0.3, h: 0.1 };
    expect(clampBoundary(0.1, first, second, 'rtl', 0.01)).toBeCloseTo(0.21);
    expect(clampBoundary(0.9, first, second, 'rtl', 0.01)).toBeCloseTo(0.69);
  });
});

describe('applyBoundary', () => {
  it('moves the facing edges of both boxes', () => {
    const [a2, b2] = applyBoundary(a, b, 0.35);
    expect(a2.x).toBeCloseTo(0.1);
    expect(a2.w).toBeCloseTo(0.25);
    expect(a2.y).toBe(0);
    expect(a2.h).toBe(0.1);
    expect(b2.x).toBeCloseTo(0.35);
    expect(b2.w).toBeCloseTo(0.25);
    expect(b2.x + b2.w).toBeCloseTo(0.6);
  });

  it('handles rtl', () => {
    const first = { x: 0.5, y: 0, w: 0.2, h: 0.1 };
    const second = { x: 0.2, y: 0, w: 0.3, h: 0.1 };
    const [f, s] = applyBoundary(first, second, 0.45, 'rtl');
    expect(f.x).toBeCloseTo(0.45);
    expect(f.x + f.w).toBeCloseTo(0.7);
    expect(s.x).toBeCloseTo(0.2);
    expect(s.x + s.w).toBeCloseTo(0.45);
  });
});
