/**
 * Variants over whole segments in the reader: a segment some witnesses do not
 * have, a segment the edition does not print, and segments in another order.
 * In verse each has a mark in the margin that opens its window, and the same
 * in the list of variants; in prose each is marked in the text. The edition
 * is made here, of twelve segments, one to a line, in four witnesses:
 *
 * - A has every segment, 1.3 and 1.7 among them.
 * - B has no 1.3 and no 1.7, its text running on without them.
 * - C has no 1.3, and has 1.5 and 1.6 the other way round.
 * - D has no 1.3, and has 1.2 after 1.12.
 *
 * The edition does not print 1.3, so that is a segment it does not print; 1.7
 * is a segment B does not have; 1.5 and 1.6 are in another order in C; 1.2
 * stands far from its place in D, which is a block given by the segment it
 * follows. Two more editions of the same witnesses do not print 1.9 either,
 * which every witness has: one is prose throughout, the other verse up to 1.5
 * and prose from 1.6, so that the stretch 1.5 to 1.6 runs over both.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  SCHEME_PRESETS,
  defaultProfile,
  fromText,
  newId,
  type Item,
  type Lineation,
  type Stream,
  type Token,
} from '@varians/core';
import {
  createDatabase,
  editionSigla,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { reader as rd } from '../src/lib/strings/reader';
import { s } from '../src/lib/strings/en';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';
import { setChosenWorks } from '../src/lib/server/transcription-works.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `lines-${stamp}@example.org`;
const password = 'a long enough password';
const WORK = `lines-work-${stamp}`;
const EDITION = `lines-edition-${stamp}`;
const PROSE = `lines-prose-${stamp}`;
const MIXED = `lines-mixed-${stamp}`;
const SLUGS = ['a', 'b', 'c', 'd'].map((x) => `lines-${x}-${stamp}`);
// Where the screenshots are written: Playwright's own folder of results, which is not tracked.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/reader-lines';

const LINES: Record<string, string> = {
  '1.1': 'alpha beta gamma',
  '1.2': 'delta epsilon zeta',
  '1.3': 'eta theta iota',
  '1.4': 'kappa lambda mu',
  '1.5': 'nu xi omicron',
  '1.6': 'pi rho sigma',
  '1.7': 'tau upsilon phi',
  '1.8': 'chi psi omega',
  '1.9': 'arma virumque cano',
  '1.10': 'troiae qui primus',
  '1.11': 'ab oris italiam',
  '1.12': 'fato profugus lavinaque',
};
const ALL = Object.keys(LINES);
const without = (...labels: string[]) => ALL.filter((l) => !labels.includes(l));

const A = ALL;
const B = without('1.3', '1.7');
const C = without('1.3').flatMap((l) => (l === '1.5' ? ['1.6'] : l === '1.6' ? ['1.5'] : [l]));
const D = [...without('1.2', '1.3'), '1.2'];

let db: Database;
let pool: ReturnType<typeof createDatabase>['pool'];

async function build(userId: string) {
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: SCHEME_PRESETS[0]!.name,
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: userId,
  });
  const workId = newId();
  await db.insert(works).values({
    id: workId,
    slug: WORK,
    title: 'Lines in the reader',
    language: 'grc',
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), ALL);
  // Where a segment's line is marked as the first of a paragraph of some kind, a paragraph break stands before it.
  const stream = (labels: string[], paragraphs: Record<string, Lineation> = {}): Stream => {
    const items: Item[] = [];
    labels.forEach((label, k) => {
      const kind = paragraphs[label];
      if (kind) items.push({ kind: 'break', id: newId(), type: 'paragraph', lineation: kind });
      else if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
      const line = fromText(LINES[label]!);
      (line.items[0] as Token).segment = { segmentId: segments.get(label)!.id };
      items.push(...line.items);
    });
    return { items };
  };

  const names = ['Venetus A', 'Venetus B', 'Codex C', 'Codex D'];
  const sigla: { witnessId: string; transcriptionId: string; siglum: string }[] = [];
  const contents = [A, B, C, D];
  for (const [k, labels] of contents.entries()) {
    const siglum = 'ABCD'[k]!;
    const witnessId = newId();
    await db.insert(witnesses).values({
      id: witnessId,
      slug: SLUGS[k]!,
      siglum,
      name: names[k]!,
      createdBy: userId,
    });
    const transcriptionId = newId();
    await db.insert(transcriptions).values({
      id: transcriptionId,
      witnessId,
      name: 'Book 1',
      ownerId: userId,
      keepsWrittenForm: false,
      visibility: 'published',
    });
    await setChosenWorks(db, transcriptionId, [workId]);
    await replaceContent(db, 'transcription', transcriptionId, userId, 0, stream(labels), 'seed');
    sigla.push({ witnessId, transcriptionId, siglum });
  }

  const edition = async (slug: string, title: string, content: Stream) => {
    const editionId = newId();
    await db.insert(editions).values({
      id: editionId,
      workId,
      slug,
      title,
      editors: ['Editor'],
      ownerId: userId,
      conventions: DEFAULT_CONVENTIONS,
    });
    await replaceContent(db, 'edition', editionId, userId, 0, content, 'start');
    await db
      .insert(editionSigla)
      .values(sigla.map((x, position) => ({ editionId, ...x, position })));
  };
  await edition(EDITION, 'Lines, an edition', stream(without('1.3')));
  // Prose throughout; and verse to 1.5, then prose.
  await edition(PROSE, 'Prose, an edition', stream(without('1.3', '1.9'), { '1.1': 'prose' }));
  await edition(
    MIXED,
    'Verse and prose, an edition',
    stream(without('1.3', '1.9'), { '1.6': 'prose' }),
  );
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await db.delete(users).where(eq(users.email, email));
}

test.describe.configure({ mode: 'serial' });
// Screenshots are taken at twice the resolution, for the marks are thin.
test.use({ deviceScaleFactor: 2 });

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Lines Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));
  await page.close();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error('registration failed');
  await build(user.id);
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  await cleanUp();
  await pool.end();
});

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function openReader(page: Page, edition = EDITION) {
  await signIn(page);
  await page.goto(`/editions/${edition}?draft=1`);
  await page.waitForLoadState('networkidle');
  // The page is live once its marks are buttons.
  await expect(page.locator('.reader [data-sites][role="button"]').first()).toBeVisible();
}

const marks = (page: Page) => page.locator('.reader .mm');
const markNamed = (page: Page, name: string) =>
  page.locator('.reader .mm[role="button"]').and(page.getByLabel(name, { exact: true }));

/** The text of a window's rows as lines: the reading, then its sigla. */
async function rowsOf(window: Locator): Promise<string[]> {
  const rows = window.locator('.row');
  const out: string[] = [];
  for (let k = 0; k < (await rows.count()); k++) {
    out.push((await rows.nth(k).innerText()).replace(/\s+/g, ' ').trim());
  }
  return out;
}

test('marks a segment some witnesses do not have in the margin, and not its words', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page);

  // 1.7 is the seventh line of the edition's text (the edition has no 1.3): line 5, counting from 0.
  const line = page.locator('.reader [data-line="5"]');
  const mark = markNamed(page, rd.variant.segmentAt('1.7'));
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveClass(/wanting/);
  await expect(line.locator('.mm')).toHaveCount(1);
  // Its words are not dotted for it, and open nothing.
  await expect(line.locator('.w.variant')).toHaveCount(0);
  await expect(line.locator('[data-token][data-sites]')).toHaveCount(0);
  // The mark stands in the margin before the words, after the label's place.
  const box = (await mark.boundingBox())!;
  const words = (await line.locator('.words').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(words.x + 1);
  expect(words.x - (box.x + box.width)).toBeLessThan(16);

  // It is in the Tab order and opens its window.
  await expect(mark).toHaveAttribute('tabindex', '0');
  await mark.focus();
  await page.keyboard.press('Enter');
  const window = page.getByRole('dialog', { name: rd.entry.title('1.7') });
  await expect(window).toBeVisible();
  await expect(window.getByText(rd.variant.thereAll(4))).toBeVisible();
  const rows = window.locator('.row');
  await expect(rows.first()).toHaveClass(/edition/);
  await expect(rows.first()).toContainText('tau upsilon phi');
  await expect(rows.first().locator('.words')).toHaveCSS('font-weight', '700');
  await expect(rows.nth(1)).toContainText(rd.variant.notIn);
  await expect(rows.nth(1).getByRole('button', { name: 'Venetus B' })).toBeVisible();
  // The mark is lit while its window is open, and focus comes back to it.
  await expect(mark).toHaveAttribute('data-active', '');
  await page.keyboard.press('Escape');
  await expect(window).toBeHidden();
  await expect(mark).toBeFocused();

  // A click opens it as well.
  await mark.click();
  await expect(window).toBeVisible();
  await page.keyboard.press('Escape');
});

test('marks a segment the edition does not print between two lines, and says where it stands', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page);

  // The line 1.3 is after 1.2, the second line of the text.
  const mark = markNamed(page, rd.variant.pointAfter('1.2'));
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveClass(/unprinted/);
  await expect(page.locator('.reader [data-line="1"] .mm.unprinted')).toHaveCount(1);
  await expect(mark).toHaveAttribute('tabindex', '0');
  await mark.focus();
  await page.keyboard.press('Enter');
  const window = page.getByRole('dialog', { name: rd.entry.title('1.3') });
  await expect(window).toBeVisible();
  // The head: the line's label, and where it stands.
  await expect(window.getByRole('heading', { name: '1.3' })).toBeVisible();
  await expect(window).toContainText(`${rd.variant.after} 1.2`);
  await expect(window.getByText(rd.variant.thereAll(4))).toBeVisible();
  // The edition is not in it first, with the witnesses whose text runs on without the line; then the line's wording.
  expect(await rowsOf(window)).toEqual([
    `${rd.variant.edition}: ${rd.variant.notIn} B C D`,
    'eta theta iota A',
  ]);
  await expect(window.locator('.row').first().locator('.lead')).toHaveCSS('font-weight', '700');
  await expect(window.locator('.addition')).toContainText(`${rd.variant.addition} A`);
  // A siglum opens its witness, as everywhere.
  await window.locator('.row').nth(1).getByRole('button', { name: 'Venetus A' }).click();
  await expect(window).toBeHidden();
  await expect(page.locator('.conspectus-row.selected')).toContainText('Venetus A');
  await page.getByRole('button', { name: rd.panels.close(rd.toolbar.witnesses) }).click();
});

test('marks segments in another order along them, and a block far from its place along the block', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page);

  // C has 1.5 and 1.6 the other way round: lines 3 and 4 of the text (no 1.3 and no 1.7 matter to the count: 1.1 1.2 1.4 1.5 1.6).
  const stretch = markNamed(page, rd.variant.segmentAt('1.5–1.6'));
  await expect(stretch).toHaveCount(1);
  // One mark over two lines: a part on each, with one button.
  const key = await stretch.getAttribute('data-sites');
  await expect(page.locator(`.reader .mm.order[data-sites="${key}"]`)).toHaveCount(2);
  await expect(page.locator(`.reader .mm.order[data-sites="${key}"][role="button"]`)).toHaveCount(
    1,
  );
  await expect(page.locator('.reader [data-line="3"] .mm.order.start')).toHaveCount(1);
  await expect(page.locator('.reader [data-line="4"] .mm.order.end')).toHaveCount(1);
  await stretch.focus();
  await page.keyboard.press('Enter');
  const window = page.getByRole('dialog', { name: rd.entry.title('1.5') });
  await expect(window).toBeVisible();
  // The labels of the stretch, the witnesses in its readings, and the labels in each order, the edition's first.
  await expect(window).toContainText('1.5–1.6');
  await expect(window.getByText(rd.variant.thereAll(4))).toBeVisible();
  expect(await rowsOf(window)).toEqual([`${rd.variant.edition}: 1.5 1.6 A B D`, '1.6 1.5 C']);
  await expect(window.locator('.row').first().locator('.words')).toHaveCSS('font-weight', '700');
  await expect(window).not.toContainText(/transpos/i);
  await page.keyboard.press('Escape');
  await expect(stretch).toBeFocused();

  // D has 1.2 after 1.12, far from its place: the mark is along 1.2, and the rows say which line it follows.
  const block = markNamed(page, rd.variant.segmentAt('1.2'));
  await expect(block).toHaveCount(1);
  await expect(block).toHaveClass(/order/);
  await block.focus();
  await page.keyboard.press('Enter');
  const far = page.getByRole('dialog', { name: rd.entry.title('1.2') });
  await expect(far).toBeVisible();
  expect(await rowsOf(far)).toEqual([
    `${rd.variant.edition}: ${rd.variant.after} 1.1 A B C`,
    `${rd.variant.after} 1.12 D`,
  ]);
  await page.keyboard.press('Escape');
});

test('draws the marks as the setting for marked words says, and hides them in print', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page);
  const mark = markNamed(page, rd.variant.segmentAt('1.7'));
  await expect(mark).toHaveClass(/drawn/);
  const color = await mark.evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgba(0, 0, 0, 0)');

  // Printed, the page has no marks.
  await page.emulateMedia({ media: 'print' });
  await expect(mark).toBeHidden();
  await expect(page.locator('.reader .mm.order').first()).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(mark).toBeVisible();

  // With the setting off the marks are still there to find, and show when pointed at.
  await page.getByRole('button', { name: rd.toolbar.settings }).click();
  await page.getByLabel(rd.settings.underline).uncheck();
  await page.keyboard.press('Escape');
  await expect(mark).not.toHaveClass(/drawn/);
  await expect(mark.locator('.stroke')).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)');
  await mark.hover();
  await expect(mark.locator('.stroke')).not.toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: rd.toolbar.settings }).click();
  await page.getByLabel(rd.settings.underline).check();
  await page.keyboard.press('Escape');
  await expect(mark).toHaveClass(/drawn/);
});

test('stands the marks side by side where they would meet', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page);
  // The caret after 1.2 and the block 1.2 meet at the second line: two lanes.
  const caret = markNamed(page, rd.variant.pointAfter('1.2'));
  const block = markNamed(page, rd.variant.segmentAt('1.2'));
  const [a, b] = await Promise.all([caret.boundingBox(), block.boundingBox()]);
  expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(4);
  expect(a!.width).toBeGreaterThan(0);
});

test('lists them in the variants panel at their place among the others', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openReader(page);
  await page.getByRole('button', { name: rd.toolbar.variants, exact: true }).click();
  const panel = page.getByRole('region', { name: rd.panels.variants });
  const cards = panel.locator('.card');
  await expect(cards.first()).toBeVisible();
  const labels = await cards.locator('.card-label').allInnerTexts();
  // Lines with variants have a card: the block 1.2, the line 1.3 the edition does not print after it, the order of 1.5 and 1.6 with 1.5, and 1.7.
  expect(labels).toEqual(['1.2', '1.3', '1.5', '1.7']);
  const unprinted = cards.filter({ has: page.getByRole('heading', { name: '1.3', exact: true }) });
  await expect(unprinted).toContainText(`${rd.variant.after} 1.2`);
  await expect(unprinted).toContainText('eta theta iota');
  const order = cards.filter({ has: page.getByRole('heading', { name: '1.5', exact: true }) });
  await expect(order).toContainText('1.5–1.6');
  await expect(order).toContainText('1.6 1.5');

  // Pointing at a place lights its mark; choosing it opens its window beside the text.
  const place = unprinted.locator('.place').first();
  await place.hover();
  await expect(markNamed(page, rd.variant.pointAfter('1.2'))).toHaveAttribute('data-lit', '');
  await place.locator('.place-words').click();
  await expect(page.getByRole('dialog', { name: rd.entry.title('1.3') })).toBeVisible();
  await page.keyboard.press('Escape');
  await order.locator('.place').first().locator('.place-words').click();
  await expect(page.getByRole('dialog', { name: rd.entry.title('1.5') })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/panel.png` });
});

test('shows the marks at phone width and in dark mode, within the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openReader(page);
  const scroll = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll.width).toBeLessThanOrEqual(scroll.inner);
  for (const mark of await marks(page).all()) {
    const box = (await mark.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(scroll.inner);
  }
  await page.locator('.reader [data-line="3"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/phone.png` });
  // A click on a mark opens its window, which fits the screen.
  await markNamed(page, rd.variant.segmentAt('1.7')).click();
  const window = page.getByRole('dialog', { name: rd.entry.title('1.7') });
  await expect(window).toBeVisible();
  const box = (await window.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(scroll.inner);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/phone-window.png` });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1300, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(markNamed(page, rd.variant.segmentAt('1.7'))).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/dark.png` });
});

test('shows the text with the three marks, and each window', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openReader(page);
  await page.locator('.reader .text-root').scrollIntoViewIfNeeded();
  const text = page.locator('.reader .text-root');
  const frame = (await text.boundingBox())!;
  await page.screenshot({
    path: `${SHOTS}/text.png`,
    clip: {
      x: Math.max(0, frame.x - 40),
      y: Math.max(0, frame.y - 10),
      width: Math.min(frame.width + 80, 1100),
      height: Math.min(frame.height + 20, 760),
    },
  });
  await markNamed(page, rd.variant.pointAfter('1.2')).click();
  const unprinted = page.getByRole('dialog', { name: rd.entry.title('1.3') });
  await expect(unprinted).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/window-unprinted.png` });
  await page.keyboard.press('Escape');
  await markNamed(page, rd.variant.segmentAt('1.5–1.6')).click();
  const order = page.getByRole('dialog', { name: rd.entry.title('1.5') });
  await expect(order).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/window-order.png` });
  await page.keyboard.press('Escape');
  await markNamed(page, rd.variant.segmentAt('1.2')).click();
  await expect(page.getByRole('dialog', { name: rd.entry.title('1.2') })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/window-block.png` });
  await page.keyboard.press('Escape');
  await markNamed(page, rd.variant.segmentAt('1.7')).click();
  await expect(page.getByRole('dialog', { name: rd.entry.title('1.7') })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/window-wanting.png` });
});

test('marks variants over whole segments in a prose paragraph in the text, and in no margin', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page, PROSE);
  const prose = page.locator('.reader .line.prose');
  // The whole text is one paragraph, one line on the screen, and nothing is marked in a margin.
  await expect(page.locator('.reader .line')).toHaveCount(1);
  await expect(prose).toHaveCount(1);
  await expect(marks(page)).toHaveCount(0);

  // A segment B does not have: its words are dotted and open its window, the first the stop.
  const words = prose.locator('.w.variant');
  await expect(words).toHaveText(['tau', 'upsilon', 'phi']);
  await expect(words.first()).toHaveCSS('text-decoration-style', 'dotted');
  await expect(words.first()).toHaveAttribute('tabindex', '0');
  await expect(words.nth(1)).toHaveAttribute('tabindex', '-1');
  await words.first().focus();
  await page.keyboard.press('Enter');
  const wanting = page.getByRole('dialog', { name: rd.entry.title('1.7') });
  await expect(wanting).toBeVisible();
  await expect(wanting.getByText(rd.variant.thereAll(4))).toBeVisible();
  await expect(wanting.locator('.row').nth(1)).toContainText(rd.variant.notIn);
  await expect(
    wanting.locator('.row').nth(1).getByRole('button', { name: 'Venetus B' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(wanting).toBeHidden();
  await expect(words.first()).toBeFocused();

  // Segments the edition does not print: a point after the word before each, as for any variant at a point.
  await expect(prose.locator('.point')).toHaveCount(2);
  const afterEight = prose.getByRole('button', {
    name: rd.variant.pointAfter('omega'),
    exact: true,
  });
  await expect(afterEight).toHaveCount(1);
  expect(await afterEight.evaluate((el) => el.previousElementSibling?.textContent)).toBe('omega');
  await afterEight.focus();
  await page.keyboard.press('Enter');
  const unprinted = page.getByRole('dialog', { name: rd.entry.title('1.9') });
  await expect(unprinted).toBeVisible();
  await expect(unprinted).toContainText(`${rd.variant.after} 1.8`);
  await expect(unprinted).toContainText('arma virumque cano');
  await page.keyboard.press('Escape');
  await expect(afterEight).toBeFocused();
  // The one for 1.3 follows the last word of 1.2.
  const afterTwo = prose.getByRole('button', { name: rd.variant.pointAfter('zeta'), exact: true });
  await expect(afterTwo).toHaveCount(1);
  await afterTwo.click();
  const third = page.getByRole('dialog', { name: rd.entry.title('1.3') });
  await expect(third).toBeVisible();
  await expect(third).toContainText(`${rd.variant.after} 1.2`);
  await page.keyboard.press('Escape');

  // Segments in another order: their labels, in the text, one stop for the stretch.
  const five = prose.getByRole('button', { name: rd.variant.segmentAt('1.5'), exact: true });
  const six = prose.getByRole('button', { name: rd.variant.segmentAt('1.6'), exact: true });
  await expect(five).toHaveClass(/label-mark/);
  await expect(five).toHaveCSS('text-decoration-style', 'dotted');
  await expect(five).toHaveAttribute('tabindex', '0');
  await expect(six).toHaveAttribute('tabindex', '-1');
  expect(await six.getAttribute('data-sites')).toBe(await five.getAttribute('data-sites'));
  await six.click();
  const order = page.getByRole('dialog', { name: rd.entry.title('1.5') });
  await expect(order).toBeVisible();
  await expect(order).toContainText('1.5–1.6');
  expect(await rowsOf(order)).toEqual([`${rd.variant.edition}: 1.5 1.6 A B D`, '1.6 1.5 C']);
  await page.keyboard.press('Escape');
  // The block D has far from its place: the label of the segment.
  await prose.getByRole('button', { name: rd.variant.segmentAt('1.2'), exact: true }).click();
  const far = page.getByRole('dialog', { name: rd.entry.title('1.2') });
  await expect(far).toBeVisible();
  expect(await rowsOf(far)).toEqual([
    `${rd.variant.edition}: ${rd.variant.after} 1.1 A B C`,
    `${rd.variant.after} 1.12 D`,
  ]);
  await page.keyboard.press('Escape');
  // The label of the first segment, in the margin, is its link still.
  await expect(prose.locator('.label a')).toHaveText('1.1');

  // Printed, the page has none of them.
  await page.emulateMedia({ media: 'print' });
  await expect(words.first()).toHaveCSS('text-decoration-line', 'none');
  await expect(afterEight).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.locator('.reader .text-root').screenshot({ path: `${SHOTS}/prose.png` });
});

test('marks the same variants in the margin beside verse and in the text in prose, a stretch over both in each', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await openReader(page, MIXED);
  // Verse: 1.1, 1.2, 1.4, 1.5 on lines of their own; prose: 1.6 on, one line on the screen.
  await expect(page.locator('.reader .line.verse')).toHaveCount(4);
  const prose = page.locator('.reader .line.prose');
  await expect(prose).toHaveCount(1);

  // In the margin, beside the lines of verse: 1.3 between 1.2 and 1.4, 1.5 in another order, and 1.2 far from its place.
  await expect(marks(page)).toHaveCount(3);
  await expect(page.locator('.reader .mm.unprinted')).toHaveCount(1);
  await expect(page.locator('.reader [data-line="1"] .mm.unprinted')).toHaveCount(1);
  await expect(page.locator('.reader .mm.order')).toHaveCount(2);
  await expect(page.locator('.reader [data-line="3"] .mm.order')).toHaveCount(1);
  await expect(page.locator('.reader [data-line="1"] .mm.order')).toHaveCount(1);
  await expect(page.locator('.reader .mm.wanting')).toHaveCount(0);
  // None in the prose, whose lines are not shown.
  await expect(prose.locator('.mm')).toHaveCount(0);

  // In the text, in prose: 1.7 on its words, 1.9 at the point after 1.8, and 1.6 on its label, in the margin.
  await expect(prose.locator('.w.variant')).toHaveText(['tau', 'upsilon', 'phi']);
  await expect(prose.locator('.point')).toHaveCount(1);
  await expect(
    prose.getByRole('button', { name: rd.variant.pointAfter('omega'), exact: true }),
  ).toHaveCount(1);
  const label = prose.locator('.label .label-mark');
  await expect(label).toHaveText('1.6');
  await expect(label).toHaveAttribute('role', 'button');

  // The stretch 1.5 to 1.6 is one variant, marked along 1.5 in the margin and on the label of 1.6 in the text.
  const stretch = markNamed(page, rd.variant.segmentAt('1.5–1.6'));
  await expect(stretch).toHaveCount(1);
  expect(await label.getAttribute('data-sites')).toBe(await stretch.getAttribute('data-sites'));
  await label.click();
  const window = page.getByRole('dialog', { name: rd.entry.title('1.5') });
  await expect(window).toBeVisible();
  expect(await rowsOf(window)).toEqual([`${rd.variant.edition}: 1.5 1.6 A B D`, '1.6 1.5 C']);
  await page.keyboard.press('Escape');
  await stretch.click();
  await expect(window).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.reader .text-root').screenshot({ path: `${SHOTS}/mixed.png` });
});
