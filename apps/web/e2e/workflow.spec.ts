/**
 * The whole way through, as an editor goes: register a work and two
 * witnesses, transcribe both (the text is saved through the editors' save
 * endpoint, as the workbench saves it), make an edition on Make New Edition
 * (its text put in through the same endpoint), adopt a reading
 * of the second witness, publish, read the published edition as a visitor
 * would, and download the work's archive.
 */
import { expect, test, type Page } from '@playwright/test';
import { fromText, newId, type Item, type Token } from '@varians/core';
import {
  createDatabase,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { edition as ed } from '../src/lib/strings/edition';
import { editor } from '../src/lib/strings/editor';
import { reader as rd } from '../src/lib/strings/reader';
import { recordActions as actions } from '../src/lib/strings/record-actions';
import { pageStrings as t } from '../src/lib/strings/pages';
import { workbench as w } from '../src/lib/strings/workbench';
import { registry as reg } from '../src/lib/strings/registry';

const ea = actions.edition;
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
    const rows = await db
      .select({ id: witnesses.id })
      .from(witnesses)
      .where(inArray(witnesses.slug, witnessSlugs));
    if (rows.length)
      await db.delete(transcriptions).where(
        inArray(
          transcriptions.witnessId,
          rows.map((r) => r.id),
        ),
      );
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
  await expect(page.locator('.apparatus-band [aria-busy=true]')).toHaveCount(0, {
    timeout: 15_000,
  });
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
  await page.getByRole('button', { name: reg.work.create, exact: true }).click();
  await page.waitForURL(
    (url) => /^\/works\/[^/]+$/.test(url.pathname) && url.pathname !== '/works/new',
  );
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
    await page.getByRole('button', { name: reg.witness.create, exact: true }).click();
    await page.waitForURL(
      (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
    );
    witnessSlugs.push(new URL(page.url()).pathname.split('/').pop()!);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: reg.witness.newTranscription }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select[name=workId]').selectOption({ label: `${workTitle} (Vergilius)` });
    await dialog.locator('input[name=name]').fill('Liber 1');
    await dialog.getByRole('button', { name: reg.transcription.create, exact: true }).click();
    await page.waitForURL(/\/transcriptions\/[^/]+$/);
    transcriptionIds.push(new URL(page.url()).pathname.split('/').pop()!);
  }

  // Their texts, saved as the workbench saves them: segments first, then the words as operations.
  const { db, pool } = createDatabase(DATABASE_URL);
  const [work] = await db.select({ id: works.id }).from(works).where(eq(works.slug, workSlug));
  await pool.end();
  const segmentsResponse = await page.request.post(`/api/works/${work!.id}/segments`, {
    data: { labels: Object.keys(TEXT_X) },
  });
  expect(segmentsResponse.ok()).toBe(true);
  const segmentBody = (await segmentsResponse.json()) as {
    segments: { id: string; label: string }[];
  };
  const segmentIds = Object.fromEntries(segmentBody.segments.map((x) => [x.label, x.id]));
  for (const [i, lines] of [TEXT_X, TEXT_Y].entries()) {
    const response = await page.request.post(
      `/api/documents/transcription/${transcriptionIds[i]}/ops`,
      {
        data: {
          fromVersion: 0,
          ops: [{ t: 'insert', after: null, items: streamOf(lines, segmentIds) }],
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
  }

  // An edition comparing X and Y, made on Make New Edition from the work's page.
  await page.goto(`/works/${workSlug}`);
  await page.getByRole('link', { name: ed.newTitle }).click();
  await page.waitForURL(/\/editions\/new\?work=/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: ed.title }).fill(`Aeneis 1, ${stamp}`);
  for (const name of [`Codex Probandi ${stamp}`, `Codex Alter ${stamp}`]) {
    // Each witness is found in the list on the page and chosen there.
    await page.getByPlaceholder(ed.conspectus.search).fill(name);
    await page.getByRole('button', { name: `${ed.choose}: ${name}`, exact: true }).click();
    await expect(
      page.getByLabel(`${ed.conspectus.siglum}: ${name}`, { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: ed.save, exact: true }).click();
  await page.waitForURL(/\/editions\/[^/]+\/settings$/);
  editionSlug = new URL(page.url()).pathname.split('/')[2]!;

  // The edition starts empty; its text is copied from X's transcript, the first of the conspectus.
  await page.getByRole('link', { name: ea.edit, exact: true }).click();
  await page.waitForURL(/\/editions\/[^/]+\/edit$/);
  await page.getByRole('button', { name: editor.dialogs.copyText.menu }).click();
  const copy = page.getByRole('dialog', { name: editor.dialogs.copyText.title });
  await copy.getByLabel(editor.dialogs.copyText.transcript).selectOption({ index: 0 });
  await Promise.all([
    page.waitForEvent('load', { timeout: 15_000 }),
    copy.getByRole('button', { name: editor.dialogs.copyText.copy }).click(),
  ]);
  await page.waitForSelector('.cm-content');
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(/Laviniaque/);

  // Y's reading at 1.2 is offered in the apparatus band; adopting it changes the text.
  await page
    .locator('.apparatus-band button[title="Adopt"]', { hasText: 'Lavinaque' })
    .first()
    .click();
  await saved(page);
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(/Lavinaque/);

  // Publish, in the application's window.
  await page.getByRole('button', { name: ea.publishButton, exact: true }).click();
  await page
    .getByRole('dialog', { name: ea.publishTitle })
    .getByRole('button', { name: ea.publishVerb, exact: true })
    .click();
  await expect(page.getByText(/Published as version 1/)).toBeVisible({ timeout: 15_000 });

  // The reader, signed out: the published text, and X's reading in the window of the variant.
  const visitor = await page.context().browser()!.newContext();
  const reader = await visitor.newPage();
  await reader.goto(`/editions/${editionSlug}`);
  await expect(reader.locator('h1')).toHaveText(`Aeneis 1, ${stamp}`);
  await expect(reader.getByText('Lavinaque').first()).toBeVisible();
  await reader.waitForLoadState('networkidle');
  await reader.locator('[data-sites]', { hasText: 'Lavinaque' }).first().click();
  await expect(reader.getByRole('dialog', { name: rd.entry.title('1.2') })).toContainText(
    'Laviniaque',
  );
  await reader.keyboard.press('Escape');
  // The download links load the files, not an edition page of that name; the plain text is not among them.
  await reader.getByRole('button', { name: actions.menu, exact: true }).click();
  await expect(reader.getByRole('menuitem', { name: /Plain Text/ })).toHaveCount(0);
  await reader.keyboard.press('Escape');
  for (const [name, ending] of [['TEI XML', '.tei.xml']] as const) {
    await reader.waitForLoadState('networkidle');
    await reader.getByRole('button', { name: actions.menu, exact: true }).click();
    const [answer] = await Promise.all([
      reader.waitForResponse((r) => new URL(r.url()).pathname.endsWith(ending)),
      reader.getByRole('menuitem', { name }).click(),
    ]);
    expect(answer.status()).toBe(200);
    await reader.goto(`/editions/${editionSlug}`);
  }
  // The plain text is kept at its address, linked from nowhere.
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

  // Pages for the second witness, added in the workbench; the second line is moved onto the first of them.
  await page.goto(`/transcriptions/${transcriptionIds[1]}`);
  await page.waitForLoadState('networkidle');
  const pane = page.getByRole('complementary', { name: w.pane.label });
  await pane.getByRole('tab', { name: w.pane.pages }).click();
  await pane.getByRole('button', { name: t.panel.addPages }).click();
  await pane.getByLabel(t.add.labels).fill('1r-1v');
  await pane.getByRole('button', { name: t.add.submit(2) }).click();
  await expect(pane.getByRole('list', { name: t.gridLabel }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: w.pages.choose })).toHaveText(w.pages.unplaced);
  const line = page.locator('.cm-content .cm-line').nth(1);
  const words = (await line.textContent())!;
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: w.move.to('1r') }).click();
  await expect(page.getByText(w.move.moved('1r'))).toBeVisible();
  await page.getByRole('button', { name: w.move.show, exact: true }).click();
  await expect(page.getByRole('button', { name: w.pages.choose })).toHaveText('1r');
  await expect(page.locator('.cm-content .cm-line')).toHaveText([words]);
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible({
    timeout: 15_000,
  });

  // A copy of the transcription, from the workbench's menu: a draft of one's own with the same text.
  await page.getByRole('button', { name: actions.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: actions.transcription.copy }).click();
  await expect(page.getByRole('dialog').locator('input[name=name]')).toHaveValue('Copy of Liber 1');
  await page.getByRole('dialog').getByRole('button', { name: reg.copy.make }).click();
  await page.waitForURL(
    (url) =>
      /^\/transcriptions\/[^/]+$/.test(url.pathname) &&
      !url.pathname.endsWith(transcriptionIds[1]!),
  );
  await expect(page.locator('h1')).toHaveText('Copy of Liber 1');
  // The copy opens on the first page with text, as the transcript does.
  await expect(page.locator('.cm-content .cm-line').nth(0)).toHaveText(words);
  // The copy is for the same work; Settings shows it as the first of its works.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: actions.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: actions.transcription.settings }).click();
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Works' })).toContainText(
    workTitle,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // A copy of the edition, from the editor: it opens in the editor with the same text.
  await page.goto(`/editions/${editionSlug}/edit`);
  await page.waitForSelector('.cm-content');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: actions.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: ea.copy }).click();
  await page.getByRole('dialog').getByRole('button', { name: reg.copy.make }).click();
  await page.waitForURL(
    (url) => /\/edit$/.test(url.pathname) && !url.pathname.includes(`/${editionSlug}/`),
  );
  await expect(page.locator('h1')).toHaveText(`Copy of Aeneis 1, ${stamp}`);
  await expect(page.locator('.cm-content .cm-line').nth(1)).toHaveText(/Lavinaque/);
  // Its reader says where it came from.
  const copySlug = new URL(page.url()).pathname.split('/')[2]!;
  await page.goto(`/editions/${copySlug}`);
  await expect(page.locator('footer.colophon')).toContainText(`Based on Aeneis 1, ${stamp}`);

  // A witness an edition names cannot be deleted: its page says so in the menu.
  await page.goto(`/witnesses/${witnessSlugs[0]}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: actions.menu, exact: true }).click();
  const remove = page.getByRole('menuitem', { name: new RegExp(actions.witness.delete) });
  await expect(remove).toHaveAttribute('data-disabled', '');
  await expect(remove).toContainText(`Aeneis 1, ${stamp}`);
});
