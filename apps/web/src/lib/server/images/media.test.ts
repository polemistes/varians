import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyMediaPath, serveStorageFile } from './media';

let root: string;

const get = (p: string, headers: Record<string, string> = {}, method = 'GET') =>
  serveStorageFile(p, { method, headers: new Headers(headers) }, root);

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-media-'));
  await mkdir(path.join(root, 'tiles/p1/image_files/0'), { recursive: true });
  await mkdir(path.join(root, 'images/p1'), { recursive: true });
  await mkdir(path.join(root, 'archive'), { recursive: true });
  await writeFile(path.join(root, 'tiles/p1/image.dzi'), '<Image TileSize="512"/>');
  await writeFile(
    path.join(root, 'tiles/p1/image_files/0/0_0.jpeg'),
    Buffer.from([0xff, 0xd8, 0xff]),
  );
  await writeFile(path.join(root, 'tiles/p1/image_files/vips-properties.xml'), '<x/>');
  await writeFile(path.join(root, 'images/p1/original.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(root, 'images/p1/notes.txt'), 'private');
  await writeFile(path.join(root, 'archive/work.json'), '{}');
  await writeFile(path.join(root, 'secret.jpg'), 'top');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('classifyMediaPath', () => {
  it('allows tiles and images with known types', () => {
    expect(classifyMediaPath('tiles/p1/image.dzi')).toEqual({
      area: 'tiles',
      contentType: 'application/xml',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(classifyMediaPath('tiles/p1/image_files/3/1_2.jpeg')?.contentType).toBe('image/jpeg');
    expect(classifyMediaPath('tiles/p1/image_files/3/1_2.JPG')?.contentType).toBe('image/jpeg');
    expect(classifyMediaPath('images/p1/original.png')).toEqual({
      area: 'images',
      contentType: 'image/png',
      cacheControl: 'public, max-age=3600',
    });
    expect(classifyMediaPath('images/p1/original.webp')?.contentType).toBe('image/webp');
    expect(classifyMediaPath('images/p1/original.tif')?.contentType).toBe('image/tiff');
  });

  it('refuses other areas and other types', () => {
    expect(classifyMediaPath('archive/work.json')).toBeNull();
    expect(classifyMediaPath('secret.jpg')).toBeNull();
    expect(classifyMediaPath('tiles')).toBeNull();
    expect(classifyMediaPath('tiles/')).toBeNull();
    expect(classifyMediaPath('tiles/p1/image_files/vips-properties.xml')).toBeNull();
    expect(classifyMediaPath('images/p1/notes.txt')).toBeNull();
    expect(classifyMediaPath('images/p1/noext')).toBeNull();
    expect(classifyMediaPath('tilesx/p1/a.jpg')).toBeNull();
  });
});

describe('serveStorageFile', () => {
  it('serves a dzi as XML with an immutable cache header', async () => {
    const res = await get('tiles/p1/image.dzi');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-length')).toBe('23');
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(await res.text()).toBe('<Image TileSize="512"/>');
  });

  it('serves a tile and an original with their types', async () => {
    const tile = await get('tiles/p1/image_files/0/0_0.jpeg');
    expect(tile.status).toBe(200);
    expect(tile.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await tile.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));

    const original = await get('images/p1/original.png');
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toBe('image/png');
    expect(original.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('answers 304 to a matching ETag and no body to HEAD', async () => {
    const first = await get('tiles/p1/image.dzi');
    const etag = first.headers.get('etag')!;
    const again = await get('tiles/p1/image.dzi', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    const head = await get('tiles/p1/image.dzi', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get('content-length')).toBe('23');
  });

  it('refuses everything outside tiles and images', async () => {
    for (const p of [
      'archive/work.json',
      'secret.jpg',
      'images/p1/notes.txt',
      'tiles/p1/image_files/vips-properties.xml',
    ]) {
      expect((await get(p)).status, p).toBe(404);
    }
  });

  it('refuses path traversal', async () => {
    for (const p of [
      'tiles/../secret.jpg',
      'tiles/p1/../../secret.jpg',
      'images/p1/../../../etc/passwd.png',
      'tiles//p1/image.dzi',
      'tiles/./p1/image.dzi',
      'tiles/p1\\image.dzi',
    ]) {
      expect((await get(p)).status, p).toBe(404);
    }
  });

  it('404s for missing files and directories', async () => {
    expect((await get('tiles/p1/missing.jpeg')).status).toBe(404);
    expect((await get('tiles/p1/image_files/0.jpg')).status).toBe(404);
    expect((await get('tiles/p2/image.dzi')).status).toBe(404);
  });
});
