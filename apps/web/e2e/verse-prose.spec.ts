/**
 * Divided words, the hyphen and paragraphs of verse and of prose, in the
 * reader and in the edition editor. The edition is made here from a witness
 * whose text divides words at a line's end: one across two segments (ana-
 * stasis, where 1.3 begins), one within a segment (kap- pa, in 1.4), and one in
 * a paragraph that is prose (mega- lon, in 1.6). Its paragraphs, by line:
 *
 * - 1.1 to 1.4, the edition's convention, verse;
 * - 1.5 to 1.7, marked as prose;
 * - 1.8 to 1.10, the edition's convention again, verse.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  SCHEME_PRESETS,
  defaultProfile,
  deriveEdition,
  fromText,
  newId,
  type Break,
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
import { eq } from 'drizzle-orm';
import { editor as ed } from '../src/lib/strings/editor';
import { s } from '../src/lib/strings/en';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';
import { setChosenWorks } from '../src/lib/server/transcription-works.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `verse-prose-${stamp}@example.org`;
const password = 'a long enough password';
const WORK = `verse-prose-work-${stamp}`;
const EDITION = `verse-prose-edition-${stamp}`;
const WITNESS = `verse-prose-a-${stamp}`;
// Where the screenshots are written: Playwright's own folder of results, which is not tracked.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/verse-prose';

/** The witness's lines; a word ending in + joins the next one, a label begins a segment. */
const LINES: { label?: string; text: string }[] = [
  { label: '1.1', text: 'alpha beta gamma' },
  { label: '1.2', text: 'delta epsilon ana+' },
  { label: '1.3', text: 'stasis eta theta' },
  { label: '1.4', text: 'iota kap+' },
  { text: 'pa lambda' },
  { label: '1.5', text: 'nu xi omicron' },
  { label: '1.6', text: 'pi rho mega+' },
  { text: 'lon sigma' },
  { label: '1.7', text: 'tau upsilon phi' },
  { label: '1.8', text: 'chi psi omega' },
  { label: '1.9', text: 'arma virumque cano' },
  { label: '1.10', text: 'troiae qui primus' },
];

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
    title: 'Verse and prose',
    language: 'grc',
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: userId,
  });
  const labels = LINES.flatMap((line) => (line.label ? [line.label] : []));
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), labels);

  const items: Item[] = [];
  LINES.forEach((line, k) => {
    if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
    const words = fromText(line.text.replaceAll('+', '')).items;
    if (line.text.endsWith('+')) (words[words.length - 1] as Token).joinNext = true;
    if (line.label) (words[0] as Token).segment = { segmentId: segments.get(line.label)!.id };
    items.push(...words);
  });
  const witnessId = newId();
  await db.insert(witnesses).values({
    id: witnessId,
    slug: WITNESS,
    siglum: 'A',
    name: 'Venetus A',
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
  await replaceContent(db, 'transcription', transcriptionId, userId, 0, { items }, 'seed');

  // The edition, made from the witness as an edition is: its divided words stay divided.
  const content: Stream = deriveEdition({ items }, transcriptionId);
  const opening = (label: string): number =>
    content.items.findIndex(
      (item) => item.kind === 'token' && item.segment?.segmentId === segments.get(label)!.id,
    ) - 1;
  const prose = content.items[opening('1.5')] as Break;
  prose.type = 'paragraph';
  prose.lineation = 'prose';
  (content.items[opening('1.8')] as Break).type = 'paragraph';

  editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: EDITION,
    title: 'Verse and prose, an edition',
    editors: ['Editor'],
    ownerId: userId,
    conventions: { ...DEFAULT_CONVENTIONS, numberEvery: 1 },
  });
  await replaceContent(db, 'edition', editionId, userId, 0, content, 'start');
  await db
    .insert(editionSigla)
    .values({ editionId, witnessId, transcriptionId, siglum: 'A', position: 0 });
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, WORK));
  await db.delete(witnesses).where(eq(witnesses.slug, WITNESS));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await db.delete(users).where(eq(users.email, email));
}

/** The edition's text as stored, to read what an edit left. */
async function stored(): Promise<Item[]> {
  const [row] = await db
    .select({ content: editions.content })
    .from(editions)
    .where(eq(editions.id, editionId));
  return row!.content.items;
}

const formOf = (item: Item) =>
  item.kind === 'token' ? item.form : item.kind === 'break' ? '|' : '·';

test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2 });

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Verse Prose Tester');
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

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password).fill(password);
  await page.getByRole('button', { name: s.auth.logInAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function openReader(page: Page) {
  await page.goto(`/editions/${EDITION}?draft=1`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.reader .line').first()).toBeVisible();
}

async function openEditor(page: Page) {
  await page.goto(`/editions/${EDITION}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function saved(page: Page) {
  await expect(page.locator('[aria-live=polite]').first()).toHaveText('Saved', { timeout: 15_000 });
}

/** Click in a word of the editor, before its letter at `offset`. */
async function clickInWord(page: Page, word: string, offset: number) {
  const point = await page.evaluate(
    ({ word, offset }) => {
      const walker = document.createTreeWalker(
        document.querySelector('.cm-content')!,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent !== word) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + 1, y: box.top + box.height / 2 };
      }
      return null;
    },
    { word, offset },
  );
  if (!point) throw new Error(`no word ${word} in the editor`);
  await page.mouse.click(point.x, point.y);
}

test('draws a hyphen where a shown line divides a word, and runs a prose paragraph on, in the reader', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await signIn(page);
  await openReader(page);

  // Nine lines: the first paragraph's five, the prose paragraph's one, the last paragraph's three.
  const lines = page.locator('.reader .line');
  await expect(lines).toHaveCount(9);
  await expect(page.locator('.reader .line.prose')).toHaveCount(1);
  // A hyphen at the end of the lines that divide a word (ana- stasis across a segment, kap- pa within one), and none in prose.
  await expect(page.locator('.reader .line.verse .hyphen')).toHaveCount(2);
  await expect(page.locator('.reader .line.prose .hyphen')).toHaveCount(0);
  const first = page.locator('.reader [data-line="1"]');
  await expect(first).toContainText('delta epsilon ana');
  await expect(first.locator('.hyphen')).toHaveCount(1);
  expect(
    await first.evaluate((el) => getComputedStyle(el.querySelector('.hyphen')!, '::after').content),
  ).toBe('"-"');
  // The hyphen is drawn: copying the line does not take it.
  expect((await first.innerText()).replace(/\s+/g, ' ').trim()).not.toContain('ana-');

  // The prose paragraph is one line: the word divided inside it is one word, every segment is labelled where it begins.
  const prose = page.locator('.reader .line.prose');
  const text = (await prose.locator('.words').innerText()).replace(/\s+/g, ' ').trim();
  expect(text).toMatch(/^nu xi omicron 1\.6\s*pi rho megalon sigma 1\.7\s*tau upsilon phi$/);
  await expect(prose.locator('.inline-label')).toHaveCount(2);
  await expect(prose.locator('.label')).toContainText('1.5');
  // No hanging indent where lines run on.
  await expect(prose.locator('.words')).toHaveCSS('text-indent', '0px');
  await expect(page.locator('.reader .line.verse .words').first()).not.toHaveCSS(
    'text-indent',
    '0px',
  );

  await page.screenshot({ path: `${SHOTS}/reader-verse-prose-verse.png`, fullPage: true });
  await page
    .locator('.reader .text-root')
    .screenshot({ path: `${SHOTS}/reader-hyphen-in-verse-none-in-prose.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/reader-phone.png`, fullPage: true });
});

test('shows the history of the edition with the prose paragraph run on and a hyphen only where a shown line ends inside a word', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await signIn(page);
  await openEditor(page);
  await page.getByRole('tab', { name: ed.workspace.history }).click();
  // The text as the first save made it, with its changes marked: every word and break is an addition.
  await page.locator('[data-history-entry]').first().click();
  const text = page.getByRole('region', { name: /^The text at version/ });
  await expect(text).toBeVisible();
  await expect(text.locator('[data-lineation="verse"]')).toHaveCount(8);
  const prose = text.locator('[data-lineation="prose"]');
  await expect(prose).toHaveCount(1);
  // The words the line ends divide have a hyphen, in verse only: ana- across two segments, kap- within one.
  await expect(text.locator('[data-lineation="verse"] .hyphen')).toHaveCount(2);
  await expect(prose.locator('.hyphen')).toHaveCount(0);
  // The prose runs on: the stored lines are not shown, and the divided word is one word, with the label of each segment in the run.
  const run = await prose.locator('p').evaluate((p) => {
    const copy = p.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll('.sr-only, .seg-label')) hidden.remove();
    return (copy.textContent ?? '').replaceAll('¶', '').replace(/\s+/g, ' ').trim();
  });
  expect(run).toBe('nu xi omicron pi rho megalon sigma tau upsilon phi');
  await expect(prose.locator('.seg-label')).toHaveText(['1.6', '1.7']);
  await expect(prose.locator(':scope > span').first()).toHaveText('1.5');
  await page.screenshot({ path: `${SHOTS}/history-verse-prose.png` });
});

test('shows a prose paragraph of the edition as one line in the editor, where Enter makes a paragraph', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await signIn(page);
  await openEditor(page);

  // Twelve lines of the text, the four of the prose paragraph being one on the screen.
  const lines = page.locator('.cm-content .cm-line');
  await expect(lines).toHaveCount(9);
  const prose = lines.nth(5);
  await expect(prose).toContainText('nu xi omicron');
  await expect(prose).toContainText('pi rho megalon sigma');
  await expect(prose).toContainText('tau upsilon phi');
  // The words of a divided word are one word on the screen, with no hyphen; the verse lines have theirs.
  await expect(page.locator('.cm-join-hyphen')).toHaveCount(2);
  await expect(prose.locator('.cm-join-hyphen')).toHaveCount(0);
  // A segment begins where its label stands, in the text, in prose.
  await expect(prose.locator('.cm-segment-inline')).toHaveCount(2);

  await page.screenshot({ path: `${SHOTS}/editor-verse-prose-verse.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/editor-phone.png` });
  await page.setViewportSize({ width: 1300, height: 900 });

  // The caret passes a line break that is not shown as it passes a space: one key from the end of a word to the start of the next.
  await clickInWord(page, 'omicron', 6);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await expect(prose).toContainText(/omicron\s*1\.6\s*Xpi/);
  await page.keyboard.press('Backspace');
  await expect(prose).toContainText(/omicron\s*1\.6\s*pi/);
  await saved(page);

  // Enter in prose makes a new paragraph, of the kind this one is marked as, where the line break stood.
  await clickInWord(page, 'sigma', 4);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await saved(page);
  const breaks = (await stored()).filter(
    (item): item is Break => item.kind === 'break' && item.type === 'paragraph',
  );
  expect(breaks.map((b) => b.lineation)).toEqual(['prose', 'prose', undefined]);
  await page.keyboard.press('Backspace');
  await saved(page);
  expect(
    (await stored()).filter((item) => item.kind === 'break' && item.type === 'paragraph'),
  ).toHaveLength(2);
});

test('divides a word where Enter is pressed inside it, and puts it together again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await signIn(page);
  await openEditor(page);
  const lines = page.locator('.cm-content .cm-line');
  await expect(page.locator('.cm-join-hyphen')).toHaveCount(2);

  // Enter inside epsilon: two parts, drawn with the hyphen, on two lines.
  await clickInWord(page, 'epsilon', 3);
  await page.keyboard.press('Enter');
  await saved(page);
  await expect(lines).toHaveCount(10);
  await expect(page.locator('.cm-join-hyphen')).toHaveCount(3);
  await expect(lines.nth(1)).toContainText('delta eps');
  await expect(lines.nth(2)).toContainText('ilon ana');
  const divided = await stored();
  const at = divided.findIndex((item) => item.kind === 'token' && item.form === 'eps');
  expect(divided.slice(at, at + 4).map(formOf)).toEqual(['eps', '|', 'ilon', 'ana']);
  expect((divided[at] as Token).joinNext).toBe(true);
  // The word has not changed its segment, and no witness is credited with an emendation.
  expect((divided[at] as Token).source?.kind).toBe('witness');
  expect((divided[at + 2] as Token).segment).toBeUndefined();
  await page.screenshot({ path: `${SHOTS}/editor-word-divided.png` });

  // Backspace at the start of the line: the word is whole, in one token.
  await page.keyboard.press('Backspace');
  await saved(page);
  await expect(lines).toHaveCount(9);
  await expect(page.locator('.cm-join-hyphen')).toHaveCount(2);
  await expect(lines.nth(1)).toContainText('delta epsilon ana');
  const whole = await stored();
  const word = whole.find((item) => item.kind === 'token' && item.form === 'epsilon') as Token;
  expect(word.joinNext).toBeUndefined();
  expect(whole.filter((item) => item.kind === 'token' && item.form === 'ilon')).toHaveLength(0);

  // Joining the lines where a segment begins on the second part: two joined words, no hyphen, one word on the screen.
  await clickInWord(page, 'stasis', 0);
  await page.keyboard.press('Backspace');
  await saved(page);
  await expect(page.locator('.cm-join-hyphen')).toHaveCount(1);
  await expect(lines.nth(1)).toHaveText(/delta epsilon ana\s*1\.3\s*stasis eta theta/);
  const joined = await stored();
  const ana = joined.findIndex((item) => item.kind === 'token' && item.form === 'ana');
  expect(joined.slice(ana, ana + 2).map(formOf)).toEqual(['ana', 'stasis']);
  expect((joined[ana] as Token).joinNext).toBe(true);
  expect((joined[ana + 1] as Token).segment).toBeDefined();
  // In the reader the word is one word and no line ends in it.
  await page.goto(`/editions/${EDITION}?draft=1`);
  await expect(page.locator('.reader .line').first()).toBeVisible();
  await expect(page.locator('.reader')).toContainText('delta epsilon anastasis eta theta');
  await expect(page.locator('.reader .line.verse .hyphen')).toHaveCount(1);
});

test('marks a paragraph as prose in the editor, and the reader runs it on', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await signIn(page);
  await openEditor(page);
  const lines = page.locator('.cm-content .cm-line');
  const count = await lines.count();

  // The last paragraph is verse, of the edition's own convention: Prose marks it.
  await clickInWord(page, 'virumque', 2);
  await page.getByRole('button', { name: ed.dialogs.paragraph.menu }).click();
  await expect(page.getByRole('menuitem', { name: ed.dialogs.paragraph.verse })).toBeDisabled();
  await page.getByRole('menuitem', { name: ed.dialogs.paragraph.prose }).click();
  await saved(page);
  // Its three lines are one.
  await expect(lines).toHaveCount(count - 2);
  await expect(lines.last()).toContainText('chi psi omega');
  await expect(lines.last()).toContainText('troiae qui primus');
  const marked = (await stored()).filter(
    (item): item is Break => item.kind === 'break' && item.type === 'paragraph',
  );
  expect(marked.map((b) => b.lineation)).toEqual(['prose', 'prose']);

  await page.goto(`/editions/${EDITION}?draft=1`);
  await expect(page.locator('.reader .line').first()).toBeVisible();
  await expect(page.locator('.reader .line.prose')).toHaveCount(2);
  const last = page.locator('.reader .line.prose').last();
  expect((await last.locator('.words').innerText()).replace(/\s+/g, ' ').trim()).toMatch(
    /^chi psi omega 1\.9\s*arma virumque cano 1\.10\s*troiae qui primus$/,
  );
  await page.screenshot({ path: `${SHOTS}/reader-two-prose-paragraphs.png`, fullPage: true });

  // And back: Verse takes the mark off the same break.
  await openEditor(page);
  await clickInWord(page, 'virumque', 2);
  await page.getByRole('button', { name: ed.dialogs.paragraph.menu }).click();
  await page.getByRole('menuitem', { name: ed.dialogs.paragraph.verse }).click();
  await saved(page);
  await expect(lines).toHaveCount(count);
  await page.screenshot({ path: `${SHOTS}/editor-verse-prose-verse-again.png` });
});
