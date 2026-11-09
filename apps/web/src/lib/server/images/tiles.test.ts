import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UploadError, acceptUpload, makeTiles, probeImage } from './tiles';

let root: string;

/** A 1300 x 900 image with a gradient and a few dark bars, as PNG or JPEG. */
async function testImage(
  format: 'png' | 'jpeg' | 'gif' | 'webp' = 'png',
  width = 1300,
  height = 900,
) {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const bar = y % 120 < 20;
      raw[i] = bar ? 40 : (200 + (x / width) * 50) | 0;
      raw[i + 1] = bar ? 30 : 190;
      raw[i + 2] = bar ? 20 : (150 + (y / height) * 60) | 0;
    }
  }
  const image = sharp(raw, { raw: { width, height, channels } });
  switch (format) {
    case 'png':
      return image.png().toBuffer();
    case 'jpeg':
      return image.jpeg().toBuffer();
    case 'gif':
      return image.gif().toBuffer();
    case 'webp':
      return image.webp().toBuffer();
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-tiles-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('probeImage', () => {
  it('reads dimensions and format', async () => {
    const info = await probeImage(await testImage('png', 640, 480));
    expect(info).toEqual({ width: 640, height: 480, format: 'png' });
  });

  it('reports the displayed dimensions of an EXIF-rotated image', async () => {
    const rotated = await sharp(await testImage('jpeg', 640, 480))
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const info = await probeImage(rotated);
    expect(info.width).toBe(480);
    expect(info.height).toBe(640);
  });

  it('rejects data that is not an image', async () => {
    await expect(probeImage(Buffer.from('hello, not an image'))).rejects.toThrow();
  });
});

describe('acceptUpload', () => {
  it('stores the original and writes a Deep Zoom pyramid', async () => {
    const result = await acceptUpload(await testImage('png'), 'page01', { root });
    expect(result.imagePath).toBe('images/page01/original.png');
    expect(result.dziPath).toBe('tiles/page01/image.dzi');
    expect(result.width).toBe(1300);
    expect(result.height).toBe(900);
    expect(result.format).toBe('png');

    const original = await stat(path.join(root, result.imagePath));
    expect(original.isFile()).toBe(true);
    expect(original.size).toBe(result.bytes);

    const dzi = await readFile(path.join(root, result.dziPath), 'utf8');
    expect(dzi).toContain('TileSize="512"');
    expect(dzi).toContain('Overlap="1"');
    expect(dzi).toMatch(/Format="jpe?g"/);
    expect(dzi).toContain('Width="1300"');
    expect(dzi).toContain('Height="900"');

    // libvips also drops a vips-properties.xml beside the level folders.
    const levels = (await readdir(path.join(root, 'tiles/page01/image_files')))
      .filter((name) => /^\d+$/.test(name))
      .map(Number)
      .sort((a, b) => a - b);
    // Levels run from 0 up to ceil(log2(max side)): 2^11 = 2048 covers 1300.
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBe(11);
    const top = await readdir(path.join(root, 'tiles/page01/image_files/11'));
    // 1300 x 900 at 512 px tiles: 3 columns, 2 rows.
    expect(top.length).toBe(6);
    expect(top.every((name) => /^\d+_\d+\.jpe?g$/.test(name))).toBe(true);

    const tile = await probeImage(
      path.join(root, 'tiles/page01/image_files/11/0_0.' + top[0].split('.')[1]),
    );
    expect(tile.format).toBe('jpeg');
    expect(tile.width).toBe(513); // 512 plus one pixel of overlap on the inner edge
  });

  it('accepts a File and replaces an earlier upload of another format', async () => {
    const jpeg = await testImage('jpeg', 700, 500);
    const file = new File([jpeg], 'scan.jpg', { type: 'image/jpeg' });
    const result = await acceptUpload(file, 'page01', { root });
    expect(result.imagePath).toBe('images/page01/original.jpg');
    expect(result.width).toBe(700);
    const files = await readdir(path.join(root, 'images/page01'));
    expect(files).toEqual(['original.jpg']);
    const dzi = await readFile(path.join(root, result.dziPath), 'utf8');
    expect(dzi).toContain('Width="700"');
  });

  it('accepts webp', async () => {
    const result = await acceptUpload(await testImage('webp', 300, 200), 'page02', { root });
    expect(result.format).toBe('webp');
    expect(result.imagePath).toBe('images/page02/original.webp');
  });

  it('refuses files over the limit before reading them', async () => {
    const png = await testImage('png', 300, 200);
    await expect(acceptUpload(png, 'page03', { root, maxBytes: 100 })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('refuses formats other than jpeg, png, tiff and webp', async () => {
    await expect(
      acceptUpload(await testImage('gif', 300, 200), 'page03', { root }),
    ).rejects.toMatchObject({
      code: 'unsupported-type',
    });
  });

  it('refuses data that is not an image, whatever the claimed type', async () => {
    const file = new File([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], 'x.jpg', {
      type: 'image/jpeg',
    });
    const err = await acceptUpload(file, 'page03', { root }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe('unreadable');
    await expect(stat(path.join(root, 'images/page03'))).rejects.toThrow();
  });

  it('refuses page ids with path syntax', async () => {
    await expect(
      acceptUpload(await testImage('png', 300, 200), '../x', { root }),
    ).rejects.toThrow();
  });
});

describe('makeTiles', () => {
  it('tiles an existing file and reports its size', async () => {
    const result = await acceptUpload(await testImage('png', 1000, 600), 'page04', { root });
    const again = await makeTiles(path.join(root, result.imagePath), 'page04', { root });
    expect(again).toEqual({ dziPath: 'tiles/page04/image.dzi', width: 1000, height: 600 });
  });
});
