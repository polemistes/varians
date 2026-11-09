import { describe, expect, it } from 'vitest';
import type { Rect } from '@varians/core';
import { detectLines, divideLine, letterCount, rowProfile } from './layout';

const line: Rect = { x: 0.1, y: 0.2, w: 0.8, h: 0.05 };

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('letterCount', () => {
  it('counts code points, not combining marks or spaces', () => {
    expect(letterCount('abc')).toBe(3);
    expect(letterCount('ἄνδρα')).toBe(5);
    // decomposed alpha + psili + oxia counts as one letter
    expect(letterCount('ἄν')).toBe(2);
    expect(letterCount('a b')).toBe(2);
    expect(letterCount('')).toBe(1);
  });
});

describe('divideLine', () => {
  it('returns nothing for no words and the line itself for one word', () => {
    expect(divideLine(line, [])).toEqual([]);
    expect(divideLine(line, [{ text: 'μῆνιν' }])).toEqual([line]);
  });

  it('divides proportionally to letters with a space share between words', () => {
    // 2 + 1 + 4 letters, two spaces of one letter each: 9 units over width 0.9.
    const rects = divideLine({ x: 0, y: 0, w: 0.9, h: 0.1 }, [
      { text: 'ab' },
      { text: 'c' },
      { text: 'defg' },
    ]);
    expect(rects).toHaveLength(3);
    // Boundaries sit in the middle of each space: after 2.5 and 4.5 units.
    expect(near(rects[0].x, 0)).toBe(true);
    expect(near(rects[0].w, 0.25)).toBe(true);
    expect(near(rects[1].x, 0.25)).toBe(true);
    expect(near(rects[1].w, 0.2)).toBe(true);
    expect(near(rects[2].x, 0.45)).toBe(true);
    expect(near(rects[2].w, 0.45)).toBe(true);
    for (const r of rects) {
      expect(r.y).toBe(0);
      expect(r.h).toBe(0.1);
    }
  });

  it('keeps boxes contiguous and inside the line', () => {
    const words = ['καὶ', 'τὸν', 'ἄνδρα', 'μοι', 'ἔννεπε'].map((text) => ({ text }));
    const rects = divideLine(line, words);
    expect(near(rects[0].x, line.x)).toBe(true);
    for (let i = 1; i < rects.length; i++) {
      expect(near(rects[i].x, rects[i - 1].x + rects[i - 1].w)).toBe(true);
    }
    const last = rects[rects.length - 1];
    expect(near(last.x + last.w, line.x + line.w)).toBe(true);
  });

  it('lays rtl words from the right end', () => {
    const rects = divideLine(
      { x: 0, y: 0, w: 1, h: 0.1 },
      [{ text: 'אב' }, { text: 'גדגד' }],
      'rtl',
    );
    // 2 + 4 letters + 1 space = 7 units; boundary after 2.5 units from the right.
    expect(near(rects[0].x, 1 - 2.5 / 7)).toBe(true);
    expect(near(rects[0].x + rects[0].w, 1)).toBe(true);
    expect(near(rects[1].x, 0)).toBe(true);
    expect(near(rects[1].x + rects[1].w, 1 - 2.5 / 7)).toBe(true);
  });

  it('honours a different space share', () => {
    const rects = divideLine({ x: 0, y: 0, w: 1, h: 1 }, [{ text: 'ab' }, { text: 'cd' }], 'ltr', {
      space: 0,
    });
    expect(near(rects[0].w, 0.5)).toBe(true);
    const wide = divideLine({ x: 0, y: 0, w: 1, h: 1 }, [{ text: 'ab' }, { text: 'cd' }], 'ltr', {
      space: 2,
    });
    expect(near(wide[0].w, 0.5)).toBe(true); // symmetric either way
  });
});

/** A greyscale RGBA image: light background, dark horizontal bands at the given rows and columns. */
function synthetic(
  width: number,
  height: number,
  bands: { from: number; to: number; x0?: number; x1?: number; value?: number }[],
  background = 235,
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = background;
      for (const band of bands) {
        const x0 = band.x0 ?? 0;
        const x1 = band.x1 ?? width;
        if (y >= band.from && y <= band.to && x >= x0 && x < x1) v = band.value ?? 40;
      }
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('rowProfile', () => {
  it('is darkness per row', () => {
    const image = synthetic(10, 4, [{ from: 1, to: 2, value: 0 }], 255);
    const profile = rowProfile(image);
    expect(Array.from(profile)).toEqual([0, 255, 255, 0]);
  });
});

describe('detectLines', () => {
  it('finds three dark bands as lines, in order, with their horizontal extent', () => {
    const image = synthetic(200, 300, [
      { from: 40, to: 60, x0: 20, x1: 180 },
      { from: 100, to: 125, x0: 20, x1: 180 },
      { from: 200, to: 215, x0: 30, x1: 170 },
    ]);
    const lines = detectLines(image, { padding: 0, smooth: 1 });
    expect(lines).toHaveLength(3);
    const px = (r: Rect) => ({
      x: Math.round(r.x * 200),
      y: Math.round(r.y * 300),
      w: Math.round(r.w * 200),
      h: Math.round(r.h * 300),
    });
    expect(px(lines[0])).toEqual({ x: 20, y: 40, w: 160, h: 21 });
    expect(px(lines[1])).toEqual({ x: 20, y: 100, w: 160, h: 26 });
    expect(px(lines[2])).toEqual({ x: 30, y: 200, w: 140, h: 16 });
  });

  it('merges bands closer than minGap and drops bands thinner than minHeight', () => {
    const image = synthetic(100, 400, [
      { from: 50, to: 70 },
      { from: 72, to: 90 }, // one row of gap: the same line
      { from: 200, to: 200 }, // a speck
      { from: 300, to: 320 },
    ]);
    const lines = detectLines(image, {
      padding: 0,
      smooth: 1,
      minGap: 0.01,
      minHeight: 0.01,
      tighten: false,
    });
    expect(lines).toHaveLength(2);
    expect(Math.round(lines[0].y * 400)).toBe(50);
    expect(Math.round((lines[0].y + lines[0].h) * 400)).toBe(91);
    expect(Math.round(lines[1].y * 400)).toBe(300);
    expect(lines[0].x).toBe(0);
    expect(lines[0].w).toBe(1);
  });

  it('looks only inside the region but reports whole-image fractions', () => {
    const image = synthetic(200, 200, [
      { from: 0, to: 199, x0: 0, x1: 60, value: 10 }, // a dark margin on the left
      { from: 50, to: 60, x0: 80, x1: 180 },
      { from: 120, to: 130, x0: 80, x1: 180 },
    ]);
    const lines = detectLines(image, {
      region: { x: 0.35, y: 0, w: 0.65, h: 1 },
      padding: 0,
      smooth: 1,
    });
    expect(lines).toHaveLength(2);
    expect(Math.round(lines[0].y * 200)).toBe(50);
    expect(Math.round(lines[0].x * 200)).toBe(80);
    expect(Math.round(lines[1].y * 200)).toBe(120);
  });

  it('pads bands and returns nothing for a blank image', () => {
    const blank = synthetic(50, 50, []);
    expect(detectLines(blank)).toEqual([]);
    const image = synthetic(100, 100, [{ from: 40, to: 50 }]);
    const [lineBox] = detectLines(image, { padding: 0.02, smooth: 1, tighten: false });
    expect(Math.round(lineBox.y * 100)).toBe(38);
    expect(Math.round(lineBox.h * 100)).toBe(15);
  });

  it('accepts single-channel data', () => {
    const data = new Uint8Array(10 * 30).fill(250);
    for (let y = 10; y < 15; y++) for (let x = 0; x < 10; x++) data[y * 10 + x] = 20;
    const lines = detectLines(
      { width: 10, height: 30, data },
      { padding: 0, smooth: 1, tighten: false },
    );
    expect(lines).toHaveLength(1);
    expect(Math.round(lines[0].y * 30)).toBe(10);
  });
});
