/**
 * Steps the browser specs share.
 */
import { expect, type Page } from '@playwright/test';
import { editor } from '../src/lib/strings/editor';

/**
 * Answer the chooser that the first word typed into a text without a
 * language opens: choose the language by its name, as the list gives it.
 */
export async function chooseLanguage(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: editor.language.label });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(editor.language.ask)).toBeVisible();
  await dialog.getByRole('radio', { name }).check();
  await dialog.getByRole('button', { name: editor.language.choose, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Type into the text, starting where the caret is, and answer the chooser the first word opens. */
export async function typeFirstWords(page: Page, text: string, language: string): Promise<void> {
  const [first, ...rest] = [...text];
  await page.keyboard.type(first!);
  await chooseLanguage(page, language);
  await expect(page.locator('.cm-content')).toBeFocused();
  if (rest.length) await page.keyboard.type(rest.join(''));
}
