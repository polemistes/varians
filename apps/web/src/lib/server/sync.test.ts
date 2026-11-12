/**
 * Sync between two installations: two databases, varians_test
 * (A) and a second made here (B), a work exported from A, divergent edits on
 * both sides, a pull into B and a push back to A, checking texts, histories
 * and persons. The transport calls the other installation directly instead
 * of over HTTP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type Token } from '@varians/core';
import {
  changesets,
  createDatabase,
  persons,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedSample } from './seed/sample.ts';
import { saveOps } from './documents/service.ts';
import { publishEdition } from './publish.ts';
import { buildPackage } from './archive/package.ts';
import { importPackage } from './archive/import-package.ts';
import { removeWorkCompletely } from './archive/import.ts';
import {
  addRemote,
  compareSync,
  licenceRefusal,
  parseRemoteAddress,
  pullRemote,
  pushRemote,
  syncState,
  type RemoteTransport,
} from './sync.ts';
import { decryptSecret, encryptSecret } from './tokens.ts';

const urlA = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const urlB = (() => {
  const u = new URL(urlA);
  u.pathname = `${u.pathname}_remote`;
  return u.toString();
})();
let a: { db: Database; pool: pg.Pool };
let b: { db: Database; pool: pg.Pool };
const userA = newId();
const userB = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

function migrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++, dir = path.dirname(dir))
    if (existsSync(path.join(dir, 'packages', 'db', 'drizzle')))
      return path.join(dir, 'packages', 'db', 'drizzle');
  throw new Error('no migrations');
}

async function clean(db: Database): Promise<void> {
  for (const w of await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad')))
    await removeWorkCompletely(db, w.id);
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: urlA });
  await admin.connect();
  const name = new URL(urlB).pathname.slice(1);
  const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
  if (exists.rowCount === 0) await admin.query(`create database ${name}`);
  await admin.end();
  const migrator = new pg.Pool({ connectionString: urlB });
  await migrate(drizzle(migrator, { casing: 'snake_case' }), {
    migrationsFolder: migrationsFolder(),
  });
  await migrator.end();
  a = createDatabase(urlA);
  b = createDatabase(urlB);
  await clean(a.db);
  await clean(b.db);
  await a.db
    .insert(users)
    .values({ id: userA, email: `${userA}@a.test`, name: 'Editor at A', passwordHash: 'x' });
  await b.db
    .insert(users)
    .values({ id: userB, email: `${userB}@b.test`, name: 'Editor at B', passwordHash: 'x' });
});

afterAll(async () => {
  for (const side of [a, b]) {
    await clean(side.db);
    await side.db
      .delete(referenceSchemes)
      .where(inArray(referenceSchemes.createdBy, [userA, userB]));
  }
  await a.db.delete(users).where(eq(users.id, userA));
  await b.db.delete(users).where(eq(users.id, userB));
  await a.pool.end();
  await b.pool.end();
});

/** Installation A as B reaches it: its public state and package; a push imported by A's editor, keeping A's text in conflicts. */
/**
 * A as B reaches it with a token of A's owner: the drafts and their
 * histories, which a pull without one does not carry (only the versions).
 */
const ownerAtA = () => ({ id: userA, role: 'member' as const });

function transportToA(workId: string): RemoteTransport {
  return {
    sync: async () => (await syncState(a.db, ownerAtA(), workId, 'https://a.example'))!,
    download: () => buildPackage(a.db, ownerAtA(), [{ kind: 'work', workId }]),
    upload: (file) =>
      importPackage(a.db, file, userA, {
        actor: { id: userA, role: 'member' },
        onConflict: 'keep',
        source: 'a push',
      }),
  };
}

const wordsOf = (content: { items: { kind: string }[] }) =>
  content.items.filter((i): i is Token => i.kind === 'token');

describe('sync between two installations', () => {
  it('knows addresses of works and licences that go together', () => {
    expect(parseRemoteAddress('https://other.example/works/iliad')).toEqual({
      origin: 'https://other.example',
      slug: 'iliad',
    });
    expect(parseRemoteAddress('https://other.example/editions/iliad-1')).toBeNull();
    expect(parseRemoteAddress('ftp://other.example/works/iliad')).toBeNull();
    expect(licenceRefusal('CC-BY-SA-4.0')).toBeNull();
    expect(licenceRefusal('CC0-1.0')).toBeNull();
    expect(
      decryptSecret(
        encryptSecret('vt_secret', 'a key of at least sixteen'),
        'a key of at least sixteen',
      ),
    ).toBe('vt_secret');
    expect(() => encryptSecret('x', '')).toThrow();
  });

  it('pulls divergent edits into B as a merge, and pushes them back to A', async () => {
    const sample = await seedSample(a.db, userA);
    await publishEdition(a.db, sample.editionId, userA);
    const transport = transportToA(sample.workId);

    // B makes its copy from A's package, as A's owner may have it made.
    const first = await buildPackage(a.db, ownerAtA(), [{ kind: 'work', workId: sample.workId }]);
    try {
      const report = await importPackage(b.db, first.file, userB, {
        actor: { id: userB, role: 'member' },
      });
      expect(report.refused).toBeNull();
    } finally {
      await first.cleanup();
    }
    const { remote } = await addRemote(
      b.db,
      { id: userB, role: 'member' },
      sample.workId,
      'https://a.example/works/iliad',
      null,
      transport,
    );
    expect(remote.remoteWorkId).toBe(sample.workId);
    expect(
      (
        await compareSync(
          b.db,
          { id: userB, role: 'member' },
          sample.workId,
          await transport.sync(),
        )
      ).every((d) => d.difference === 'same' || d.kind === 'edition'),
    ).toBe(true);

    // Each side changes a different word of B's transcription.
    const [onA] = await a.db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.witnessId, sample.witnessIds.B!));
    const words = wordsOf(onA!.content);
    await saveOps(
      a.db,
      'transcription',
      onA!.id,
      userA,
      onA!.version,
      [{ t: 'set', id: words[2]!.id, fields: { form: 'ΘΕΑ' } }],
      'at A',
    );
    const [onB] = await b.db.select().from(transcriptions).where(eq(transcriptions.id, onA!.id));
    expect(onB!.ownerId).toBe(userB);
    await saveOps(
      b.db,
      'transcription',
      onB!.id,
      userB,
      onB!.version,
      [{ t: 'set', id: words[30]!.id, fields: { form: 'ΚΥΝΕΣΣΙΝ' } }],
      'at B',
    );
    expect(
      (
        await compareSync(
          b.db,
          { id: userB, role: 'member' },
          sample.workId,
          await transport.sync(),
        )
      ).find((d) => d.id === onA!.id)!.difference,
    ).toBe('differs');

    // B pulls: both words, as one merge changeset of B's editor.
    const pulled = await pullRemote(b.db, { id: userB, role: 'member' }, remote, { transport });
    expect(pulled.refused).toBeNull();
    expect(pulled.works[0]!.documents.find((d) => d.id === onA!.id)!.result).toBe('merged');
    const [mergedB] = await b.db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, onA!.id));
    expect(wordsOf(mergedB!.content)[2]!.form).toBe('ΘΕΑ');
    expect(wordsOf(mergedB!.content)[30]!.form).toBe('ΚΥΝΕΣΣΙΝ');
    // A's editor is a person at B now, without an account there.
    const [personA] = await b.db.select().from(persons).where(eq(persons.id, userA));
    expect(personA).toMatchObject({ name: 'Editor at A', userId: null });

    // B pushes back: A takes B's word without losing its own.
    await pushRemote(b.db, { id: userB, role: 'member' }, remote, { transport });
    const [afterA] = await a.db.select().from(transcriptions).where(eq(transcriptions.id, onA!.id));
    expect(wordsOf(afterA!.content)[2]!.form).toBe('ΘΕΑ');
    expect(wordsOf(afterA!.content)[30]!.form).toBe('ΚΥΝΕΣΣΙΝ');
    // Both histories hold both changes; B's editor is a person at A.
    for (const side of [a, b]) {
      const messages = (
        await side.db
          .select({ message: changesets.message })
          .from(changesets)
          .where(eq(changesets.documentId, onA!.id))
      ).map((c) => c.message);
      expect(messages).toEqual(expect.arrayContaining(['at A', 'at B']));
    }
    expect((await a.db.select().from(persons).where(eq(persons.id, userB)))[0]).toMatchObject({
      name: 'Editor at B',
      userId: null,
    });

    // A second pull has nothing left to bring.
    const again = await pullRemote(b.db, { id: userB, role: 'member' }, remote, {
      transport,
      dryRun: true,
    });
    expect(again.works[0]!.documents.find((d) => d.id === onA!.id)!.result).not.toBe('conflict');
  }, 180_000);
});
