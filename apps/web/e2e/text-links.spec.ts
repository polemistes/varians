import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { s } from '../src/lib/strings/en';

/**
 * What one clicks to act (a button) and every heading is in Title Case; a link
 * that stands as text (in a sentence, under a form, in the footer) is in
 * sentence case. The words are written out here so that a change of the
 * strings shows.
 */
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/text-links';

/** What goes wrong in the page: uncaught errors and errors the console logs. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  return problems;
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test('the login page has a heading and buttons in Title Case, and links in sentence case', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log In');
  await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible();
  // The header's buttons are Title Case.
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Register', exact: true })).toBeVisible();
  // The links under the form are sentence case.
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: s.auth.forgotPassword })).toHaveText(
    'Forgotten your password?',
  );
  await expect(main.getByRole('link', { name: s.auth.registerLink })).toHaveText(
    'Create an account',
  );
  await expect(main.getByRole('link', { name: 'Forgotten Your Password?' })).toHaveCount(0);
  await expectFooter(page);
  await page.screenshot({ path: `${SHOTS}/login.png`, fullPage: true });
  expect(problems).toEqual([]);
});

test('the registration page has its heading in Title Case and the link to log in in sentence case', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/register');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create an Account');
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Log in', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/register.png`, fullPage: true });
  expect(problems).toEqual([]);
});

test('the front page has the same footer, and the error page a heading and a button in Title Case', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/');
  await expectFooter(page);
  const missing = await page.goto('/there-is-nothing-here');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing Here');
  await expect(page.getByRole('link', { name: 'Back to the Library', exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/not-found.png`, fullPage: true });
  expect(problems.filter((p) => !p.includes('404'))).toEqual([]);
});

/** The links of the footer, in sentence case. */
async function expectFooter(page: Page) {
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link')).toHaveText([
    'Guide',
    'Sources and licences',
    'Terms',
    'Data format',
    'Source code',
  ]);
}
