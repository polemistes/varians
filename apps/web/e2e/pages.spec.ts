/**
 * Managing the pages of a witness from the transcription workbench: the
 * Pages tab, pages added by their labels, an image given from a card and
 * from the facsimile pane, an image moved to another page, and a run of
 * images shifted by one page. Screenshots go to E2E_SHOTS when it is set.
 */
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createDatabase, pages as pagesTable, transcriptions, users, witnesses } from '@varians/db';
import { asc, eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { pageStrings as t } from '../src/lib/strings/pages';
import { workbench as w } from '../src/lib/strings/workbench';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `pages-${stamp}@example.org`;
const password = 'a long enough password';
const witnessName = `Codex Paginarum ${stamp}`;
const shots = process.env.E2E_SHOTS;
let witnessSlug = '';

/** A small PNG whose width tells it apart. */
async function image(width: number): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const buffer = await sharp({ create: { width, height: 300, channels: 3, background: { r: 230, g: 220, b: 190 } } })
    .png()
    .toBuffer();
  return { name: `scan-${width}.png`, mimeType: 'image/png', buffer };
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

/** The pages of the witness as label and image width, from the database. */
async function widths(): Promise<[string, number | null][]> {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [witness] = await db.select().from(witnesses).where(eq(witnesses.slug, witnessSlug));
  const rows = await db
    .select({ label: pagesTable.label, width: pagesTable.imageWidth })
    .from(pagesTable)
    .where(eq(pagesTable.witnessId, witness!.id))
    .orderBy(asc(pagesTable.position));
  await pool.end();
  return rows.map((r) => [r.label, r.width]);
}

test.afterAll(async () => {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [witness] = await db.select().from(witnesses).where(eq(witnesses.slug, witnessSlug));
  if (witness) {
    await db.delete(transcriptions).where(eq(transcriptions.witnessId, witness.id));
    await db.delete(witnesses).where(eq(witnesses.id, witness.id));
  }
  await db.delete(users).where(eq(users.email, email));
  await pool.end();
});

test('pages are managed from the transcription workbench', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  // A maintainer: whoever registers the witness.
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Pages Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(witnessName);
  await page.locator('input[name=siglum]').fill('P');
  await page.getByRole('button', { name: 'Register the witness' }).click();
  await page.waitForURL((url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new');
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'New transcript' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=name]').fill('Probatio');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  await page.waitForLoadState('networkidle');

  // The Pages tab, reached from the page chooser.
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: w.pages.manage }).click();
  const pane = page.getByRole('complementary', { name: w.pane.label });
  await expect(pane.getByRole('tab', { name: w.pane.pages })).toHaveAttribute('data-state', 'active');
  await expect(pane.getByText(t.panel.empty)).toBeVisible();

  // Pages by their labels.
  await pane.getByRole('button', { name: t.panel.addPages }).click();
  await pane.getByLabel(t.add.labels).fill('1r-2v');
  await pane.getByRole('button', { name: t.add.submit(4) }).click();
  const grid = pane.getByRole('list', { name: t.gridLabel });
  await expect(grid.getByRole('listitem')).toHaveCount(4);
  await expect(pane.getByText(t.summary(4, 0))).toBeVisible();
  await shot(page, '1-pages-added');

  // An image from the card of 1r.
  const card = (label: string) => grid.getByRole('article', { name: label, exact: true });
  let chooser = page.waitForEvent('filechooser');
  await card('1r').getByRole('button', { name: t.card.addImage }).click();
  await (await chooser).setFiles(await image(401));
  await expect(card('1r').locator('img')).toBeVisible({ timeout: 20_000 });
  await expect(pane.getByText(t.summary(4, 1))).toBeVisible();

  // A click on a card goes to that page; the facsimile there offers an image for it.
  await card('1v').getByRole('button', { name: t.card.open('1v') }).click();
  await expect(page.getByRole('button', { name: w.pages.choose })).toHaveText('1v');
  await expect(card('1v')).toHaveAttribute('aria-current', 'true');
  await pane.getByRole('tab', { name: w.pane.facsimile }).click();
  await expect(pane.getByRole('tab', { name: w.pane.facsimile })).toHaveAttribute('data-state', 'active');
  await expect(pane.getByText(w.facsimile.noImage('1v'))).toBeVisible();
  await shot(page, '2-facsimile-no-image');
  chooser = page.waitForEvent('filechooser');
  await pane.getByRole('button', { name: w.facsimile.addImage }).click();
  await (await chooser).setFiles(await image(402));
  await expect(pane.getByRole('toolbar', { name: w.facsimile.tools })).toBeVisible({ timeout: 20_000 });
  await shot(page, '3-facsimile-image');

  // Back on the tab: 2r gets 2r's image, but on 2v by mistake; then it is moved.
  await pane.getByRole('tab', { name: w.pane.pages }).click();
  await expect(pane.getByText(t.summary(4, 2))).toBeVisible();
  chooser = page.waitForEvent('filechooser');
  await card('2v').getByRole('button', { name: t.card.addImage }).click();
  await (await chooser).setFiles(await image(403));
  await expect(card('2v').locator('img')).toBeVisible({ timeout: 20_000 });
  expect(await widths()).toEqual([['1r', 401], ['1v', 402], ['2r', null], ['2v', 403]]);

  await card('2v').getByRole('button', { name: t.card.menu('2v') }).click();
  await page.getByRole('menuitem', { name: t.menu.moveImage }).click();
  const move = page.getByRole('dialog', { name: t.moveImage.title('2v') });
  await move.getByLabel(t.moveImage.target).selectOption({ label: '2r' });
  await shot(page, '4-move-image');
  await move.getByRole('button', { name: t.moveImage.submit }).click();
  await expect(page.getByText(t.moveImage.moved('2v', '2r'))).toBeVisible();
  expect(await widths()).toEqual([['1r', 401], ['1v', 402], ['2r', 403], ['2v', null]]);

  // The whole run began a page too early: shift from 1r one page later. The last image needs no new page.
  await card('1r').getByRole('button', { name: t.card.menu('1r') }).click();
  await page.getByRole('menuitem', { name: t.menu.shiftImages }).click();
  const shift = page.getByRole('dialog', { name: t.shiftImages.title('1r') });
  await expect(shift.getByRole('radio', { name: new RegExp(t.shiftImages.earlier) })).toBeDisabled();
  await shift.getByRole('radio', { name: new RegExp(t.shiftImages.later) }).check();
  await shot(page, '5-shift-images');
  await shift.getByRole('button', { name: t.shiftImages.submit }).click();
  await expect(page.getByText(t.shiftImages.shifted(3, null))).toBeVisible();
  expect(await widths()).toEqual([['1r', null], ['1v', 401], ['2r', 402], ['2v', 403]]);

  // Once more: now 2v has an image, so a page 3r is added for it.
  await card('1v').getByRole('button', { name: t.card.menu('1v') }).click();
  await page.getByRole('menuitem', { name: t.menu.shiftImages }).click();
  const again = page.getByRole('dialog', { name: t.shiftImages.title('1v') });
  await again.getByRole('radio', { name: new RegExp(t.shiftImages.later) }).check();
  await expect(again.getByText(t.shiftImages.laterAdds('2v', '3r'))).toBeVisible();
  await again.getByRole('button', { name: t.shiftImages.submit }).click();
  await expect(page.getByText(t.shiftImages.shifted(3, '3r'))).toBeVisible();
  expect(await widths()).toEqual([['1r', null], ['1v', null], ['2r', 401], ['2v', 402], ['3r', 403]]);

  // And back by one: earlier from 2r.
  await card('2r').getByRole('button', { name: t.card.menu('2r') }).click();
  await page.getByRole('menuitem', { name: t.menu.shiftImages }).click();
  const back = page.getByRole('dialog', { name: t.shiftImages.title('2r') });
  await expect(back.getByRole('radio', { name: new RegExp(t.shiftImages.earlier) })).toBeChecked();
  await back.getByRole('button', { name: t.shiftImages.submit }).click();
  await expect(page.getByText(t.shiftImages.shifted(3, null))).toBeVisible();
  expect(await widths()).toEqual([['1r', null], ['1v', 401], ['2r', 402], ['2v', 403], ['3r', null]]);
  await expect(grid.locator('img')).toHaveCount(3);
  await shot(page, '6-after-shifts');

  // The witness's own pages screen offers the same.
  await page.goto(`/witnesses/${witnessSlug}/pages`);
  await expect(page.getByRole('list', { name: t.gridLabel }).getByRole('listitem')).toHaveCount(5);
  await shot(page, '7-pages-screen');
});
