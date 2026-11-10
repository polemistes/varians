import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { newId, type Item } from '@varians/core';
import {
  changesets,
  createDatabase,
  desc,
  eq,
  pages,
  transcriptions,
  users,
  witnesses,
  zones,
  type Database,
} from '@varians/db';
import {
  followingLabel,
  labelFromFileName,
  labelsAfter,
  sortByName,
} from '$lib/components/pages/labels';
import type { IiifManifest } from '$lib/server/images/iiif';
import { loadManifest } from '$lib/server/images/iiif';
import { undoChangeset } from '$lib/server/history';
import { UploadError } from '$lib/server/images/tiles';
import {
  PageError,
  addImagePage,
  addPages,
  attachUpload,
  detachImage,
  dziThumbnailLevel,
  expandLabels,
  importManifest,
  mergeOrder,
  moveImage,
  movePage,
  canvasRights,
  pageSource,
  pagesWithoutRights,
  parseImageRights,
  setWitnessImageDefaults,
  updatePageRights,
  pageViewsOf,
  pagesOfWitness,
  shiftImages,
  previewManifest,
  referenceCounts,
  referencesOf,
  removePage,
  renamePage,
  thumbnailOf,
} from './pages';

vi.mock('$lib/server/images/iiif', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/images/iiif')>();
  return { ...actual, loadManifest: vi.fn() };
});

const mockedLoad = vi.mocked(loadManifest);

function labelsOf(spec: string): string[] {
  const result = expandLabels(spec);
  if (!result.ok) throw new Error(`expected labels for "${spec}", got: ${result.error}`);
  return result.labels;
}

function errorOf(spec: string, max?: number): string {
  const result = expandLabels(spec, max);
  if (result.ok)
    throw new Error(`expected an error for "${spec}", got ${result.labels.length} labels`);
  return result.error;
}

describe('expandLabels', () => {
  it('expands folio sides, recto and verso', () => {
    const labels = labelsOf('1r-12v');
    expect(labels).toHaveLength(24);
    expect(labels.slice(0, 5)).toEqual(['1r', '1v', '2r', '2v', '3r']);
    expect(labels.at(-1)).toBe('12v');
    expect(labelsOf('1v-3r')).toEqual(['1v', '2r', '2v', '3r']);
    expect(labelsOf('12r-12v')).toEqual(['12r', '12v']);
    expect(labelsOf('f. 1r - f. 2v')).toEqual(['f. 1r', 'f. 1v', 'f. 2r', 'f. 2v']);
    expect(labelsOf('fol. 7v–8r')).toEqual(['fol. 7v', 'fol. 8r']);
    expect(labelsOf('001R-002V')).toEqual(['001R', '001V', '002R', '002V']);
  });

  it('expands numbers, with prefixes and leading zeros', () => {
    const labels = labelsOf('1-20');
    expect(labels).toHaveLength(20);
    expect(labels[0]).toBe('1');
    expect(labels[19]).toBe('20');
    expect(labelsOf('p. 1-20')).toHaveLength(20);
    expect(labelsOf('p. 1-20').slice(0, 2)).toEqual(['p. 1', 'p. 2']);
    expect(labelsOf('p. 1-20').at(-1)).toBe('p. 20');
    expect(labelsOf('p. 1 - p. 3')).toEqual(['p. 1', 'p. 2', 'p. 3']);
    expect(labelsOf('008-011')).toEqual(['008', '009', '010', '011']);
    expect(labelsOf('MS-A 1-3')).toEqual(['MS-A 1', 'MS-A 2', 'MS-A 3']);
  });

  it('expands Roman numerals and letters', () => {
    expect(labelsOf('col. i-iv')).toEqual(['col. i', 'col. ii', 'col. iii', 'col. iv']);
    expect(labelsOf('I-IV')).toEqual(['I', 'II', 'III', 'IV']);
    expect(labelsOf('col. ix-xii')).toEqual(['col. ix', 'col. x', 'col. xi', 'col. xii']);
    expect(labelsOf('fr. a-d')).toEqual(['fr. a', 'fr. b', 'fr. c', 'fr. d']);
  });

  it('takes lists as given, and mixes lists with ranges', () => {
    expect(labelsOf('12r, 12v, 13r')).toEqual(['12r', '12v', '13r']);
    expect(labelsOf('Front cover; 1r-1v,\nFly-leaf ,  Back   cover')).toEqual([
      'Front cover',
      '1r',
      '1v',
      'Fly-leaf',
      'Back cover',
    ]);
    expect(labelsOf('12r')).toEqual(['12r']);
  });

  it('says what is wrong with invalid input', () => {
    expect(errorOf('')).toMatch(/at least one label/);
    expect(errorOf(' , ;')).toMatch(/at least one label/);
    expect(errorOf('12-1')).toMatch(/backwards/);
    expect(errorOf('3v-3r')).toMatch(/backwards/);
    expect(errorOf('1r-12')).toMatch(/not of the same kind/);
    expect(errorOf('p. 1 - f. 3')).toMatch(/different prefixes/);
    expect(errorOf('1-')).toMatch(/only one end/);
    expect(errorOf('1-5000')).toMatch(/5000 pages; at most 2000/);
    expect(errorOf('1-10, 11-20', 15)).toMatch(/20 pages; at most 15/);
    expect(errorOf('x'.repeat(121))).toMatch(/at most 120 characters/);
  });
});

describe('labels that follow', () => {
  it('continues folios, numbers and numerals', () => {
    expect(followingLabel('12r')).toBe('12v');
    expect(followingLabel('12v')).toBe('13r');
    expect(followingLabel('f. 3v')).toBe('f. 4r');
    expect(followingLabel('p. 9')).toBe('p. 10');
    expect(followingLabel('009')).toBe('010');
    expect(followingLabel('col. iv')).toBe('col. v');
    expect(followingLabel('Front cover')).toBeNull();
    expect(labelsAfter('12v', 3)).toEqual(['13r', '13v', '14r']);
    expect(labelsAfter('Back cover', 2)).toBeNull();
    expect(labelsAfter(null, 2)).toBeNull();
    expect(labelsAfter('7', 0)).toEqual([]);
  });

  it('makes labels from file names, in natural order', () => {
    expect(labelFromFileName('IMG_0001.jpg')).toBe('IMG_0001');
    expect(labelFromFileName('scans/012r.tif')).toBe('012r');
    expect(labelFromFileName('folio 3 recto.JPEG')).toBe('folio 3 recto');
    expect(
      sortByName([{ name: 'p10.jpg' }, { name: 'p2.jpg' }, { name: 'p1.jpg' }]).map((f) => f.name),
    ).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
  });
});

describe('what the screen shows', () => {
  const base = {
    id: '01TESTPAGE',
    imagePath: null,
    imageIiif: null,
    imageWidth: null,
    imageHeight: null,
    tilesPath: null,
    updatedAt: new Date(1_700_000_000_000),
  };

  it('finds the one-tile level of a pyramid', () => {
    expect(dziThumbnailLevel(1300, 900)).toBe(9);
    expect(dziThumbnailLevel(512, 300)).toBe(9);
    expect(dziThumbnailLevel(100, 100)).toBe(7);
    expect(dziThumbnailLevel(1, 1)).toBe(0);
  });

  it('gives sources and thumbnails for uploads and IIIF, and none without an image', () => {
    expect(pageSource({ ...base, imageKind: null })).toBeNull();
    expect(thumbnailOf({ ...base, imageKind: null })).toBeNull();
    const iiif = {
      ...base,
      imageKind: 'iiif' as const,
      imageIiif: 'https://iiif.example.org/image/p1/',
    };
    expect(pageSource(iiif)).toEqual({
      kind: 'iiif',
      infoUrl: 'https://iiif.example.org/image/p1/info.json',
    });
    expect(thumbnailOf(iiif)).toBe('https://iiif.example.org/image/p1/full/240,/0/default.jpg');
    const upload = {
      ...base,
      imageKind: 'upload' as const,
      imagePath: 'images/01TESTPAGE/original.tif',
      tilesPath: 'tiles/01TESTPAGE/image.dzi',
      imageWidth: 1300,
      imageHeight: 900,
    };
    const version = (1_700_000_000_000).toString(36);
    expect(pageSource(upload)).toEqual({
      kind: 'dzi',
      url: `/media/tiles/01TESTPAGE/image.dzi?v=${version}`,
    });
    expect(thumbnailOf(upload)).toBe(`/media/tiles/01TESTPAGE/image_files/9/0_0.jpeg?v=${version}`);
    expect(thumbnailOf({ ...upload, tilesPath: null })).toBe(
      `/media/images/01TESTPAGE/original.tif?v=${version}`,
    );
  });

  it('merges the order of an import around the pages already there', () => {
    expect(mergeOrder(['a', 'b'], ['n1', 'n2'], new Set())).toEqual(['a', 'b', 'n1', 'n2']);
    expect(
      mergeOrder(['cover', 'x', 'note', 'y'], ['n1', 'x', 'n2', 'y', 'n3'], new Set(['x', 'y'])),
    ).toEqual(['cover', 'n1', 'x', 'note', 'n2', 'y', 'n3']);
  });
});

// The database: records of our own, removed afterwards.

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let root: string;
const ids = {
  user: newId(),
  witness: newId(),
  other: newId(),
  iiif: newId(),
  transcription: newId(),
};
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const PDM = 'https://creativecommons.org/publicdomain/mark/1.0/';
const IN_COPYRIGHT = 'http://rightsstatements.org/vocab/InC/1.0/';
const RIGHTS = { rights: CC_BY, attribution: 'Test Library', imageSource: null };

async function testImage(width = 1300, height = 900): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      raw[i] = (200 + (x / width) * 50) | 0;
      raw[i + 1] = y % 100 < 10 ? 40 : 190;
      raw[i + 2] = (150 + (y / height) * 60) | 0;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** The file on disk behind a /media URL. */
function mediaFile(url: string): string {
  return path.join(root, url.replace(/^\/media\//, '').replace(/\?.*$/, ''));
}

async function labels(witnessId: string): Promise<string[]> {
  return (await pagesOfWitness(db, witnessId)).map((p) => p.label);
}

async function setBreaks(pageIds: string[]): Promise<void> {
  const items: Item[] = pageIds.map((pageId, i) => ({
    kind: 'break',
    id: `b${i}`,
    type: 'page',
    pageId,
  }));
  await db
    .update(transcriptions)
    .set({ content: { items } })
    .where(eq(transcriptions.id, ids.transcription));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  root = await mkdtemp(path.join(os.tmpdir(), 'varians-pages-'));
  await db
    .insert(users)
    .values({ id: ids.user, email: `${ids.user}@test`, name: 'Pages Tester', passwordHash: 'x' });
  await db.insert(witnesses).values([
    { id: ids.witness, slug: `w-${ids.witness}`, siglum: 'P', name: 'Pages test' },
    { id: ids.other, slug: `w-${ids.other}`, siglum: 'Q', name: 'Other witness' },
    { id: ids.iiif, slug: `w-${ids.iiif}`, siglum: 'R', name: 'IIIF witness' },
  ]);
  await db
    .insert(transcriptions)
    .values({ id: ids.transcription, witnessId: ids.witness, name: 'Iliad 1', ownerId: ids.user });
});

afterAll(async () => {
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(witnesses).where(eq(witnesses.id, ids.other));
  await db.delete(witnesses).where(eq(witnesses.id, ids.iiif));
  await db.delete(users).where(eq(users.id, ids.user));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('the list of pages', () => {
  it('appends pages after the last position', async () => {
    const first = await addPages(db, ids.witness, ['1r', '1v']);
    expect(first.map((p) => [p.label, p.position])).toEqual([
      ['1r', 1],
      ['1v', 2],
    ]);
    const second = await addPages(db, ids.witness, labelsOf('2r-3r'));
    expect(second.map((p) => p.position)).toEqual([3, 4, 5]);
    expect(await labels(ids.witness)).toEqual(['1r', '1v', '2r', '2v', '3r']);
    expect(await addPages(db, ids.witness, [])).toEqual([]);
    await expect(addPages(db, ids.witness, ['  '])).rejects.toBeInstanceOf(PageError);
    // Another witness's list is its own.
    const other = await addPages(db, ids.other, ['A']);
    expect(other[0]!.position).toBe(1);
  });

  it('renames a page', async () => {
    const [page] = await pagesOfWitness(db, ids.witness);
    const renamed = await renamePage(db, page!.id, '  1r   bis ');
    expect(renamed?.label).toBe('1r bis');
    await renamePage(db, page!.id, '1r');
    await expect(renamePage(db, page!.id, '')).rejects.toThrow(/at least one label/);
    expect(await renamePage(db, 'no-such-page', '2r')).toBeNull();
  });

  it('moves a page and renumbers the list', async () => {
    const list = await pagesOfWitness(db, ids.witness);
    const last = list.at(-1)!;
    const moved = await movePage(db, last.id, 0);
    expect(moved?.map((p) => p.label)).toEqual(['3r', '1r', '1v', '2r', '2v']);
    const stored = await pagesOfWitness(db, ids.witness);
    expect(stored.map((p) => p.position)).toEqual([1, 2, 3, 4, 5]);
    expect(stored.map((p) => p.label)).toEqual(['3r', '1r', '1v', '2r', '2v']);
    // Beyond the end goes to the end.
    await movePage(db, last.id, 99);
    expect(await labels(ids.witness)).toEqual(['1r', '1v', '2r', '2v', '3r']);
    const v1 = stored.find((p) => p.label === '1v')!;
    await movePage(db, v1.id, 2);
    expect(await labels(ids.witness)).toEqual(['1r', '2r', '1v', '2v', '3r']);
    await movePage(db, v1.id, 1);
    expect(await labels(ids.witness)).toEqual(['1r', '1v', '2r', '2v', '3r']);
    expect(await movePage(db, 'no-such-page', 1)).toBeNull();
  });

  it('removes a page with its zones, and moves its text to Not on a page in every transcript', async () => {
    const [p1r, p1v, p2r, p2v] = await pagesOfWitness(db, ids.witness);
    await db.insert(zones).values({
      id: newId(),
      transcriptionId: ids.transcription,
      pageId: p1r!.id,
      geometry: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } },
      tokenIds: ['t1'],
    });
    const content: Item[] = [
      { kind: 'token', id: 'u0', form: 'ἄνδρα' },
      { kind: 'break', id: 'b1', type: 'page', pageId: p1v!.id },
      { kind: 'token', id: 't1', form: 'μῆνιν' },
      { kind: 'token', id: 't2', form: 'ἄειδε' },
      { kind: 'break', id: 'b2', type: 'page', pageId: p2r!.id },
      { kind: 'token', id: 't3', form: 'θεὰ' },
    ];
    await db
      .update(transcriptions)
      .set({ content: { items: content } })
      .where(eq(transcriptions.id, ids.transcription));

    const counts = await referenceCounts(db, ids.witness);
    expect(counts.get(p1r!.id)).toEqual({ zones: 1, transcriptions: 0, words: 0 });
    expect(counts.get(p1v!.id)).toEqual({ zones: 0, transcriptions: 1, words: 2 });
    expect(counts.has(p2v!.id)).toBe(false);
    expect((await referencesOf(db, p1v!)).transcriptions.map((t) => [t.name, t.words])).toEqual([
      ['Iliad 1', 2],
    ]);

    const zoned = await removePage(db, p1r!.id, root, ids.user);
    expect(zoned).toMatchObject({ ok: true, moved: { words: 0, transcriptions: 0 } });
    expect(await db.select().from(zones).where(eq(zones.pageId, p1r!.id))).toEqual([]);

    const removed = await removePage(db, p1v!.id, root, ids.user);
    expect(removed).toMatchObject({ ok: true, moved: { words: 2, transcriptions: 1 } });
    const [row] = await db
      .select({ content: transcriptions.content, version: transcriptions.version })
      .from(transcriptions)
      .where(eq(transcriptions.id, ids.transcription));
    const shape = row!.content.items.map((i) =>
      i.kind === 'break' ? `#${i.type === 'page' ? i.pageId : i.type}` : i.id,
    );
    expect(shape).toEqual(['u0', '#line', 't1', 't2', `#${p2r!.id}`, 't3']);
    const [log] = await db
      .select()
      .from(changesets)
      .where(eq(changesets.documentId, ids.transcription))
      .orderBy(desc(changesets.version))
      .limit(1);
    expect(log!.message).toBe('Page 1v removed from the witness; its text is not on a page');
    expect(log!.userId).toBe(ids.user);

    // Undoing that changeset cannot bring back a page break for the page that is gone: the save keeps the shape.
    const undone = await undoChangeset(db, 'transcription', ids.transcription, ids.user, log!.id);
    expect(undone.ok).toBe(true);
    const [again] = await db
      .select({ content: transcriptions.content })
      .from(transcriptions)
      .where(eq(transcriptions.id, ids.transcription));
    expect(
      again!.content.items.flatMap((i) =>
        i.kind === 'break' && i.type === 'page' ? [i.pageId] : [],
      ),
    ).toEqual([p2r!.id]);
    expect(again!.content.items.flatMap((i) => (i.kind === 'token' ? [i.id] : []))).toEqual([
      'u0',
      't1',
      't2',
      't3',
    ]);

    const free = await removePage(db, p2v!.id, root, ids.user);
    expect(free.ok).toBe(true);
    expect(await labels(ids.witness)).toEqual(['2r', '3r']);
    expect(await removePage(db, p2v!.id, root)).toEqual({ ok: false, reason: 'not-found' });
    await setBreaks([]);
  });

  it('puts the text of the transcripts in the new order of the pages', async () => {
    const list = await pagesOfWitness(db, ids.witness);
    const [first, second] = list;
    const content: Item[] = [
      { kind: 'break', id: 'b1', type: 'page', pageId: first!.id },
      { kind: 'token', id: 'a', form: 'a' },
      { kind: 'break', id: 'b2', type: 'page', pageId: second!.id },
      { kind: 'token', id: 'b', form: 'b' },
    ];
    await db
      .update(transcriptions)
      .set({ content: { items: content } })
      .where(eq(transcriptions.id, ids.transcription));
    await movePage(db, second!.id, 0, ids.user);
    const [row] = await db
      .select({ content: transcriptions.content })
      .from(transcriptions)
      .where(eq(transcriptions.id, ids.transcription));
    expect(row!.content.items.map((i) => i.id)).toEqual(['b2', 'b', 'b1', 'a']);
    const [log] = await db
      .select()
      .from(changesets)
      .where(eq(changesets.documentId, ids.transcription))
      .orderBy(desc(changesets.version))
      .limit(1);
    expect(log!.message).toBe('Pages reordered');
    await movePage(db, second!.id, 1, ids.user);
    await setBreaks([]);
  });
});

describe('uploaded images', () => {
  it('attaches an upload, tiles it, and detaches it again', async () => {
    const [page] = await addPages(db, ids.witness, ['4r']);
    const attached = await attachUpload(db, page!.id, await testImage(), RIGHTS, root);
    expect(attached).toMatchObject({
      imageKind: 'upload',
      imagePath: `images/${page!.id}/original.png`,
      tilesPath: `tiles/${page!.id}/image.dzi`,
      imageIiif: null,
      imageWidth: 1300,
      imageHeight: 900,
    });
    expect(await exists(path.join(root, attached!.imagePath!))).toBe(true);
    expect(await exists(path.join(root, attached!.tilesPath!))).toBe(true);
    // The thumbnail is a real tile of the pyramid.
    const thumbnail = thumbnailOf(attached!);
    expect(thumbnail).toMatch(/image_files\/9\/0_0\.jpeg\?v=/);
    expect(await exists(mediaFile(thumbnail!))).toBe(true);
    const tile = await sharp(mediaFile(thumbnail!)).metadata();
    expect([tile.width, tile.height]).toEqual([325, 225]);
    expect(pageSource(attached!)).toEqual({
      kind: 'dzi',
      url: expect.stringMatching(new RegExp(`^/media/tiles/${page!.id}/image\\.dzi\\?v=`)),
    });

    const detached = await detachImage(db, page!.id, root);
    expect(detached).toMatchObject({
      imageKind: null,
      imagePath: null,
      tilesPath: null,
      imageWidth: null,
      imageHeight: null,
    });
    expect(await exists(path.join(root, 'images', page!.id))).toBe(false);
    expect(await exists(path.join(root, 'tiles', page!.id))).toBe(false);

    await expect(
      attachUpload(db, page!.id, Buffer.from('not an image at all'), RIGHTS, root),
    ).rejects.toMatchObject({
      code: 'unreadable',
    });
    await expect(
      attachUpload(db, page!.id, await testImage(40, 40), RIGHTS, root, { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(
      await attachUpload(db, 'no-such-page', await testImage(40, 40), RIGHTS, root),
    ).toBeNull();
  });

  it('adds a page with its image, and none for a file that is not an image', async () => {
    const before = await labels(ids.witness);
    const page = await addImagePage(
      db,
      ids.witness,
      'IMG_0007',
      await testImage(600, 800),
      RIGHTS,
      root,
    );
    expect(page).toMatchObject({
      label: 'IMG_0007',
      imageKind: 'upload',
      imageWidth: 600,
      imageHeight: 800,
    });
    expect(await labels(ids.witness)).toEqual([...before, 'IMG_0007']);
    await expect(
      addImagePage(db, ids.witness, 'broken', Buffer.from('GIF89a nonsense'), RIGHTS, root),
    ).rejects.toBeInstanceOf(UploadError);
    expect(await labels(ids.witness)).toEqual([...before, 'IMG_0007']);
    const left = await readdir(path.join(root, 'images'));
    expect(left).toEqual([page.id]);

    const removed = await removePage(db, page.id, root);
    expect(removed.ok).toBe(true);
    expect(await exists(path.join(root, 'images', page.id))).toBe(false);
    expect(await exists(path.join(root, 'tiles', page.id))).toBe(false);
  });
});

describe('rights of images', () => {
  it('checks a statement, credit line and source', () => {
    expect(
      parseImageRights({
        rights: 'http://creativecommons.org/licenses/by/4.0/deed.de',
        attribution: '  Biblioteca\n Laurenziana ',
      }),
    ).toEqual({
      ok: true,
      value: { rights: CC_BY, attribution: 'Biblioteca Laurenziana', imageSource: null },
    });
    expect(parseImageRights({})).toMatchObject({ ok: false, field: 'rights' });
    expect(
      parseImageRights({ rights: 'https://creativecommons.org/licenses/by/3.0/' }),
    ).toMatchObject({ ok: false, field: 'rights' });
    expect(parseImageRights({ rights: CC_BY, attribution: 'x'.repeat(501) })).toMatchObject({
      ok: false,
      field: 'attribution',
    });
    expect(
      parseImageRights({ rights: CC_BY, imageSource: 'ftp://example.org/a.jpg' }),
    ).toMatchObject({ ok: false, field: 'imageSource' });
    expect(
      parseImageRights({ rights: CC_BY, imageSource: 'https://example.org/a.jpg' }),
    ).toMatchObject({
      ok: true,
      value: { imageSource: 'https://example.org/a.jpg' },
    });
  });

  it('refuses an upload without a valid statement, and stores the one given', async () => {
    const [page] = await addPages(db, ids.witness, ['R1']);
    for (const rights of [{}, { rights: '' }, { rights: 'https://example.org/my-licence' }]) {
      await expect(
        attachUpload(db, page!.id, await testImage(40, 40), rights, root),
      ).rejects.toMatchObject({ code: 'invalid-rights' });
    }
    expect(await exists(path.join(root, 'images', page!.id))).toBe(false);
    const before = await labels(ids.witness);
    await expect(
      addImagePage(db, ids.witness, 'R2', await testImage(40, 40), {}, root),
    ).rejects.toBeInstanceOf(PageError);
    expect(await labels(ids.witness)).toEqual(before);

    const attached = await attachUpload(
      db,
      page!.id,
      await testImage(40, 40),
      {
        rights: 'https://rightsstatements.org/vocab/InC/1.0',
        attribution: 'Owner',
        imageSource: 'https://example.org/r1.jpg',
      },
      root,
    );
    expect(attached).toMatchObject({
      rights: IN_COPYRIGHT,
      attribution: 'Owner',
      imageSource: 'https://example.org/r1.jpg',
    });
    const added = await addImagePage(db, ids.witness, 'R2', await testImage(40, 40), RIGHTS, root);
    expect(added).toMatchObject({ rights: CC_BY, attribution: 'Test Library', imageSource: null });

    // A new image replaces the rights of the old; taking the image away takes them too.
    const replaced = await attachUpload(
      db,
      page!.id,
      await testImage(40, 40),
      { rights: PDM },
      root,
    );
    expect(replaced).toMatchObject({ rights: PDM, attribution: null, imageSource: null });
    const detached = await detachImage(db, page!.id, root);
    expect(detached).toMatchObject({ rights: null, attribution: null, imageSource: null });
    await removePage(db, page!.id, root);
    await removePage(db, added.id, root);
  });

  it('moves the rights with the image', async () => {
    const [a, b] = await addPages(db, ids.other, ['M1', 'M2']);
    await attachUpload(db, a!.id, await testImage(40, 40), { rights: PDM, attribution: 'A' }, root);
    const moved = await moveImage(db, a!.id, b!.id, root);
    expect(moved.ok).toBe(true);
    const [[from], [to]] = await Promise.all([
      db.select().from(pages).where(eq(pages.id, a!.id)),
      db.select().from(pages).where(eq(pages.id, b!.id)),
    ]);
    expect(from).toMatchObject({ imageKind: null, rights: null, attribution: null });
    expect(to).toMatchObject({ imageKind: 'upload', rights: PDM, attribution: 'A' });
    await removePage(db, a!.id, root);
    await removePage(db, b!.id, root);
  });

  it('changes the rights of a page', async () => {
    const [page] = await addPages(db, ids.other, ['U1']);
    await attachUpload(db, page!.id, await testImage(40, 40), RIGHTS, root);
    const updated = await updatePageRights(db, page!.id, {
      rights: IN_COPYRIGHT,
      attribution: 'Holder',
      imageSource: 'https://example.org/u1',
    });
    expect(updated).toMatchObject({
      rights: IN_COPYRIGHT,
      attribution: 'Holder',
      imageSource: 'https://example.org/u1',
    });
    await expect(updatePageRights(db, page!.id, { rights: 'nonsense' })).rejects.toMatchObject({
      code: 'invalid-rights',
    });
    expect(await updatePageRights(db, 'no-such-page', RIGHTS)).toBeNull();
    await removePage(db, page!.id, root);
  });

  it('stores the witness defaults and gives them to the images without a statement', async () => {
    const witness = newId();
    await db
      .insert(witnesses)
      .values({ id: witness, slug: `w-${witness}`, siglum: 'D', name: 'Defaults' });
    const [stated, bare, credited, imageless] = await addPages(db, witness, ['1', '2', '3', '4']);
    await attachUpload(
      db,
      stated!.id,
      await testImage(40, 40),
      { rights: PDM, attribution: 'Own' },
      root,
    );
    await attachUpload(db, bare!.id, await testImage(40, 40), RIGHTS, root);
    await attachUpload(db, credited!.id, await testImage(40, 40), RIGHTS, root);
    // As an import leaves them: images without a statement, one of them with a credit line of its own.
    await db.update(pages).set({ rights: null, attribution: null }).where(eq(pages.id, bare!.id));
    await db
      .update(pages)
      .set({ rights: null, attribution: 'From the manifest' })
      .where(eq(pages.id, credited!.id));
    expect(await pagesWithoutRights(db, witness)).toBe(2);

    // Without applying, only the witness changes.
    expect(
      await setWitnessImageDefaults(db, witness, {
        imageRights: IN_COPYRIGHT,
        imageAttribution: 'Library',
      }),
    ).toBe(0);
    let [row] = await db.select().from(witnesses).where(eq(witnesses.id, witness));
    expect(row).toMatchObject({ imageRights: IN_COPYRIGHT, imageAttribution: 'Library' });
    expect(await pagesWithoutRights(db, witness)).toBe(2);

    expect(
      await setWitnessImageDefaults(
        db,
        witness,
        { imageRights: 'http://rightsstatements.org/vocab/InC/1.0', imageAttribution: 'Library' },
        true,
      ),
    ).toBe(2);
    const after = new Map((await pagesOfWitness(db, witness)).map((p) => [p.id, p]));
    expect(after.get(stated!.id)).toMatchObject({ rights: PDM, attribution: 'Own' });
    expect(after.get(bare!.id)).toMatchObject({ rights: IN_COPYRIGHT, attribution: 'Library' });
    expect(after.get(credited!.id)).toMatchObject({
      rights: IN_COPYRIGHT,
      attribution: 'From the manifest',
    });
    expect(after.get(imageless!.id)).toMatchObject({ rights: null, attribution: null });
    expect(await pagesWithoutRights(db, witness)).toBe(0);

    // An empty statement clears the default; a statement not listed is refused.
    expect(
      await setWitnessImageDefaults(db, witness, { imageRights: '', imageAttribution: '' }, true),
    ).toBe(0);
    [row] = await db.select().from(witnesses).where(eq(witnesses.id, witness));
    expect(row).toMatchObject({ imageRights: null, imageAttribution: null });
    await expect(
      setWitnessImageDefaults(db, witness, { imageRights: 'https://example.org/licence' }),
    ).rejects.toMatchObject({ code: 'invalid-rights' });
    for (const page of await pagesOfWitness(db, witness)) await removePage(db, page.id, root);
    await db.delete(witnesses).where(eq(witnesses.id, witness));
  });
});

describe('an image moved to another page', () => {
  it('moves an upload with its files, swaps two uploads, and refuses what makes no sense', async () => {
    const [first, second, third] = await addPages(db, ids.witness, ['m1', 'm2', 'm3']);
    await attachUpload(db, first!.id, await testImage(400, 300), RIGHTS, root);
    const originalVersion = pageSource(
      (await pagesOfWitness(db, ids.witness)).find((p) => p.id === first!.id)!,
    );

    // To a page without an image: the files follow, the first page is left bare.
    const moved = await moveImage(db, first!.id, second!.id, root);
    expect(moved).toMatchObject({ ok: true, swapped: false });
    if (!moved.ok) throw new Error('unreachable');
    expect(moved.to).toMatchObject({
      imageKind: 'upload',
      imagePath: `images/${second!.id}/original.png`,
      tilesPath: `tiles/${second!.id}/image.dzi`,
      imageWidth: 400,
      imageHeight: 300,
    });
    expect(moved.from).toMatchObject({
      imageKind: null,
      imagePath: null,
      tilesPath: null,
      imageWidth: null,
      imageHeight: null,
    });
    expect(await exists(path.join(root, moved.to.imagePath!))).toBe(true);
    expect(await exists(path.join(root, moved.to.tilesPath!))).toBe(true);
    expect(await exists(path.join(root, 'images', first!.id))).toBe(false);
    expect(await exists(path.join(root, 'tiles', first!.id))).toBe(false);
    expect(await exists(mediaFile(thumbnailOf(moved.to)!))).toBe(true);
    // The viewer asks for the image afresh on both pages.
    expect(pageSource(moved.to)).not.toEqual(originalVersion);

    // Two uploads change places, and so do their files.
    await attachUpload(db, third!.id, await testImage(200, 500), RIGHTS, root);
    const swapped = await moveImage(db, third!.id, second!.id, root);
    expect(swapped).toMatchObject({ ok: true, swapped: true });
    if (!swapped.ok) throw new Error('unreachable');
    expect(swapped.to).toMatchObject({
      imagePath: `images/${second!.id}/original.png`,
      imageWidth: 200,
      imageHeight: 500,
    });
    expect(swapped.from).toMatchObject({
      imagePath: `images/${third!.id}/original.png`,
      imageWidth: 400,
      imageHeight: 300,
    });
    const onSecond = await sharp(path.join(root, swapped.to.imagePath!)).metadata();
    const onThird = await sharp(path.join(root, swapped.from.imagePath!)).metadata();
    expect([onSecond.width, onSecond.height]).toEqual([200, 500]);
    expect([onThird.width, onThird.height]).toEqual([400, 300]);
    expect(await exists(mediaFile(thumbnailOf(swapped.to)!))).toBe(true);
    expect(await exists(mediaFile(thumbnailOf(swapped.from)!))).toBe(true);
    expect(await exists(path.join(root, 'images', `${third!.id}_swap`))).toBe(false);

    // A IIIF image moves as a link, and leaves no files behind.
    const [iiif] = await addPages(db, ids.witness, ['m4']);
    await db
      .update(pages)
      .set({
        imageKind: 'iiif',
        imageIiif: 'https://iiif.example.org/img/1',
        imageWidth: 1000,
        imageHeight: 1500,
      })
      .where(eq(pages.id, iiif!.id));
    const linked = await moveImage(db, iiif!.id, first!.id, root);
    expect(linked).toMatchObject({ ok: true, swapped: false });
    if (!linked.ok) throw new Error('unreachable');
    expect(linked.to).toMatchObject({
      imageKind: 'iiif',
      imageIiif: 'https://iiif.example.org/img/1',
      imagePath: null,
      tilesPath: null,
      imageWidth: 1000,
    });
    expect(linked.from).toMatchObject({ imageKind: null, imageIiif: null });

    // Refusals change nothing.
    expect(await moveImage(db, first!.id, first!.id, root)).toEqual({
      ok: false,
      reason: 'same-page',
    });
    expect(await moveImage(db, iiif!.id, first!.id, root)).toEqual({
      ok: false,
      reason: 'no-image',
    });
    expect(await moveImage(db, first!.id, 'no-such-page', root)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    const [elsewhere] = await addPages(db, ids.other, ['x1']);
    expect(await moveImage(db, first!.id, elsewhere!.id, root)).toEqual({
      ok: false,
      reason: 'other-witness',
    });
    expect(await exists(path.join(root, 'images', first!.id))).toBe(false);

    for (const page of [first!, second!, third!, iiif!]) await removePage(db, page.id, root);
    await removePage(db, elsewhere!.id, root);
  });

  it('shifts a run of images one page later or earlier, with their files', async () => {
    const shiftId = newId();
    await db
      .insert(witnesses)
      .values({ id: shiftId, slug: `w-${shiftId}`, siglum: 'S', name: 'Shift test' });
    const list = await addPages(db, shiftId, ['s1', 's2', 's3', 's4']);
    const [p1, p2, p3, p4] = list as [
      (typeof list)[number],
      (typeof list)[number],
      (typeof list)[number],
      (typeof list)[number],
    ];
    // Images on s1, s2 and s4 (s3 is a gap), sized so that each can be told apart.
    await attachUpload(db, p1.id, await testImage(101, 50), RIGHTS, root);
    await attachUpload(db, p2.id, await testImage(102, 50), RIGHTS, root);
    await attachUpload(db, p4.id, await testImage(104, 50), RIGHTS, root);
    const widths = async () =>
      (await pagesOfWitness(db, shiftId)).map((p) => [p.label, p.imageWidth]);

    // Later from s2: s2 → s3, gap → s4, s4 → a new page s5.
    const later = await shiftImages(db, p2.id, 'later', root);
    expect(later).toMatchObject({ ok: true, moved: 2, added: { label: 's5' } });
    expect(await widths()).toEqual([
      ['s1', 101],
      ['s2', null],
      ['s3', 102],
      ['s4', null],
      ['s5', 104],
    ]);
    const added = later.ok ? later.added! : null;
    for (const page of await pagesOfWitness(db, shiftId)) {
      if (!page.imageKind) continue;
      const meta = await sharp(path.join(root, page.imagePath!)).metadata();
      expect(meta.width).toBe(page.imageWidth);
      expect(await exists(mediaFile(thumbnailOf(page)!))).toBe(true);
    }
    expect(await exists(path.join(root, 'images', p2.id))).toBe(false);

    // Earlier from s3 back again: s3 → s2, s4 (bare) → s3, s5 → s4; s5 is left without an image.
    expect(await shiftImages(db, p3.id, 'earlier', root)).toMatchObject({
      ok: true,
      moved: 2,
      added: null,
    });
    expect(await widths()).toEqual([
      ['s1', 101],
      ['s2', 102],
      ['s3', null],
      ['s4', 104],
      ['s5', null],
    ]);

    // Refused: no page before the first, a page before with an image, nothing to shift.
    expect(await shiftImages(db, p1.id, 'earlier', root)).toEqual({
      ok: false,
      reason: 'first-page',
    });
    expect(await shiftImages(db, p2.id, 'earlier', root)).toEqual({
      ok: false,
      reason: 'occupied',
    });
    expect(await shiftImages(db, added!.id, 'later', root)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(await shiftImages(db, 'no-such-page', 'later', root)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(await widths()).toEqual([
      ['s1', 101],
      ['s2', 102],
      ['s3', null],
      ['s4', 104],
      ['s5', null],
    ]);

    for (const page of await pagesOfWitness(db, shiftId)) await removePage(db, page.id, root);
    await db.delete(witnesses).where(eq(witnesses.id, shiftId));
  });

  it('shows the pages as the screens need them', async () => {
    const [a, b] = await addPages(db, ids.witness, ['v1', 'v2']);
    await attachUpload(db, a!.id, await testImage(100, 100), RIGHTS, root);
    await db
      .update(transcriptions)
      .set({
        content: {
          items: [
            { kind: 'break', id: 'b0', type: 'page', pageId: b!.id },
            { kind: 'token', id: 'w1', form: 'a' },
            { kind: 'token', id: 'w2', form: 'b' },
          ],
        },
      })
      .where(eq(transcriptions.id, ids.transcription));
    const views = await pageViewsOf(db, ids.witness);
    const viewA = views.find((v) => v.id === a!.id)!;
    const viewB = views.find((v) => v.id === b!.id)!;
    expect(viewA).toMatchObject({
      label: 'v1',
      imageKind: 'upload',
      width: 100,
      height: 100,
      image: { kind: 'file', url: `/media/images/${a!.id}/original.png` },
      zones: 0,
      transcriptions: 0,
    });
    expect(viewA.thumbnail).toMatch(/^\/media\/tiles\//);
    expect(viewA.source).toMatchObject({ kind: 'dzi' });
    expect(viewB).toMatchObject({
      label: 'v2',
      imageKind: null,
      thumbnail: null,
      source: null,
      image: null,
      transcriptions: 1,
      words: 2,
    });
    expect(views.map((v) => v.index)).toEqual(views.map((_, i) => i + 1));
    await setBreaks([]);
    for (const page of [a!, b!]) await removePage(db, page.id, root);
  });
});

describe('IIIF manifests', () => {
  const service = (n: number) => `https://iiif.example.org/image/ms/${n}`;
  function manifest(labels: string[], extra: Partial<IiifManifest> = {}): IiifManifest {
    return {
      label: 'Test manuscript',
      version: 3,
      canvases: labels.map((label, i) => ({
        id: `https://iiif.example.org/canvas/${i + 1}`,
        label,
        width: 2000 + i,
        height: 3000,
        imageService: service(i + 1),
      })),
      warnings: [],
      ...extra,
    };
  }

  beforeEach(() => {
    mockedLoad.mockReset();
  });

  it('previews the first canvases with thumbnails and counts what is already here', async () => {
    const labels = labelsOf('1r-10v');
    mockedLoad.mockResolvedValue(manifest(labels, { warnings: ['The manifest has no label.'] }));
    const preview = await previewManifest('https://iiif.example.org/m.json', [
      { label: 'x', imageKind: 'iiif', imageIiif: `${service(1)}/` },
      { label: '2r', imageKind: null, imageIiif: null },
    ]);
    expect(mockedLoad).toHaveBeenCalledWith('https://iiif.example.org/m.json');
    expect(preview.total).toBe(20);
    expect(preview.withImage).toBe(20);
    expect(preview.present).toBe(1);
    expect(preview.attachable).toBe(1);
    expect(preview.canvases).toHaveLength(12);
    expect(preview.canvases[0]).toEqual({
      label: '1r',
      thumbnail: `${service(1)}/full/240,/0/default.jpg`,
      width: 2000,
      height: 3000,
    });
    expect(preview.warnings).toEqual(['The manifest has no label.']);
  });

  it('appends every canvas, then only new ones, and stores the manifest on the witness', async () => {
    mockedLoad.mockResolvedValue(manifest(['1r', '1v', '2r']));
    const first = await importManifest(db, ids.iiif, 'https://iiif.example.org/m.json', {
      storageRoot: root,
    });
    expect(first).toMatchObject({
      label: 'Test manuscript',
      canvases: 3,
      added: 3,
      skipped: 0,
      removed: 0,
    });
    const stored = await pagesOfWitness(db, ids.iiif);
    expect(
      stored.map((p) => [p.label, p.position, p.imageKind, p.imageIiif, p.imageWidth]),
    ).toEqual([
      ['1r', 1, 'iiif', service(1), 2000],
      ['1v', 2, 'iiif', service(2), 2001],
      ['2r', 3, 'iiif', service(3), 2002],
    ]);
    const [witness] = await db.select().from(witnesses).where(eq(witnesses.id, ids.iiif));
    expect(witness!.iiifManifest).toBe('https://iiif.example.org/m.json');

    mockedLoad.mockResolvedValue(manifest(['1r', '1v', '2r', '2v']));
    const again = await importManifest(db, ids.iiif, 'https://iiif.example.org/m.json', {
      onlyNew: true,
      storageRoot: root,
    });
    expect(again).toMatchObject({ added: 1, skipped: 3, attached: 0 });
    expect(await labels(ids.iiif)).toEqual(['1r', '1v', '2r', '2v']);

    // Without options, everything is appended again.
    const all = await importManifest(db, ids.iiif, 'https://iiif.example.org/m.json', {
      storageRoot: root,
    });
    expect(all.added).toBe(4);
    expect(await labels(ids.iiif)).toHaveLength(8);
  });

  it('replaces the pages nothing refers to, gives blank pages their images and keeps the order of the manifest', async () => {
    // Start over: a page without an image that a transcription breaks to, and an upload nothing refers to.
    for (const page of await pagesOfWitness(db, ids.iiif)) await removePage(db, page.id, root);
    const [blank, note] = await addPages(db, ids.iiif, ['2r', 'Note']);
    const upload = await addImagePage(db, ids.iiif, 'scan', await testImage(64, 64), RIGHTS, root);
    await db.insert(transcriptions).values({
      id: newId(),
      witnessId: ids.iiif,
      name: 'T',
      ownerId: ids.user,
      content: {
        items: [
          { kind: 'break', id: 'b1', type: 'page', pageId: blank!.id },
          { kind: 'break', id: 'b2', type: 'page', pageId: note!.id },
        ],
      },
    });

    mockedLoad.mockResolvedValue({
      ...manifest(['1r', '1v', '2r', '2v']),
      canvases: [
        ...manifest(['1r', '1v', '2r', '2v']).canvases,
        {
          id: 'https://iiif.example.org/canvas/plain',
          label: 'Plate',
          width: 100,
          height: 100,
          imageService: null,
          imageUrl: 'https://iiif.example.org/plate.jpg',
        },
      ],
    });
    const summary = await importManifest(db, ids.iiif, 'https://iiif.example.org/m.json', {
      replace: true,
      storageRoot: root,
    });
    expect(summary).toMatchObject({
      canvases: 5,
      added: 4,
      attached: 1,
      skipped: 0,
      removed: 1,
      kept: 1,
    });
    expect(summary.warnings).toEqual([expect.stringMatching(/Canvas "Plate" has a plain image/)]);
    expect(await exists(path.join(root, 'images', upload.id))).toBe(false);

    const stored = await pagesOfWitness(db, ids.iiif);
    expect(stored.map((p) => p.label)).toEqual(['1r', '1v', '2r', 'Note', '2v', 'Plate']);
    expect(stored.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6]);
    const kept = stored.find((p) => p.id === blank!.id)!;
    expect(kept).toMatchObject({
      label: '2r',
      imageKind: 'iiif',
      imageIiif: service(3),
      imageWidth: 2002,
    });
    expect(stored.find((p) => p.label === 'Plate')).toMatchObject({
      imageKind: null,
      imageIiif: null,
    });
  });

  it('takes the rights of a canvas, else of the manifest', () => {
    const m = { rights: 'http://creativecommons.org/licenses/by/4.0/', attribution: 'Library' };
    expect(canvasRights(m, {})).toEqual({ rights: CC_BY, attribution: 'Library', unlisted: null });
    expect(
      canvasRights(m, { rights: 'http://creativecommons.org/publicdomain/mark/1.0/' }),
    ).toEqual({ rights: PDM, attribution: 'Library', unlisted: null });
    expect(canvasRights(m, { attribution: 'Folio credit' })).toEqual({
      rights: CC_BY,
      attribution: 'Folio credit',
      unlisted: null,
    });
    expect(canvasRights({}, { rights: 'https://library.example.org/terms' })).toEqual({
      rights: null,
      attribution: 'https://library.example.org/terms',
      unlisted: 'https://library.example.org/terms',
    });
    expect(
      canvasRights({ attribution: 'Library' }, { rights: 'https://library.example.org/terms' }),
    ).toMatchObject({ rights: null, attribution: 'Library' });
    expect(canvasRights({}, {})).toEqual({ rights: null, attribution: null, unlisted: null });
  });

  it('keeps the rights of the manifest on the pages, and says what it cannot keep', async () => {
    const witness = newId();
    await db
      .insert(witnesses)
      .values({ id: witness, slug: `w-${witness}`, siglum: 'I', name: 'Rights from IIIF' });
    const base = manifest(['1r', '1v', '2r']);
    base.canvases[1]!.rights = 'http://creativecommons.org/publicdomain/mark/1.0/';
    base.canvases[2]!.rights = 'https://library.example.org/terms';
    mockedLoad.mockResolvedValue({
      ...base,
      rights: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'Library',
    });
    const preview = await previewManifest('https://iiif.example.org/r.json', [], null);
    expect(preview.rights).toEqual({
      rights: CC_BY,
      label: 'CC BY 4.0',
      unlisted: null,
      attribution: 'Library',
      ownStatements: 2,
      fallback: null,
      fallbackLabel: null,
    });
    expect(preview.warnings).toEqual([
      expect.stringContaining('https://library.example.org/terms'),
    ]);

    const summary = await importManifest(db, witness, 'https://iiif.example.org/r.json', {
      storageRoot: root,
    });
    expect(summary.warnings).toEqual([
      expect.stringContaining('https://library.example.org/terms'),
    ]);
    const stored = await pagesOfWitness(db, witness);
    expect(stored.map((p) => [p.label, p.rights, p.attribution, p.imageSource])).toEqual([
      ['1r', CC_BY, 'Library', 'https://iiif.example.org/r.json'],
      ['1v', PDM, 'Library', 'https://iiif.example.org/r.json'],
      ['2r', null, 'Library', 'https://iiif.example.org/r.json'],
    ]);

    // A manifest that states nothing: the pages take the witness's defaults, a blank page taking an image too.
    for (const page of stored) await removePage(db, page.id, root);
    await setWitnessImageDefaults(db, witness, {
      imageRights: IN_COPYRIGHT,
      imageAttribution: 'Our photographs',
    });
    await addPages(db, witness, ['1v']);
    mockedLoad.mockResolvedValue(manifest(['1r', '1v']));
    const fallback = await previewManifest('https://iiif.example.org/s.json', [], IN_COPYRIGHT);
    expect(fallback.rights).toMatchObject({
      rights: null,
      fallback: IN_COPYRIGHT,
      fallbackLabel: 'In Copyright',
    });
    await importManifest(db, witness, 'https://iiif.example.org/s.json', {
      onlyNew: true,
      storageRoot: root,
    });
    expect(
      (await pagesOfWitness(db, witness)).map((p) => [
        p.label,
        p.imageKind,
        p.rights,
        p.attribution,
      ]),
    ).toEqual([
      ['1r', 'iiif', IN_COPYRIGHT, 'Our photographs'],
      ['1v', 'iiif', IN_COPYRIGHT, 'Our photographs'],
    ]);
    for (const page of await pagesOfWitness(db, witness)) await removePage(db, page.id, root);
    await db.delete(witnesses).where(eq(witnesses.id, witness));
  });

  it('passes on the errors of the manifest reader, and refuses a witness that does not exist', async () => {
    const { ManifestError } =
      await vi.importActual<typeof import('$lib/server/images/iiif')>('$lib/server/images/iiif');
    mockedLoad.mockRejectedValue(new ManifestError('fetch', 'The server answered 404.'));
    await expect(
      importManifest(db, ids.iiif, 'https://iiif.example.org/missing.json'),
    ).rejects.toMatchObject({ code: 'fetch' });
    mockedLoad.mockResolvedValue(manifest(['1r']));
    await expect(
      importManifest(db, newId(), 'https://iiif.example.org/m.json'),
    ).rejects.toBeInstanceOf(PageError);
  });
});
