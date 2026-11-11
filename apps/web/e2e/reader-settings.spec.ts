/**
 * The print apparatus is not offered: Edition Settings has no section for it
 * and leaves what an edition has stored; the reading settings have no choice
 * of it and offer interpretative variants as Shown or Not shown, like the
 * minor ones; a reader who remembers the old choices gets the page without an
 * apparatus and without an error; the page prints, and loads without scripts,
 * with its text, labels and preface and no apparatus; the edition's menu and
 * the foot of the reader link no plain text with apparatus.
 *
 * The edition is made here, of two lines in two witnesses: B has ὅ τι where
 * the edition has ὅτι (the same letters, divided otherwise: an interpretative
 * variant) and ἄεισε where it has ἄειδε (a textual one). The edition stores
 * the print conventions "negative", "interpretative variants not printed",
 * and the words cett. and codd., which no setting of the page governs.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  SCHEME_PRESETS,
  defaultProfile,
  fromText,
  newId,
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
import { edition as ed } from '../src/lib/strings/edition';
import { s } from '../src/lib/strings/en';
import { reader as rd } from '../src/lib/strings/reader';
import { recordActions } from '../src/lib/strings/record-actions';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';
import { setChosenWorks } from '../src/lib/server/transcription-works.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `rsettings-${stamp}@example.org`;
const password = 'a long enough password';
const WORK = `rsettings-work-${stamp}`;
const EDITION = `rsettings-edition-${stamp}`;
const SLUGS = ['a', 'b'].map((x) => `rsettings-${x}-${stamp}`);
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/reader-settings';
const PREFACE = 'The preface, which is printed with the text.';

const LINES: Record<string, { edition: string; b: string }> = {
  '1.1': { edition: 'ὅτι μῆνιν θεά', b: 'ὅ τι μῆνιν θεά' },
  '1.2': { edition: 'ἄειδε Πηληϊάδεω', b: 'ἄεισε Πηληϊάδεω' },
};
const STORED = { apparatus: 'negative', interpretative: 'none', rest: 'cett.', all: 'codd.' };

let db: Database;
let pool: ReturnType<typeof createDatabase>['pool'];
let editionId = '';

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
    title: 'Settings in the reader',
    language: 'grc',
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: userId,
  });
  const labels = Object.keys(LINES);
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), labels);
  const stream = (which: 'edition' | 'b'): Stream => {
    const items: Stream['items'] = [];
    labels.forEach((label, k) => {
      if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
      const line = fromText(LINES[label]![which]);
      (line.items[0] as Token).segment = { segmentId: segments.get(label)!.id };
      items.push(...line.items);
    });
    return { items };
  };
  const sigla: { witnessId: string; transcriptionId: string; siglum: string }[] = [];
  for (const [k, which] of (['edition', 'b'] as const).entries()) {
    const siglum = 'AB'[k]!;
    const witnessId = newId();
    await db.insert(witnesses).values({
      id: witnessId,
      slug: SLUGS[k]!,
      siglum,
      name: `Codex ${siglum}`,
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
    await replaceContent(db, 'transcription', transcriptionId, userId, 0, stream(which), 'seed');
    sigla.push({ witnessId, transcriptionId, siglum });
  }
  editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: EDITION,
    title: 'Settings, an edition',
    editors: ['Editor'],
    preface: PREFACE,
    ownerId: userId,
    conventions: { ...DEFAULT_CONVENTIONS, ...STORED } as never,
  });
  await replaceContent(db, 'edition', editionId, userId, 0, stream('edition'), 'start');
  await db.insert(editionSigla).values(sigla.map((x, position) => ({ editionId, ...x, position })));
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await db.delete(users).where(eq(users.email, email));
}

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1300, height: 900 } });

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Settings Tester');
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

/** What goes wrong in the page: uncaught errors and errors the console logs. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  return problems;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** The owner's draft in the reader, once the page is live. */
async function openReader(page: Page) {
  await signIn(page);
  await page.goto(`/editions/${EDITION}?draft=1`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.reader [data-sites][role="button"]').first()).toBeVisible();
}

/** The words of the text that are marked as having a variant. */
const marked = (page: Page) => page.locator('.reader .w.variant');
const storedSettings = (page: Page) => page.evaluate(() => localStorage.getItem('varians.reader'));

test('Edition Settings has no print apparatus, and saving leaves what the edition has stored', async ({
  page,
}) => {
  const problems = watch(page);
  await signIn(page);
  await page.goto(`/editions/${EDITION}/settings`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: ed.conventions })).toBeVisible();
  await expect(page.getByLabel(ed.numberEvery)).toBeVisible();
  // Nothing of the print apparatus is a field or a heading of the page.
  await expect(page.getByRole('heading', { name: /apparatus/i })).toHaveCount(0);
  for (const name of ['apparatus', 'interpretative', 'rest', 'all'])
    await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
  await expect(page.getByText(/positive|negative|cett\.|codd\.|as in print/i)).toHaveCount(0);

  // The foot of the page, with Save for the whole of it.
  await page.getByLabel(ed.numberEvery).fill('10');
  await page.screenshot({ path: `${SHOTS}/settings-foot.png` });
  await page.getByRole('button', { name: ed.save, exact: true }).click();
  await expect(page.getByText(ed.saved)).toBeVisible();
  const [row] = await db.select().from(editions).where(eq(editions.id, editionId));
  expect(row!.conventions).toMatchObject({ ...STORED, numberEvery: 10 });
  expect(problems).toEqual([]);
  // Put back what the other tests read.
  await db
    .update(editions)
    .set({ conventions: { ...row!.conventions, numberEvery: 5 } })
    .where(eq(editions.id, editionId));
});

test('the reading settings offer interpretative variants as Shown or Not shown, and no print apparatus', async ({
  page,
}) => {
  const problems = watch(page);
  await openReader(page);
  // The edition stores that interpretative variants are not printed; that does not govern the screen.
  await expect(marked(page)).toHaveCount(2);
  const division = page.locator('.reader .w.variant', { hasText: 'ὅτι' });
  await expect(division).toHaveCount(1);

  await page.getByRole('button', { name: rd.toolbar.settings }).click();
  const interpretative = page.getByRole('group', { name: rd.settings.interpretative });
  await expect(interpretative.getByLabel(rd.settings.interpretativeShown)).toBeChecked();
  await expect(page.getByRole('group', { name: rd.settings.minor })).toBeVisible();
  await expect(page.getByRole('group', { name: rd.settings.labels })).toBeVisible();
  // Nothing of the print apparatus: no choice of it, of its form, no word of print.
  await expect(page.getByRole('group', { name: /apparatus|form/i })).toHaveCount(0);
  await expect(
    page.getByText(/as in print|positive|negative|below the text|beside the text/i),
  ).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/settings.png` });

  // Not shown: the interpretative variant is neither marked nor listed; the textual one is.
  await interpretative.getByText(rd.settings.interpretativeHidden, { exact: true }).click();
  await expect(interpretative.getByLabel(rd.settings.interpretativeHidden)).toBeChecked();
  await expect(division).toHaveCount(0);
  await expect(marked(page)).toHaveCount(1);
  await expect(marked(page)).toHaveText('ἄειδε');
  expect(await storedSettings(page)).toBe('{"showInterpretative":false}');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: rd.toolbar.variants, exact: true }).click();
  const panel = page.getByRole('region', { name: rd.panels.variants });
  await expect(panel.locator('.card .card-label')).toHaveText(['1.2']);
  await page.getByRole('button', { name: rd.toolbar.variants, exact: true }).click();

  // The choice is kept for the next visit.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(marked(page)).toHaveCount(1);
  // Shown again: the default, which stores nothing.
  await page.getByRole('button', { name: rd.toolbar.settings }).click();
  await page
    .getByRole('group', { name: rd.settings.interpretative })
    .getByText(rd.settings.interpretativeShown, { exact: true })
    .click();
  await expect(marked(page)).toHaveCount(2);
  expect(await storedSettings(page)).toBeNull();
  expect(problems).toEqual([]);
});

test('a reader who remembers the old choices gets the page without an apparatus and without an error', async ({
  page,
}) => {
  const problems = watch(page);
  await signIn(page);
  await page.evaluate(() =>
    localStorage.setItem(
      'varians.reader',
      JSON.stringify({
        size: 'large',
        apparatus: 'foot',
        form: 'negative',
        interpretative: 'none',
        underline: false,
      }),
    ),
  );
  await page.goto(`/editions/${EDITION}?draft=1`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.reader [data-sites][role="button"]').first()).toBeVisible();
  // No block of an apparatus anywhere on the page.
  await expect(page.locator('.reader .apparatus, .reader .entry')).toHaveCount(0);
  await expect(page.getByText(rd.text.apparatus('1.1–1.2'))).toHaveCount(0);
  // What still means something is kept: the size and the underline, and interpretative variants out of sight.
  await expect(page.locator('.reader')).toHaveCSS('--reader-size', '1.375rem');
  await expect(marked(page)).toHaveCount(0);
  await expect(page.locator('.reader [data-sites]:not(.variant)').first()).toBeVisible();
  await page.getByRole('button', { name: rd.toolbar.settings }).click();
  await expect(
    page
      .getByRole('group', { name: rd.settings.interpretative })
      .getByLabel(rd.settings.interpretativeHidden),
  ).toBeChecked();
  // What is stored is rewritten without what is gone.
  expect(JSON.parse((await storedSettings(page)) ?? '{}')).toEqual({
    size: 'large',
    underline: false,
    showInterpretative: false,
  });
  expect(problems).toEqual([]);
});

test('prints the text with its labels and preface, and no apparatus', async ({ page }) => {
  const problems = watch(page);
  await openReader(page);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.reader .title-block h1')).toBeVisible();
  await expect(page.locator('.reader .preface-text', { hasText: PREFACE })).toBeVisible();
  await expect(page.locator('.reader .line .label').first()).toBeVisible();
  await expect(page.locator('.reader .line', { hasText: 'ὅτι μῆνιν θεά' })).toBeVisible();
  // No block of an apparatus, no panel, no bar.
  await expect(page.locator('.reader .apparatus, .reader .entry')).toHaveCount(0);
  await expect(page.getByText(rd.text.apparatus('1.1–1.2'))).toHaveCount(0);
  await expect(page.locator('.reader-bar')).toBeHidden();
  await expect(page.getByText('cett.')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/print.png`, fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  expect(problems).toEqual([]);
});

test('loads without scripts with the text and no apparatus', async ({ browser }) => {
  // The draft is the owner's: the session cookie of a signed-in page goes with the page without scripts.
  const owner = await browser.newContext();
  await signIn(await owner.newPage());
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.addCookies(await owner.cookies());
  const page = await context.newPage();
  await page.goto(`/editions/${EDITION}?draft=1`);
  await expect(page.locator('.reader .line', { hasText: 'ὅτι μῆνιν θεά' })).toBeVisible();
  await expect(page.locator('.reader .apparatus, .reader .entry')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/no-scripts.png`, fullPage: true });
  await context.close();
  await owner.close();
});

test('the edition menu and the foot of the reader offer no plain text with an apparatus', async ({
  page,
}) => {
  const problems = watch(page);
  await openReader(page);
  await page.getByRole('button', { name: recordActions.menu, exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: recordActions.edition.tei })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: recordActions.edition.package })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /plain text|apparatus/i })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/menu.png` });
  await page.keyboard.press('Escape');
  // The foot links the TEI and the package, and no plain text.
  const foot = page.locator('.colophon');
  await expect(foot.getByRole('link', { name: recordActions.edition.tei })).toBeVisible();
  await expect(foot.locator('a[href*=".txt"]')).toHaveCount(0);
  await expect(page.locator('a[href*=".txt"]')).toHaveCount(0);
  await foot.scrollIntoViewIfNeeded();
  await foot.screenshot({ path: `${SHOTS}/foot.png` });
  // The route is kept, linked from nowhere.
  const text = await page.request.get(`/editions/${EDITION}.txt?draft=1`);
  expect(text.ok()).toBe(true);
  expect(problems).toEqual([]);
});
