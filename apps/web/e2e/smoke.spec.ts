import { expect, test } from '@playwright/test';
import { s } from '../src/lib/strings/en';
import { site } from '../src/lib/strings/site';

/**
 * Register, see the front page as a user, log out, log in again.
 * Runs against the varians_test database; every run makes a new account.
 */
test('a new user registers, logs out and logs back in', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const name = `Smoke ${stamp}`;
  const email = `smoke-${stamp}@example.com`;
  const password = 'correct horse battery';
  const accountNav = page.getByRole('banner');

  // A visitor sees what Varians is, the editions to read, and the way to log in.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: site.home.title })).toBeVisible();
  await expect(page.getByRole('link', { name: site.home.read })).toBeVisible();
  await expect(accountNav.getByRole('link', { name: s.shell.logIn })).toBeVisible();

  // Register.
  await accountNav.getByRole('link', { name: s.shell.register }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel(s.auth.name).fill(name);
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();

  // The front page as a new user: the ways to start, and nothing to continue yet.
  await expect(page).toHaveURL(/\/$/);
  // The menus work once the page has hydrated; a click before that opens nothing.
  await page.waitForLoadState('networkidle');
  const start = page.getByRole('navigation', { name: site.home.menu });
  await expect(start.getByRole('link', { name: site.home.makeEdition })).toBeVisible();
  await expect(page.getByRole('heading', { name: site.home.continue })).toHaveCount(0);
  await expect(page.getByRole('button', { name: s.shell.userMenu })).toContainText(name);

  // Log out through the user menu.
  await page.getByRole('button', { name: s.shell.userMenu }).click();
  await page.getByRole('menuitem', { name: s.shell.logOut }).click();
  await expect(accountNav.getByRole('link', { name: s.shell.logIn })).toBeVisible();
  await expect(page.getByRole('navigation', { name: site.home.menu })).toHaveCount(0);

  // A wrong password is refused.
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill('not the password');
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await expect(page.getByRole('alert')).toContainText(s.auth.invalidCredentials);

  // The right one is accepted.
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: site.home.menu })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // The account page is reachable and shows the name.
  await page.getByRole('button', { name: s.shell.userMenu }).click();
  await page.getByRole('menuitem', { name: s.shell.account }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('textbox', { name: s.auth.name, exact: true })).toHaveValue(name);
});

test('a visitor is sent to the login from a page that needs an account', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?redirectTo=%2Faccount$/);
});
