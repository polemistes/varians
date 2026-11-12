/**
 * A transcript has no works of its own: the work is chosen where text is
 * assigned. In a new transcript the segment window's Work field offers no
 * work and its search is open; a work found there is selected, and once a
 * segment of it is set the work is offered by itself, with the next label,
 * and the work's page lists the transcript.
 */
import { expect, test, type Page } from '@playwright/test';
import { fromText, newId, type Item } from '@varians/core';
import {
  createDatabase,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
} from '@varians/db';
import { eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { registry as reg } from '../src/lib/strings/registry';
import { workbench as w } from '../src/lib/strings/workbench';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `segment-work-${stamp}@example.org`;
const password = 'a long enough password';
const workTitle = `Carmen eligendum ${stamp}`;
const transcriptName = `Liber eligendus ${stamp}`;
let witnessSlug = '';

test.afterAll(async () => {
  const { db, pool } = createDatabase(DATABASE_URL);
  if (witnessSlug) {
    const [witness] = await db.select().from(witnesses).where(eq(witnesses.slug, witnessSlug));
    if (witness) {
      await db.delete(transcriptions).where(eq(transcriptions.witnessId, witness.id));
      await db.delete(witnesses).where(eq(witnesses.id, witness.id));
    }
  }
  await db.delete(works).where(eq(works.title, workTitle));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await db.delete(users).where(eq(users.email, email));
  await pool.end();
});

async function selectLine(page: Page, n: number) {
  const line = page.locator('.cm-content .cm-line').nth(n);
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible({
    timeout: 15_000,
  });
}

test('the work is chosen in the segment window, and comes back by itself once text is assigned', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Segment Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  await page.goto('/works/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=title]').fill(workTitle);
  await page.locator('input[name=author]').fill('Vergilius');
  await page.locator('select[name=language]').selectOption('la');
  await page.getByRole('button', { name: reg.work.create, exact: true }).click();
  await page.waitForURL(
    (url) => /^\/works\/[^/]+$/.test(url.pathname) && url.pathname !== '/works/new',
  );
  const workPath = new URL(page.url()).pathname;

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(`Codex Eligendus ${stamp}`);
  await page.locator('input[name=siglum]').fill('E');
  await page.getByRole('button', { name: reg.witness.create, exact: true }).click();
  await page.waitForURL(
    (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
  );
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: reg.witness.newTranscription }).first().click();
  const create = page.getByRole('dialog');
  await create.locator('input[name=name]').fill(transcriptName);
  await create.getByRole('button', { name: reg.transcription.create, exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  const transcriptPath = new URL(page.url()).pathname;
  const transcriptionId = transcriptPath.split('/').pop()!;

  // Two lines of text, assigned to nothing.
  const items: Item[] = [
    ...fromText('arma virumque cano').items,
    { kind: 'break', id: newId(), type: 'line' },
    ...fromText('Italiam fato profugus').items,
  ];
  const saving = await page.request.post(`/api/documents/transcription/${transcriptionId}/ops`, {
    data: { fromVersion: 0, ops: [{ t: 'insert', after: null, items }] },
  });
  expect(saving.ok(), await saving.text()).toBe(true);

  // The work's page does not list a transcript with nothing assigned to the work.
  await page.goto(workPath);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(transcriptName)).toHaveCount(0);

  await page.goto(transcriptPath);
  await page.waitForSelector('.cm-content');
  await page.waitForLoadState('networkidle');

  // No work to offer: the select is empty, the search open, and nothing can be set yet.
  await selectLine(page, 0);
  await page.getByRole('button', { name: w.toolbar.segment, exact: true }).click();
  let form = page.getByRole('form', { name: w.segment.title });
  const select = () => form.getByLabel(w.workField.label, { exact: true });
  const another = () => form.getByRole('checkbox', { name: w.workField.another });
  const search = () => form.getByRole('searchbox', { name: w.workField.search });
  const set = () => form.getByRole('button', { name: w.segment.set, exact: true });
  await expect(select()).toHaveValue('');
  await expect(select().locator('option')).toHaveCount(0);
  await expect(another()).toBeChecked();
  await expect(search()).toBeVisible();
  await form.getByLabel(w.segment.label, { exact: true }).fill('1.1');
  await expect(set()).toBeDisabled();

  // Found in the registry: the work is selected and the search closes.
  await search().fill(workTitle);
  await form.getByRole('button', { name: new RegExp(workTitle) }).click();
  await expect(select().locator('option:checked')).toHaveText(workTitle);
  await expect(another()).not.toBeChecked();
  await expect(search()).toHaveCount(0);
  await set().click();
  await expect(form).toHaveCount(0);
  await saved(page);

  // Opened again: the text brings its work, and the next label is proposed.
  await page.reload();
  await page.waitForSelector('.cm-content');
  await page.waitForLoadState('networkidle');
  await selectLine(page, 1);
  await page.getByRole('button', { name: w.toolbar.segment, exact: true }).click();
  form = page.getByRole('form', { name: w.segment.title });
  await expect(select().locator('option:checked')).toHaveText(workTitle);
  await expect(another()).not.toBeChecked();
  await expect(form.getByLabel(w.segment.label, { exact: true })).toHaveValue('1.2');
  await set().click();
  await expect(form).toHaveCount(0);
  await saved(page);

  // The work's page now lists the transcript.
  await page.goto(workPath);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(transcriptName).first()).toBeVisible();
});
