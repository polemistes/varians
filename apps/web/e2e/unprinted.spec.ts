/**
 * A line that witnesses have and the edition does not print, in the edition
 * editor: its mark between the lines it stands between, stepping to it, its
 * entry in the band, adopting it (which prints it), Undo, and the round trip
 * of taking a printed line out and printing it again from its witness. The
 * sample Iliad is seeded for a user registered here: A has 1.6, B and C run
 * on without it.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDatabase, editions, referenceSchemes, users, witnesses, works } from '@varians/db';
import { segmentAt, type Stream } from '@varians/core';
import { eq, inArray } from 'drizzle-orm';
import { editor as ed } from '../src/lib/strings/editor';
import { reader as rd } from '../src/lib/strings/reader';
import { seedSample } from '../src/lib/server/seed/sample.ts';
import { s } from '../src/lib/strings/en';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const email = `unprinted-${Date.now()}@example.org`;
const password = 'a long enough password';
const SHOTS = process.env.SHOTS_DIR;
const LINE_5 = 'οἰωνοῖσί τε πᾶσι, Διὸς δ᾽ ἐτελείετο βουλή,';
const LINE_6 = 'ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε';
const LINE_7 = 'Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς.';

async function cleanSample() {
  const { db, pool } = createDatabase(DATABASE_URL);
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await pool.end();
}

/** The sources of the edition's words in a segment, as stored. */
async function sourcesOf(label: string): Promise<unknown[]> {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [edition] = await db
    .select({ content: editions.content, workId: editions.workId })
    .from(editions)
    .where(eq(editions.slug, 'iliad-1-working-edition'));
  const segment = await db.query.segments.findFirst({
    where: (t, { and, eq }) => and(eq(t.workId, edition!.workId), eq(t.label, label)),
  });
  await pool.end();
  const content = edition!.content as Stream;
  return content.items.flatMap((item, i) =>
    item.kind === 'token' && segmentAt(content, i)?.segmentId === segment!.id ? [item.source] : [],
  );
}

async function lines(page: Page): Promise<string[]> {
  return (await page.locator('.cm-content .cm-line').allInnerTexts()).map((t) => t.trim());
}

async function saved(page: Page) {
  await expect(page.locator('[aria-live=polite]').first()).toHaveText('Saved', { timeout: 15_000 });
  await expect(page.locator('.apparatus-band [aria-busy=true]')).toHaveCount(0, {
    timeout: 15_000,
  });
}

/** The band's section of a segment. */
function section(page: Page, label: string): Locator {
  return page
    .locator('.apparatus-band section')
    .filter({ has: page.locator('h3', { hasText: new RegExp(`^${label.replace('.', '\\.')}$`) }) });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  await cleanSample();
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Unprinted Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));
  await page.close();
  const { db, pool } = createDatabase(DATABASE_URL);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error('registration failed');
  await seedSample(db, user.id);
  await pool.end();
});

test.afterAll(async () => {
  await cleanSample();
  const { db, pool } = createDatabase(DATABASE_URL);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await pool.end();
});

test('a line the edition does not print is marked, stepped to, adopted, taken back and printed again', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/editions/iliad-1-working-edition/edit');
  await expect(page.locator('.cm-content')).toBeVisible();
  const printedFrom = await sourcesOf('1.6');
  expect(printedFrom.length).toBeGreaterThan(0);
  const lineCount = (await lines(page)).length;
  const marks = page.locator('.cm-margin-mark');
  await expect(page.locator('.apparatus-band')).toBeVisible();
  await expect(marks).toHaveCount(0);

  // B and C run on without 1.6: adopting their reading takes the line out of the text.
  await section(page, '1.6')
    .locator('button[title="Adopt"]', { hasText: rd.variant.notIn })
    .click();
  await saved(page);
  expect(await lines(page)).not.toContain(LINE_6);
  // Taking a line out takes its line break with it: no empty line is left.
  expect(await lines(page)).toHaveLength(lineCount - 1);

  // The line is now one the edition does not print: a mark at the foot of 1.5, which opens its variant.
  await expect(marks).toHaveCount(1, { timeout: 15_000 });
  const mark = page.getByTitle(ed.notPrinted('1.6'), { exact: true });
  await expect(mark).toBeVisible();
  const five = page.locator('.cm-content .cm-line', { hasText: LINE_5 });
  const markBox = (await mark.boundingBox())!;
  const fiveBox = (await five.boundingBox())!;
  expect(Math.abs(markBox.y + markBox.height / 2 - (fiveBox.y + fiveBox.height))).toBeLessThan(
    markBox.height,
  );
  await mark.click();
  await expect(mark).toHaveClass(/cm-margin-mark-active/);
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/editor-mark-close.png`,
      clip: { x: 0, y: fiveBox.y - 70, width: 640, height: 170 },
    });

  // The band has it after the section of 1.5, as the reader's window lists it: the head says where it stands,
  // then who is there and who has the words as an addition, then the edition's row (nothing, in B and C) and A's.
  const entry = page.locator('.apparatus-band section[data-unprinted]');
  await expect(entry).toHaveCount(1);
  const order = await page
    .locator('.apparatus-band section')
    .evaluateAll((all) => all.map((el) => el.querySelector('h3')?.textContent?.trim()));
  expect(order[order.indexOf('1.5') + 1]).toBe('1.6');
  await expect(entry.locator('.entry')).toHaveClass(/bg-accent-soft/);
  await expect(entry.locator('.entry').getByRole('button').first()).toHaveText(
    `${rd.variant.after} 1.5`,
  );
  await expect(entry.getByText(rd.variant.thereAll(3))).toBeVisible();
  await expect(entry.locator('.addition')).toContainText(`${rd.variant.addition} A`);
  const rows = entry.locator('.row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveClass(/edition/);
  await expect(rows.first()).toContainText(
    new RegExp(`^\\s*${rd.variant.edition}: ${rd.variant.notIn}\\s*B\\s*C`),
  );
  await expect(rows.first().locator('button[title="Adopt"]')).toHaveCount(0);
  await expect(entry.locator('.entry')).not.toContainText(/omitted|added/);
  const adoptLine = entry.locator('button[title="Adopt"]', { hasText: LINE_6 });
  await expect(rows.nth(1)).toContainText('A');
  await expect(rows.nth(1).locator('button[title="Adopt"]')).toHaveText(LINE_6);
  // The controls every variant has.
  await expect(entry.getByRole('button', { name: ed.minor, exact: true })).toBeVisible();
  await expect(entry.getByRole('button', { name: ed.register })).toBeVisible();
  // Adopting the absence marked it reviewed; the editor asks to review it again.
  await entry.getByRole('button', { name: ed.kept }).click();
  await expect(entry.getByRole('button', { name: ed.keep })).toBeVisible();

  // Stepping reaches it in its place: Next variant from the first line, and Next to review.
  const steps = [
    page.getByTitle(ed.workspace.nextSite, { exact: true }),
    page.getByRole('button', { name: ed.workspace.nextUnreviewed }),
  ];
  for (const button of steps) {
    await page.locator('.cm-content .cm-line').first().click();
    await expect(mark).not.toHaveClass(/cm-margin-mark-active/);
    let reached = false;
    for (let k = 0; k < 30 && !reached; k++) {
      await button.click();
      reached = (await mark.getAttribute('class'))?.includes('cm-margin-mark-active') ?? false;
    }
    expect(reached, 'the step reaches the line').toBe(true);
    await expect(entry.locator('.entry')).toHaveClass(/bg-accent-soft/);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-unprinted-active.png` });

  // Adopting A's words prints the line after 1.5, on a line of its own.
  await adoptLine.click();
  await saved(page);
  let text = await lines(page);
  expect(text.slice(text.indexOf(LINE_5), text.indexOf(LINE_5) + 3)).toEqual([
    LINE_5,
    LINE_6,
    LINE_7,
  ]);
  expect(await lines(page)).toHaveLength(lineCount);
  await expect(marks).toHaveCount(0);
  await expect(page.locator('.apparatus-band section[data-unprinted]')).toHaveCount(0);
  await expect(page.locator('.cm-segment-gutter')).toContainText(/1\.5\s*1\.6\s*1\.7/);
  expect(await sourcesOf('1.6')).toEqual(printedFrom);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-after-adopting.png` });

  // Undo takes it back: the line is not printed again, and its mark is back.
  await page.getByRole('button', { name: ed.workspace.undoAdoption('1.6') }).click();
  await saved(page);
  expect(await lines(page)).not.toContain(LINE_6);
  expect(await lines(page)).toHaveLength(lineCount - 1);
  await expect(marks).toHaveCount(1, { timeout: 15_000 });
  // What the editor had said of it is said again: here, that it is to review.
  await expect(
    page.locator('.apparatus-band section[data-unprinted]').getByRole('button', { name: ed.keep }),
  ).toBeVisible();

  // Adopted again, it stays printed, its words from A as before it was taken out.
  await page
    .locator('.apparatus-band section[data-unprinted]')
    .locator('button[title="Adopt"]', { hasText: LINE_6 })
    .click();
  await saved(page);
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  text = await lines(page);
  expect(text.slice(text.indexOf(LINE_5), text.indexOf(LINE_5) + 3)).toEqual([
    LINE_5,
    LINE_6,
    LINE_7,
  ]);
  expect(text).toHaveLength(lineCount);
  await expect(marks).toHaveCount(0);
  expect(await sourcesOf('1.6')).toEqual(printedFrom);
});
