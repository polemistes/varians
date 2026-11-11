import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultProfile, newId } from '@varians/core';
import {
  bibliographyItems,
  conjectures,
  createDatabase,
  editions,
  notes,
  referenceSchemes,
  segments,
  users,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray, like } from 'drizzle-orm';
import pg from 'pg';
import {
  bibText,
  citationsByRecord,
  citationsOf,
  deleteEntry,
  editionBibliographyFor,
  editionWorksCited,
  importBibliography,
  listBibliography,
  saveEntry,
  setCitations,
} from './bibliography.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const tag = newId().slice(-8).toLowerCase();
const key = (k: string) => `${k}-${tag}`;
const ids = {
  owner: newId(),
  other: newId(),
  editor: newId(),
  scheme: newId(),
  work: newId(),
  segment: newId(),
  edition: newId(),
};
const owner = { id: ids.owner, role: 'member' as const };
const other = { id: ids.other, role: 'member' as const };
const siteEditor = { id: ids.editor, role: 'editor' as const };

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values([
    { id: ids.owner, email: `${ids.owner}@test`, name: 'Owner', passwordHash: 'x' },
    { id: ids.other, email: `${ids.other}@test`, name: 'Other', passwordHash: 'x' },
    {
      id: ids.editor,
      email: `${ids.editor}@test`,
      name: 'Editor',
      passwordHash: 'x',
      role: 'editor',
    },
  ]);
  await db.insert(referenceSchemes).values({
    id: ids.scheme,
    name: 'l',
    levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }],
  });
  await db.insert(works).values({
    id: ids.work,
    slug: `w-${ids.work}`,
    title: 'W',
    schemeId: ids.scheme,
    profile: defaultProfile('grc'),
  });
  await db.insert(segments).values({
    id: ids.segment,
    workId: ids.work,
    address: { line: '1' },
    label: '1',
    sortKey: '00001',
  });
  await db.insert(editions).values({
    id: ids.edition,
    workId: ids.work,
    slug: `e-${ids.edition}`,
    title: 'E',
    ownerId: ids.owner,
    conventions: DEFAULT_CONVENTIONS,
  });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(bibliographyItems).where(like(bibliographyItems.citationKey, `%-${tag}`));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(inArray(users.id, [ids.owner, ids.other, ids.editor]));
  await pool.end();
});

const bib = `
@book{${key('west1998')},
  author = {West, Martin L.},
  title = {Homeri Ilias},
  date = {1998},
}
@article{${key('west1998b')},
  author = {West, M. L.},
  title = {Notes},
  journaltitle = {CQ},
  year = {1998},
}
`;

describe('the bibliography', () => {
  it('imports, keeps what belongs to others, and updates the importer’s own entries', async () => {
    const first = await importBibliography(db, bib, owner);
    expect(first.created).toEqual([key('west1998'), key('west1998b')]);
    const again = await importBibliography(db, bib, owner);
    expect(again.unchanged).toHaveLength(2);
    const changed = bib.replace('Homeri Ilias', 'Homeri Ilias, volumen prius');
    expect((await importBibliography(db, changed, other)).kept).toEqual([key('west1998')]);
    expect((await importBibliography(db, changed, owner)).updated).toEqual([key('west1998')]);
    expect((await importBibliography(db, changed, siteEditor)).unchanged).toHaveLength(2);
    const found = await listBibliography(db, { q: 'volumen prius' });
    expect(found.items.map((i) => i.citationKey)).toEqual([key('west1998')]);
    expect(found.items[0]!.label).toBe('West 1998');
  });

  it('saves one entry at a time and refuses taken keys and others’ entries', async () => {
    const created = await saveEntry(
      db,
      null,
      `@book{${key('allen1931')}, author = {Allen, T. W.}, title = {Homeri Ilias}, year = {1931}}`,
      other,
    );
    expect(created.ok).toBe(true);
    const item = created.ok ? created.item : null;
    expect((await saveEntry(db, null, `@book{${key('allen1931')}, title = {X}}`, owner)).ok).toBe(
      false,
    );
    expect((await saveEntry(db, null, `@book{a, title={x}} @book{b, title={y}}`, owner)).ok).toBe(
      false,
    );
    expect((await saveEntry(db, null, 'not biblatex', owner)).ok).toBe(false);
    const forbidden = await saveEntry(
      db,
      item!.id,
      `@book{${key('allen1931')}, title = {Y}}`,
      owner,
    );
    expect(forbidden.ok ? '' : forbidden.error).toBe('forbidden');
    const edited = await saveEntry(
      db,
      item!.id,
      `@book{${key('allen1931')}, author = {Allen, Thomas W.}, title = {Homeri Ilias}, year = {1931}}`,
      siteEditor,
    );
    expect(edited.ok).toBe(true);
    expect(await bibText(db, [item!.id])).toContain('Allen, Thomas W.');
  });

  it('cites from conjectures and notes, gathers an edition’s works cited, and protects cited entries', async () => {
    const [west] = await db
      .select()
      .from(bibliographyItems)
      .where(eq(bibliographyItems.citationKey, key('west1998')));
    const [westb] = await db
      .select()
      .from(bibliographyItems)
      .where(eq(bibliographyItems.citationKey, key('west1998b')));
    const conjectureId = newId();
    await db.insert(conjectures).values({
      id: conjectureId,
      workId: ids.work,
      segmentId: ids.segment,
      lemma: 'a',
      reading: 'b',
      proposer: 'West',
      ownerId: ids.owner,
    });
    await setCitations(db, { conjectureId }, [
      { itemId: west!.id, postnote: ' 45 ' },
      { itemId: 'nothing' },
    ]);
    expect((await citationsOf(db, { conjectureId })).map((c) => c.text)).toEqual(['West 1998, 45']);
    const noteId = newId();
    await db.insert(notes).values({
      id: noteId,
      editionId: ids.edition,
      segmentId: ids.segment,
      text: 'n',
      authorId: ids.owner,
    });
    await setCitations(db, { noteId, editionId: ids.edition }, [
      { itemId: westb!.id, prenote: 'cf.' },
    ]);
    expect((await citationsByRecord(db, 'note', [noteId])).get(noteId)?.[0]?.text).toBe(
      'cf. West 1998',
    );
    const cited = await editionWorksCited(db, ids.edition);
    expect(cited.map((c) => c.label)).toEqual(['West 1998a', 'West 1998b']);
    expect(cited[0]!.reference).toContain('Homeri Ilias');
    // The same bibliography as the edition's TEI lists it: the works under those labels, and what the conjecture cites of them.
    const listed = await editionBibliographyFor(db, ids.edition);
    expect(listed.works.map((w) => [w.id, w.label])).toEqual([
      [west!.id, 'West 1998a'],
      [westb!.id, 'West 1998b'],
    ]);
    expect(listed.works[0]!.entry.fields.title).toContain('Homeri Ilias');
    expect(listed.citations).toEqual({
      [conjectureId]: [{ itemId: west!.id, prenote: null, postnote: '45' }],
    });
    // A conjecture belongs to the work whoever owns it: what another person's conjecture cites is listed too.
    await db
      .update(conjectures)
      .set({ ownerId: ids.other })
      .where(eq(conjectures.id, conjectureId));
    expect((await editionWorksCited(db, ids.edition)).map((c) => c.key)).toEqual([
      key('west1998'),
      key('west1998b'),
    ]);
    const refused = await deleteEntry(db, west!.id, owner);
    expect(refused).toEqual({ ok: false, error: 'cited', cited: 1 });
    await setCitations(db, { conjectureId }, []);
    expect(await deleteEntry(db, west!.id, other)).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteEntry(db, west!.id, owner)).toEqual({ ok: true });
  });
});
