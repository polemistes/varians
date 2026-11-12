/**
 * Copying text from transcripts into an edition that starts empty: the
 * empty edition offers the window where its text would be; lines 1.1 to 1.3
 * come from A, 1.4 to 1.6 from B through the Insert menu, then 1.2 and 1.3
 * from B again, which the window warns will replace two segments. After
 * each copy the editor shows the text as stored, and the band reports A
 * where B's text now stands. The witnesses' lines are made up.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
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
import { eq, inArray } from 'drizzle-orm';
import { editor as ed } from '../src/lib/strings/editor';
import { historyStrings as hs } from '../src/lib/strings/history';
import { s } from '../src/lib/strings/en';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';
import { typeFirstWords } from './helpers';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `copy-text-${stamp}@example.org`;
const password = 'a long enough password';
const WORK = `copy-text-work-${stamp}`;
const EDITION = `copy-text-edition-${stamp}`;
/** An edition with no witnesses at all. */
const BARE = `copy-text-bare-${stamp}`;
const WITNESSES = [`copy-text-a-${stamp}`, `copy-text-b-${stamp}`];
// Where the screenshots are written: Playwright's own folder of results, which is not tracked.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/copy-text';
const t = ed.dialogs.copyText;

/** Made-up lines of two witnesses that differ in one word of each line. */
const A: Record<string, string> = {
  '1.1': 'κάλος ἔφυ λίθος',
  '1.2': 'ποταμὸς ῥέει μέγας',
  '1.3': 'ἄστρον φαίνει νύκτωρ',
  '1.4': 'δένδρον ἔχει φύλλα',
  '1.5': 'ἄνεμος πνεῖ σφόδρα',
  '1.6': 'θάλασσα κυμαίνει πάλιν',
};
const B: Record<string, string> = {
  '1.1': 'καλὸς ἔφυ λίθος',
  '1.2': 'ποταμὸς ῥεῖ μέγας',
  '1.3': 'ἄστρα φαίνει νύκτωρ',
  '1.4': 'δένδρον ἔχει φύλλον',
  '1.5': 'ἄνεμος πνέει σφόδρα',
  '1.6': 'θάλαττα κυμαίνει πάλιν',
};

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
    title: 'Copied lines',
    schemeId,
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), Object.keys(A));
  const stream = (lines: Record<string, string>): Stream => {
    const items: Item[] = [];
    Object.entries(lines).forEach(([label, text], k) => {
      if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
      const words = fromText(text, { lang: 'grc' }).items;
      (words[0] as Token).segment = { segmentId: segments.get(label)!.id };
      items.push(...words);
    });
    return { items };
  };
  const sigla: { witnessId: string; transcriptionId: string; siglum: string }[] = [];
  for (const [k, [siglum, lines]] of (
    [
      ['A', A],
      ['B', B],
    ] as const
  ).entries()) {
    const witnessId = newId();
    await db.insert(witnesses).values({
      id: witnessId,
      slug: WITNESSES[k]!,
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
    await replaceContent(db, 'transcription', transcriptionId, userId, 0, stream(lines), 'seed');
    sigla.push({ witnessId, transcriptionId, siglum });
  }
  // The edition starts empty, with both witnesses in its conspectus.
  const editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: EDITION,
    title: 'Copied lines, an edition',
    editors: ['Editor'],
    ownerId: userId,
    conventions: { ...DEFAULT_CONVENTIONS, numberEvery: 1 },
  });
  await db
    .insert(editionSigla)
    .values(sigla.map((entry, position) => ({ editionId, ...entry, position })));
  await db.insert(editions).values({
    id: newId(),
    workId,
    slug: BARE,
    title: 'Copied lines, an edition without witnesses',
    editors: ['Editor'],
    ownerId: userId,
    conventions: DEFAULT_CONVENTIONS,
  });
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(inArray(witnesses.slug, WITNESSES));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await db.delete(users).where(eq(users.email, email));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Copy Tester');
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

async function lines(page: Page): Promise<string[]> {
  return (await page.locator('.cm-content .cm-line').allInnerTexts())
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Copy Text, and wait for the editor to start again from the text the server has. */
async function copyAndReload(page: Page, dialog: Locator) {
  await Promise.all([
    page.waitForEvent('load', { timeout: 15_000 }),
    dialog.getByRole('button', { name: t.copy }).click(),
  ]);
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** The band's section of a segment. */
function section(page: Page, label: string): Locator {
  return page
    .locator('.apparatus-band section')
    .filter({ has: page.locator('h3', { hasText: new RegExp(`^${label.replace('.', '\\.')}$`) }) });
}

/** Fill the window and copy, once it has said what the copy brings. */
async function copy(page: Page, siglum: string, from: string, to: string, count: string) {
  const dialog = page.getByRole('dialog', { name: t.title });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(t.transcript).selectOption({ label: `${siglum}: Codex ${siglum}` });
  await dialog.getByLabel(t.from, { exact: true }).fill(from);
  await dialog.getByLabel(t.to, { exact: true }).fill(to);
  await expect(dialog.getByTestId('copy-text-count')).toHaveText(count);
  return dialog;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('an empty edition without transcripts cannot copy, and is typed into, its first word asking its language', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page);
  await page.goto(`/editions/${BARE}/edit`);
  // The first opening of the editor on a server just started takes longer than an expectation waits.
  await page.waitForSelector('.cm-content');
  await expect(page.getByText(t.empty)).toBeVisible();
  await expect(page.getByRole('button', { name: t.menu })).toBeDisabled();
  await page.getByRole('button', { name: ed.dialogs.insert.menu, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: t.menu })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('.cm-content').click();
  // An edition starts without a language: the first word typed opens the chooser, and the next takes its language.
  await typeFirstWords(page, 'ὕδωρ ῥέει', 'Ancient Greek');
  await expect(page.locator('.cm-content .cm-language-label')).toHaveCount(1);
  await expect(page.getByRole('button', { name: ed.language.label, exact: true })).toHaveText(
    'Ancient Greek',
  );
  await expect
    .poll(
      async () => {
        const [row] = await db
          .select({ content: editions.content })
          .from(editions)
          .where(eq(editions.slug, BARE));
        return row!.content.items.flatMap((item) =>
          item.kind === 'token' ? [[item.form, item.lang]] : [],
        );
      },
      { timeout: 15_000 },
    )
    .toEqual([
      ['ὕδωρ', 'grc'],
      ['ῥέει', 'grc'],
    ]);
  await expect(page.getByText(t.empty)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an empty edition takes its text from two transcripts, range by range', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await signIn(page);
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`/editions/${EDITION}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();

  // The empty edition says so where its text would be, and offers the window.
  await expect(page.getByText(t.empty)).toBeVisible();
  const offer = page.getByRole('button', { name: t.menu });
  await expect(offer).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/1-empty-edition.png` });
  await offer.click();
  let dialog = await copy(page, 'A', '1.1', '1.3', t.count(3, 0));
  await copyAndReload(page, dialog);
  await expect.poll(() => lines(page), { timeout: 15_000 }).toEqual([A['1.1'], A['1.2'], A['1.3']]);
  await expect(page.getByText(t.empty)).toHaveCount(0);

  // 1.4 to 1.6 from B, through the Insert menu: they follow 1.3.
  await page.getByRole('button', { name: ed.dialogs.insert.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: t.menu }).click();
  dialog = await copy(page, 'B', '1.4', '1.6', t.count(3, 0));
  await copyAndReload(page, dialog);
  await expect
    .poll(() => lines(page), { timeout: 15_000 })
    .toEqual([A['1.1'], A['1.2'], A['1.3'], B['1.4'], B['1.5'], B['1.6']]);
  // Where B's text stands, the band reports A's reading, to be adopted.
  await expect(
    section(page, '1.5').locator('button[title="Adopt"]', { hasText: 'πνεῖ' }),
  ).toBeVisible({ timeout: 15_000 });

  // 1.2 and 1.3 from B: the window says that the edition's text of both is replaced.
  await page.getByRole('button', { name: ed.dialogs.insert.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: t.menu }).click();
  dialog = await copy(page, 'B', '1.2', '1.3', t.count(2, 2));
  await expect(dialog.getByRole('status').filter({ hasText: t.count(2, 2) })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/2-window-with-warning.png` });
  await copyAndReload(page, dialog);
  await expect
    .poll(() => lines(page), { timeout: 15_000 })
    .toEqual([A['1.1'], B['1.2'], B['1.3'], B['1.4'], B['1.5'], B['1.6']]);
  await expect(
    section(page, '1.3').locator('button[title="Adopt"]', { hasText: 'ἄστρον' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    section(page, '1.5').locator('button[title="Adopt"]', { hasText: 'πνεῖ' }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3-result.png` });

  // The history names each copy.
  await page.getByRole('tab', { name: ed.workspace.history }).click();
  await page.getByRole('button', { name: hs.showChanges(3) }).click();
  for (const message of [
    t.message('1.1–1.3', 'A'),
    t.message('1.4–1.6', 'B'),
    t.message('1.2–1.3', 'B'),
  ])
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
