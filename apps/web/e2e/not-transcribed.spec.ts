/**
 * Marking a stretch as not transcribed from the workbench: Insert, Not
 * Transcribed puts a gap of that reason at the caret, the text shows it in
 * words and not in the brackets of a loss, it is saved, and it undoes like
 * any object.
 */
import { expect, test } from '@playwright/test';
import { fromText, isObj, newId, type Item, type Obj } from '@varians/core';
import { createDatabase, pages as pagesTable, transcriptions, users, witnesses } from '@varians/db';
import { eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { pageStrings as p } from '../src/lib/strings/pages';
import { workbench as w } from '../src/lib/strings/workbench';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `untranscribed-${stamp}@example.org`;
const password = 'a long enough password';
const witnessName = `Codex Omissus ${stamp}`;
let witnessSlug = '';
let transcriptionId = '';

/** The gaps of the transcript as saved, by reason. */
async function savedReasons(): Promise<unknown[]> {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [row] = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  await pool.end();
  return row!.content.items
    .filter((i): i is Obj => isObj(i) && i.type === 'gap')
    .map((g) => g.attrs?.reason);
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

test('a stretch is marked as not transcribed from the Insert menu', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Untranscribed Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(witnessName);
  await page.locator('input[name=siglum]').fill('O');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(
    (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
  );
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Make New Transcript' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=name]').fill('Probatio');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  transcriptionId = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');

  // One page, and a line of text on it, saved as the workbench saves it.
  const pane = page.getByRole('complementary', { name: w.pane.label });
  await pane.getByRole('button', { name: p.panel.addPages }).click();
  await pane.getByLabel(p.add.labels).fill('1r');
  await pane.getByRole('button', { name: p.add.submit(1), exact: true }).click();
  await expect(
    pane.getByRole('list', { name: p.gridLabel }).getByRole('article', { name: '1r', exact: true }),
  ).toBeVisible();
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

  // The caret at the end of the line; Insert, Not Transcribed.
  await page.goto(`/transcriptions/${transcriptionId}`);
  await page.waitForLoadState('networkidle');
  const line = page
    .locator('.cm-content .cm-line')
    .filter({ hasText: 'arma virumque cano' })
    .first();
  await expect(line).toBeVisible();
  await line.click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: w.insert.label, exact: true }).click();
  await page.getByRole('menuitem', { name: w.insert.notTranscribed }).click();

  // The text says so in words, set apart from the witness's letters, and not in the brackets of a loss.
  const marked = page.locator('.cm-object-gap.cm-object-untranscribed');
  await expect(marked).toHaveText('not transcribed');
  await expect(page.locator('.cm-content')).not.toContainText('[...]');
  await expect.poll(savedReasons, { timeout: 15_000 }).toEqual(['ellipsis']);

  // Like any object, it goes with an undo.
  await page.keyboard.press('Control+z');
  await expect(marked).toHaveCount(0);
  await expect.poll(savedReasons, { timeout: 15_000 }).toEqual([]);
});
