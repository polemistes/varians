/**
 * Mapping words to the facsimile from the workbench: words selected in the
 * text, "Map" in the selection toolbar, a rectangle drawn on the image. A
 * zone of those words is saved, and the drawing can be undone.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { fromText, newId, type Item } from '@varians/core';
import {
  createDatabase,
  pages as pagesTable,
  transcriptions,
  users,
  witnesses,
  zones,
} from '@varians/db';
import { eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { pageStrings as p } from '../src/lib/strings/pages';
import { workbench as w } from '../src/lib/strings/workbench';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `mapping-${stamp}@example.org`;
const password = 'a long enough password';
const witnessName = `Codex Mappae ${stamp}`;
let witnessSlug = '';
let transcriptionId = '';

async function image(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const buffer = await sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 230, g: 220, b: 190 } },
  })
    .png()
    .toBuffer();
  return { name: 'scan.png', mimeType: 'image/png', buffer };
}

/** A rectangle dragged across the middle of the image. */
async function drawBox(page: Page, stage: Locator) {
  const box = (await stage.boundingBox())!;
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  const to = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
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

test('selected words are mapped to a box drawn on the facsimile', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Mapping Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(witnessName);
  await page.locator('input[name=siglum]').fill('M');
  await page.getByRole('button', { name: 'Register the witness' }).click();
  await page.waitForURL(
    (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
  );
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'New transcript' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=name]').fill('Probatio');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  transcriptionId = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');

  // One page, with an image.
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: w.pages.manage }).click();
  const pane = page.getByRole('complementary', { name: w.pane.label });
  await pane.getByRole('button', { name: p.panel.addPages }).click();
  await pane.getByLabel(p.add.labels).fill('1r');
  await pane.getByRole('button', { name: p.add.submit(1), exact: true }).click();
  const card = pane
    .getByRole('list', { name: p.gridLabel })
    .getByRole('article', { name: '1r', exact: true });
  const chooser = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: p.card.addImage }).click();
  await (await chooser).setFiles(await image());
  await expect(card.locator('img')).toBeVisible({ timeout: 20_000 });

  // Its text, beginning with a break to that page, saved as the workbench saves it.
  const { db, pool } = createDatabase(DATABASE_URL);
  const [witness] = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(eq(witnesses.slug, witnessSlug));
  const [witnessPage] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.witnessId, witness!.id));
  await pool.end();
  const items: Item[] = [
    { kind: 'break', id: newId(), type: 'page', pageId: witnessPage!.id },
    ...fromText('arma virumque cano').items,
  ];
  const response = await page.request.post(`/api/documents/transcription/${transcriptionId}/ops`, {
    data: { fromVersion: 0, ops: [{ t: 'insert', after: null, items }] },
  });
  expect(response.ok(), await response.text()).toBe(true);

  // The words selected in the text, then "Map" in the selection toolbar.
  await page.goto(`/transcriptions/${transcriptionId}`);
  await page.waitForLoadState('networkidle');
  const line = page
    .locator('.cm-content .cm-line')
    .filter({ hasText: 'arma virumque cano' })
    .first();
  await expect(line).toBeVisible();
  const text = (await line.boundingBox())!;
  await page.mouse.click(text.x + 2, text.y + text.height / 2);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page
    .getByRole('toolbar', { name: w.toolbar.actions })
    .getByRole('button', { name: w.toolbar.map, exact: true })
    .click();
  await expect(pane.getByText(w.facsimile.drawPrompt.selection(3))).toBeVisible();

  // A rectangle on the image: the zone is made and the prompt is gone.
  const stage = pane.locator('.facsimile-stage');
  await expect(stage.locator('canvas').first()).toBeVisible();
  await expect(pane.getByRole('button', { name: w.facsimile.undo })).toBeDisabled();
  await drawBox(page, stage);
  await expect(pane.getByText(w.facsimile.mapped(1))).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByRole('button', { name: w.facsimile.undo })).toBeEnabled();

  const saved = async () => {
    const { db, pool } = createDatabase(DATABASE_URL);
    const rows = await db
      .select({ tokenIds: zones.tokenIds })
      .from(zones)
      .where(eq(zones.transcriptionId, transcriptionId));
    await pool.end();
    return rows;
  };
  const rows = await saved();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.tokenIds).toHaveLength(3);

  // Undo takes the zone away again.
  await pane.getByRole('button', { name: w.facsimile.undo }).click();
  await expect(pane.getByText(w.facsimile.history.undone(w.facsimile.history.made(1)))).toBeVisible(
    { timeout: 15_000 },
  );
  await expect.poll(async () => (await saved()).length).toBe(0);
});
