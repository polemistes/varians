/**
 * Passages in the reader and the editor: a variant whose words lie on either
 * side of a boundary is one variant, labelled by both segments; a word a
 * witness divides across a boundary is no variant; and a segment the edition
 * does not print is the variant at the point after the segment it follows.
 * The edition is made here, in two witnesses:
 *
 * - A has the text as the edition prints it, divides μυρία across 1.2 and
 *   1.3, and has 1.4, which the edition does not print;
 * - B reads Πηλείδεω Ἀχιλλῆος across 1.1 and 1.2, and has no 1.4.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { SCHEME_PRESETS, defaultProfile, newId, type Item, type Stream } from '@varians/core';
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
import { reader as rd } from '../src/lib/strings/reader';
import { s } from '../src/lib/strings/en';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `passages-${stamp}@example.org`;
const password = 'a long enough password';
const WORK = `passages-work-${stamp}`;
const EDITION = `passages-edition-${stamp}`;
const SLUGS = ['a', 'b'].map((x) => `passages-${x}-${stamp}`);
// Where the screenshots are written: Playwright's own folder of results, which is not tracked.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/passages';
const LABELS = ['1.1', '1.2', '1.3', '1.4', '1.5'];

let db: Database;
let pool: ReturnType<typeof createDatabase>['pool'];

/**
 * A stream from lines: `1.1: a b`, a line that begins the segment 1.1; a
 * word ending in `-` is divided, its next part beginning the next line.
 */
function streamOf(segmentIdOf: (label: string) => string, ...lines: string[]): Stream {
  const items: Item[] = [];
  lines.forEach((line, k) => {
    if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
    const [label, text] = line.split(': ') as [string, string];
    text
      .split(/\s+/u)
      .filter(Boolean)
      .forEach((word, w) => {
        const joins = word.endsWith('-');
        items.push({
          kind: 'token',
          id: newId(),
          form: joins ? word.slice(0, -1) : word,
          ...(joins ? { joinNext: true } : {}),
          ...(w === 0 && label ? { segment: { segmentId: segmentIdOf(label) } } : {}),
        });
      });
  });
  return { items };
}

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
    title: 'Passages',
    language: 'grc',
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), LABELS);
  const stream = (...lines: string[]) => streamOf((l) => segments.get(l)!.id, ...lines);
  const texts: [string, string, Stream][] = [
    [
      'A',
      'Venetus A',
      stream(
        '1.1: μῆνιν ἄειδε θεὰ Πηληϊάδεω',
        '1.2: Ἀχιλῆος οὐλομένην ἣ μυ-',
        '1.3: ρία Ἀχαιοῖς ἄλγε᾽ ἔθηκε',
        '1.4: πολλὰς δ᾽ ἰφθίμους',
        '1.5: ψυχὰς Ἄϊδι προΐαψεν',
      ),
    ],
    [
      'B',
      'Venetus B',
      stream(
        '1.1: μῆνιν ἄειδε θεὰ Πηλείδεω',
        '1.2: Ἀχιλλῆος οὐλομένην ἣ μυρία',
        '1.3: Ἀχαιοῖς ἄλγε᾽ ἔθηκε',
        '1.5: ψυχὰς Ἄϊδι προΐαψεν',
      ),
    ],
  ];
  const sigla: { witnessId: string; transcriptionId: string; siglum: string }[] = [];
  for (const [k, [siglum, name, content]] of texts.entries()) {
    const witnessId = newId();
    await db.insert(witnesses).values({
      id: witnessId,
      slug: SLUGS[k]!,
      siglum,
      name,
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
    await replaceContent(db, 'transcription', transcriptionId, userId, 0, content, 'seed');
    sigla.push({ witnessId, transcriptionId, siglum });
  }
  const editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: EDITION,
    title: 'Passages, an edition',
    editors: ['Editor'],
    ownerId: userId,
    conventions: DEFAULT_CONVENTIONS,
  });
  await replaceContent(
    db,
    'edition',
    editionId,
    userId,
    0,
    stream(
      '1.1: μῆνιν ἄειδε θεὰ Πηληϊάδεω',
      '1.2: Ἀχιλῆος οὐλομένην ἣ μυρία',
      '1.3: Ἀχαιοῖς ἄλγε᾽ ἔθηκε',
      '1.5: ψυχὰς Ἄϊδι προΐαψεν',
    ),
    'start',
  );
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

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const page = await browser.newPage();
  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Passages Tester');
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

/** A word of the reader's text. */
const word = (page: Page, text: string) =>
  page.locator('.reader [data-token]').filter({ hasText: new RegExp(`^${text}[,.·]?$`) });

test('the reader marks a variant across a boundary on its words in both segments, and labels it by both', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await signIn(page);
  await page.goto(`/editions/${EDITION}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.reader [data-sites][role="button"]').first()).toBeVisible();

  // The words on either side of the boundary between 1.1 and 1.2 open one variant.
  const first = word(page, 'Πηληϊάδεω');
  const second = word(page, 'Ἀχιλῆος');
  await expect(first).toHaveAttribute('data-sites', /.+/);
  const key = await first.getAttribute('data-sites');
  await expect(second).toHaveAttribute('data-sites', key!);
  // A word A divides across 1.2 and 1.3 is one word, as the others have it: no variant.
  await expect(word(page, 'μυρία')).not.toHaveAttribute('data-sites', /.+/);

  await first.click();
  const window = page.getByRole('dialog', { name: rd.entry.title('1.1–1.2') });
  await expect(window).toBeVisible();
  await expect(window).toContainText('Πηλείδεω Ἀχιλλῆος');
  // Its permalink goes to its first segment.
  await expect(window.getByRole('link', { name: rd.text.permalink('1.1–1.2') })).toHaveAttribute(
    'href',
    new RegExp(`/editions/${EDITION}/1\\.1$`),
  );
  await page.screenshot({ path: `${SHOTS}/reader-across.png` });
  await page.keyboard.press('Escape');

  // The segment the edition does not print is marked between 1.3 and 1.5.
  const mark = page
    .locator('.reader .mm[role="button"]')
    .and(page.getByLabel(rd.variant.pointAfter('1.3'), { exact: true }));
  await expect(mark).toHaveCount(1);
  await mark.click();
  const unprinted = page.getByRole('dialog', { name: rd.entry.title('1.4') });
  await expect(unprinted).toBeVisible();
  await expect(unprinted).toContainText(`${rd.variant.after} 1.3`);
  await expect(unprinted).toContainText('πολλὰς δ᾽ ἰφθίμους');
  await page.screenshot({ path: `${SHOTS}/reader-unprinted.png` });
});

test('the editor lists a variant across a boundary in the section of the segment where it begins, labelled by both', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await signIn(page);
  await page.goto(`/editions/${EDITION}/edit`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const band = page.locator('.apparatus-band');
  const section = (label: string) =>
    band.locator('section').filter({
      has: page.locator('h3', { hasText: new RegExp(`^${label.replace('.', '\\.')}$`) }),
    });
  await expect(section('1.1').locator('.entry')).toHaveCount(1);
  await expect(section('1.1').locator('.entry')).toContainText('1.1–1.2');
  await expect(section('1.1').locator('.entry')).toContainText('Πηλείδεω Ἀχιλλῆος');
  // Nothing in 1.2 or 1.3: the divided word is no variant, and the variant is listed once.
  await expect(section('1.2').locator('.entry')).toHaveCount(0);
  await expect(section('1.3').locator('.entry')).toHaveCount(0);
  // 1.2, whose first word is in the variant, names it and does not say the witnesses agree.
  await expect(section('1.2')).toContainText(ed.variantAt('1.1–1.2'));
  await expect(section('1.2')).not.toContainText(ed.noSites);
  await expect(section('1.3')).toContainText(ed.noSites);
  // Its words are dotted in both segments.
  const dotted = page.locator('.cm-content .vs-site');
  await expect(dotted).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/editor-across.png` });

  // The segment the edition does not print: its mark in the margin, its section after 1.3.
  const mark = page.getByTitle(ed.notPrinted('1.4'), { exact: true });
  await expect(mark).toBeVisible();
  await expect(section('1.4')).toHaveAttribute('data-unprinted', '');
  await expect(section('1.4').locator('.entry')).toContainText('πολλὰς δ᾽ ἰφθίμους');
  await mark.click();
  await expect(mark).toHaveClass(/cm-margin-mark-active/);
  // Its entry is the active one, and the witness beside the text shows the line.
  await expect(section('1.4').locator('.entry[data-active]')).toHaveCount(1);
  await expect(page.locator('aside')).toContainText('πολλὰς δ᾽ ἰφθίμους');
  await section('1.4').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/editor-unprinted.png` });
});
