/**
 * Making an edition from scratch on one page: a new account presses Make
 * New Edition, adds a new work in a window, names the edition, adds a new
 * witness in a window and makes a transcript of it in another, and saves.
 * The page stays as Edition Settings with the witness, its siglum and its
 * transcript, which a reload shows again; Edit opens the editor.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createDatabase,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { edition as ed } from '../src/lib/strings/edition';
import { editor as edr } from '../src/lib/strings/editor';
import { recordActions } from '../src/lib/strings/record-actions';
import { registry as reg } from '../src/lib/strings/registry';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const ea = recordActions.edition;
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/make-edition';
const stamp = Date.now().toString(36);
const email = `make-edition-${stamp}@example.org`;
const workTitle = `Carmen novum ${stamp}`;
const witnessName = `Codex Recens ${stamp}`;
const editionName = `Carmen novum, editio ${stamp}`;

test.use({ viewport: { width: 1500, height: 1000 } });

async function cleanUp() {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const [work] = await db.select().from(works).where(eq(works.title, workTitle));
  if (work) {
    await db.delete(editions).where(eq(editions.workId, work.id));
    await db.delete(works).where(eq(works.id, work.id));
  }
  const made = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(eq(witnesses.name, witnessName));
  if (made.length) {
    const ids = made.map((w) => w.id);
    await db.delete(transcriptions).where(inArray(transcriptions.witnessId, ids));
    await db.delete(witnesses).where(inArray(witnesses.id, ids));
  }
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await pool.end();
}

test.afterAll(cleanUp);

/** Errors the page throws or logs, which a green test would otherwise hide. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  return problems;
}

test('an edition made from scratch on one page, which stays as Edition Settings', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watch(page);

  // A new account.
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Edition Maker');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill('a long enough password');
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  // Make New Edition, from the front page.
  await page.goto('/');
  await page.getByRole('link', { name: ed.newTitle }).click();
  await page.waitForURL('**/editions/new');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: ed.chooseWork })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-empty.png`, fullPage: true });

  // Add New Work, in a window over the page.
  await page.getByRole('button', { name: ed.addWork }).click();
  const workWindow = page.getByRole('dialog', { name: ed.addWorkTitle });
  await expect(workWindow).toContainText(reg.work.publicNote);
  await workWindow.locator('input[name=title]').fill(workTitle);
  await workWindow.locator('input[name=author]').fill('Anonymus');
  await workWindow.locator('select[name=language]').selectOption('la');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/3-add-new-work.png` });
  await workWindow.getByRole('button', { name: ed.save, exact: true }).click();
  await expect(workWindow).toBeHidden();
  await page.waitForURL(/\/editions\/new\?work=/);
  await expect(page.getByRole('heading', { name: ed.work, exact: true })).toBeVisible();
  await expect(page.getByText(workTitle, { exact: true })).toBeVisible();

  // Change shows the registry's works again, the new one among them; Choose takes it back.
  await page.getByRole('button', { name: ed.change }).click();
  await page.getByRole('searchbox', { name: ed.searchWorks }).fill(workTitle);
  const choose = page.getByRole('button', { name: `${ed.choose}: ${workTitle}` });
  await expect(choose).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1b-works-listed.png`, fullPage: true });
  await choose.click();
  await page.waitForURL(/\/editions\/new\?work=/);
  await expect(page.getByRole('heading', { name: ed.work, exact: true })).toBeVisible();

  // The name.
  await page.getByLabel(ed.title).fill(editionName);
  await page.screenshot({ path: `${SHOTS}/2-work-chosen.png`, fullPage: true });

  // Add Witness, then Add New Witness in its own window.
  await page.getByRole('button', { name: ed.conspectus.addWitness, exact: true }).click();
  const picker = page.getByRole('dialog', { name: ed.conspectus.picker.title });
  await expect(picker).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/4-add-witness.png` });
  await picker.getByRole('button', { name: ed.conspectus.addNewWitness }).click();
  const witnessWindow = page.getByRole('dialog', { name: ed.conspectus.addNewWitnessTitle });
  await witnessWindow.locator('input[name=name]').fill(witnessName);
  await witnessWindow.locator('input[name=siglum]').fill('R');
  await witnessWindow.getByRole('button', { name: ed.save, exact: true }).click();
  await expect(witnessWindow).toBeHidden();
  const siglum = page.getByLabel(`${ed.conspectus.siglum}: ${witnessName}`, { exact: true });
  await expect(siglum).toHaveValue('R');
  const transcript = page.getByLabel(`${ed.conspectus.transcript}: ${witnessName}`, {
    exact: true,
  });
  await expect(transcript).toHaveValue('');

  // Make New Transcript, in a window, for the work chosen.
  await page
    .getByRole('button', { name: `${ed.conspectus.makeTranscript}: ${witnessName}` })
    .click();
  const transcriptWindow = page.getByRole('dialog', { name: ed.conspectus.makeTranscriptTitle });
  await expect(transcriptWindow).toContainText(workTitle);
  await expect(transcriptWindow.locator('input[name=name]')).toHaveValue(workTitle);
  await transcriptWindow.getByRole('button', { name: reg.transcription.create }).click();
  await expect(transcriptWindow).toBeHidden();
  await expect(transcript.locator('option:checked')).toHaveText(workTitle);
  await expect(page.getByRole('link', { name: ed.conspectus.openTranscript })).toBeVisible();

  // Save: the page stays, now as Edition Settings.
  await page.getByRole('button', { name: ed.save, exact: true }).click();
  await page.waitForURL(/\/editions\/[^/]+\/settings$/);
  await expect(page.getByText(ed.saved)).toBeVisible();
  const settingsUrl = page.url();
  const check = async () => {
    await expect(page.locator('h1')).toHaveText(editionName);
    await expect(page.getByLabel(ed.title)).toHaveValue(editionName);
    await expect(
      page.getByLabel(`${ed.conspectus.siglum}: ${witnessName}`, { exact: true }),
    ).toHaveValue('R');
    await expect(
      page
        .getByLabel(`${ed.conspectus.transcript}: ${witnessName}`, { exact: true })
        .locator('option:checked'),
    ).toHaveText(workTitle);
    await expect(page.getByRole('heading', { name: ed.printApparatus })).toBeVisible();
  };
  await check();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/5-saved.png`, fullPage: true });
  await page.reload();
  await check();
  await page.waitForLoadState('networkidle');

  // A change not saved is asked about before leaving; staying keeps it.
  await page.getByLabel(ed.title).fill(`${editionName}, altered`);
  await page.getByRole('link', { name: ea.edit, exact: true }).click();
  const leave = page.getByRole('dialog', { name: ed.leave.title });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: ed.leave.stay }).click();
  await expect(page).toHaveURL(settingsUrl);
  await expect(page.getByLabel(ed.title)).toHaveValue(`${editionName}, altered`);
  await page.getByRole('button', { name: ed.cancel, exact: true }).click();
  await expect(page.getByLabel(ed.title)).toHaveValue(editionName);

  // Edit opens the editor.
  await page.getByRole('link', { name: ea.edit, exact: true }).click();
  await page.waitForURL(/\/editions\/[^/]+\/edit$/);
  await expect(page.locator('.cm-content')).toBeVisible();

  // The editor's Witnesses and Sigla window holds the same conspectus.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: edr.workspace.witnessList }).click();
  const window = page.getByRole('dialog', { name: edr.dialogs.sigla.title });
  await expect(
    window.getByLabel(`${ed.conspectus.siglum}: ${witnessName}`, { exact: true }),
  ).toHaveValue('R');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/6-editor-witnesses.png` });
  await window.getByRole('button', { name: edr.dialogs.cancel }).click();

  expect(problems).toEqual([]);
});
