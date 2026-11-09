/**
 * The whole way through, as an editor goes: register a work and two
 * witnesses, transcribe both (the text is saved through the editors' save
 * endpoint, as the workbench saves it), make an edition, adopt a reading
 * of the second witness, publish, read the published edition as a visitor
 * would, and download the work's archive.
 */
import { expect, test, type Page } from '@playwright/test';
import { fromText, newId, type Item, type Token } from '@varians/core';
import { createDatabase, editions, referenceSchemes, transcriptions, users, witnesses, works } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `workflow-${stamp}@example.org`;
const password = 'a long enough password';
const workTitle = `Carmen probandi ${stamp}`;

const TEXT_X: Record<string, string> = {
  '1.1': 'arma virumque cano Troiae qui primus ab oris',
  '1.2': 'Italiam fato profugus Laviniaque venit',
  '1.3': 'litora multum ille et terris iactatus et alto',
};
const TEXT_Y: Record<string, string> = {
  '1.1': 'arma virumque cano Troiae qui primus ab oris',
  '1.2': 'Italiam fato profugus Lavinaque venit',
  '1.3': 'litora multum ille et terris iactatus et alto',
};

let workSlug = '';
let editionSlug = '';
const witnessSlugs: string[] = [];

async function cleanUp() {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [work] = await db.select().from(works).where(eq(works.title, workTitle));
  if (work) {
    await db.delete(editions).where(eq(editions.workId, work.id));
    await db.delete(works).where(eq(works.id, work.id));
  }
  if (witnessSlugs.length) {
    const rows = await db.select({ id: witnesses.id }).from(witnesses).where(inArray(witnesses.slug, witnessSlugs));
    if (rows.length) await db.delete(transcriptions).where(inArray(transcriptions.witnessId, rows.map((r) => r.id)));
    await db.delete(witnesses).where(inArray(witnesses.slug, witnessSlugs));
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await pool.end();
}

/** The lines as a stream: a line break between lines, each line's first word starting its segment. */
function streamOf(lines: Record<string, string>, segmentIds: Record<string, string>): Item[] {
  const items: Item[] = [];
  for (const [label, text] of Object.entries(lines)) {
    if (items.length) items.push({ kind: 'break', id: newId(), type: 'line' });
    const line = fromText(text).items;
    (line[0] as Token).segment = { segmentId: segmentIds[label]! };
    items.push(...line);
  }
  return items;
}

async function saved(page: Page) {
  await expect(page.locator('[aria-live=polite]').first()).toHaveText('Saved', { timeout: 15_000 });
  await expect(page.locator('.apparatus-band [aria-busy=true]')).toHaveCount(0, { timeout: 15_000 });
}

test.describe.configure({ mode: 'serial' });

test.afterAll(cleanUp);

test('from a new work to a published edition and its archive', async ({ page }) => {
  test.setTimeout(180_000);

  // An account.
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Workflow Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  // A work, with the default scheme of book and line.
  await page.goto('/works/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=title]').fill(workTitle);
  await page.locator('input[name=author]').fill('Vergilius');
  await page.locator('select[name=language]').selectOption('la');
  await page.getByRole('button', { name: 'Register the work' }).click();
  await page.waitForURL((url) => /^\/works\/[^/]+$/.test(url.pathname) && url.pathname !== '/works/new');
  workSlug = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.locator('h1')).toHaveText(workTitle);

  // Two witnesses, each with a transcription for the work.
  const transcriptionIds: string[] = [];
  for (const [siglum, name] of [
    ['X', `Codex Probandi ${stamp}`],
    ['Y', `Codex Alter ${stamp}`],
  ] as const) {
    await page.goto('/witnesses/new');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name=name]').fill(name);
    await page.locator('input[name=siglum]').fill(siglum);
    await page.getByRole('button', { name: 'Register the witness' }).click();
    await page.waitForURL((url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new');
    witnessSlugs.push(new URL(page.url()).pathname.split('/').pop()!);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'New transcript' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select[name=workId]').selectOption({ label: `${workTitle} (Vergilius)` });
    await dialog.locator('input[name=name]').fill('Liber 1');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/transcriptions\/[^/]+$/);
    transcriptionIds.push(new URL(page.url()).pathname.split('/').pop()!);
  }

  // Their texts, saved as the workbench saves them: segments first, then the words as operations.
  const { db, pool } = createDatabase(DATABASE_URL);
  const [work] = await db.select({ id: works.id }).from(works).where(eq(works.slug, workSlug));
  await pool.end();
  const segmentsResponse = await page.request.post(`/api/works/${work!.id}/segments`, { data: { labels: Object.keys(TEXT_X) } });
  expect(segmentsResponse.ok()).toBe(true);
  const segmentBody = (await segmentsResponse.json()) as { segments: { id: string; label: string }[] };
  const segmentIds = Object.fromEntries(segmentBody.segments.map((x) => [x.label, x.id]));
  for (const [i, lines] of [TEXT_X, TEXT_Y].entries()) {
    const response = await page.request.post(`/api/documents/transcription/${transcriptionIds[i]}/ops`, {
      data: { fromVersion: 0, ops: [{ t: 'insert', after: null, items: streamOf(lines, segmentIds) }] },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  // An edition based on X, comparing X and Y.
  await page.goto(`/editions/new?work=${workSlug}`);
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=title]').fill(`Aeneis 1, ${stamp}`);
  await page.locator('select[name=base]').selectOption(transcriptionIds[0]!);
  await page.getByRole('button', { name: 'Create the edition' }).click();
  await page.waitForURL(/\/editions\/[^/]+\/edit$/);
  editionSlug = new URL(page.url()).pathname.split('/')[2]!;
  await page.waitForSelector('.cm-content');
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(/Laviniaque/);

  // Y's reading at 1.2 is offered in the apparatus band; adopting it changes the text.
  await page.locator('.apparatus-band button[title="Adopt"]', { hasText: 'Lavinaque' }).first().click();
  await saved(page);
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(/Lavinaque/);

  // Publish.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published as version 1/)).toBeVisible({ timeout: 15_000 });

  // The reader, signed out: the published text with X's reading in the apparatus.
  const visitor = await page.context().browser()!.newContext();
  const reader = await visitor.newPage();
  await reader.goto(`/editions/${editionSlug}`);
  await expect(reader.locator('h1')).toHaveText(`Aeneis 1, ${stamp}`);
  await expect(reader.getByText('Lavinaque').first()).toBeVisible();
  await expect(reader.locator('main')).toContainText('Laviniaque');
  // The download links load the files, not an edition page of that name.
  for (const [name, ending] of [
    ['Plain text with apparatus', '.txt'],
    ['TEI XML', '.tei.xml'],
  ] as const) {
    await reader.waitForLoadState('networkidle');
    await reader.getByRole('button', { name: 'Downloads and versions' }).click();
    const [answer] = await Promise.all([
      reader.waitForResponse((r) => new URL(r.url()).pathname.endsWith(ending)),
      reader.getByRole('menuitem', { name }).click(),
    ]);
    expect(answer.status()).toBe(200);
    await reader.goto(`/editions/${editionSlug}`);
  }
  const text = await reader.request.get(`/editions/${editionSlug}.txt`);
  expect(text.ok()).toBe(true);
  expect(await text.text()).toContain('Laviniaque X');
  // The work page is public too.
  await reader.goto(`/works/${workSlug}`);
  await expect(reader.locator('h1')).toHaveText(workTitle);
  await visitor.close();

  // The archive, as the editor sees it.
  const archive = await page.request.get(`/works/${workSlug}/archive.zip`);
  expect(archive.ok()).toBe(true);
  expect(archive.headers()['content-type']).toBe('application/zip');
  expect((await archive.body()).subarray(0, 2).toString()).toBe('PK');

  // A page break from the Insert menu, nothing selected, the caret inside a line: the line begins the page, whole.
  await page.goto(`/transcriptions/${transcriptionIds[1]}`);
  await page.waitForLoadState('networkidle');
  const line = page.locator('.cm-content .cm-line').nth(1);
  const words = (await line.textContent())!;
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Insert' }).click();
  await expect(page.getByRole('menu')).toContainText('Line 2 will begin a new page');
  await expect(page.locator('.cm-break-preview')).toHaveCount(1);
  await page.getByRole('menuitem', { name: /Page break/ }).click();
  await expect(page.locator('.cm-break-preview')).toHaveCount(0);
  await expect(page.locator('.cm-line.cm-page-start')).toHaveText(words);
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });

  // A copy of the transcription, from the workbench's menu: a draft of one's own with the same text.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Make a copy…' }).click();
  await expect(page.getByRole('dialog').locator('input[name=name]')).toHaveValue('Copy of Liber 1');
  await page.getByRole('dialog').getByRole('button', { name: 'Make the copy' }).click();
  await page.waitForURL((url) => /^\/transcriptions\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith(transcriptionIds[1]!));
  await expect(page.locator('h1')).toHaveText('Copy of Liber 1');
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(words);
  // The copy is for the same work; Settings shows it as the first of its works.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Settings…' }).click();
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Works' })).toContainText(workTitle);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // A copy of the edition, from the editor: it opens in the editor with the same text.
  await page.goto(`/editions/${editionSlug}/edit`);
  await page.waitForSelector('.cm-content');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Make a copy…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make the copy' }).click();
  await page.waitForURL((url) => /\/edit$/.test(url.pathname) && !url.pathname.includes(`/${editionSlug}/`));
  await expect(page.locator('h1')).toHaveText(`Copy of Aeneis 1, ${stamp}`);
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(/Lavinaque/);
  // Its reader says where it came from.
  const copySlug = new URL(page.url()).pathname.split('/')[2]!;
  await page.goto(`/editions/${copySlug}`);
  await expect(page.locator('footer.colophon')).toContainText(`Based on Aeneis 1, ${stamp}`);
});
