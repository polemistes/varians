/**
 * The command line of Varians, for the server's operator:
 *
 *   pnpm --filter @varians/web cli export-archive <work-slug> [--root DIR]
 *   pnpm --filter @varians/web cli export-all [--root DIR]
 *   pnpm --filter @varians/web cli import-archive <dir>  --user <email>
 *   pnpm --filter @varians/web cli seed-sample --user <email>
 *   pnpm --filter @varians/web cli make-admin <email>
 *
 * Reads DATABASE_URL and STORAGE_DIR from the environment (apps/web/.env is
 * loaded when present).
 */

import { createDatabase, users, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { archiveChangedWorks } from '../src/lib/server/archive/schedule.ts';
import { archiveWork } from '../src/lib/server/archive/archive.ts';
import { importArchive } from '../src/lib/server/archive/import.ts';
import { seedSample } from '../src/lib/server/seed/sample.ts';

async function loadEnv(): Promise<void> {
  try {
    const text = await readFile(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
      if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^"(.*)"$/u, '$1');
    }
  } catch {
    // No .env: the environment must carry the settings.
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  await loadEnv();
  const [command, ...args] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const storage = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? '../../storage');
  const root = flag(args, 'root') ?? path.join(storage, 'archives');
  const { db, pool } = createDatabase(url);
  try {
    switch (command) {
      case 'export-archive': {
        const slug = args[0];
        if (!slug) throw new Error('usage: export-archive <work-slug>');
        const [work] = await db.select({ id: works.id }).from(works).where(eq(works.slug, slug));
        if (!work) throw new Error(`no work with slug ${slug}`);
        const hash = await archiveWork(db, work.id, root, 'manual export', { storageRoot: storage });
        console.log(hash ? `committed ${hash}` : 'nothing changed');
        break;
      }
      case 'export-all': {
        const archived = await archiveChangedWorks(db, root, 'manual export', { storageRoot: storage });
        console.log(`${archived.length} work(s) committed`);
        break;
      }
      case 'import-archive': {
        const dir = args[0];
        const email = flag(args, 'user');
        if (!dir || !email) throw new Error('usage: import-archive <dir> --user <email>');
        const user = await userByEmail(db, email);
        const report = await importArchive(db, path.resolve(dir), user.id);
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      case 'seed-sample': {
        const email = flag(args, 'user');
        if (!email) throw new Error('usage: seed-sample --user <email>');
        const user = await userByEmail(db, email);
        const result = await seedSample(db, user.id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case 'make-admin': {
        const email = args[0];
        if (!email) throw new Error('usage: make-admin <email>');
        const user = await userByEmail(db, email);
        await db.update(users).set({ role: 'administrator' }).where(eq(users.id, user.id));
        console.log(`${email} is now an administrator`);
        break;
      }
      default:
        console.log('commands: export-archive <slug>, export-all, import-archive <dir> --user <email>, seed-sample --user <email>, make-admin <email>');
    }
  } finally {
    await pool.end();
  }
}

async function userByEmail(db: ReturnType<typeof createDatabase>['db'], email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user) throw new Error(`no user ${email}`);
  return user;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
