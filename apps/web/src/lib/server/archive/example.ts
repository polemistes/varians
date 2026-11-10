/**
 * The example archive of the format: the seed sample, with one
 * small image, written as an archive into docs/formats/example/. It is the
 * conformance target for other implementations, regenerated whenever the
 * format changes (`cli write-example`).
 *
 * It is built in a database of its own, made and dropped here, so that
 * nothing of the installation it runs on reaches it.
 */

import { newId, siteKey } from '@varians/core';
import { conjectures, createDatabase, pages, users } from '@varians/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import { setSiteKind } from '../collation.ts';
import { adoptConjecture } from '../conjectures.ts';
import { publishEdition } from '../publish.ts';
import { editionView } from '../reader.ts';
import { seedSample } from '../seed/sample.ts';
import { writeArchive } from './archive.ts';
import { buildPackage } from './package.ts';

/** The address the example's TEI prefixes resolve to: the reference installation. */
export const EXAMPLE_ORIGIN = 'https://varians.eu';

const EXAMPLE_README = `# The example archive

\`iliad/\` is a complete archive in the Varians Data Format, version 2: the opening of Iliad 1 in three transcribed witnesses and one known from a reported reading, an edition with its apparatus, a conjecture adopted and one not, a note citing the literature, a zone on a page with a small image, an alignment constraint, sites looked at and classed, one place left out of the apparatus, review positions, a named and a published moment, and a collaborator.

\`iliad.zip\` is the same work as a package: a BagIt bag with RO-Crate metadata, as one installation sends a work to another.

It is the conformance target for other implementations: every JSON file in it is valid against its schema, every TEI file against varians.rng, and Varians reads it back. It is written by \`pnpm --filter @varians/web cli write-example\` from the application's sample, so its ids and times change each time it is written. The words, readings and image are examples, not a verified text.
`;

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here, i = 0; i < 8; i++, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'packages', 'db', 'drizzle');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('packages/db/drizzle not found');
}

/** The same server as `url`, another database. */
function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * Write the example archive into `outDir` (its contents are replaced),
 * using a temporary database on the server of `serverUrl`. Returns the
 * archive's directory.
 */
export async function writeExample(serverUrl: string, outDir: string): Promise<string> {
  const name = `varians_example_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: withDatabase(serverUrl, 'postgres') });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const storage = await mkdtemp(path.join(os.tmpdir(), 'varians-example-'));
  try {
    const url = withDatabase(serverUrl, name);
    const migrator = new pg.Pool({ connectionString: url });
    await migrate(drizzle(migrator, { casing: 'snake_case' }), {
      migrationsFolder: migrationsFolder(),
    });
    await migrator.end();
    const { db, pool } = createDatabase(url);
    try {
      const editor = newId();
      const collaborator = newId();
      await db.insert(users).values([
        { id: editor, email: 'editor@example.org', name: 'Example Editor', passwordHash: 'x' },
        {
          id: collaborator,
          email: 'collaborator@example.org',
          name: 'Example Collaborator',
          passwordHash: 'x',
        },
      ]);
      const sample = await seedSample(db, editor, { collaboratorId: collaborator });
      const [conjecture] = await db
        .select()
        .from(conjectures)
        .where(eq(conjectures.workId, sample.workId))
        .limit(1);
      await adoptConjecture(db, sample.editionId, conjecture!.id);
      // One place the editor leaves out of the apparatus, as a spelling of the same word that the edition does not record.
      const view = await editionView(db, sample.editionId, null, {
        kind: 'editor',
        viewer: { id: editor, role: 'member' },
      });
      const left = Object.values(view.segments).find((s) => s.label === '1.8')!;
      const place = left.collation.sites.find((site) =>
        site.readings.some((r) => r.text === 'συνέηκε'),
      )!;
      await setSiteKind(
        db,
        sample.editionId,
        left.segmentId,
        siteKey(place, left.baseUnits),
        'unreported',
        editor,
      );
      await publishEdition(db, sample.editionId, editor);
      // One small image on A's first page, so that the archive shows how images travel.
      const [page] = await db
        .select()
        .from(pages)
        .where(eq(pages.witnessId, sample.witnessIds.A!))
        .orderBy(pages.position)
        .limit(1);
      // Where uploads are kept: images/<page id>/<file>.
      const imagePath = `images/${page!.id}/original.jpg`;
      await mkdir(path.join(storage, 'images', page!.id), { recursive: true });
      await sharp({
        create: { width: 64, height: 96, channels: 3, background: { r: 236, g: 226, b: 204 } },
      })
        .jpeg({ quality: 70 })
        .toFile(path.join(storage, imagePath));
      await db
        .update(pages)
        .set({
          imageKind: 'upload',
          imagePath,
          imageWidth: 64,
          imageHeight: 96,
          rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
          attribution: 'An example image, made by Varians',
        })
        .where(eq(pages.id, page!.id));

      await rm(outDir, { recursive: true, force: true });
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, 'README.md'), EXAMPLE_README, 'utf8');
      const dir = await writeArchive(db, sample.workId, outDir, {
        storageRoot: storage,
        origin: EXAMPLE_ORIGIN,
      });
      // The same work as a package, as another installation would receive it.
      const pkg = await buildPackage(
        db,
        { id: editor, role: 'administrator' },
        [{ kind: 'work', workId: sample.workId }],
        { storageRoot: storage, origin: EXAMPLE_ORIGIN, name: 'iliad', agent: 'Varians (example)' },
      );
      try {
        await copyFile(pkg.file, path.join(outDir, 'iliad.zip'));
      } finally {
        await pkg.cleanup();
      }
      return dir;
    } finally {
      await pool.end();
    }
  } finally {
    await rm(storage, { recursive: true, force: true });
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}

/** The work directories of the example. */
export async function exampleWorks(exampleDir: string): Promise<string[]> {
  return (await readdir(exampleDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(exampleDir, e.name));
}
