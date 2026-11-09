/**
 * Identifiers and merging (PLAN-2 C7, C8): register two witnesses, give one
 * a Diktyon number, find it by that number, and merge the other into it
 * from its edit page; the survivor lists the merged witness.
 */
import { expect, test } from '@playwright/test';
import { createDatabase, registryMerges, users, witnesses } from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { registry as t } from '../src/lib/strings/registry';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const diktyon = `9${Date.now()}`;
const email = `merge-${stamp}@example.org`;
const password = 'a long enough password';
const duplicate = `Codex Duplex ${stamp}`;
const survivor = `Codex Superstes ${stamp}`;
const slugs: string[] = [];

test.afterAll(async () => {
  const { db, pool } = createDatabase(DATABASE_URL);
  const rows = slugs.length ? await db.select({ id: witnesses.id }).from(witnesses).where(inArray(witnesses.slug, slugs)) : [];
  if (rows.length) {
    await db.delete(registryMerges).where(inArray(registryMerges.survivorId, rows.map((r) => r.id)));
    await db.delete(witnesses).where(inArray(witnesses.id, rows.map((r) => r.id)));
  }
  await db.delete(users).where(eq(users.email, email));
  await pool.end();
});

test('a witness registered twice is merged into the other', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Merge Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  // Two witnesses; the survivor with a Diktyon number.
  for (const [name, siglum, withIdentifier] of [
    [survivor, 'S', true],
    [duplicate, 'D', false],
  ] as const) {
    await page.goto('/witnesses/new');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name=name]').fill(name);
    await page.locator('input[name=siglum]').fill(siglum);
    if (withIdentifier) {
      await page.getByRole('button', { name: t.identifiers.add }).click();
      await page.getByRole('combobox', { name: t.identifiers.schemeOf(''), exact: true }).selectOption('diktyon');
      await page.getByRole('textbox', { name: t.identifiers.value, exact: true }).fill(diktyon);
    }
    await page.getByRole('button', { name: t.witness.create }).click();
    await page.waitForURL((url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new');
    slugs.push(new URL(page.url()).pathname.split('/').pop()!);
  }
  const [survivorSlug, duplicateSlug] = slugs;

  // The identifier is shown with a link to Pinakes, and the search finds the witness by it.
  await page.goto(`/witnesses/${survivorSlug}`);
  await expect(page.getByRole('link', { name: t.identifiers.lookUp('Diktyon', diktyon) })).toHaveAttribute(
    'href',
    `https://pinakes.irht.cnrs.fr/notices/cote/${diktyon}/`,
  );
  await page.goto(`/search?q=${diktyon}`);
  await expect(page.getByRole('link', { name: survivor })).toBeVisible();

  // Merge the duplicate into the survivor from its edit page.
  await page.goto(`/witnesses/${duplicateSlug}/edit`);
  await page.getByRole('link', { name: t.merge.action }).click();
  await page.waitForURL(new RegExp(`/witnesses/${duplicateSlug}/merge`));
  await page.getByLabel(t.merge.findWitness).fill(diktyon);
  await page.getByRole('button', { name: t.merge.find }).click();
  await page.getByRole('link', { name: t.merge.chooseLabel(survivor) }).click();
  const preview = page.getByTestId('merge-preview');
  await expect(preview).toBeVisible();
  await expect(page.getByTestId('merge-blocks')).toHaveCount(0);
  await preview.getByRole('button', { name: t.merge.confirm }).click();

  // The survivor's page lists what was merged into it; the duplicate is gone.
  await page.waitForURL(new RegExp(`/witnesses/${survivorSlug}$`));
  await expect(page.getByText(t.merge.mergedHere)).toBeVisible();
  await expect(page.getByText(duplicate)).toBeVisible();
  const response = await page.goto(`/witnesses/${duplicateSlug}`);
  expect(response?.status()).toBe(404);
});
