/**
 * A transcript and an edition have a draft and versions. Publish… asks in a
 * window of its own, which gives the number the version will have and the
 * changes since the version before, and takes a note; the reader's Versions
 * menu then lists the version with its note, and What Changed shows its
 * changes. Withdraw Version… asks which version and for the note readers
 * see, and the withdrawn version's address gives its citation and that note
 * and no text. A transcript is published and withdrawn from its own menu,
 * and a reader of it sees its latest version in the workbench with the same
 * Versions menu. A record that has a version is not deleted, and the window
 * says why. Every list badges a record Version n or Draft.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { SCHEME_PRESETS, fromText, newId, type Item, type Stream, type Token } from '@varians/core';
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
import { eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { recordActions as ra } from '../src/lib/strings/record-actions';
import { versions as vs } from '../src/lib/strings/versions';
import { workbench as w } from '../src/lib/strings/workbench';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { publishEdition } from '../src/lib/server/publish.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const password = 'a long enough password';
const OWNER = { name: 'Owner of Versions', email: `versions-owner-${stamp}@example.org` };
const WORK = { slug: `versions-work-${stamp}`, title: `Aeneis ${stamp}` };
const WITNESS = { slug: `versions-witness-${stamp}`, name: `Codex V ${stamp}` };
const BOOK = `Book 1 ${stamp}`;
const LOOSE = `Loose leaves ${stamp}`;
/** Published through the window in the first test. */
const FIRST = { slug: `versions-first-${stamp}`, title: `Liber primus ${stamp}` };
/** Published twice before the tests; version 1 is withdrawn in the window. */
const TWICE = { slug: `versions-twice-${stamp}`, title: `Liber secundus ${stamp}` };
/** Published once; its deletion is refused. */
const KEPT = { slug: `versions-kept-${stamp}`, title: `Liber tertius ${stamp}` };
/** Never published. */
const DRAFT = { slug: `versions-draft-${stamp}`, title: `Liber quartus ${stamp}` };
const NOTE = `The first lines, read in one witness ${stamp}.`;
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/versions';

const LINES: Record<string, string> = {
  '1.1': 'arma virumque cano',
  '1.2': 'Troiae qui primus ab oris',
};

let db: Database;
let pool: ReturnType<typeof createDatabase>['pool'];
const ids: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1500, height: 950 } });

async function register(browser: Browser, who: { name: string; email: string }) {
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill(who.name);
  await page.getByLabel(s.auth.email).fill(who.email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));
  await page.close();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, who.email));
  if (!user) throw new Error('registration failed');
  return user.id;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(OWNER.email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** Errors the page throws or logs, to be none at the end of a test. */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** A work, a witness with two transcripts of the owner's, and four editions that compare the first. */
async function build(userId: string) {
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: SCHEME_PRESETS[0]!.name,
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: userId,
  });
  ids.work = newId();
  await db.insert(works).values({
    id: ids.work,
    slug: WORK.slug,
    title: WORK.title,
    author: 'Vergilius',
    schemeId,
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, ids.work), Object.keys(LINES));
  const stream = (): Stream => {
    const items: Item[] = [];
    Object.entries(LINES).forEach(([label, text], k) => {
      if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
      const words = fromText(text, { lang: 'la' }).items;
      (words[0] as Token).segment = { segmentId: segments.get(label)!.id };
      items.push(...words);
    });
    return { items };
  };
  ids.witness = newId();
  await db
    .insert(witnesses)
    .values({ id: ids.witness, slug: WITNESS.slug, siglum: 'V', name: WITNESS.name });
  for (const [key, name] of [
    ['book', BOOK],
    ['loose', LOOSE],
  ] as const) {
    ids[key] = newId();
    await db.insert(transcriptions).values({
      id: ids[key],
      witnessId: ids.witness,
      name,
      ownerId: userId,
      keepsWrittenForm: false,
    });
    await replaceContent(db, 'transcription', ids[key], userId, 0, stream(), 'seed');
  }
  for (const [key, edition] of [
    ['first', FIRST],
    ['twice', TWICE],
    ['kept', KEPT],
    ['draft', DRAFT],
  ] as const) {
    ids[key] = newId();
    await db.insert(editions).values({
      id: ids[key],
      workId: ids.work,
      slug: edition.slug,
      title: edition.title,
      editors: [OWNER.name],
      ownerId: userId,
      conventions: DEFAULT_CONVENTIONS,
    });
    await db.insert(editionSigla).values({
      editionId: ids[key],
      witnessId: ids.witness,
      transcriptionId: ids.book,
      siglum: 'V',
      position: 0,
    });
    await replaceContent(db, 'edition', ids[key], userId, 0, stream(), 'seed');
  }
  await publishEdition(db, ids.twice!, userId, 'The first version.');
  await publishEdition(db, ids.twice!, userId, 'The second version.');
  await publishEdition(db, ids.kept!, userId);
}

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const ownerId = await register(browser, OWNER);
  await build(ownerId);
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  // The records have versions and are not deleted through the application; the test removes them itself.
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, OWNER.email));
  await db.delete(works).where(eq(works.slug, WORK.slug));
  await db.delete(witnesses).where(eq(witnesses.slug, WITNESS.slug));
  if (user) {
    await db.delete(transcriptions).where(eq(transcriptions.ownerId, user.id));
    await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  }
  await db.delete(users).where(eq(users.email, OWNER.email));
  await pool.end();
});

/** The reader's or the workbench's Versions menu, opened. */
async function openVersions(page: Page) {
  await page.getByRole('button', { name: vs.menu.label }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('publishes an edition through its window with a note, and the reader lists the version with its note and what changed', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page);
  await page.goto(`/editions/${FIRST.slug}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: ra.edition.publishButton, exact: true }).click();
  const window = page.getByRole('dialog', { name: vs.publish.edition });
  await expect(window).toContainText(vs.publish.body('edition', 1));
  // The changes since the beginning: every word of the text is added.
  await expect(window).toContainText(vs.changes.totals(8, 0, 0));
  await window.getByText(vs.changes.totals(8, 0, 0)).click();
  await expect(window.getByRole('rowheader', { name: '1.2' })).toBeVisible();
  await window.getByLabel(vs.publish.note).fill(NOTE);
  await page.screenshot({ path: `${SHOTS}/1-publish-window.png` });
  await window.getByRole('button', { name: vs.publish.verb, exact: true }).click();
  await expect(page.getByText(vs.publish.done(1))).toBeVisible({ timeout: 15_000 });
  await expect(window).toBeHidden();

  // The reader says which version it shows, with the note, and lists it.
  await page.goto(`/editions/${FIRST.slug}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.title-block')).toContainText(vs.published(1));
  await expect(page.locator('.title-block')).toContainText(NOTE);
  const menu = await openVersions(page);
  await expect(menu).toContainText(vs.version(1));
  await expect(menu).toContainText(NOTE);
  await expect(menu).toContainText(vs.menu.current);
  // Its editors preview the draft from there.
  await expect(menu.getByRole('menuitem', { name: /Preview the Draft/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/2-versions-menu.png` });
  await menu.getByRole('menuitem', { name: vs.menu.whatChanged }).click();
  const changed = page.getByRole('dialog', { name: vs.menu.whatChangedOf(1) });
  await expect(changed).toContainText(vs.changes.totals(8, 0, 0));
  await expect(changed).toContainText(NOTE);
  await expect(changed.getByRole('rowheader', { name: '1.1' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('withdraws a version through its window, and its address gives the citation and the note and no text', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page);
  await page.goto(`/editions/${TWICE.slug}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ra.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: ra.edition.withdraw }).click();
  const window = page.getByRole('dialog', { name: vs.withdraw.title });
  await expect(window).toContainText(vs.withdraw.body);
  const which = window.getByLabel(vs.withdraw.which, { exact: true });
  // The latest is chosen to begin with; the first is withdrawn here.
  await expect(which).toHaveValue('2');
  await which.selectOption('1');
  await window.getByLabel(vs.withdraw.note).fill('Superseded: the second line was misread.');
  await page.screenshot({ path: `${SHOTS}/3-withdraw-window.png` });
  await window.getByRole('button', { name: vs.withdraw.verb, exact: true }).click();
  await expect(page.getByText(vs.withdraw.done(1))).toBeVisible({ timeout: 15_000 });

  // The menu marks it withdrawn; the latest is still read at the edition's address.
  const menu = await openVersions(page);
  await expect(menu.getByRole('menuitem', { name: /Version 1/ })).toContainText(vs.menu.withdrawn);
  await page.keyboard.press('Escape');

  // Its own address: the citation and the withdrawal, and no text.
  const visitor = await page.context().browser()!.newContext();
  const reader = await visitor.newPage();
  const answer = await reader.goto(`/editions/${TWICE.slug}/v/1`);
  expect(answer?.status()).toBe(200);
  await expect(reader.locator('h1')).toHaveText(TWICE.title);
  await expect(
    reader.getByText(vs.withdrawnPage.withdrawn, { exact: false }).first(),
  ).toBeVisible();
  await expect(reader.getByText('Superseded: the second line was misread.')).toBeVisible();
  await expect(reader.getByText('The first version.')).toBeVisible();
  await expect(reader.getByText(`/editions/${TWICE.slug}/v/1`)).toBeVisible();
  await expect(reader.getByRole('link', { name: vs.withdrawnPage.readLatest })).toHaveAttribute(
    'href',
    `/editions/${TWICE.slug}`,
  );
  await expect(reader.getByText('virumque')).toHaveCount(0);
  await reader.screenshot({ path: `${SHOTS}/4-withdrawn-page.png`, fullPage: true });
  await visitor.close();
  expect(errors).toEqual([]);
});

test('a transcript is published and withdrawn from its menu, and a reader sees its version in the workbench', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page);
  // From the witness's list, where the window opens in place.
  await page.goto(`/witnesses/${WITNESS.slug}`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('main li').filter({ hasText: LOOSE });
  await expect(row.getByText(vs.draft, { exact: true })).toBeVisible();
  await row.getByRole('button', { name: ra.menuOf(LOOSE) }).click();
  const withdrawItem = page.getByRole('menuitem', { name: new RegExp(ra.transcription.withdraw) });
  await expect(withdrawItem).toHaveAttribute('data-disabled', '');
  await expect(withdrawItem).toContainText(vs.withdraw.nothing);
  await page.getByRole('menuitem', { name: ra.transcription.publish }).click();
  const window = page.getByRole('dialog', { name: vs.publish.transcription });
  await expect(window).toContainText(vs.publish.body('transcription', 1));
  await window.getByLabel(vs.publish.note).fill('Leaves 1 and 2.');
  await window.getByRole('button', { name: vs.publish.verb, exact: true }).click();
  await expect(page.getByText(vs.publish.done(1))).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/witnesses/${WITNESS.slug}$`));
  await expect(row.getByText(vs.version(1), { exact: true })).toBeVisible();

  // A reader sees the version read only, says the header, with the Versions menu.
  const visitor = await page.context().browser()!.newContext();
  const reader = await visitor.newPage();
  await reader.goto(`/transcriptions/${ids.loose}`);
  await reader.locator('.cm-content').waitFor();
  await reader.waitForLoadState('networkidle');
  await expect(reader.getByText(vs.published(1))).toBeVisible();
  await expect(reader.getByText(w.readOnly, { exact: true })).toBeVisible();
  const menu = await openVersions(reader);
  await expect(menu).toContainText('Leaves 1 and 2.');
  await expect(menu.getByRole('menuitem', { name: /Version 1/ })).toHaveAttribute(
    'href',
    `/transcriptions/${ids.loose}/v/1`,
  );
  await reader.keyboard.press('Escape');

  // The owner sees the draft, and withdraws the version from the workbench's menu.
  await page.goto(`/transcriptions/${ids.loose}`);
  await page.locator('.cm-content').waitFor();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(vs.draft, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: ra.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: ra.transcription.withdraw }).click();
  const withdraw = page.getByRole('dialog', { name: vs.withdraw.title });
  await withdraw.getByLabel(vs.withdraw.note).fill('Taken back.');
  await withdraw.getByRole('button', { name: vs.withdraw.verb, exact: true }).click();
  await expect(page.getByText(vs.withdraw.done(1))).toBeVisible({ timeout: 15_000 });

  // Its address now gives the citation and the note, to anyone.
  await reader.goto(`/transcriptions/${ids.loose}/v/1`);
  await expect(reader.locator('h1')).toHaveText(LOOSE);
  await expect(reader.getByText('Taken back.')).toBeVisible();
  await expect(reader.locator('.cm-content')).toHaveCount(0);
  await visitor.close();
  expect(errors).toEqual([]);
});

test('an edition that has a version is not deleted, and the window says why', async ({ page }) => {
  const errors = watch(page);
  await signIn(page);
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  const row = page.locator('main li').filter({ hasText: KEPT.title });
  await row.getByRole('button', { name: ra.menuOf(KEPT.title) }).click();
  await page.getByRole('menuitem', { name: ra.edition.delete }).click();
  const window = page.getByRole('dialog', { name: ra.edition.deleteTitle });
  await window.getByRole('button', { name: ra.edition.deleteVerb, exact: true }).click();
  await expect(window.getByRole('alert')).toContainText(ra.edition.hasVersion);
  await window.getByRole('button', { name: ra.cancel }).click();
  expect(await db.select().from(editions).where(eq(editions.id, ids.kept!))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('every list badges a record Version n or Draft', async ({ page }) => {
  const errors = watch(page);
  await signIn(page);
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  const badge = (title: string) =>
    page.locator('main li').filter({ hasText: title }).locator('span.rounded-full');
  await expect(badge(TWICE.title)).toHaveText(vs.version(2));
  await expect(badge(KEPT.title)).toHaveText(vs.version(1));
  await expect(badge(DRAFT.title)).toHaveText(vs.draft);
  // The transcript the editions compare was published with them.
  await expect(badge(BOOK)).toHaveText(/^Version \d+$/);
  await page.screenshot({ path: `${SHOTS}/5-your-work.png`, fullPage: true });

  await page.goto(`/works/${WORK.slug}`);
  await page.waitForLoadState('networkidle');
  await expect(
    page.locator('main li').filter({ hasText: DRAFT.title }).getByText(vs.draft, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('main li')
      .filter({ hasText: KEPT.title })
      .getByText(vs.version(1), { exact: true }),
  ).toBeVisible();

  // The editor's header too.
  await page.goto(`/editions/${TWICE.slug}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const header = page.locator('h1', { hasText: TWICE.title }).locator('..');
  await expect(header.getByText(vs.version(2), { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
