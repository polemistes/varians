import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEME_PRESETS,
  fromText,
  newId,
  toText,
  type Item,
  type Stream,
  type Token,
} from '@varians/core';
import {
  changesets,
  createDatabase,
  editionSigla,
  editions,
  notes,
  pages,
  referenceSchemes,
  segments,
  transcriptionSegments,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
  type Role,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { grantsFor, type Actor } from './authz';
import { replaceContent } from './documents/service.ts';
import {
  addMaintainer,
  archiveZip,
  createTranscription,
  createWitness,
  createWork,
  deleteTranscription,
  deleteWitness,
  deleteWork,
  maintainersOf,
  RegistryError,
  removeMaintainer,
  resolveSchemeInput,
  schemeName,
  searchRegistry,
  SEARCH_LIMIT,
  transcriptionsOfWitness,
  transcriptionsOfWork,
  uniqueSlug,
  updateWitness,
  updateWork,
  worksOfWitness,
} from './registry';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { resolveLabels, resolveSegment, schemeOfWork } from './segments.ts';
import { chosenWorks, worksOfTranscription } from './transcription-works.ts';
import { loadTranscriptionAccess } from './transcription-access.ts';
import { copyEdition } from './edition-copy.ts';
import { createZones, zonesOf } from './zones.ts';

// The test database is shared: every record here carries this run's tag and
// is deleted at the end; nothing else is touched.
const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const tag = newId().slice(-8).toLowerCase();
const git = promisify(execFile);
let db: Database;
let pool: pg.Pool;

const created = { works: [] as string[], witnesses: [] as string[], documents: [] as string[] };

function person(role: Role, name: string): Actor & { email: string; name: string } {
  const id = newId();
  return { id, role, name: `${name} ${tag}`, email: `${id}@registry.test` };
}

const alice = person('member', 'Alice');
const bob = person('member', 'Bob');
const admin = person('administrator', 'Admin');
const people = [alice, bob, admin];

async function work(
  title: string,
  owner = alice,
  scheme: Parameters<typeof createWork>[1]['scheme'] = { preset: SCHEME_PRESETS[0]!.name },
) {
  const row = await createWork(db, { title: `${title} ${tag}`, language: 'grc', scheme }, owner.id);
  created.works.push(row.id);
  return row;
}

async function witness(
  name: string,
  owner = alice,
  fields: Partial<Parameters<typeof createWitness>[1]> = {},
) {
  const row = await createWitness(db, { siglum: 'X', name: `${name} ${tag}`, ...fields }, owner.id);
  created.witnesses.push(row.id);
  return row;
}

/** Lines of text, each starting a segment of the work with the given label. */
async function textOf(workId: string, lines: Record<string, string>): Promise<Stream> {
  const scheme = await schemeOfWork(db, workId);
  const resolved = await resolveLabels(db, scheme, Object.keys(lines));
  const items: Item[] = [];
  for (const [label, text] of Object.entries(lines)) {
    if (items.length) items.push({ kind: 'break', id: newId(), type: 'line' });
    const line = fromText(text);
    (line.items[0] as Token).segment = { segmentId: resolved.get(label)!.id };
    items.push(...line.items);
  }
  return { items };
}

async function edition(
  workId: string,
  owner: Actor,
  sigla: { witnessId: string; transcriptionId: string | null }[] = [],
) {
  const id = newId();
  await db.insert(editions).values({
    id,
    workId,
    slug: `registry-edition-${tag}-${id.slice(-6).toLowerCase()}`,
    title: `Edition ${id.slice(-4)} ${tag}`,
    ownerId: owner.id,
    conventions: DEFAULT_CONVENTIONS,
  });
  if (sigla.length) {
    await db
      .insert(editionSigla)
      .values(sigla.map((s, i) => ({ editionId: id, ...s, siglum: `S${i}`, position: i })));
  }
  created.documents.push(id);
  return id;
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values(
    people.map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      passwordHash: 'x',
    })),
  );
});

afterAll(async () => {
  const userIds = people.map((p) => p.id);
  // Works take their editions, segments, conjectures and readings; witnesses their pages and transcriptions.
  if (created.works.length) await db.delete(works).where(inArray(works.id, created.works));
  if (created.witnesses.length)
    await db.delete(witnesses).where(inArray(witnesses.id, created.witnesses));
  await db.delete(editions).where(inArray(editions.ownerId, userIds));
  await db.delete(transcriptions).where(inArray(transcriptions.ownerId, userIds));
  if (created.documents.length)
    await db.delete(changesets).where(inArray(changesets.documentId, created.documents));
  // Every save here was made by one of these people.
  await db.delete(changesets).where(inArray(changesets.userId, userIds));
  await db.delete(referenceSchemes).where(inArray(referenceSchemes.createdBy, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe('schemes as given', () => {
  it('takes a preset by name and refuses an unknown one', () => {
    expect(resolveSchemeInput({ preset: 'Chapter and verse' }).levels.map((l) => l.key)).toEqual([
      'chapter',
      'verse',
    ]);
    expect(() => resolveSchemeInput({ preset: 'Nonsense' })).toThrow(RegistryError);
  });

  it('checks custom levels and names them', () => {
    const scheme = resolveSchemeInput({
      levels: [
        { key: ' folio ', label: 'Folio', type: 'number', separator: '.' },
        { key: 'side', label: 'Side', type: 'text', separator: '' },
      ],
    });
    expect(scheme.levels[0]).toEqual({
      key: 'folio',
      label: 'Folio',
      type: 'number',
      separator: '',
    });
    expect(scheme.name).toBe('Folio and side');
    try {
      resolveSchemeInput({
        levels: [
          { key: 'a', label: 'A', type: 'number', separator: '' },
          { key: 'b', label: 'B', type: 'number', separator: '' },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryError);
      expect((e as RegistryError).code).toBe('invalid-scheme');
      expect((e as RegistryError).problems.length).toBeGreaterThan(0);
    }
  });

  it('recognizes a preset among custom levels', () => {
    expect(schemeName(SCHEME_PRESETS[2]!.scheme)).toBe(SCHEME_PRESETS[2]!.name);
    expect(
      schemeName({ levels: [{ key: 'verse', label: 'Verse', type: 'number', separator: '' }] }),
    ).toBe('Verse');
  });
});

describe('works', () => {
  it('creates a work from a preset with its scheme, profile and creator as maintainer', async () => {
    const row = await work('Odyssey');
    expect(row.slug).toBe(`odyssey-${tag}`);
    expect(row.visibility).toBe('public');
    expect(row.profile.language).toBe('grc');
    const { scheme } = await schemeOfWork(db, row.id);
    expect(scheme.levels).toEqual(SCHEME_PRESETS[0]!.scheme.levels);
    const maintainers = await maintainersOf(db, 'work', row.id);
    expect(maintainers).toEqual([
      { id: alice.id, name: alice.name, email: alice.email, isCreator: true },
    ]);
  });

  it('creates a work with a custom scheme, and refuses an unsound one', async () => {
    const row = await work('Fragments', alice, {
      levels: [
        { key: 'fragment', label: 'Fragment', type: 'number', separator: '' },
        { key: 'line', label: 'Line', type: 'number', separator: ',' },
      ],
    });
    const [scheme] = await db
      .select()
      .from(referenceSchemes)
      .where(eq(referenceSchemes.id, row.schemeId));
    expect(scheme!.name).toBe('Fragment and line');
    await expect(
      createWork(db, { title: `Broken ${tag}`, language: 'la', scheme: { levels: [] } }, alice.id),
    ).rejects.toThrow(RegistryError);
    expect(
      await db
        .select()
        .from(works)
        .where(eq(works.slug, `broken-${tag}`)),
    ).toHaveLength(0);
  });

  it('numbers slugs that are taken', async () => {
    const first = await work('Twin');
    const second = await work('Twin');
    const third = await work('Twin');
    expect([first.slug, second.slug, third.slug]).toEqual([
      `twin-${tag}`,
      `twin-${tag}-2`,
      `twin-${tag}-3`,
    ]);
    expect(await uniqueSlug(db, works, `twin-${tag}`)).toBe(`twin-${tag}-4`);
    expect(await uniqueSlug(db, works, `free-${tag}`)).toBe(`free-${tag}`);
  });

  it('updates the metadata and resets the profile with the language', async () => {
    const row = await work('Aeneid');
    const updated = await updateWork(db, row.id, {
      title: `Aeneis ${tag}`,
      author: '  Vergil ',
      language: 'la',
      identifier: '',
    });
    expect(updated.title).toBe(`Aeneis ${tag}`);
    expect(updated.author).toBe('Vergil');
    expect(updated.identifier).toBeNull();
    expect(updated.profile.latinUV).toBe(true);
    expect(updated.slug).toBe(row.slug);
  });

  it('relabels the segments when the separators change, and keeps keys and types once there are segments', async () => {
    const row = await work('Theogony');
    const scheme = await schemeOfWork(db, row.id);
    await resolveLabels(db, scheme, ['1.1', '1.2', '2.10']);
    const levels = SCHEME_PRESETS[0]!.scheme.levels.map((l) => ({ ...l }));
    levels[1]!.separator = ':';
    levels[0]!.label = 'Liber';
    await updateWork(db, row.id, { scheme: { levels } });
    const labels = (
      await db
        .select({ label: segments.label })
        .from(segments)
        .where(eq(segments.workId, row.id))
        .orderBy(segments.sortKey)
    ).map((s) => s.label);
    expect(labels).toEqual(['1:1', '1:2', '2:10']);
    // The relabelled segment is found again rather than made twice.
    const again = await resolveSegment(db, await schemeOfWork(db, row.id), '1:2');
    expect(again!.label).toBe('1:2');
    expect(await db.select().from(segments).where(eq(segments.workId, row.id))).toHaveLength(3);
    const [renamed] = await db
      .select()
      .from(referenceSchemes)
      .where(eq(referenceSchemes.id, row.schemeId));
    expect(renamed!.name).toBe('Liber and line');

    const rekeyed = levels.map((l, i) => (i === 1 ? { ...l, key: 'verse' } : l));
    await expect(updateWork(db, row.id, { scheme: { levels: rekeyed } })).rejects.toMatchObject({
      code: 'scheme-locked',
    });
    const retyped = levels.map((l, i) => (i === 1 ? { ...l, type: 'text' as const } : l));
    await expect(updateWork(db, row.id, { scheme: { levels: retyped } })).rejects.toMatchObject({
      code: 'scheme-locked',
    });
  });

  it('gives a work its own scheme row before changing one another work shares', async () => {
    const one = await work('Sharer one');
    const two = await work('Sharer two');
    await db.update(works).set({ schemeId: one.schemeId }).where(eq(works.id, two.id));
    const levels = SCHEME_PRESETS[0]!.scheme.levels.map((l) => ({
      ...l,
      label: l.label.toUpperCase(),
    }));
    const updated = await updateWork(db, one.id, { scheme: { levels } });
    expect(updated.schemeId).not.toBe(one.schemeId);
    const [kept] = await db
      .select()
      .from(referenceSchemes)
      .where(eq(referenceSchemes.id, one.schemeId));
    expect(kept!.levels[0]!.label).toBe('Book');
  });
});

describe('maintainers', () => {
  it('adds by email, refuses twice and unknown people, and keeps the creator', async () => {
    const row = await work('Maintained');
    const added = await addMaintainer(db, 'work', row.id, bob.email.toUpperCase());
    expect(added).toMatchObject({ ok: true, user: { id: bob.id, isCreator: false } });
    expect(await addMaintainer(db, 'work', row.id, bob.email)).toEqual({
      ok: false,
      error: 'already',
    });
    expect(await addMaintainer(db, 'work', row.id, `nobody-${tag}@registry.test`)).toEqual({
      ok: false,
      error: 'no-user',
    });
    expect((await maintainersOf(db, 'work', row.id)).map((m) => m.id)).toEqual([alice.id, bob.id]);
    expect(await removeMaintainer(db, 'work', row.id, alice.id)).toEqual({
      ok: false,
      error: 'creator',
    });
    expect(await removeMaintainer(db, 'work', row.id, bob.id)).toEqual({
      ok: true,
      name: bob.name,
    });
    expect(await removeMaintainer(db, 'work', row.id, bob.id)).toEqual({
      ok: false,
      error: 'not-maintainer',
    });
  });

  it('works the same for witnesses', async () => {
    const row = await witness('Maintained witness');
    expect((await addMaintainer(db, 'witness', row.id, bob.email)).ok).toBe(true);
    expect(await removeMaintainer(db, 'witness', row.id, alice.id)).toEqual({
      ok: false,
      error: 'creator',
    });
    expect((await maintainersOf(db, 'witness', row.id)).map((m) => m.isCreator)).toEqual([
      true,
      false,
    ]);
  });
});

describe('witnesses', () => {
  it('creates and updates a witness, cleaning empty fields', async () => {
    const row = await witness('Codex Testinus', alice, {
      siglum: ' T ',
      shelfmark: 'Test. 1',
      repository: '  ',
    });
    expect(row.siglum).toBe('T');
    expect(row.slug).toBe(`codex-testinus-${tag}`);
    expect(row.repository).toBeNull();
    const updated = await updateWitness(db, row.id, {
      dateText: 's. X',
      shelfmark: '',
      material: 'papyrus',
      format: 'roll',
    });
    expect(updated).toMatchObject({
      dateText: 's. X',
      shelfmark: null,
      category: 'manuscript',
      material: 'papyrus',
      format: 'roll',
      name: row.name,
    });
    const indirect = await updateWitness(db, row.id, {
      category: 'indirect',
      format: null,
      sourceAuthor: ' Athenaeus ',
      sourceWork: 'Deipnosophistae',
    });
    expect(indirect).toMatchObject({
      category: 'indirect',
      format: null,
      sourceAuthor: 'Athenaeus',
      sourceWork: 'Deipnosophistae',
    });
  });
});

describe('transcriptions', () => {
  let poem: Awaited<ReturnType<typeof work>>;
  let first: Awaited<ReturnType<typeof witness>>;
  let second: Awaited<ReturnType<typeof witness>>;
  let source: string;
  let copy: string;
  let bobs: string;

  beforeAll(async () => {
    poem = await work('Poem');
    first = await witness('First witness');
    second = await witness('Second witness');
  });

  it('creates one for a work, and any number more of the same witness and work', async () => {
    const row = await createTranscription(
      db,
      { witnessId: first.id, workIds: [poem.id], name: 'Poem' },
      alice.id,
    );
    source = row.id;
    expect(await chosenWorks(db, row.id)).toEqual([poem.id]);
    expect(row).toMatchObject({
      ownerId: alice.id,
      version: 0,
      visibility: 'draft',
      keepsWrittenForm: false,
    });
    // A second one of the same witness for the same work is allowed.
    const again = await createTranscription(
      db,
      { witnessId: first.id, workIds: [poem.id], name: 'Again' },
      alice.id,
    );
    expect(again.id).not.toBe(source);
    await db.delete(transcriptions).where(eq(transcriptions.id, again.id));
    const other = await createTranscription(
      db,
      { witnessId: first.id, workIds: [poem.id], name: 'Bob’s', keepsWrittenForm: true },
      bob.id,
    );
    bobs = other.id;
    expect(other.keepsWrittenForm).toBe(true);
  });

  it('starts one from another: the text copied with new ids, the work kept, saved as the first change', async () => {
    const text = await textOf(poem.id, { '1.1': 'arma virumque cano', '1.2': 'Troiae qui primus' });
    await replaceContent(db, 'transcription', source, alice.id, 0, text, 'test');
    const row = await createTranscription(
      db,
      { witnessId: second.id, name: 'Poem copied', fromTranscriptionId: source },
      alice.id,
    );
    copy = row.id;
    created.documents.push(copy);
    expect(await chosenWorks(db, copy)).toEqual([poem.id]);
    expect(row.version).toBe(1);
    expect(toText(row.content)).toBe(toText(text));
    const sourceIds = new Set(text.items.map((i) => i.id));
    expect(row.content.items.some((i) => sourceIds.has(i.id))).toBe(false);
    expect(row.description).toContain('First witness');
    const index = await db
      .select()
      .from(transcriptionSegments)
      .where(eq(transcriptionSegments.transcriptionId, copy));
    expect(index.map((r) => r.workId)).toEqual([poem.id, poem.id]);
    const [history] = await db.select().from(changesets).where(eq(changesets.documentId, copy));
    expect(history!.message).toContain('Poem');
    // A second copy for the same witness and work is allowed too.
    const twice = await createTranscription(
      db,
      { witnessId: second.id, name: 'Twice', fromTranscriptionId: source },
      alice.id,
    );
    expect(toText(twice.content)).toBe(toText(text));
    created.documents.push(twice.id);
    await db.delete(transcriptions).where(eq(transcriptions.id, twice.id));
  });

  it('lists the transcriptions of a work, with or without text in it', async () => {
    const rows = await transcriptionsOfWork(db, poem.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(source)?.segmentCount).toBe(2);
    expect(byId.get(copy)?.segmentCount).toBe(2);
    expect(byId.get(bobs)?.segmentCount).toBe(0);
    expect(byId.get(copy)).toMatchObject({
      witnessName: second.name,
      witnessSiglum: 'X',
      ownerName: alice.name,
    });
  });

  it('lists the transcriptions and works of a witness', async () => {
    const rows = await transcriptionsOfWitness(db, first.id);
    expect(rows.map((r) => r.id).sort()).toEqual([source, bobs].sort());
    const mine = rows.find((r) => r.id === source)!;
    expect(mine.works.map((w) => w.id)).toEqual([poem.id]);
    expect(mine.assigned).toEqual([expect.objectContaining({ id: poem.id, segmentCount: 2 })]);
    const connected = await worksOfWitness(db, first.id);
    expect(connected).toEqual([
      expect.objectContaining({
        id: poem.id,
        transcriptionCount: 2,
        segmentCount: 2,
        readingCount: 0,
      }),
    ]);
  });

  it('refuses to delete a transcription an edition names, or someone else’s', async () => {
    const editionId = await edition(poem.id, alice, [
      { witnessId: second.id, transcriptionId: copy },
    ]);
    const refused = await deleteTranscription(db, copy, alice);
    expect(refused).toMatchObject({ ok: false, error: 'in-conspectus' });
    expect(
      refused.ok === false && refused.error === 'in-conspectus' && refused.editions[0]!.title,
    ).toContain('Edition');
    expect(await deleteTranscription(db, source, bob)).toEqual({ ok: false, error: 'forbidden' });
    await db.delete(editions).where(eq(editions.id, editionId));
    expect(await deleteTranscription(db, copy, admin)).toEqual({ ok: true, name: 'Poem copied' });
    expect(await db.select().from(changesets).where(eq(changesets.documentId, copy))).toHaveLength(
      0,
    );
    expect(await deleteTranscription(db, copy, alice)).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('deleting works', () => {
  it('refuses while someone else’s edition or text depends on the work, then deletes it with its own records', async () => {
    const row = await work('Doomed');
    const place = await witness('Doomed witness');
    const own = await edition(row.id, alice);
    const others = await edition(row.id, bob);
    expect(await deleteWork(db, row.id, bob)).toEqual({ ok: false, error: 'forbidden' });
    const refused = await deleteWork(db, row.id, alice);
    expect(refused.ok).toBe(false);
    if (!refused.ok && refused.error === 'in-use') {
      expect(refused.dependents.editions.map((e) => e.ownerName)).toEqual([bob.name]);
    } else {
      expect.unreachable();
    }
    await db.delete(editions).where(eq(editions.id, others));

    const bobsText = await createTranscription(
      db,
      { witnessId: place.id, workIds: [row.id], name: 'Bob reads' },
      bob.id,
    );
    await replaceContent(
      db,
      'transcription',
      bobsText.id,
      bob.id,
      0,
      await textOf(row.id, { '1.1': 'menin aeide' }),
      'test',
    );
    const stillRefused = await deleteWork(db, row.id, admin);
    expect(stillRefused).toMatchObject({
      ok: false,
      error: 'in-use',
      dependents: { transcriptions: 1 },
    });
    await db.delete(transcriptions).where(eq(transcriptions.id, bobsText.id));

    expect(await deleteWork(db, row.id, alice)).toEqual({ ok: true, title: row.title });
    expect(await db.select().from(works).where(eq(works.id, row.id))).toHaveLength(0);
    expect(await db.select().from(editions).where(eq(editions.id, own))).toHaveLength(0);
    expect(
      await db.select().from(referenceSchemes).where(eq(referenceSchemes.id, row.schemeId)),
    ).toHaveLength(0);
  });
});

describe('deleting witnesses', () => {
  it('refuses while someone else transcribes it or an edition names it', async () => {
    const row = await witness('Contested');
    const theirs = await createTranscription(db, { witnessId: row.id, name: 'Theirs' }, bob.id);
    expect(await deleteWitness(db, row.id, bob)).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteWitness(db, row.id, alice)).toMatchObject({
      ok: false,
      error: 'in-use',
      dependents: { transcriptions: 1 },
    });
    await db.delete(transcriptions).where(eq(transcriptions.id, theirs.id));

    const poem = await work('Named poem');
    await edition(poem.id, alice, [{ witnessId: row.id, transcriptionId: null }]);
    const named = await deleteWitness(db, row.id, alice);
    expect(
      named.ok === false && named.error === 'in-use' && named.dependents.editions,
    ).toHaveLength(1);
  });

  it('deletes a witness with its pages and its creator’s own transcriptions', async () => {
    const row = await witness('Disposable');
    const pageId = newId();
    await db.insert(pages).values({ id: pageId, witnessId: row.id, label: '1r', position: 1 });
    const mine = await createTranscription(db, { witnessId: row.id, name: 'Mine' }, alice.id);
    const result = await deleteWitness(db, row.id, alice);
    expect(result).toEqual({ ok: true, title: row.name, pageIds: [pageId] });
    expect(
      await db.select().from(transcriptions).where(eq(transcriptions.id, mine.id)),
    ).toHaveLength(0);
    expect(await db.select().from(pages).where(eq(pages.id, pageId))).toHaveLength(0);
  });
});

describe('the archive as a download', () => {
  it('commits to a repository of its own, never to an enclosing checkout, and zips its head', async () => {
    const checkout = await mkdtemp(path.join(tmpdir(), 'varians-registry-'));
    try {
      await git('git', ['init', '-q', '-b', 'main'], { cwd: checkout });
      const row = await work('Archived');
      await resolveLabels(db, await schemeOfWork(db, row.id), ['1.1']);
      const zip = await archiveZip(
        db,
        row,
        path.join(checkout, 'archives'),
        path.join(checkout, 'storage'),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of zip) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
      expect(body.includes(`${row.slug}/work.json`)).toBe(true);
      expect(existsSync(path.join(checkout, 'archives', row.slug, '.git'))).toBe(true);
      // The checkout around the storage directory gained no commit.
      await expect(
        git('git', ['rev-parse', '--verify', 'HEAD'], { cwd: checkout }),
      ).rejects.toThrow();
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});

describe('search', () => {
  it('finds works by title or author among those the user may see', async () => {
    const open = await createWork(
      db,
      {
        title: `Searchable ${tag} Alpha`,
        author: `Auctor${tag}`,
        language: 'la',
        scheme: { preset: SCHEME_PRESETS[1]!.name },
      },
      alice.id,
    );
    const closed = await createWork(
      db,
      {
        title: `Searchable ${tag} Beta`,
        language: 'la',
        visibility: 'private',
        scheme: { preset: SCHEME_PRESETS[1]!.name },
      },
      alice.id,
    );
    created.works.push(open.id, closed.id);
    const forBob = await searchRegistry(
      db,
      'work',
      `searchable ${tag}`,
      bob,
      await grantsFor(db, bob),
    );
    expect(forBob.map((h) => h.id)).toEqual([open.id]);
    const forAlice = await searchRegistry(
      db,
      'work',
      `Searchable ${tag}`,
      alice,
      await grantsFor(db, alice),
    );
    expect(forAlice.map((h) => h.id)).toEqual([open.id, closed.id]);
    const forAdmin = await searchRegistry(
      db,
      'work',
      `Searchable ${tag}`,
      admin,
      await grantsFor(db, admin),
    );
    expect(forAdmin).toHaveLength(2);
    const byAuthor = await searchRegistry(
      db,
      'work',
      `auctor${tag}`,
      null,
      await grantsFor(db, null),
    );
    expect(byAuthor).toEqual([
      {
        id: open.id,
        slug: open.slug,
        title: open.title,
        author: `Auctor${tag}`,
        siglum: null,
        shelfmark: null,
        settlement: null,
      },
    ]);
    expect(await searchRegistry(db, 'work', '   ', alice, await grantsFor(db, alice))).toEqual([]);
    expect(
      (await searchRegistry(db, 'work', `${tag}%Alpha`, alice, await grantsFor(db, alice))).length,
    ).toBe(0);
  });

  it('finds witnesses by name, siglum or shelfmark, eight at most', async () => {
    for (let i = 0; i < SEARCH_LIMIT + 1; i++) await witness(`Many ${i}`);
    const hits = await searchRegistry(db, 'witness', `many`, alice, await grantsFor(db, alice));
    expect(hits.length).toBeLessThanOrEqual(SEARCH_LIMIT);
    const mine = await searchRegistry(db, 'witness', `${tag}`, alice, await grantsFor(db, alice));
    expect(mine).toHaveLength(SEARCH_LIMIT);
    const marked = await witness('Shelved', alice, {
      siglum: `Q${tag}`,
      shelfmark: `Shelf ${tag} 7`,
      settlement: 'Oxford',
    });
    const byShelfmark = await searchRegistry(
      db,
      'witness',
      `shelf ${tag}`,
      alice,
      await grantsFor(db, alice),
    );
    expect(byShelfmark).toEqual([
      {
        id: marked.id,
        slug: marked.slug,
        title: marked.name,
        author: null,
        siglum: `Q${tag}`,
        shelfmark: `Shelf ${tag} 7`,
        settlement: 'Oxford',
      },
    ]);
    expect(
      (await searchRegistry(db, 'witness', `q${tag}`, alice, await grantsFor(db, alice))).map(
        (h) => h.id,
      ),
    ).toEqual([marked.id]);
  });
});

describe('transcriptions of several works, and copies', () => {
  it('keeps the works chosen in order, and counts the works the text is assigned to as well', async () => {
    const greek = await work('Greek part');
    const latin = await work('Latin part');
    const place = await witness('Miscellany');
    const row = await createTranscription(
      db,
      { witnessId: place.id, workIds: [latin.id, greek.id, latin.id], name: 'All of it' },
      alice.id,
    );
    expect(await chosenWorks(db, row.id)).toEqual([latin.id, greek.id]);
    const third = await work('Third part');
    const text = await textOf(third.id, { '1.1': 'alpha beta' });
    await replaceContent(db, 'transcription', row.id, alice.id, 0, text, 'test');
    created.documents.push(row.id);
    expect(await worksOfTranscription(db, row.id)).toEqual([latin.id, greek.id, third.id]);
    // Listed with every one of its works.
    for (const w of [latin, greek, third])
      expect((await transcriptionsOfWork(db, w.id)).map((t) => t.id)).toContain(row.id);
  });

  it('hides a transcription with text of a private work from those who may not see that work', async () => {
    const open = await work('Open text');
    const closed = await createWork(
      db,
      {
        title: `Closed text ${tag}`,
        language: 'grc',
        visibility: 'private',
        scheme: { preset: SCHEME_PRESETS[0]!.name },
      },
      bob.id,
    );
    created.works.push(closed.id);
    const place = await witness('Shared codex');
    const row = await createTranscription(
      db,
      { witnessId: place.id, workIds: [open.id], name: 'Codex' },
      alice.id,
    );
    await db
      .update(transcriptions)
      .set({ visibility: 'published' })
      .where(eq(transcriptions.id, row.id));
    expect((await loadTranscriptionAccess(db, null, row.id))!.canView).toBe(true);
    // Text assigned to the private work, though the work chosen is public.
    await replaceContent(
      db,
      'transcription',
      row.id,
      bob.id,
      0,
      await textOf(closed.id, { '1.1': 'secret words' }),
      'test',
    );
    created.documents.push(row.id);
    expect((await loadTranscriptionAccess(db, null, row.id))!.canView).toBe(false);
    expect((await loadTranscriptionAccess(db, bob, row.id))!.canView).toBe(true);
  });

  it('copies a transcription with its works, memory and boxes; boxes only within the same witness', async () => {
    const poem = await work('Copied poem');
    const place = await witness('Copied codex');
    const other = await witness('Other codex');
    const [page] = await db
      .insert(pages)
      .values({ id: newId(), witnessId: place.id, label: '1r', position: 1 })
      .returning();
    const row = await createTranscription(
      db,
      { witnessId: place.id, workIds: [poem.id], name: 'Original' },
      alice.id,
    );
    const text = await textOf(poem.id, { '1.1': 'arma virumque' });
    await replaceContent(db, 'transcription', row.id, alice.id, 0, text, 'test');
    await db
      .update(transcriptions)
      .set({ memory: [{ form: 'ARMA', norm: 'arma', count: 2 }] })
      .where(eq(transcriptions.id, row.id));
    created.documents.push(row.id);
    const [first, second] = text.items.filter((i) => i.kind === 'token').map((i) => i.id);
    await createZones(db, row.id, place.id, [
      {
        pageId: page!.id,
        geometry: { rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 }, rotate: 2 },
        tokenIds: [first!],
      },
      {
        pageId: page!.id,
        geometry: { rect: { x: 0.2, y: 0.1, w: 0.1, h: 0.05 } },
        tokenIds: [second!],
      },
      {
        pageId: page!.id,
        geometry: { rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
        tokenIds: [],
        feature: { kind: 'figure' },
      },
    ]);

    const copy = await createTranscription(
      db,
      { witnessId: place.id, name: 'Copy', fromTranscriptionId: row.id },
      bob.id,
    );
    created.documents.push(copy.id);
    expect(await chosenWorks(db, copy.id)).toEqual([poem.id]);
    expect(copy.memory).toEqual([{ form: 'ARMA', norm: 'arma', count: 2 }]);
    const copiedTokens = copy.content.items.filter((i) => i.kind === 'token').map((i) => i.id);
    const boxes = await zonesOf(db, copy.id);
    expect(boxes).toHaveLength(3);
    const firstBox = boxes.find((z) => z.geometry.rotate === 2)!;
    expect(firstBox.tokenIds).toEqual([copiedTokens[0]]);
    expect(boxes.some((z) => z.feature?.kind === 'figure')).toBe(true);
    // The original keeps its own.
    expect((await zonesOf(db, row.id)).map((z) => z.tokenIds).flat()).toEqual([first, second]);

    const elsewhere = await createTranscription(
      db,
      { witnessId: other.id, name: 'Elsewhere', fromTranscriptionId: row.id },
      alice.id,
    );
    created.documents.push(elsewhere.id);
    expect(await zonesOf(db, elsewhere.id)).toEqual([]);
  });

  it('copies an edition: its editors the draft with their names, others the published version, without what they may not see', async () => {
    const poem = await work('Edited poem');
    const place = await witness('Edited codex');
    const second = await witness('Unseen codex');
    const base = await createTranscription(
      db,
      { witnessId: place.id, workIds: [poem.id], name: 'Base' },
      alice.id,
    );
    await db
      .update(transcriptions)
      .set({ visibility: 'published' })
      .where(eq(transcriptions.id, base.id));
    const hidden = await createTranscription(
      db,
      { witnessId: second.id, workIds: [poem.id], name: 'Hidden' },
      alice.id,
    );
    const id = await edition(poem.id, alice, [
      { witnessId: place.id, transcriptionId: base.id },
      { witnessId: second.id, transcriptionId: hidden.id },
    ]);
    await db
      .update(editions)
      .set({ editors: ['Alice Editor'], preface: 'A preface.' })
      .where(eq(editions.id, id));
    const text = await textOf(poem.id, { '1.1': 'arma virumque cano' });
    await replaceContent(db, 'edition', id, alice.id, 0, text, 'test');
    const [segmentId] = [(text.items[0] as Token).segment!.segmentId!];
    const tokenId = text.items[0]!.id;
    await db.insert(notes).values([
      { id: newId(), editionId: id, segmentId, tokenIds: [tokenId], text: 'On arma.' },
      {
        id: newId(),
        editionId: id,
        segmentId,
        tokenIds: ['gone'],
        text: 'On a word since removed.',
      },
    ]);

    // A reader may not copy a draft.
    expect(await copyEdition(db, bob, id, 'Mine')).toBe('forbidden');

    const own = await copyEdition(db, alice, id, 'Alice again');
    if (typeof own === 'string') throw new Error(own);
    created.documents.push(own.edition.id);
    expect(own.edition).toMatchObject({
      ownerId: alice.id,
      editors: ['Alice Editor'],
      preface: 'A preface.',
      visibility: 'draft',
      publishedVersion: null,
    });
    expect(own.edition.copiedFrom).toMatchObject({ editionId: id, published: false, number: null });
    expect(own.withoutTranscription).toBe(0);
    expect(toText(own.edition.content)).toBe(toText(text));
    expect(
      (await db.select().from(notes).where(eq(notes.editionId, own.edition.id))).map((n) => n.text),
    ).toEqual(['On arma.']);

    await db
      .update(editions)
      .set({ visibility: 'published', publishedVersion: 1 })
      .where(eq(editions.id, id));
    const theirs = await copyEdition(db, bob, id, 'Bob reads');
    if (typeof theirs === 'string') throw new Error(theirs);
    created.documents.push(theirs.edition.id);
    expect(theirs.edition).toMatchObject({ ownerId: bob.id, editors: [], title: 'Bob reads' });
    expect(theirs.edition.copiedFrom).toMatchObject({
      editionId: id,
      title: expect.stringContaining('Edition'),
      published: true,
      version: 1,
    });
    // Alice's draft transcription stays out of Bob's copy; the witness stays in.
    expect(theirs.withoutTranscription).toBe(1);
    const sigla = await db
      .select()
      .from(editionSigla)
      .where(eq(editionSigla.editionId, theirs.edition.id));
    expect(sigla.map((s) => s.transcriptionId).sort()).toEqual([base.id, null].sort());
  });
});
