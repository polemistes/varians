/**
 * The command line of Varians, for the server's operator:
 *
 *   pnpm --filter @varians/web cli export-archive <work-slug> [--root DIR]
 *   pnpm --filter @varians/web cli export-all [--root DIR]
 *   pnpm --filter @varians/web cli check-archive [<work-slug>] [--root DIR]
 *   pnpm --filter @varians/web cli write-example [--out DIR]
 *   pnpm --filter @varians/web cli import-archive <dir>  --user <email>
 *   pnpm --filter @varians/web cli seed-sample --user <email>
 *   pnpm --filter @varians/web cli make-admin <email>
 *   pnpm --filter @varians/web cli reset-password <email>
 *   pnpm --filter @varians/web cli confirm-email <email>
 *   pnpm --filter @varians/web cli version
 *
 * In a release the same commands are `bin/varians cli <command> ...`.
 *
 * Reads DATABASE_URL, STORAGE_DIR and ORIGIN from the environment (then from
 * the file VARIANS_ENV_FILE names, then from apps/web/.env; see env.ts).
 */

import { createDatabase, sql, users, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { archiveChangedWorks } from '../src/lib/server/archive/schedule.ts';
import { archiveWork } from '../src/lib/server/archive/archive.ts';
import { checkArchive, isClean } from '../src/lib/server/archive/check.ts';
import { writeExample } from '../src/lib/server/archive/example.ts';
import { importArchive } from '../src/lib/server/archive/import.ts';
import { confirmEmailDirectly, makeResetLinkFor } from '../src/lib/server/account-mail.ts';
import { seedSample } from '../src/lib/server/seed/sample.ts';
import { formatVersion } from '../src/lib/version-format.ts';
import { loadEnv } from './env.ts';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnv();
  const [command, ...args] = process.argv.slice(2);
  if (command === 'version') {
    // Fixed by the bundling of the scripts (vite.scripts.config.ts); from source, the package's version alone.
    const version = typeof __VARIANS_VERSION__ === 'string' ? __VARIANS_VERSION__ : process.env.npm_package_version ?? 'unknown';
    const commit = typeof __VARIANS_COMMIT__ === 'string' ? __VARIANS_COMMIT__ : '';
    console.log(formatVersion(version, commit));
    return;
  }
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
      case 'check-archive': {
        const slug = args[0] && !args[0].startsWith('--') ? args[0] : null;
        const list = await db.select({ id: works.id, slug: works.slug }).from(works).where(slug ? eq(works.slug, slug) : undefined);
        if (slug && list.length === 0) throw new Error(`no work with slug ${slug}`);
        let clean = true;
        for (const work of list) {
          const d = await checkArchive(db, work, root, { storageRoot: storage });
          if (isClean(d)) {
            console.log(`${work.slug}: the same`);
            continue;
          }
          clean = false;
          console.log(`${work.slug}:`);
          for (const f of d.missing) console.log(`  missing  ${f}`);
          for (const f of d.extra) console.log(`  extra    ${f}`);
          for (const f of d.changed) console.log(`  changed  ${f}`);
        }
        if (!clean) process.exitCode = 1;
        break;
      }
      case 'write-example': {
        // The example of the format, built in a database of its own on the same server (docs/formats/example).
        const out = path.resolve(flag(args, 'out') ?? path.join(process.cwd(), '..', '..', 'docs', 'formats', 'example'));
        const dir = await writeExample(url, out);
        console.log(`wrote ${dir}`);
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
      case 'reset-password': {
        // For an installation without mail: a link to hand to the person, by a means the operator trusts.
        const email = args[0];
        if (!email) throw new Error('usage: reset-password <email>');
        const origin = process.env.ORIGIN?.trim();
        if (!origin) throw new Error('ORIGIN is not set; the link is made from it');
        const made = await makeResetLinkFor(db, email, { name: process.env.SITE_NAME?.trim() || 'Varians', origin: origin.replace(/\/+$/u, '') });
        if (!made) throw new Error(`no user ${email}`);
        console.log(`A link to set a new password for ${made.account.name}, valid until ${made.expiresAt.toISOString()} and for one use:`);
        console.log(made.link);
        break;
      }
      case 'confirm-email': {
        const email = args[0];
        if (!email) throw new Error('usage: confirm-email <email>');
        if (!(await confirmEmailDirectly(db, email))) throw new Error(`no user ${email}`);
        console.log(`The address ${email} is confirmed`);
        break;
      }
      default:
        console.log(
          'commands: export-archive <slug>, export-all, check-archive [<slug>], write-example, import-archive <dir> --user <email> [--on-conflict keep|take] [--dry-run], seed-sample --user <email>, make-admin <email>, reset-password <email>, confirm-email <email>, version',
        );
    }
  } finally {
    await pool.end();
  }
}

async function userByEmail(db: ReturnType<typeof createDatabase>['db'], email: string) {
  // Addresses are kept as typed and compared without regard to case, as at login.
  const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
  if (!user) throw new Error(`no user ${email}`);
  return user;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
