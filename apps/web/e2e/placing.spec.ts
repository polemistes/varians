/**
 * Pages as containers of text: a transcript whose text is all on
 * no page is placed page by page with Move to Page…, the facsimile
 * proposing the next page without text; a later page is placed before an
 * earlier one; every word keeps its segment; removing a page with text
 * sends the text to Not on a page; and text typed on a page that was
 * removed elsewhere meanwhile is saved on no page, the workbench following.
 */
import { expect, test, type Page } from '@playwright/test';
import { fromText, newId, segmentAt, type Item, type Stream, type Token } from '@varians/core';
import {
  createDatabase,
  pages,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
} from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { pageStrings as t } from '../src/lib/strings/pages';
import { recordActions } from '../src/lib/strings/record-actions';
import { registry as reg } from '../src/lib/strings/registry';
import { workbench as w } from '../src/lib/strings/workbench';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `placing-${stamp}@example.org`;
const password = 'a long enough password';
const workTitle = `Carmen paginatum ${stamp}`;
const shots = process.env.E2E_SHOTS;
let witnessSlug = '';
let transcriptionId = '';

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/placing-${name}.png` });
}

const LINES: Record<string, string> = {
  '1.1': 'arma virumque cano',
  '1.2': 'Italiam fato profugus',
  '1.3': 'litora multum ille',
  '1.4': 'vi superum saevae',
};

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

async function content(): Promise<Stream> {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [row] = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  await pool.end();
  return row!.content;
}

/** The stream as `#page` for page breaks (by label), `/` for line breaks and the words. */
function shape(stream: Stream, labels: Record<string, string>): string {
  return stream.items
    .map((i) =>
      i.kind === 'break'
        ? i.type === 'page'
          ? `#${labels[i.pageId!] ?? '?'}`
          : '/'
        : i.kind === 'token'
          ? i.form
          : '·',
    )
    .join(' ');
}

/** The segment label of every word by flow. */
function segmentsOf(
  stream: Stream,
  labelOf: Record<string, string>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  stream.items.forEach((item, i) => {
    if (item.kind === 'token') {
      const id = segmentAt(stream, i)?.segmentId;
      out[item.form] = id ? (labelOf[id] ?? id) : null;
    }
  });
  return out;
}

/** Select the whole of one line of the text shown. */
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

test('text on no page is placed page by page, and goes back when its page is removed', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Placing Tester');
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
  const workSlug = new URL(page.url()).pathname.split('/').pop()!;

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(`Codex Paginatus ${stamp}`);
  await page.locator('input[name=siglum]').fill('Q');
  await page.getByRole('button', { name: reg.witness.create, exact: true }).click();
  await page.waitForURL(
    (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
  );
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: reg.witness.newTranscription }).first().click();
  const create = page.getByRole('dialog');
  await create.locator('select[name=workId]').selectOption({ label: `${workTitle} (Vergilius)` });
  await create.locator('input[name=name]').fill('Liber 1');
  await create.getByRole('button', { name: reg.transcription.create, exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  transcriptionId = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');

  // Three pages, added on the Pages tab the new transcript opens on.
  const pane = page.getByRole('complementary', { name: w.pane.label });
  await expect(pane.getByRole('tab', { name: w.pane.pages })).toHaveAttribute(
    'data-state',
    'active',
  );
  await pane.getByRole('button', { name: t.panel.addPages }).click();
  await pane.getByLabel(t.add.labels).fill('1r-2r');
  await pane.getByRole('button', { name: t.add.submit(3) }).click();
  await expect(pane.getByRole('list', { name: t.gridLabel }).getByRole('listitem')).toHaveCount(3);

  // The whole text, segmented, on no page: as an import would leave it.
  const { db, pool } = createDatabase(DATABASE_URL);
  const [work] = await db.select({ id: works.id }).from(works).where(eq(works.slug, workSlug));
  const [witnessRow] = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(eq(witnesses.slug, witnessSlug));
  await pool.end();
  const made = await page.request.post(`/api/works/${work!.id}/segments`, {
    data: { labels: Object.keys(LINES) },
  });
  const segmentRows = ((await made.json()) as { segments: { id: string; label: string }[] })
    .segments;
  const labelOf = Object.fromEntries(segmentRows.map((x) => [x.id, x.label]));
  const items: Item[] = [];
  for (const [label, text] of Object.entries(LINES)) {
    if (items.length) items.push({ kind: 'break', id: newId(), type: 'line' });
    const line = fromText(text).items;
    (line[0] as Token).segment = { segmentId: segmentRows.find((x) => x.label === label)!.id };
    items.push(...line);
  }
  const saving = await page.request.post(`/api/documents/transcription/${transcriptionId}/ops`, {
    data: { fromVersion: 0, ops: [{ t: 'insert', after: null, items }] },
  });
  expect(saving.ok(), await saving.text()).toBe(true);
  const before = segmentsOf({ items }, labelOf);

  // Opened again: no page has text, so the transcript opens on Not on a page, the facsimile on the first page.
  await page.goto(`/transcriptions/${transcriptionId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: w.pages.choose })).toHaveText(w.pages.unplaced);
  await pane.getByRole('tab', { name: w.pane.facsimile }).click();
  const shown = pane.getByLabel(w.move.facsimilePage);
  await expect(shown.locator('option:checked')).toHaveText('1r');

  // The first line stands on 1r: moved there, and the facsimile goes on to 1v.
  await selectLine(page, 0);
  await expect(page.getByRole('button', { name: w.move.to('1r') })).toBeVisible();
  await shot(page, '1-unplaced-selection');
  await page.getByRole('button', { name: w.move.to('1r') }).click();
  await expect(page.getByText(w.move.moved('1r'))).toBeVisible();
  await expect(shown.locator('option:checked')).toHaveText('1v');
  await expect(page.locator('.cm-content .cm-line')).toHaveCount(3);

  // The last line stands on 2r, placed before 1v has its text.
  await shown.selectOption({ label: '2r' });
  await selectLine(page, 2);
  await page.getByRole('button', { name: w.move.to('2r') }).click();
  await expect(page.getByText(w.move.moved('2r'))).toBeVisible();

  // The two lines left are 1v's, proposed again.
  await expect(shown.locator('option:checked')).toHaveText('1v');
  const first = page.locator('.cm-content .cm-line').nth(0);
  await first.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+End');
  await page.getByRole('button', { name: w.move.to('1v') }).click();
  await expect(page.getByText(w.move.moved('1v'))).toBeVisible();
  await saved(page);

  const { db: db2, pool: pool2 } = createDatabase(DATABASE_URL);
  const pageRows = await db2.query.pages.findMany({
    where: (p, { eq }) => eq(p.witnessId, witnessRow!.id),
  });
  await pool2.end();
  const pageLabels = Object.fromEntries(pageRows.map((p) => [p.id, p.label]));
  const placed = await content();
  expect(shape(placed, pageLabels)).toBe(
    '#1r arma virumque cano #1v Italiam fato profugus / litora multum ille #2r vi superum saevae',
  );
  expect(segmentsOf(placed, labelOf)).toEqual(before);

  // On 2r the gutter shows its line's segment; the chooser marks the pages with text.
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: '2r' }).click();
  await expect(page.locator('.cm-segment-label').first()).toHaveText('1.4');
  await shot(page, '2-page');

  // The whole text, read only, the pages under their labels; a double-click opens a word's page.
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: w.pages.whole }).click();
  await expect(page.locator('.cm-break-page')).toHaveCount(3);
  await shot(page, '3-whole');
  await page.locator('.cm-content [data-token]', { hasText: 'litora' }).dblclick();
  await expect(page.getByRole('button', { name: w.pages.choose })).toHaveText('1v');

  // Cut and paste moves words: 2r's line cut, pasted after the last word of 1r, keeps its ids and its segment.
  const idsOf = (stream: Stream, forms: string[]) =>
    forms.map((f) => stream.items.find((i) => i.kind === 'token' && i.form === f)!.id);
  const moving = ['vi', 'superum', 'saevae'];
  const idsBefore = idsOf(await content(), moving);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: '2r' }).click();
  await selectLine(page, 0);
  await page.keyboard.press('Control+x');
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: '1r' }).click();
  await page.locator('.cm-content .cm-line').nth(0).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  // The pasted words begin segment 1.4 in mid-line: its label stands before them.
  await expect(page.locator('.cm-content .cm-line').nth(0)).toHaveText(
    'arma virumque cano 1.4vi superum saevae',
  );
  await saved(page);
  const pasted = await content();
  expect(idsOf(pasted, moving)).toEqual(idsBefore);
  expect(segmentsOf(pasted, labelOf)).toEqual(before);

  // Back to 2r with the toolbar's chooser: the last three words selected.
  await page.locator('.cm-content .cm-line').nth(0).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.getByRole('button', { name: w.move.other }).click();
  await page.getByRole('menuitem', { name: '2r' }).click();
  await expect(page.getByText(w.move.moved('2r'))).toBeVisible();
  await saved(page);
  expect(shape(await content(), pageLabels)).toBe(
    '#1r arma virumque cano #1v Italiam fato profugus / litora multum ille #2r vi superum saevae',
  );
  expect(segmentsOf(await content(), labelOf)).toEqual(before);

  // 1v removed: its two lines go to Not on a page, which the chooser then counts.
  await pane.getByRole('tab', { name: w.pane.pages }).click();
  const card = pane
    .getByRole('list', { name: t.gridLabel })
    .getByRole('article', { name: '1v', exact: true });
  await expect(card.getByText(t.card.lines(2))).toBeVisible();
  await card.getByRole('button', { name: t.card.menu('1v') }).click();
  await page.getByRole('menuitem', { name: t.menu.remove }).click();
  const removal = page.getByRole('dialog', { name: t.remove.title('1v') });
  await expect(removal).toContainText(t.remove.description('1v', 6, 1, 0, false));
  await removal.getByRole('button', { name: t.remove.submit }).click();
  await expect(page.getByText(t.remove.moved('1v', 6, 1))).toBeVisible();
  const after = await content();
  expect(shape(after, pageLabels)).toBe(
    'Italiam fato profugus / litora multum ille #1r arma virumque cano #2r vi superum saevae',
  );
  expect(segmentsOf(after, labelOf)).toEqual(before);
  await page.getByRole('button', { name: w.pages.choose }).click();
  await expect(
    page.getByRole('menuitem', {
      name: new RegExp(`${w.pages.unplaced}.*${w.pages.unplacedWords(6)}`),
    }),
  ).toBeVisible();

  // A page removed elsewhere while this workbench still lists it: what is typed on it is saved,
  // put on no page by the server, and the workbench takes up the text as it now stands.
  await page.keyboard.press('Escape');
  await pane.getByRole('button', { name: t.panel.addPages }).click();
  await pane.getByLabel(t.add.labels).fill('3r');
  await pane.getByRole('button', { name: t.add.submit(1), exact: true }).click();
  await expect(pane.getByRole('list', { name: t.gridLabel }).getByRole('listitem')).toHaveCount(3);
  const { db: db4, pool: pool4 } = createDatabase(DATABASE_URL);
  await db4.delete(pages).where(and(eq(pages.witnessId, witnessRow!.id), eq(pages.label, '3r')));
  await pool4.end();
  await page.getByRole('button', { name: w.pages.choose }).click();
  await page.getByRole('menuitem', { name: '3r' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('ignotum');
  await expect(page.getByText(w.pages.pageGone)).toBeVisible({ timeout: 15_000 });
  await saved(page);
  expect(shape(await content(), pageLabels)).toBe(
    'Italiam fato profugus / litora multum ille / ignotum #1r arma virumque cano #2r vi superum saevae',
  );
  await page.getByRole('button', { name: w.move.show, exact: true }).click();
  await expect(page.getByRole('button', { name: w.pages.choose })).toHaveText(w.pages.unplaced);
  await expect(page.locator('.cm-content .cm-line')).toHaveCount(3);
  await expect(page.locator('.cm-content .cm-line').nth(2)).toHaveText('ignotum');
  await page.getByRole('button', { name: w.pages.choose }).click();
  await expect(page.getByRole('menuitem', { name: '3r' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await shot(page, '4-page-gone');

  // The witness is deleted from its own page, with its pages and the transcript of its creator.
  await page.goto(`/witnesses/${witnessSlug}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: recordActions.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: recordActions.witness.delete }).click();
  const confirm = page.getByRole('dialog', { name: recordActions.witness.deleteTitle });
  await expect(confirm).toContainText(recordActions.witness.deleteBody);
  await confirm
    .getByRole('button', { name: recordActions.witness.deleteVerb, exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === '/');
  const { db: db3, pool: pool3 } = createDatabase(DATABASE_URL);
  expect(await db3.select().from(witnesses).where(eq(witnesses.slug, witnessSlug))).toEqual([]);
  expect(
    await db3.select().from(transcriptions).where(eq(transcriptions.id, transcriptionId)),
  ).toEqual([]);
  await pool3.end();
});
