/**
 * The edition editor in a browser: adopting a witness's reading, taking it
 * back, registering and adopting a conjecture, moving a line, and finding
 * all of it saved after a reload. The sample Iliad is seeded into the test
 * database for a user registered here.
 */
import { expect, test, type Page } from '@playwright/test';
import { createDatabase, referenceSchemes, users, witnesses, works } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { seedSample } from '../src/lib/server/seed/sample.ts';
import { s } from '../src/lib/strings/en';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const email = `editor-${Date.now()}@example.org`;
const password = 'a long enough password';

async function cleanSample() {
  const { db, pool } = createDatabase(DATABASE_URL);
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  await pool.end();
}

async function line(page: Page, n: number): Promise<string> {
  return (await page.locator('.cm-content .cm-line').nth(n).innerText()).trim();
}

async function saved(page: Page) {
  await expect(page.locator('[aria-live=polite]').first()).toHaveText('Saved', { timeout: 15_000 });
  // The segments an edit touched are collated again after the save.
  await expect(page.locator('.apparatus-band [aria-busy=true]')).toHaveCount(0, { timeout: 15_000 });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  await cleanSample();
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Edition Tester');
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
  if (user) {
    await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  }
  await pool.end();
});

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('adopts a reading, takes it back, and adopts a conjecture', async ({ page }) => {
  await signIn(page);
  await page.goto('/editions/iliad-1-working-edition/edit');
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(await line(page, 1)).toBe('οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,');

  await page.locator('.apparatus-band button[title="Adopt"]', { hasText: 'μυρία' }).first().click();
  await saved(page);
  expect(await line(page, 1)).toBe('οὐλομένην, ἣ μυρία Ἀχαιοῖς ἄλγε᾽ ἔθηκε,');
  await expect(page.locator('.apparatus-band section').nth(1)).toContainText('μυρί᾽ A C');

  await page.getByRole('button', { name: /Undo adoption/ }).click();
  await saved(page);
  expect(await line(page, 1)).toBe('οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,');

  await page.locator('.cm-content .cm-line').nth(2).getByText('ἰφθίμους').dblclick();
  await page.getByRole('toolbar', { name: 'Edition marks' }).getByRole('button', { name: 'Conjecture…' }).click();
  await page.getByLabel('Reading').fill('ἰφθίμων');
  await page.getByLabel('Proposed by').fill('Tester');
  await page.getByRole('button', { name: 'Register and adopt' }).click();
  await saved(page);
  expect(await line(page, 2)).toBe('πολλὰς δ᾽ ἰφθίμων ψυχὰς Ἄϊδι προΐαψεν');

  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(await line(page, 2)).toBe('πολλὰς δ᾽ ἰφθίμων ψυχὰς Ἄϊδι προΐαψεν');
  await expect(page.locator('.apparatus-band section', { hasText: '1.3' }).first()).toContainText('Tester');
});

test('moves a line with its label and reports the order of the witnesses', async ({ page }) => {
  await signIn(page);
  await page.goto('/editions/iliad-1-working-edition/edit');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content .cm-line').nth(8).click();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await saved(page);
  await expect(page.locator('.cm-segment-gutter')).toContainText(/1\.7\s*1\.9\s*1\.8/);
  await expect(page.locator('.apparatus-band')).toContainText('A has it after 1.8');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await saved(page);
  await expect(page.locator('.apparatus-band')).not.toContainText('has it after');
});
