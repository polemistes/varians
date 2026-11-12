/**
 * The two things an import brings in: a text to start from, which gives its
 * words and nothing else, and a transcript of the witness, which is read
 * with its features, its pages and its source. One TEI file, imported as
 * the one and then as the other.
 */
import { expect, test } from '@playwright/test';
import {
  createDatabase,
  pages,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
} from '@varians/db';
import { eq } from 'drizzle-orm';
import { s } from '../src/lib/strings/en';
import { workbench as w } from '../src/lib/strings/workbench';

const DATABASE_URL = 'postgres://varians@127.0.0.1:54329/varians_test';
const stamp = Date.now().toString(36);
const email = `import-${stamp}@example.org`;
const password = 'a long enough password';
const workTitle = `Carmen importatum ${stamp}`;
let witnessSlug = '';
let transcriptionId = '';

/** An edition's text, with its editor's supplement, a note, a speaker, and the pages of its print. */
const FILE = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>
  <pb n="77"/><sp><speaker>Λυσιστράτη</speaker>
  <l n="1">ἀλλ᾽ εἴ τις <supplied reason="lost">ἐς</supplied> Βακχεῖον</l>
  <l n="2">ἢ ᾽ς <unclear>Πανὸς</unclear> <note>cf. Hsch.</note></l></sp>
</body></text></TEI>`;

test.afterAll(async () => {
  const { db, pool } = createDatabase(DATABASE_URL);
  if (witnessSlug) {
    const [witness] = await db.select().from(witnesses).where(eq(witnesses.slug, witnessSlug));
    if (witness) {
      await db.delete(transcriptions).where(eq(transcriptions.witnessId, witness.id));
      await db.delete(witnesses).where(eq(witnesses.id, witness.id));
    }
  }
  await db.delete(works).where(eq(works.title, workTitle));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, user.id));
  await db.delete(users).where(eq(users.email, email));
  await pool.end();
});

async function stored() {
  const { db, pool } = createDatabase(DATABASE_URL);
  const [row] = await db
    .select({ content: transcriptions.content, sources: transcriptions.sources })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId));
  const [witness] = await db.select().from(witnesses).where(eq(witnesses.slug, witnessSlug));
  const pageRows = await db.select().from(pages).where(eq(pages.witnessId, witness!.id));
  await pool.end();
  return {
    words: row!.content.items.flatMap((i) => (i.kind === 'token' ? [i.form] : [])),
    marks: row!.content.items.flatMap((i) =>
      i.kind === 'token' ? (i.marks ?? []).map((m) => m.kind) : [],
    ),
    gaps: row!.content.items.filter((i) => i.kind === 'object' && i.type === 'gap').length,
    sources: row!.sources,
    pages: pageRows.map((p) => p.label),
  };
}

test('a TEI file is taken as a text to start from, or as a transcript of the witness', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 950 });

  await page.goto('/register');
  await page.getByLabel(s.auth.name).fill('Import Tester');
  await page.getByLabel(s.auth.email).fill(email);
  await page.getByLabel(s.auth.password, { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: new RegExp(s.auth.termsLink) }).check();
  await page.getByRole('button', { name: s.auth.registerAction }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/register'));

  await page.goto('/works/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=title]').fill(workTitle);
  await page.locator('input[name=author]').fill('Aristophanes');
  await page.locator('select[name=language]').selectOption('grc');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(
    (url) => /^\/works\/[^/]+$/.test(url.pathname) && url.pathname !== '/works/new',
  );

  await page.goto('/witnesses/new');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=name]').fill(`Codex Importatus ${stamp}`);
  await page.locator('input[name=siglum]').fill('R');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(
    (url) => /^\/witnesses\/[^/]+$/.test(url.pathname) && url.pathname !== '/witnesses/new',
  );
  witnessSlug = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Make New Transcript' }).first().click();
  // The window names the witness and asks for no work: the transcript is of its witness.
  const create = page.getByRole('dialog');
  await expect(create.locator('select[name=workId]')).toHaveCount(0);
  await create.locator('input[name=name]').fill('Lysistrata');
  await create.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/transcriptions\/[^/]+$/);
  transcriptionId = new URL(page.url()).pathname.split('/').pop()!;
  await page.waitForLoadState('networkidle');

  const file = { name: 'lysistrata.xml', mimeType: 'text/xml', buffer: Buffer.from(FILE) };
  const open = async () => {
    await page.getByRole('button', { name: w.tools.label, exact: true }).click();
    await page.getByRole('menuitem', { name: w.tools.import }).click();
    const dialog = page.getByRole('dialog', { name: w.importer.title });
    await dialog.locator('input[name=file][accept*=".tei"]').setInputFiles(file);
    return dialog;
  };

  // A text to start from: nothing is read before it is said what the file is.
  let dialog = await open();
  // The transcript has no text assigned to a work yet, so the work is found in the registry: the search is open from the start.
  await dialog
    .getByRole('searchbox', { name: w.workField.search })
    .filter({ visible: true })
    .fill(workTitle);
  await dialog
    .getByRole('button', { name: new RegExp(workTitle) })
    .filter({ visible: true })
    .click();
  await expect(
    dialog.getByLabel(w.workField.label, { exact: true }).filter({ visible: true }),
  ).toHaveValue(/.+/);
  const read = dialog.getByRole('button', { name: w.importer.tei.preview });
  await expect(read).toBeDisabled();
  await dialog.getByRole('radio', { name: new RegExp(w.importer.kindText) }).check();
  // It has no source to record.
  await expect(dialog.getByLabel(w.importer.source)).toHaveCount(0);
  await read.click();
  await expect(dialog.getByText(w.importer.tei.words(8))).toBeVisible();
  await dialog.getByRole('button', { name: w.importer.run, exact: true }).click();
  await expect(page.getByText(w.importer.done).first()).toBeVisible({ timeout: 15_000 });
  // The dialog stays open when the import has something to say (line numbers the work's scheme has no place for).
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await stored()).toEqual({
    words: ['ἀλλ᾽', 'εἴ', 'τις', 'ἐς', 'Βακχεῖον', 'ἢ', '᾽ς', 'Πανὸς'],
    marks: [],
    gaps: 0,
    sources: null,
    pages: [],
  });

  // The same file as a transcript of the witness: its features, its page, its source, and the gap where its editor supplied.
  dialog = await open();
  await dialog.getByRole('radio', { name: new RegExp(w.importer.kindTranscript) }).check();
  await dialog.getByRole('checkbox', { name: w.importer.replace }).check();
  // Every tab of the dialog has the field; the one shown is the TEI tab's.
  await dialog
    .getByLabel(w.importer.source)
    .filter({ visible: true })
    .fill('Transcribed at Ravenna by N.N.');
  await dialog.getByRole('button', { name: w.importer.tei.preview }).click();
  await expect(dialog.getByText(w.importer.tei.pageBreaks(1))).toBeVisible();
  await dialog.getByRole('button', { name: w.importer.run, exact: true }).click();
  await expect.poll(async () => (await stored()).sources, { timeout: 15_000 }).not.toBeNull();
  const after = await stored();
  expect(after.words).toEqual(['ἀλλ᾽', 'εἴ', 'τις', 'Βακχεῖον', 'ἢ', '᾽ς', 'Πανὸς']);
  expect(after.marks).toEqual(['unclear']);
  expect(after.gaps).toBe(1);
  expect(after.sources).toBe('Transcribed at Ravenna by N.N.');
  expect(after.pages).toEqual(['77']);
});
