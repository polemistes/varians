/**
 * Every kind of record has the one menu beside its name that an edition has,
 * and nothing is deleted or removed without the application's own window
 * asking first. A work and a witness have Edit and a menu on their pages and
 * in lists (and a work is refused deletion, with a reason that names no
 * draft of another person, until nothing depends on it); a transcript has
 * the same menu in the workbench and in every list it stands in, and Settings
 * from a list opens the workbench with its window; a conjecture, a reported
 * reading and a bibliography entry have Edit and Delete in their rows; a
 * note, a maintainer, a remote and a token are removed only after the window.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { SCHEME_PRESETS, fromText, newId, type Item, type Stream, type Token } from '@varians/core';
import {
  conjectures,
  createDatabase,
  editionSigla,
  editions,
  notes,
  referenceSchemes,
  reportedReadings,
  transcriptions,
  users,
  witnesses,
  workMaintainers,
  workRemotes,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { bibStrings } from '../src/lib/strings/bibliography';
import { recordActions as ra } from '../src/lib/strings/record-actions';
import { registry as reg } from '../src/lib/strings/registry';
import { workbench as w } from '../src/lib/strings/workbench';
import { site } from '../src/lib/strings/site';
import { replaceContent } from '../src/lib/server/documents/service.ts';
import { publishEdition } from '../src/lib/server/publish.ts';
import { DEFAULT_CONVENTIONS } from '../src/lib/server/seed/sample.ts';
import { resolveLabels, schemeOfWork } from '../src/lib/server/segments.ts';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const password = 'a long enough password';
const OWNER = { name: 'Owner of Records', email: `menus-owner-${stamp}@example.org` };
const OTHER = { name: 'Another Person', email: `menus-other-${stamp}@example.org` };
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots/record-menus';

const WORK = {
  slug: `menus-work-${stamp}`,
  title: `Aeneis ${stamp}`,
  author: `Aaa Menus ${stamp}`,
};
const DOOMED_WORK = { slug: `menus-doomed-${stamp}`, title: `Doomed work ${stamp}` };
const WITNESS = {
  slug: `menus-witness-${stamp}`,
  siglum: 'M',
  name: `Aaa Codex M ${stamp}`,
};
const DOOMED_WITNESS = { slug: `menus-doomed-witness-${stamp}`, name: `Doomed witness ${stamp}` };
const BOOK = `Book 1 ${stamp}`;
const SPARE = `Spare transcript ${stamp}`;
const SECOND = `Second transcript ${stamp}`;
const DRAFT = { slug: `menus-draft-${stamp}`, title: `Liber secundus ${stamp}` };
const PUBLISHED = { slug: `menus-published-${stamp}`, title: `Liber primus ${stamp}` };
const THEIR_OPEN = { slug: `menus-open-${stamp}`, title: `Open edition ${stamp}` };
const THEIR_SECRET = { slug: `menus-secret-${stamp}`, title: `Secret draft ${stamp}` };
const NOTE = `A note on the first line ${stamp}`;
const LINES: Record<string, string> = {
  '1.1': 'arma virumque cano',
  '1.2': 'Troiae qui primus ab oris',
  '1.3': 'Italiam fato profugus',
};

/** The menu of a transcript, for its owner, wherever it stands. */
const TRANSCRIPTION_MENU = [
  ra.transcription.settings,
  ra.transcription.copy,
  ra.transcription.tei,
  ra.transcription.leiden,
  ra.transcription.delete,
];

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
  // An item that cannot be done now says why under its label: the label is the first line.
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map(
    (t) => t.trim().split('\n')[0]!,
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  return items;
}

/** The menu of the record whose own page this is: its name is `Actions`. */
const ownMenu = (page: Page) => page.getByRole('button', { name: ra.menu, exact: true });

/**
 * A screenshot, with the fade of a menu or a window finished. A window is
 * taken as the viewport shows it; the rest as whole pages, or a strip of the top.
 */
async function shot(page: Page, name: string, options: { clip?: boolean; window?: boolean } = {}) {
  await page.screenshot({
    path: `${SHOTS}/${name}.png`,
    animations: 'disabled',
    ...(options.clip
      ? { clip: { x: 0, y: 0, width: 1500, height: 420 } }
      : { fullPage: !options.window }),
  });
}

/** A work with one witness, three transcripts, two editions of the owner's, and the records the menus act on. */
async function build(ownerId: string, otherId: string) {
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: SCHEME_PRESETS[0]!.name,
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: ownerId,
  });
  const work = (id: string, slug: string, title: string, author: string | null) =>
    db.insert(works).values({
      id,
      slug,
      title,
      author,
      schemeId,
      createdBy: ownerId,
    });
  ids.work = newId();
  ids.doomedWork = newId();
  await work(ids.work, WORK.slug, WORK.title, WORK.author);
  await work(ids.doomedWork, DOOMED_WORK.slug, DOOMED_WORK.title, null);
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
  ids.doomedWitness = newId();
  await db.insert(witnesses).values([
    {
      id: ids.witness,
      slug: WITNESS.slug,
      siglum: WITNESS.siglum,
      name: WITNESS.name,
      createdBy: ownerId,
    },
    {
      id: ids.doomedWitness,
      slug: DOOMED_WITNESS.slug,
      siglum: 'D',
      name: DOOMED_WITNESS.name,
      createdBy: ownerId,
    },
  ]);

  // The three transcripts of the owner's: Book 1 is named by both editions; the others are free.
  for (const [key, name] of [
    ['book', BOOK],
    ['spare', SPARE],
    ['second', SECOND],
  ] as const) {
    ids[key] = newId();
    await db.insert(transcriptions).values({
      id: ids[key],
      witnessId: ids.witness,
      name,
      ownerId,
      keepsWrittenForm: false,
    });
    await replaceContent(db, 'transcription', ids[key], ownerId, 0, stream(), 'seed');
  }

  const edition = async (
    id: string,
    slug: string,
    title: string,
    workId: string,
    owner: string,
    published: boolean,
    naming: boolean,
  ) => {
    await db.insert(editions).values({
      id,
      workId,
      slug,
      title,
      ownerId: owner,
      conventions: DEFAULT_CONVENTIONS,
    });
    if (naming)
      await db.insert(editionSigla).values({
        editionId: id,
        witnessId: ids.witness,
        transcriptionId: ids.book,
        siglum: 'M',
        position: 0,
      });
    if (workId === ids.work) await replaceContent(db, 'edition', id, owner, 0, stream(), 'seed');
    if (published) await publishEdition(db, id, owner);
  };
  ids.draft = newId();
  ids.published = newId();
  ids.theirOpen = newId();
  ids.theirSecret = newId();
  await edition(ids.draft, DRAFT.slug, DRAFT.title, ids.work, ownerId, false, true);
  await edition(ids.published, PUBLISHED.slug, PUBLISHED.title, ids.work, ownerId, true, true);
  await edition(
    ids.theirOpen,
    THEIR_OPEN.slug,
    THEIR_OPEN.title,
    ids.doomedWork,
    otherId,
    true,
    false,
  );
  await edition(
    ids.theirSecret,
    THEIR_SECRET.slug,
    THEIR_SECRET.title,
    ids.doomedWork,
    otherId,
    false,
    false,
  );

  // Records on the work, in rows with a menu.
  const conjecture = (key: string, lemma: string, reading: string, label: string) => {
    ids[key] = newId();
    return db.insert(conjectures).values({
      id: ids[key],
      workId: ids.work,
      segmentId: segments.get(label)!.id,
      kind: 'substitution',
      lemma,
      reading,
      ownerId,
    });
  };
  await conjecture('conjectureA', 'virumque', 'viroque', '1.1');
  await conjecture('conjectureB', 'primus', 'primum', '1.2');
  const reading = (key: string, lemma: string, text: string, label: string) => {
    ids[key] = newId();
    return db.insert(reportedReadings).values({
      id: ids[key],
      workId: ids.work,
      segmentId: segments.get(label)!.id,
      witnessId: ids.witness,
      lemma,
      reading: text,
      source: 'Apparatus of Probus',
      ownerId,
    });
  };
  await reading('readingA', 'arma', 'armo', '1.1');
  await reading('readingB', 'cano', 'canto', '1.1');
  await reading('readingC', 'fato', 'fatu', '1.3');

  // A note of the draft edition, a maintainer and a remote of the work.
  await db.insert(notes).values({
    id: newId(),
    editionId: ids.draft,
    segmentId: segments.get('1.1')!.id,
    tokenIds: [],
    text: NOTE,
    authorId: ownerId,
  });
  await db.insert(workMaintainers).values({ workId: ids.work, userId: otherId });
  await db.insert(workRemotes).values({
    id: newId(),
    workId: ids.work,
    origin: 'https://example.org',
    remoteWorkId: 'remote-work',
    remoteSlug: `aeneis-${stamp}`,
  });
}

async function cleanUp() {
  await db.delete(works).where(inArray(works.slug, [WORK.slug, DOOMED_WORK.slug]));
  await db.delete(witnesses).where(inArray(witnesses.slug, [WITNESS.slug, DOOMED_WITNESS.slug]));
  for (const who of [OWNER, OTHER]) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, who.email));
    if (user) {
      await db.delete(transcriptions).where(eq(transcriptions.ownerId, user.id));
      await db.delete(editions).where(eq(editions.ownerId, user.id));
      await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
    }
    await db.delete(users).where(eq(users.email, who.email));
  }
}

test.beforeAll(async ({ browser }) => {
  ({ db, pool } = createDatabase(DATABASE_URL));
  const ownerId = await register(browser, OWNER);
  const otherId = await register(browser, OTHER);
  await build(ownerId, otherId);
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  await cleanUp();
  await pool.end();
});

test('a work has Edit and one menu beside its name, and its sections hold what is made of it', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/works/${WORK.slug}`);
  await page.waitForLoadState('networkidle');

  // Beside the name: Edit and the menu; nothing that makes a record beside it.
  const header = page.locator('header').filter({ has: page.locator('h1') });
  await expect(header.getByRole('link', { name: ra.work.edit, exact: true })).toHaveAttribute(
    'href',
    `/works/${WORK.slug}/edit`,
  );
  await expect(header.getByRole('link', { name: reg.work.newEdition })).toHaveCount(0);
  await expect(header.getByRole('button', { name: reg.work.transcribe })).toHaveCount(0);
  expect(await menuOf(page, ownMenu(page))).toEqual([
    ra.work.remotes,
    ra.work.package,
    ra.work.merge,
    ra.work.delete,
  ]);

  // The sections that list editions and transcripts make them.
  const editionsSection = page.getByRole('region', { name: new RegExp(`^${reg.work.editions}`) });
  await expect(editionsSection.getByRole('link', { name: reg.work.newEdition })).toHaveAttribute(
    'href',
    `/editions/new?work=${WORK.slug}`,
  );
  const transcripts = page.getByRole('region', { name: new RegExp(`^${reg.work.witnesses}`) });
  await expect(transcripts.getByRole('button', { name: reg.work.transcribe })).toBeVisible();

  await ownMenu(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await shot(page, '1-work-page-menu');
  await page.keyboard.press('Escape');

  // Merge and Delete are in the menu, not at the foot of the Edit page.
  await page.goto(`/works/${WORK.slug}/edit`);
  await expect(page.getByRole('heading', { name: 'Maintainers' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Merge/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a work is refused deletion with a reason that names no draft of another person, then deleted through the window', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/works/${DOOMED_WORK.slug}`);
  await page.waitForLoadState('networkidle');
  await ownMenu(page).click();
  const remove = page.getByRole('menuitem', { name: new RegExp(ra.work.delete) });
  await expect(remove).toHaveAttribute('data-disabled', '');
  await expect(remove).toContainText(THEIR_OPEN.title);
  await expect(remove).toContainText('another edition that is not published');
  await expect(remove).not.toContainText(THEIR_SECRET.title);
  await expect(remove).not.toContainText(OTHER.name);
  await shot(page, '2-work-delete-disabled');
  await page.keyboard.press('Escape');

  // Once nothing depends on it, the item works, and asks first.
  await db.delete(editions).where(inArray(editions.id, [ids.theirOpen!, ids.theirSecret!]));
  await page.goto(`/works/${DOOMED_WORK.slug}`);
  await page.waitForLoadState('networkidle');
  await ownMenu(page).click();
  await page.getByRole('menuitem', { name: ra.work.delete }).click();
  const window = page.getByRole('dialog', { name: ra.work.deleteTitle });
  await expect(window).toContainText(ra.work.deleteBody);
  await shot(page, '3-confirm-delete', { window: true });
  await window.getByRole('button', { name: ra.cancel }).click();
  await expect(window).toBeHidden();
  expect(await db.select().from(works).where(eq(works.id, ids.doomedWork!))).toHaveLength(1);

  await ownMenu(page).click();
  await page.getByRole('menuitem', { name: ra.work.delete }).click();
  await window.getByRole('button', { name: ra.work.deleteVerb, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
  expect(await db.select().from(works).where(eq(works.id, ids.doomedWork!))).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('the Works list and search give those who may change a work Edit and the menu, and others nothing', async ({
  page,
  browser,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/works');
  await page.waitForLoadState('networkidle');
  await shot(page, '4-works-list');
  await page.goto(`/search?q=${stamp}`);
  await page.waitForLoadState('networkidle');
  const row = page
    .getByRole('region', { name: /^Works/ })
    .locator('li')
    .filter({ hasText: WORK.title });
  await expect(row.getByRole('link', { name: ra.work.editOf(WORK.title) })).toHaveAttribute(
    'href',
    `/works/${WORK.slug}/edit`,
  );
  expect(await menuOf(page, row.getByRole('button', { name: ra.menuOf(WORK.title) }))).toEqual([
    ra.work.remotes,
    ra.work.package,
    ra.work.merge,
    ra.work.delete,
  ]);
  // The name still leads to the work.
  await expect(row.locator(`a[href="/works/${WORK.slug}"]`)).toBeVisible();

  // Another person, who maintains nothing: no Edit and no menu in the list; the package on the page.
  const other = await browser.newPage();
  const otherErrors = watch(other);
  await signIn(other, OTHER);
  await other.goto(`/search?q=${stamp}`);
  await other.waitForLoadState('networkidle');
  // OTHER is a maintainer of the work (see build), but not of the witness.
  await expect(
    other
      .locator('li')
      .filter({ hasText: WITNESS.name })
      .getByRole('button', { name: /^Actions/ }),
  ).toHaveCount(0);
  await expect(
    other
      .getByRole('region', { name: /^Witnesses/ })
      .locator('li')
      .filter({ hasText: WITNESS.name })
      .getByRole('link', { name: /^Edit/ }),
  ).toHaveCount(0);
  await other.goto(`/witnesses/${WITNESS.slug}`);
  await other.waitForLoadState('networkidle');
  await expect(ownMenu(other)).toHaveCount(0);
  await expect(other.getByRole('link', { name: ra.witness.edit, exact: true })).toHaveCount(0);
  await other.close();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('a witness has Edit and Merge into and Delete Witness in its menu, which says why it cannot be deleted', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/witnesses/${WITNESS.slug}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: ra.witness.edit, exact: true })).toBeVisible();
  expect(await menuOf(page, ownMenu(page))).toEqual([ra.witness.merge, ra.witness.delete]);
  await ownMenu(page).click();
  const remove = page.getByRole('menuitem', { name: new RegExp(ra.witness.delete) });
  await expect(remove).toHaveAttribute('data-disabled', '');
  await expect(remove).toContainText(DRAFT.title);
  await shot(page, '5-witness-page');
  await page.keyboard.press('Escape');

  // Make New Transcript and Manage Pages stand in their sections' headings.
  await expect(
    page
      .getByRole('region', { name: new RegExp(`^${reg.witness.transcriptions}`) })
      .getByRole('button', {
        name: reg.witness.newTranscription,
      }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: new RegExp(`^${reg.witness.pages}`) }).getByRole('link', {
      name: reg.witness.managePages,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a witness is deleted from a list through the window, and stays there', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/search?q=${stamp}`);
  await page.waitForLoadState('networkidle');
  const row = page
    .getByRole('region', { name: /^Witnesses/ })
    .locator('li')
    .filter({ hasText: DOOMED_WITNESS.name });
  await row.getByRole('button', { name: ra.menuOf(DOOMED_WITNESS.name) }).click();
  await page.getByRole('menuitem', { name: ra.witness.delete }).click();
  const window = page.getByRole('dialog', { name: ra.witness.deleteTitle });
  await expect(window).toContainText(ra.witness.deleteBody);
  await window.getByRole('button', { name: ra.witness.deleteVerb, exact: true }).click();
  await expect(page.getByText(ra.witness.deleted(DOOMED_WITNESS.name))).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page).toHaveURL(/\/search\?q=/);
  expect(await db.select().from(witnesses).where(eq(witnesses.id, ids.doomedWitness!))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a transcript has the same menu in the workbench, on a witness and a work, on Your Work and on Continue', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);

  // The workbench: the transcript's menu; its tools are in the Tools menu and its view in the header.
  await page.goto(`/transcriptions/${ids.book}`);
  await page.locator('.cm-content').waitFor();
  await page.waitForLoadState('networkidle');
  expect(await menuOf(page, ownMenu(page))).toEqual(TRANSCRIPTION_MENU);
  await expect(page.getByRole('button', { name: w.menu.paneLeft })).toBeVisible();
  await expect(page.getByRole('button', { name: w.menu.togglePane })).toBeVisible();
  await page.getByRole('button', { name: w.tools.label, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: w.tools.import })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: w.tools.numberLines })).toBeVisible();
  await page.keyboard.press('Escape');
  await ownMenu(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await shot(page, '6-workbench-header-menu', { clip: true });
  await page.keyboard.press('Escape');

  // The rows of a witness's page and of a work's page.
  await page.goto(`/witnesses/${WITNESS.slug}`);
  await page.waitForLoadState('networkidle');
  const onWitness = page.locator('main li').filter({ hasText: BOOK });
  expect(await menuOf(page, onWitness.getByRole('button', { name: ra.menuOf(BOOK) }))).toEqual(
    TRANSCRIPTION_MENU,
  );
  await page.goto(`/works/${WORK.slug}`);
  await page.waitForLoadState('networkidle');
  const onWork = page.locator('main li').filter({ hasText: BOOK });
  expect(await menuOf(page, onWork.getByRole('button', { name: ra.menuOf(BOOK) }))).toEqual(
    TRANSCRIPTION_MENU,
  );

  // Your Work, own transcripts.
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  await shot(page, '7-your-work');
  const onMine = page.locator('main li').filter({ hasText: BOOK });
  expect(await menuOf(page, onMine.getByRole('button', { name: ra.menuOf(BOOK) }))).toEqual(
    TRANSCRIPTION_MENU,
  );

  // The front page: a transcript's card under Continue, with its date in line with an edition's.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const continued = page.getByRole('region', { name: site.home.continue });
  await shot(page, '8-front-page');
  const cards = continued.locator('article');
  const transcriptCard = cards.filter({ hasText: site.home.transcription }).first();
  await expect(transcriptCard).toBeVisible();
  const name = (await transcriptCard.locator('a').first().innerText()).trim();
  expect(await menuOf(page, transcriptCard.getByRole('button', { name: ra.menuOf(name) }))).toEqual(
    TRANSCRIPTION_MENU,
  );
  const editionCard = cards.filter({ hasText: site.home.edition }).first();
  if (await editionCard.count()) {
    const dateOf = async (card: Locator) =>
      (await card.getByText(site.home.changed).boundingBox())!.y;
    expect(Math.abs((await dateOf(transcriptCard)) - (await dateOf(editionCard)))).toBeLessThan(2);
  }
  expect(errors).toEqual([]);
});

test('Settings and Make a Copy from a list open the workbench with their window', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/witnesses/${WITNESS.slug}`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('main li').filter({ hasText: SECOND });
  await row.getByRole('button', { name: ra.menuOf(SECOND) }).click();
  await page.getByRole('menuitem', { name: ra.transcription.settings }).click();
  await page.waitForURL(`**/transcriptions/${ids.second}`);
  const settings = page.getByRole('dialog', { name: w.settings.title });
  await expect(settings).toBeVisible();
  await expect(settings.locator('input[name=name]')).toHaveValue(SECOND);
  // The address no longer carries the request, so a reload does not open the window again.
  await expect(page).toHaveURL(new RegExp(`/transcriptions/${ids.second}$`));
  await settings.getByRole('button', { name: w.settings.cancel }).click();

  await page.goto('/mine');
  await page.waitForLoadState('networkidle');
  await page
    .locator('li')
    .filter({ hasText: SECOND })
    .getByRole('button', { name: ra.menuOf(SECOND) })
    .click();
  await page.getByRole('menuitem', { name: ra.transcription.copy }).click();
  await page.waitForURL(`**/transcriptions/${ids.second}`);
  const copy = page.getByRole('dialog', { name: reg.copy.transcriptionTitle });
  await expect(copy).toBeVisible();
  await expect(copy.locator('input[name=name]')).toHaveValue(reg.copy.proposed(SECOND));
  expect(errors).toEqual([]);
});

test('a transcript is deleted from a list through the window; one an edition names is refused in it', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/mine');
  await page.waitForLoadState('networkidle');

  // Book 1 stands behind a siglum of two editions: the window says so.
  const book = page.locator('main li').filter({ hasText: BOOK });
  await book.getByRole('button', { name: ra.menuOf(BOOK) }).click();
  await page.getByRole('menuitem', { name: ra.transcription.delete }).click();
  const window = page.getByRole('dialog', { name: ra.transcription.deleteTitle });
  await expect(window).toContainText(ra.transcription.deleteBody);
  await window.getByRole('button', { name: ra.transcription.deleteVerb, exact: true }).click();
  await expect(window.getByRole('alert')).toContainText(DRAFT.title);
  await window.getByRole('button', { name: ra.cancel }).click();
  expect(
    await db.select().from(transcriptions).where(eq(transcriptions.id, ids.book!)),
  ).toHaveLength(1);

  // The spare one goes, and Your Work stays.
  const spare = page.locator('main li').filter({ hasText: SPARE });
  await spare.getByRole('button', { name: ra.menuOf(SPARE) }).click();
  await page.getByRole('menuitem', { name: ra.transcription.delete }).click();
  await window.getByRole('button', { name: ra.transcription.deleteVerb, exact: true }).click();
  await expect(page.getByText(ra.transcription.deleted)).toBeVisible();
  await expect(spare).toHaveCount(0);
  await expect(page).toHaveURL(/\/mine$/);
  expect(await db.select().from(transcriptions).where(eq(transcriptions.id, ids.spare!))).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});

test('a conjecture and a reported reading are edited and deleted from their rows on the work page', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/works/${WORK.slug}`);
  await page.waitForLoadState('networkidle');
  const conjectureRows = page.getByRole('region', { name: new RegExp(`^${reg.work.conjectures}`) });
  const rowOfA = conjectureRows.locator('li').filter({ hasText: 'viroque' });
  await rowOfA.getByRole('button', { name: ra.menuOf('1.1 virumque') }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await shot(page, '9-conjecture-rows-menu');
  await page.keyboard.press('Escape');
  expect(
    await menuOf(page, rowOfA.getByRole('button', { name: ra.menuOf('1.1 virumque') })),
  ).toEqual([ra.conjecture.edit, ra.conjecture.delete]);

  // Edit… first.
  await rowOfA.getByRole('button', { name: ra.menuOf('1.1 virumque') }).click();
  await page.getByRole('menuitem', { name: ra.conjecture.edit }).click();
  const edit = page.getByRole('dialog', { name: reg.conjecture.editTitle });
  await edit.getByLabel(reg.conjecture.reading, { exact: true }).fill('viroquam');
  await edit.getByRole('button', { name: reg.conjecture.save, exact: true }).click();
  await expect(page.getByText(reg.conjecture.updated)).toBeVisible();
  await expect(conjectureRows.locator('li').filter({ hasText: 'viroquam' })).toBeVisible();

  // Delete… last, through the window.
  const rowOfB = conjectureRows.locator('li').filter({ hasText: 'primum' });
  await rowOfB.getByRole('button', { name: ra.menuOf('1.2 primus') }).click();
  await page.getByRole('menuitem', { name: ra.conjecture.delete }).click();
  const window = page.getByRole('dialog', { name: ra.conjecture.deleteTitle });
  await expect(window).toContainText(ra.conjecture.deleteBody);
  await window.getByRole('button', { name: ra.cancel }).click();
  await expect(rowOfB).toHaveCount(1);
  await rowOfB.getByRole('button', { name: ra.menuOf('1.2 primus') }).click();
  await page.getByRole('menuitem', { name: ra.conjecture.delete }).click();
  await window.getByRole('button', { name: ra.conjecture.deleteVerb, exact: true }).click();
  await expect(page.getByText(ra.conjecture.deleted)).toBeVisible();
  await expect(rowOfB).toHaveCount(0);

  // The same for a reported reading.
  const readingRows = page.getByRole('region', { name: new RegExp(`^${reg.work.readings}`) });
  const rowOfRA = readingRows.locator('li').filter({ hasText: 'armo' });
  expect(
    await menuOf(
      page,
      rowOfRA.getByRole('button', { name: ra.menuOf(`1.1 ${WITNESS.siglum}`) }).first(),
    ),
  ).toEqual([ra.reading.edit, ra.reading.delete]);
  await rowOfRA.getByRole('button', { name: ra.menuOf(`1.1 ${WITNESS.siglum}`) }).click();
  await page.getByRole('menuitem', { name: ra.reading.edit }).click();
  const editReading = page.getByRole('dialog', { name: reg.reading.editTitle });
  await editReading.getByLabel(reg.reading.reading, { exact: true }).fill('armu');
  await editReading.getByRole('button', { name: reg.reading.save, exact: true }).click();
  await expect(page.getByText(reg.reading.updated)).toBeVisible();
  const rowOfRB = readingRows.locator('li').filter({ hasText: 'canto' });
  await rowOfRB.getByRole('button', { name: ra.menuOf(`1.1 ${WITNESS.siglum}`) }).click();
  await page.getByRole('menuitem', { name: ra.reading.delete }).click();
  const readingWindow = page.getByRole('dialog', { name: ra.reading.deleteTitle });
  await expect(readingWindow).toContainText(ra.reading.deleteBody);
  await readingWindow.getByRole('button', { name: ra.reading.deleteVerb, exact: true }).click();
  await expect(page.getByText(ra.reading.deleted)).toBeVisible();
  await expect(rowOfRB).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a reported reading is edited and deleted from the witness page too', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/witnesses/${WITNESS.slug}`);
  await page.waitForLoadState('networkidle');
  const readings = page.getByRole('region', { name: new RegExp(`^${reg.witness.readings}`) });
  const rowC = readings.locator('li').filter({ hasText: 'fatu' });
  const menu = rowC.getByRole('button', { name: /^Actions/ });
  expect(await menuOf(page, menu)).toEqual([ra.reading.edit, ra.reading.delete]);

  // Edit… leads to the work's page, with the window open.
  await menu.click();
  await page.getByRole('menuitem', { name: ra.reading.edit }).click();
  await page.waitForURL(new RegExp(`/works/${WORK.slug}$`));
  const edit = page.getByRole('dialog', { name: reg.reading.editTitle });
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel(reg.reading.reading, { exact: true })).toHaveValue('fatu');
  await edit.getByRole('button', { name: reg.common.cancel }).click();

  // Delete… asks here, and the row goes.
  await page.goto(`/witnesses/${WITNESS.slug}`);
  await page.waitForLoadState('networkidle');
  await rowC.getByRole('button', { name: /^Actions/ }).click();
  await page.getByRole('menuitem', { name: ra.reading.delete }).click();
  const window = page.getByRole('dialog', { name: ra.reading.deleteTitle });
  await window.getByRole('button', { name: ra.reading.deleteVerb, exact: true }).click();
  await expect(rowC).toHaveCount(0);
  expect(
    await db.select().from(reportedReadings).where(eq(reportedReadings.id, ids.readingC!)),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('a bibliography entry has Edit and Delete in its row, and is deleted through the window', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/bibliography');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: bibStrings.add }).click();
  const key = `menus${stamp}`;
  const entry = page.getByRole('dialog', { name: bibStrings.entry.addTitle });
  await entry
    .getByLabel(bibStrings.entry.field)
    .fill(
      `@book{${key},\n  author = {Menus, Marcus},\n  title = {A Book of Menus},\n  date = {2001},\n}`,
    );
  await entry.getByRole('button', { name: bibStrings.entry.save, exact: true }).click();
  await expect(entry).toBeHidden();
  const row = page.locator('li', { hasText: key });
  await expect(row).toBeVisible();
  const label = (await row.locator('span').first().innerText()).trim();
  expect(await menuOf(page, row.getByRole('button', { name: ra.menuOf(label) }))).toEqual([
    ra.bibliography.edit,
    ra.bibliography.delete,
  ]);
  await row.getByRole('button', { name: ra.menuOf(label) }).click();
  await page.getByRole('menuitem', { name: ra.bibliography.delete }).click();
  const window = page.getByRole('dialog', { name: ra.bibliography.deleteTitle });
  await expect(window).toContainText(ra.bibliography.deleteBody(label));
  await window.getByRole('button', { name: ra.bibliography.deleteVerb, exact: true }).click();
  await expect(page.getByText(ra.bibliography.deleted)).toBeVisible();
  await expect(page.locator('li', { hasText: key })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a note of an edition is deleted only after the window asks', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/editions/${DRAFT.slug}/edit`);
  await page.locator('.cm-content').waitFor();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(NOTE)).toBeVisible();
  await page.getByRole('button', { name: ra.note.deleteOf('1.1') }).click();
  const window = page.getByRole('dialog', { name: ra.note.deleteTitle });
  await expect(window).toContainText(ra.note.deleteBody);
  await window.getByRole('button', { name: ra.cancel }).click();
  await expect(page.getByText(NOTE)).toBeVisible();
  expect(await db.select().from(notes).where(eq(notes.editionId, ids.draft!))).toHaveLength(1);
  await page.getByRole('button', { name: ra.note.deleteOf('1.1') }).click();
  await window.getByRole('button', { name: ra.note.deleteVerb, exact: true }).click();
  await expect(page.getByText(NOTE)).toHaveCount(0);
  expect(await db.select().from(notes).where(eq(notes.editionId, ids.draft!))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a maintainer and a remote are removed only after the window asks', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto(`/works/${WORK.slug}/edit`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ra.maintainer.remove(OTHER.name) }).click();
  const window = page.getByRole('dialog', { name: ra.maintainer.removeTitle });
  await expect(window).toContainText(ra.maintainer.removeBody(OTHER.name, 'work'));
  await shot(page, '10-confirm-remove', { window: true });
  await window.getByRole('button', { name: ra.cancel }).click();
  expect(
    await db.select().from(workMaintainers).where(eq(workMaintainers.workId, ids.work!)),
  ).toHaveLength(1);
  await page.getByRole('button', { name: ra.maintainer.remove(OTHER.name) }).click();
  await window.getByRole('button', { name: ra.maintainer.removeVerb, exact: true }).click();
  await expect(page.getByText(reg.maintainers.removed(OTHER.name))).toBeVisible();
  await expect(page.getByRole('button', { name: ra.maintainer.remove(OTHER.name) })).toHaveCount(0);
  expect(
    await db.select().from(workMaintainers).where(eq(workMaintainers.workId, ids.work!)),
  ).toEqual([]);

  await page.goto(`/works/${WORK.slug}/remotes`);
  await page.waitForLoadState('networkidle');
  const address = `https://example.org/works/aeneis-${stamp}`;
  await page.getByRole('button', { name: ra.remote.removeOf(address) }).click();
  const remote = page.getByRole('dialog', { name: ra.remote.removeTitle });
  await expect(remote).toContainText(ra.remote.removeBody);
  await remote.getByRole('button', { name: ra.cancel }).click();
  expect(await db.select().from(workRemotes).where(eq(workRemotes.workId, ids.work!))).toHaveLength(
    1,
  );
  await page.getByRole('button', { name: ra.remote.removeOf(address) }).click();
  await remote.getByRole('button', { name: ra.remote.removeVerb, exact: true }).click();
  await expect(page.getByText(ra.remote.removed)).toBeVisible();
  expect(await db.select().from(workRemotes).where(eq(workRemotes.workId, ids.work!))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a token is revoked only after the window asks', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, OWNER);
  await page.goto('/account');
  await page.waitForLoadState('networkidle');
  const name = `Token of ${stamp}`;
  await page.getByLabel(s.account.tokenName).fill(name);
  await page.getByRole('button', { name: s.account.makeToken }).click();
  await expect(page.getByText(s.account.tokenMade)).toBeVisible();
  await page.getByRole('button', { name: ra.token.revokeOf(name) }).click();
  const window = page.getByRole('dialog', { name: ra.token.revokeTitle });
  await expect(window).toContainText(ra.token.revokeBody(name));
  await shot(page, '11-confirm-revoke', { window: true });
  await window.getByRole('button', { name: ra.cancel }).click();
  await expect(page.getByRole('button', { name: ra.token.revokeOf(name) })).toBeVisible();
  await page.getByRole('button', { name: ra.token.revokeOf(name) }).click();
  await window.getByRole('button', { name: ra.token.revokeVerb, exact: true }).click();
  await expect(page.getByText(s.account.tokenRevoked)).toBeVisible();
  await expect(page.getByRole('button', { name: ra.token.revokeOf(name) })).toHaveCount(0);
  expect(errors).toEqual([]);
});
