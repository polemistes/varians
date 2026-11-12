/**
 * An edition's name leads to the reader, and Read, Edit and its menu stand
 * beside it, the same everywhere. An account owns a draft and an edition it
 * publishes from Your Work; the name opens the reader from the front page's
 * Continue and from Your Work, Edit the editor; the menu has the same items
 * in the same order on a card, in the reader, in the editor and on Edition
 * Settings (less the item for the page one is on); publishing and deleting
 * ask in the application's window, and a deletion from Your Work leaves the
 * list without the row. Owner and Collaborators on Edition Settings invites
 * the second account and removes it again. That account, which may not edit,
 * sees no buttons on the card and, in the reader, a menu with the copy and
 * the downloads only.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  SCHEME_PRESETS,
  defaultProfile,
  fromText,
  newId,
  type Item,
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
import { s } from '../src/lib/strings/en';
import { recordActions } from '../src/lib/strings/record-actions';
import { site } from '../src/lib/strings/site';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const password = 'a long enough password';
const OWNER = { name: 'Owner of Editions', email: `actions-owner-${stamp}@example.org` };
const OTHER = { name: 'Another Reader', email: `actions-other-${stamp}@example.org` };
const WORK = `actions-work-${stamp}`;
const WITNESS = `actions-witness-${stamp}`;
/** Published from Your Work in the first test. */
const PUBLISHED = { slug: `actions-published-${stamp}`, title: `Liber primus ${stamp}` };
const DRAFT = { slug: `actions-draft-${stamp}`, title: `Liber secundus ${stamp}` };
/** Deleted from Your Work. */
const DOOMED = { slug: `actions-doomed-${stamp}`, title: `Liber tertius ${stamp}` };
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/edition-actions';
const ea = recordActions.edition;

const LINES: Record<string, string> = {
  '1.1': 'arma virumque cano',
  '1.2': 'Troiae qui primus ab oris',
  '1.3': 'Italiam fato profugus',
};

/** Every item of an edition's menu for its owner, in order, on a page other than Edition Settings. */
const OWNER_MENU = [ea.settings, ea.publish, ea.unpublish, ea.copy, ea.tei, ea.package, ea.delete];
const READER_MENU = [ea.copy, ea.tei, ea.package];

let db: Database;
let pool: ReturnType<typeof createDatabase>['pool'];

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

/** A work with one witness, its transcript, and three editions of the owner's that read it. */
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
    title: 'Aeneis',
    author: 'Vergilius',
    language: 'lat',
    schemeId,
    profile: defaultProfile('lat'),
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), Object.keys(LINES));
  const stream = (): Stream => {
    const items: Item[] = [];
    Object.entries(LINES).forEach(([label, text], k) => {
      if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
      const words = fromText(text).items;
      (words[0] as Token).segment = { segmentId: segments.get(label)!.id };
      items.push(...words);
    });
    return { items };
  };
  const witnessId = newId();
  await db
    .insert(witnesses)
    .values({ id: witnessId, slug: WITNESS, siglum: 'M', name: 'Codex M', createdBy: userId });
  const transcriptionId = newId();
  await db.insert(transcriptions).values({
    id: transcriptionId,
    witnessId,
    name: 'Book 1',
    ownerId: userId,
    keepsWrittenForm: false,
    visibility: 'published',
  });
  await replaceContent(db, 'transcription', transcriptionId, userId, 0, stream(), 'seed');
  for (const edition of [DOOMED, DRAFT, PUBLISHED]) {
    const editionId = newId();
    await db.insert(editions).values({
      id: editionId,
      workId,
      slug: edition.slug,
      title: edition.title,
      editors: ['Owner of Editions'],
      ownerId: userId,
      conventions: DEFAULT_CONVENTIONS,
    });
    await db
      .insert(editionSigla)
      .values({ editionId, witnessId, transcriptionId, siglum: 'M', position: 0 });
    await replaceContent(db, 'edition', editionId, userId, 0, stream(), 'seed');
  }
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(inArray(witnesses.slug, [WITNESS]));
  for (const who of [OWNER, OTHER]) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, who.email));
    if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
    await db.delete(users).where(eq(users.email, who.email));
  }
}

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const ownerId = await register(browser, OWNER);
  await register(browser, OTHER);
  await build(ownerId);
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  await cleanUp();
  await pool.end();
});

async function signIn(page: Page, who: { email: string }) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(who.email);
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

/** The menu's items, in order, opened from `trigger` and closed again. */
async function menuOf(page: Page, trigger: Locator): Promise<string[]> {
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  return items;
}

/** A row of Your Work, by the edition's title. */
const rowOf = (page: Page, title: string) => page.locator('li').filter({ hasText: title });
/** A card, by the edition's title. */
const cardOf = (scope: Page | Locator, title: string) =>
  scope.locator('article').filter({ hasText: title });

test('publishes an edition from Your Work through the application window', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  const row = rowOf(page, PUBLISHED.title);
  await row.getByRole('button', { name: recordActions.menuOf(PUBLISHED.title) }).click();
  await page.getByRole('menuitem', { name: ea.publish }).click();
  const window = page.getByRole('dialog', { name: ea.publishTitle });
  await expect(window).toContainText(ea.publishBody);
  await window.getByRole('button', { name: ea.publishVerb, exact: true }).click();
  await expect(page.getByText(ea.published(1))).toBeVisible({ timeout: 15_000 });
  await expect(window).toBeHidden();
  await expect(row.getByText(site.home.published)).toBeVisible();
  await expect(page).toHaveURL(/\/mine$/);
  expect(errors).toEqual([]);
});

test('the name opens the reader from Continue and from Your Work, and Edit the editor', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const continued = page.getByRole('region', { name: site.home.continue });
  await expect(cardOf(continued, DRAFT.title)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-front-page.png`, fullPage: true });

  // From Continue: the name leads to the reader, Edit to the editor.
  await continued.getByRole('link', { name: DRAFT.title, exact: true }).click();
  await page.waitForURL(`**/editions/${DRAFT.slug}`);
  await expect(page.locator('h1')).toHaveText(DRAFT.title);
  await page.goBack();
  await page.waitForLoadState('networkidle');
  await continued.getByRole('link', { name: ea.editOf(DRAFT.title) }).click();
  await page.waitForURL(`**/editions/${DRAFT.slug}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();

  // From Your Work, the same.
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/2-your-work.png`, fullPage: true });
  await rowOf(page, PUBLISHED.title)
    .getByRole('link', { name: PUBLISHED.title, exact: true })
    .click();
  await page.waitForURL(`**/editions/${PUBLISHED.slug}`);
  await page.goto('/mine');
  await rowOf(page, PUBLISHED.title)
    .getByRole('link', { name: ea.editOf(PUBLISHED.title) })
    .click();
  await page.waitForURL(`**/editions/${PUBLISHED.slug}/edit`);
  expect(errors).toEqual([]);
});

test('the menu has the same items in the same order on a card, in the reader, in the editor and on Edition Settings', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);

  // A card among the published editions of the front page.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const editionsSection = page.getByRole('region', { name: site.home.editions });
  const card = cardOf(editionsSection, PUBLISHED.title);
  await expect(card.getByRole('link', { name: ea.readOf(PUBLISHED.title) })).toBeVisible();
  await expect(card.getByRole('link', { name: ea.editOf(PUBLISHED.title) })).toBeVisible();
  expect(
    await menuOf(page, card.getByRole('button', { name: recordActions.menuOf(PUBLISHED.title) })),
  ).toEqual(OWNER_MENU);

  // The reader: Edit and the menu, no Read; the versions in a menu of their own.
  await page.goto(`/editions/${PUBLISHED.slug}`);
  await page.waitForLoadState('networkidle');
  const bar = page.locator('.reader-bar');
  await expect(bar.getByRole('link', { name: ea.edit, exact: true })).toBeVisible();
  await expect(bar.getByRole('link', { name: ea.read, exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Versions' })).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/3-reader-bar.png`,
    clip: { x: 0, y: 0, width: 1500, height: 260 },
  });
  expect(
    await menuOf(page, bar.getByRole('button', { name: recordActions.menu, exact: true })),
  ).toEqual(OWNER_MENU);

  // The editor: Publish, Read (the draft of a published edition) and the menu.
  await page.goto(`/editions/${PUBLISHED.slug}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: ea.read, exact: true })).toHaveAttribute(
    'href',
    `/editions/${PUBLISHED.slug}?draft=1`,
  );
  await expect(page.getByRole('link', { name: ea.edit, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ea.publishButton, exact: true })).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/4-editor-header.png`,
    clip: { x: 0, y: 0, width: 1500, height: 200 },
  });
  expect(
    await menuOf(page, page.getByRole('button', { name: recordActions.menu, exact: true })),
  ).toEqual(OWNER_MENU);

  // Edition Settings: Read, Edit and the menu, less Edition Settings itself.
  await page.goto(`/editions/${PUBLISHED.slug}/settings`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: ea.read, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: ea.edit, exact: true })).toBeVisible();
  expect(
    await menuOf(page, page.getByRole('button', { name: recordActions.menu, exact: true })),
  ).toEqual(OWNER_MENU.slice(1));
  expect(errors).toEqual([]);
});

test('Owner and Collaborators on Edition Settings invites a collaborator and removes one through the window', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/editions/${DRAFT.slug}/settings`);
  await page.waitForLoadState('networkidle');
  const section = page.getByRole('region', { name: ea.people.title });
  await expect(section).toContainText(OWNER.name);
  await section.getByLabel(ea.people.invite).fill(OTHER.email);
  await section.getByRole('button', { name: ea.people.inviteAction, exact: true }).click();
  await expect(page.getByText(ea.people.invited(OTHER.name))).toBeVisible();
  await expect(section).toContainText(OTHER.email);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/5-settings-people.png`, fullPage: true });

  await section.getByRole('button', { name: ea.people.removeOf(OTHER.name) }).click();
  const window = page.getByRole('dialog', { name: ea.people.removeTitle });
  await expect(window).toContainText(ea.people.removeBody(OTHER.name));
  await window.getByRole('button', { name: ea.people.removeVerb, exact: true }).click();
  await expect(page.getByText(ea.people.removed(OTHER.name))).toBeVisible();
  await expect(section).not.toContainText(OTHER.email);
  await expect(section).toContainText(ea.people.nobody);
  expect(errors).toEqual([]);
});

test('deleting from Your Work asks in the window and leaves the list without the row', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  await rowOf(page, DOOMED.title)
    .getByRole('button', { name: recordActions.menuOf(DOOMED.title) })
    .click();
  await page.getByRole('menuitem', { name: ea.delete }).click();
  const window = page.getByRole('dialog', { name: ea.deleteTitle });
  await expect(window).toContainText(ea.deleteBody);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/6-confirm-delete.png` });
  await window.getByRole('button', { name: ea.deleteVerb, exact: true }).click();
  await expect(page.getByText(ea.deleted(DOOMED.title))).toBeVisible();
  await expect(page).toHaveURL(/\/mine$/);
  await expect(rowOf(page, DOOMED.title)).toHaveCount(0);
  await expect(rowOf(page, DRAFT.title)).toBeVisible();
  expect(errors).toEqual([]);
});

test('someone who may not edit sees no buttons on the card, and in the reader a menu with the copy and the downloads', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OTHER);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const card = cardOf(page, PUBLISHED.title);
  await expect(card).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(card.getByRole('link')).toHaveCount(1);
  await card.getByRole('link', { name: PUBLISHED.title, exact: true }).click();
  await page.waitForURL(`**/editions/${PUBLISHED.slug}`);
  await page.waitForLoadState('networkidle');
  const bar = page.locator('.reader-bar');
  await expect(bar.getByRole('link', { name: ea.edit, exact: true })).toHaveCount(0);
  expect(
    await menuOf(page, bar.getByRole('button', { name: recordActions.menu, exact: true })),
  ).toEqual(READER_MENU);
  // The draft is not theirs to see.
  const draft = await page.goto(`/editions/${DRAFT.slug}`);
  expect(draft?.status()).toBe(404);
  expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
});
