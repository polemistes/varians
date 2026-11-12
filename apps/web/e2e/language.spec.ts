/**
 * The language of the words in the workbench: the first word typed into an
 * empty transcript opens the chooser and waits for it, cancelling takes the
 * word back, the words typed after take the language of the word before,
 * one label names the stretch, and choosing in Language with words selected
 * gives them another, which a second label names.
 */
import { expect, test } from '@playwright/test';
import { createDatabase, transcriptions, users, witnesses } from '@varians/db';
import { eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { editor } from '../src/lib/strings/editor';
import { chooseLanguage } from './helpers';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `language-${stamp}@example.org`;
const password = 'a long enough password';
const witnessName = `Codex Linguarum ${stamp}`;
let witnessSlug = '';
let transcriptionId = '';

/** The words of the transcript as saved, with their languages. */
async function savedWords(): Promise<[string, string | undefined][]> {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [row] = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  await pool.end();
  return row!.content.items.flatMap((i) => (i.kind === 'token' ? [[i.form, i.lang]] : []));
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

test('the first word typed asks its language, and the words after take it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Language Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(witnessName);
  await page.locator('input[name=siglum]').fill('L');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(
    (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
  );
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Make New Transcript' }).first().click();
  const create = page.getByRole('dialog');
  await create.locator('input[name=name]').fill('Probatio');
  await create.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  transcriptionId = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');

  const text = page.locator('.cm-content');
  const control = page.getByRole('button', { name: editor.language.label, exact: true });
  const labels = page.locator('.cm-content .cm-language-label');
  // Language is there in an empty text, and names no language.
  await expect(control).toBeVisible();
  await expect(control).toHaveText('');

  // The first letter opens the chooser, with nothing chosen; cancelling takes the word back.
  await text.click();
  await page.keyboard.type('a');
  const chooser = page.getByRole('dialog', { name: editor.language.label });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByText(editor.language.ask)).toBeVisible();
  await expect(chooser.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(chooser.getByRole('button', { name: editor.language.choose })).toBeDisabled();
  await chooser.getByRole('button', { name: editor.language.cancel }).click();
  await expect(chooser).toHaveCount(0);
  await expect(page.locator('.cm-content [data-token]')).toHaveCount(0);
  expect(await savedWords()).toEqual([]);

  // Answered, the word takes the language, and the next word takes it from the word before.
  await page.locator('.cm-content').click();
  await page.keyboard.type('a');
  await chooseLanguage(page, 'Latin');
  await expect(text).toBeFocused();
  await page.keyboard.type('rma virumque cano');
  await expect(text).toContainText('arma virumque cano');
  await expect(labels).toHaveCount(1);
  await expect(labels.first()).toHaveAttribute('data-label', 'Latin');
  await expect(control).toHaveText('Latin');
  await expect.poll(savedWords, { timeout: 15_000 }).toEqual([
    ['arma', 'la'],
    ['virumque', 'la'],
    ['cano', 'la'],
  ]);

  // The words selected take another language, and the stretch they make has a label of its own.
  await page.locator('[data-token]', { hasText: 'virumque' }).dblclick();
  await control.click();
  await page.getByRole('menuitem', { name: /Ancient Greek/ }).click();
  await expect(labels).toHaveCount(3);
  await expect(labels.nth(1)).toHaveAttribute('data-label', 'Ancient Greek');
  await expect(labels.nth(2)).toHaveAttribute('data-label', 'Latin');
  await expect.poll(savedWords, { timeout: 15_000 }).toEqual([
    ['arma', 'la'],
    ['virumque', 'grc'],
    ['cano', 'la'],
  ]);

  // The menu lists the languages of the text first, in the order they first occur.
  await control.click();
  const items = page.getByRole('menuitem');
  await expect(items.nth(0)).toContainText('Latin');
  await expect(items.nth(1)).toContainText('Ancient Greek');
  await page.keyboard.press('Escape');

  // With nothing selected, a language of one's own given by its tag is the language of what is typed next.
  await page.locator('[data-token]', { hasText: 'cano' }).click();
  await page.keyboard.press('End');
  await control.click();
  await page.getByRole('menuitem', { name: editor.language.other }).click();
  const other = page.getByRole('dialog', { name: editor.language.label });
  await other.getByLabel(editor.language.code).fill('hbo');
  await other.getByRole('button', { name: editor.language.choose, exact: true }).click();
  await expect(other).toHaveCount(0);
  await expect(control).toHaveText('hbo');
  await expect(text).toBeFocused();
  await page.keyboard.type(' bereshit');
  await expect.poll(savedWords, { timeout: 15_000 }).toEqual([
    ['arma', 'la'],
    ['virumque', 'grc'],
    ['cano', 'la'],
    ['bereshit', 'hbo'],
  ]);
  await expect(labels).toHaveCount(4);
});
