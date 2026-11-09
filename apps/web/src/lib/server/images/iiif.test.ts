import { describe, expect, it } from 'vitest';
import v2 from './fixtures/manifest-v2.json';
import v3 from './fixtures/manifest-v3.json';
import {
  ManifestError,
  fetchManifest,
  imageInfoUrl,
  labelText,
  loadManifest,
  normalizeServiceId,
  parseManifest,
  thumbnailUrl,
} from './iiif';

describe('labelText', () => {
  it('reads strings, arrays and v2 value objects, preferring English', () => {
    expect(labelText('1r')).toBe('1r');
    expect(labelText(['a', 'b'])).toBe('a');
    expect(labelText(12)).toBe('12');
    expect(labelText({ '@value': 'fol. 3', '@language': 'la' })).toBe('fol. 3');
    expect(
      labelText([
        { '@value': 'Blatt 1', '@language': 'de' },
        { '@value': 'Leaf 1', '@language': 'en' },
      ]),
    ).toBe('Leaf 1');
    expect(labelText([{ '@value': 'Blatt 1', '@language': 'de' }, 'plain'])).toBe('plain');
  });

  it('reads v3 language maps: en, then none, then the first', () => {
    expect(labelText({ de: ['Handschrift'], en: ['Manuscript'] })).toBe('Manuscript');
    expect(labelText({ de: ['Handschrift'], none: ['MS 2'] })).toBe('MS 2');
    expect(labelText({ de: ['Handschrift'], fr: ['Manuscrit'] })).toBe('Handschrift');
    expect(labelText({ 'en-GB': ['Colour'], none: ['x'] })).toBe('Colour');
    expect(labelText({ en: ['Vol. 1', 'Part 2'] })).toBe('Vol. 1, Part 2');
  });

  it('returns null for nothing', () => {
    expect(labelText(undefined)).toBeNull();
    expect(labelText('')).toBeNull();
    expect(labelText({})).toBeNull();
    expect(labelText([])).toBeNull();
  });
});

describe('image API URLs', () => {
  it('normalizes a service id and builds info and thumbnail URLs', () => {
    expect(normalizeServiceId('https://x.org/iiif/a/info.json')).toBe('https://x.org/iiif/a');
    expect(normalizeServiceId('https://x.org/iiif/a/')).toBe('https://x.org/iiif/a');
    expect(imageInfoUrl('https://x.org/iiif/a/')).toBe('https://x.org/iiif/a/info.json');
    expect(thumbnailUrl('https://x.org/iiif/a', 300)).toBe(
      'https://x.org/iiif/a/full/300,/0/default.jpg',
    );
    expect(thumbnailUrl('https://x.org/iiif/a/info.json', 149.6)).toBe(
      'https://x.org/iiif/a/full/150,/0/default.jpg',
    );
  });
});

describe('parseManifest, Presentation API 2', () => {
  const url = 'https://example.org/iiif/ms-1/manifest';
  const result = parseManifest(v2, url);

  it('reads the label in English and detects the version', () => {
    expect(result.label).toBe('Codex Exemplaris');
    expect(result.version).toBe(2);
    expect(result.canvases).toHaveLength(4);
  });

  it('reads canvases with an image service, normalizing the service id', () => {
    const c = result.canvases[0];
    expect(c).toEqual({
      id: 'https://example.org/iiif/ms-1/canvas/1',
      label: '1r',
      width: 4000,
      height: 6000,
      imageService: 'https://example.org/iiif/images/f1r',
      imageUrl: 'https://example.org/iiif/images/f1r/full/full/0/default.jpg',
    });
  });

  it('keeps a direct image without a service and falls back to its dimensions', () => {
    const c = result.canvases[1];
    expect(c.imageService).toBeNull();
    expect(c.imageUrl).toBe('https://example.org/static/f1v.jpg');
    expect(c.width).toBe(3800);
    expect(c.height).toBe(5900);
    expect(result.warnings).toContain('Canvas "1v" has no dimensions; using the image\'s.');
  });

  it('unwraps an oa:Choice to its default and strips /info.json', () => {
    const c = result.canvases[2];
    expect(c.imageService).toBe('https://example.org/iiif/images/f2r-natural');
  });

  it('keeps a canvas without images and warns', () => {
    const c = result.canvases[3];
    expect(c.label).toBe('2v');
    expect(c.imageService).toBeNull();
    expect(c.imageUrl).toBeUndefined();
    expect(result.warnings).toContain('Canvas "2v" has no image.');
  });
});

describe('parseManifest, Presentation API 3', () => {
  const url = 'https://example.org/iiif/3/ms-2/manifest';
  const result = parseManifest(v3, url);

  it('reads the label from the language map, preferring English', () => {
    expect(result.label).toBe('Manuscript 2');
    expect(result.version).toBe(3);
    expect(result.canvases).toHaveLength(4);
  });

  it('reads a painting body with an ImageService3 service', () => {
    expect(result.canvases[0]).toEqual({
      id: 'https://example.org/iiif/3/ms-2/canvas/p1',
      label: 'f. 1r',
      width: 3000,
      height: 4500,
      imageService: 'https://example.org/iiif/3/images/p1',
      imageUrl: 'https://example.org/iiif/3/images/p1/full/max/0/default.jpg',
    });
  });

  it('skips non-painting annotations and takes the first item of a Choice, reading @id/@type services', () => {
    const c = result.canvases[1];
    expect(c.label).toBe('f. 1v');
    expect(c.imageService).toBe('https://example.org/iiif/2/images/p2-color');
  });

  it('numbers an unlabelled canvas, resolves relative ids and takes dimensions from the body', () => {
    const c = result.canvases[2];
    expect(c.label).toBe('3');
    expect(c.imageService).toBeNull();
    expect(c.imageUrl).toBe('https://example.org/iiif/3/static/p3.png');
    expect(c.width).toBe(2800);
    expect(c.height).toBe(4200);
    expect(result.warnings).toContain('Canvas 3 has no label; numbered instead.');
  });

  it('warns about a canvas without an image', () => {
    expect(result.canvases[3].imageService).toBeNull();
    expect(result.warnings).toContain('Canvas "f. 2v" has no image.');
  });
});

describe('parseManifest, bad input', () => {
  it('refuses non-objects and documents that are neither version', () => {
    expect(() => parseManifest(null, 'https://x.org/m')).toThrow(ManifestError);
    expect(() => parseManifest('text', 'https://x.org/m')).toThrow(ManifestError);
    const err = (() => {
      try {
        parseManifest({ hello: 'world' }, 'https://x.org/m');
      } catch (e) {
        return e as ManifestError;
      }
    })();
    expect(err?.code).toBe('unsupported');
  });

  it('refuses collections', () => {
    expect(() =>
      parseManifest({ '@type': 'sc:Collection', manifests: [] }, 'https://x.org/c'),
    ).toThrow(/collection/i);
    expect(() => parseManifest({ type: 'Collection', items: [] }, 'https://x.org/c')).toThrow(
      /collection/i,
    );
  });

  it('tolerates a manifest without canvases or label', () => {
    const result = parseManifest({ type: 'Manifest', items: [] }, 'https://x.org/m');
    expect(result.canvases).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining(['The manifest has no label.', 'The manifest has no canvases.']),
    );
  });
});

describe('fetchManifest', () => {
  const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });

  it('fetches and parses JSON with an Accept header', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = init;
      return jsonResponse(v3);
    };
    const json = await fetchManifest('https://example.org/iiif/3/ms-2/manifest', { fetchImpl });
    expect((json as { type: string }).type).toBe('Manifest');
    expect((seen?.headers as Record<string, string>).accept).toMatch(/ld\+json/);
    const manifest = await loadManifest('https://example.org/iiif/3/ms-2/manifest', { fetchImpl });
    expect(manifest.label).toBe('Manuscript 2');
  });

  it('refuses non-http URLs and bad URLs', async () => {
    await expect(fetchManifest('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid' });
    await expect(fetchManifest('not a url')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('reports HTTP errors', async () => {
    const fetchImpl: typeof fetch = async () => new Response('gone', { status: 404 });
    await expect(fetchManifest('https://example.org/m', { fetchImpl })).rejects.toMatchObject({
      code: 'fetch',
    });
  });

  it('caps the size, by header and by body', async () => {
    const big = jsonResponse({ a: 'x'.repeat(5000) });
    await expect(
      fetchManifest('https://example.org/m', { fetchImpl: async () => big, maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'too-large' });

    const declared = new Response('{}', { status: 200, headers: { 'content-length': '999999' } });
    await expect(
      fetchManifest('https://example.org/m', { fetchImpl: async () => declared, maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'too-large' });
  });

  it('times out', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    await expect(
      fetchManifest('https://example.org/m', { fetchImpl, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects responses that are not JSON', async () => {
    const fetchImpl: typeof fetch = async () => new Response('<html></html>', { status: 200 });
    await expect(fetchManifest('https://example.org/m', { fetchImpl })).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});
