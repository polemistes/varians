/**
 * The form actions that take rights of images: uploads refused
 * without a statement, the rights of a page, and the witness's defaults,
 * each for the maintainers of the witness only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type pg from 'pg';
import { newId } from '@varians/core';
import { createDatabase, eq, pages, users, witnesses, type Database } from '@varians/db';
import type { CurrentUser } from '$lib/types';
import { pageStrings } from '$lib/strings/pages';
import { actions as editActions } from '../../routes/(app)/witnesses/[slug]/edit/+page.server';
import { actions as pageActions } from '../../routes/(app)/witnesses/[slug]/pages/+page.server';
import { removePageFiles, storageDir } from './images/storage';
import { addPages, attachUpload, pagesOfWitness } from './pages';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const IN_COPYRIGHT = 'http://rightsstatements.org/vocab/InC/1.0/';

let db: Database;
let pool: pg.Pool;
let root: string;
const ids = { owner: newId(), stranger: newId(), witness: newId(), other: newId() };
const slug = `w-${ids.witness}`;

const person = (id: string, name: string): CurrentUser => ({ id, email: `${id}@test`, name, role: 'member', preferences: {} as CurrentUser['preferences'], termsVersion: 1 });
const owner = person(ids.owner, 'Owner');
const stranger = person(ids.stranger, 'Stranger');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (event: any) => unknown;

/** Runs a form action as `user` with these fields, as SvelteKit would. */
function run(action: Action | undefined, user: CurrentUser | null, fields: Record<string, string | Blob>, witnessSlug = slug) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  const request = new Request('http://localhost/action', { method: 'POST', body });
  return Promise.resolve(action!({ request, locals: { db, user }, params: { slug: witnessSlug } })) as Promise<{
    status?: number;
    data?: Record<string, unknown>;
    ok?: boolean;
    message?: string;
  }>;
}

async function image(): Promise<Blob> {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 190, b: 170 } } }).png().toBuffer();
  return new File([new Uint8Array(png)], 'f1r.png', { type: 'image/png' });
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  // The actions store files where the server does; the test removes its own afterwards.
  root = storageDir();
  await db.insert(users).values([
    { id: ids.owner, email: owner.email, name: owner.name, passwordHash: 'x' },
    { id: ids.stranger, email: stranger.email, name: stranger.name, passwordHash: 'x' },
  ]);
  await db.insert(witnesses).values([
    { id: ids.witness, slug, siglum: 'R', name: 'Rights witness', createdBy: ids.owner },
    { id: ids.other, slug: `w-${ids.other}`, siglum: 'S', name: 'Other', createdBy: ids.owner },
  ]);
});

afterAll(async () => {
  for (const witness of [ids.witness, ids.other]) {
    for (const page of await pagesOfWitness(db, witness)) await removePageFiles(page.id, root);
  }
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(witnesses).where(eq(witnesses.id, ids.other));
  await db.delete(users).where(eq(users.id, ids.owner));
  await db.delete(users).where(eq(users.id, ids.stranger));
  await pool.end();
});

describe('uploads', () => {
  it('refuses new pages from images without a rights statement, and keeps the one given', async () => {
    const refused = await run(pageActions.upload, owner, { file: await image(), label: 'f1r' });
    expect(refused).toMatchObject({ status: 400, data: { error: pageStrings.rights.required } });
    const unlisted = await run(pageActions.upload, owner, { file: await image(), label: 'f1r', rights: 'https://example.org/licence' });
    expect(unlisted).toMatchObject({ status: 400 });
    expect(await pagesOfWitness(db, ids.witness)).toHaveLength(0);

    const added = await run(pageActions.upload, owner, {
      file: await image(),
      label: 'f1r',
      rights: CC_BY,
      attribution: 'Library',
      imageSource: 'https://library.example.org/f1r',
    });
    expect(added).toMatchObject({ ok: true, labels: ['f1r'] });
    const [page] = await pagesOfWitness(db, ids.witness);
    expect(page).toMatchObject({ label: 'f1r', imageKind: 'upload', rights: CC_BY, attribution: 'Library', imageSource: 'https://library.example.org/f1r' });
  });

  it('refuses an image for a page without a rights statement', async () => {
    const [page] = await addPages(db, ids.witness, ['f1v']);
    const refused = await run(pageActions.replaceImage, owner, { pageId: page!.id, file: await image() });
    expect(refused).toMatchObject({ status: 400, data: { error: pageStrings.rights.required } });
    const accepted = await run(pageActions.replaceImage, owner, { pageId: page!.id, file: await image(), rights: IN_COPYRIGHT });
    expect(accepted).toMatchObject({ ok: true });
    const [row] = await db.select().from(pages).where(eq(pages.id, page!.id));
    expect(row).toMatchObject({ imageKind: 'upload', rights: IN_COPYRIGHT, attribution: null });
  });

  it('lets no one but the maintainers upload', async () => {
    await expect(run(pageActions.upload, stranger, { file: await image(), label: 'x', rights: CC_BY })).rejects.toMatchObject({ status: 403 });
    await expect(run(pageActions.upload, null, { file: await image(), label: 'x', rights: CC_BY })).rejects.toMatchObject({ status: 303 });
  });
});

describe('the rights of a page', () => {
  it('changes them for the maintainers, and refuses everyone else', async () => {
    const [page] = await addPages(db, ids.witness, ['f2r']);
    await attachUpload(db, page!.id, new Uint8Array(await (await image()).arrayBuffer()), { rights: CC_BY }, root);
    const fields = { pageId: page!.id, rights: IN_COPYRIGHT, attribution: 'Holder', imageSource: 'https://example.org/f2r' };

    await expect(run(pageActions.rights, stranger, fields)).rejects.toMatchObject({ status: 403 });
    await expect(run(pageActions.rights, null, fields)).rejects.toMatchObject({ status: 303 });
    let [row] = await db.select().from(pages).where(eq(pages.id, page!.id));
    expect(row).toMatchObject({ rights: CC_BY, attribution: null });

    const missing = await run(pageActions.rights, owner, { ...fields, rights: '' });
    expect(missing).toMatchObject({ status: 400, data: { errors: { rights: [pageStrings.rights.required] } } });
    const badSource = await run(pageActions.rights, owner, { ...fields, imageSource: 'not an address' });
    expect(badSource).toMatchObject({ status: 400, data: { errors: { imageSource: [pageStrings.rights.sourceInvalid] } } });

    const saved = await run(pageActions.rights, owner, fields);
    expect(saved).toMatchObject({ ok: true, message: pageStrings.rights.saved('f2r') });
    [row] = await db.select().from(pages).where(eq(pages.id, page!.id));
    expect(row).toMatchObject({ rights: IN_COPYRIGHT, attribution: 'Holder', imageSource: 'https://example.org/f2r' });
  });

  it('refuses a page without an image, and a page of another witness', async () => {
    const [bare] = await addPages(db, ids.witness, ['f3r']);
    const [elsewhere] = await addPages(db, ids.other, ['f1r']);
    expect(await run(pageActions.rights, owner, { pageId: bare!.id, rights: CC_BY })).toMatchObject({ status: 400 });
    expect(await run(pageActions.rights, owner, { pageId: elsewhere!.id, rights: CC_BY })).toMatchObject({ status: 404 });
  });
});

describe('the defaults of a witness', () => {
  it('stores them for the maintainers, and gives them to the images without a statement when asked', async () => {
    const [bare] = await addPages(db, ids.other, ['f2r']);
    await attachUpload(db, bare!.id, new Uint8Array(await (await image()).arrayBuffer()), { rights: CC_BY }, root);
    await db.update(pages).set({ rights: null }).where(eq(pages.id, bare!.id));
    const otherSlug = `w-${ids.other}`;
    const fields = { imageRights: IN_COPYRIGHT, imageAttribution: 'Our photographs', apply: 'on' };

    await expect(run(editActions.images, stranger, fields, otherSlug)).rejects.toMatchObject({ status: 403 });
    const refused = await run(editActions.images, owner, { ...fields, imageRights: 'https://example.org/licence' }, otherSlug);
    expect(refused).toMatchObject({ status: 400, data: { errors: { imageRights: [pageStrings.rights.notListed] } } });

    const saved = await run(editActions.images, owner, fields, otherSlug);
    expect(saved).toMatchObject({ form: 'images' });
    const [witness] = await db.select().from(witnesses).where(eq(witnesses.id, ids.other));
    expect(witness).toMatchObject({ imageRights: IN_COPYRIGHT, imageAttribution: 'Our photographs' });
    const [row] = await db.select().from(pages).where(eq(pages.id, bare!.id));
    expect(row).toMatchObject({ rights: IN_COPYRIGHT, attribution: 'Our photographs' });
  });
});
