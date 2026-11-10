/**
 * The command line of Varians, for the server's operator:
 *
 *   pnpm --filter @varians/web cli export-archive <work-slug> [--root DIR]
 *   pnpm --filter @varians/web cli export-all [--root DIR]
 *   pnpm --filter @varians/web cli check-archive [<work-slug>] [--root DIR]
 *   pnpm --filter @varians/web cli write-example [--out DIR]
 *   pnpm --filter @varians/web cli export-package (--work <slug> | --edition <slug> | --transcription <id> | --all) --out <file.zip>
 *   pnpm --filter @varians/web cli export-all --package <file.zip>
 *   pnpm --filter @varians/web cli pull <work-slug> <address there> --user <email> [--token T] [--on-conflict keep|take] [--dry-run]
 *   pnpm --filter @varians/web cli push <work-slug> <address there> --user <email> --token T
 *   pnpm --filter @varians/web cli import-archive <dir> --user <email> [--on-conflict keep|take] [--dry-run]
 *   pnpm --filter @varians/web cli seed-sample --user <email>
 *   pnpm --filter @varians/web cli make-admin <email>
 *   pnpm --filter @varians/web cli reset-password <email>
 *   pnpm --filter @varians/web cli confirm-email <email>
 *   pnpm --filter @varians/web cli conform-pages
 *   pnpm --filter @varians/web cli version
 *
 * In a release the same commands are `bin/varians cli <command> ...`.
 *
 * Reads DATABASE_URL, STORAGE_DIR and ORIGIN from the environment (then from
 * the file VARIANS_ENV_FILE names, then from apps/web/.env; see env.ts).
 */

import { createDatabase, editions, sql, users, works } from '@varians/db';
import { eq } from 'drizzle-orm';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { archiveChangedWorks } from '../src/lib/server/archive/schedule.ts';
import { archiveWork } from '../src/lib/server/archive/archive.ts';
import { checkArchive, isClean } from '../src/lib/server/archive/check.ts';
import { writeExample } from '../src/lib/server/archive/example.ts';
import { importPackage } from '../src/lib/server/archive/import-package.ts';
import { buildPackage, type PackageScope } from '../src/lib/server/archive/package.ts';
import {
  addRemote,
  httpTransport,
  parseRemoteAddress,
  pullRemote,
  pushRemote,
  remotesOf,
  transportOf,
} from '../src/lib/server/sync.ts';
import { confirmEmailDirectly, makeResetLinkFor } from '../src/lib/server/account-mail.ts';
import { seedSample } from '../src/lib/server/seed/sample.ts';
import { conformAll, formatConformance } from '../src/lib/server/conform.ts';
import { pageStrings } from '../src/lib/strings/pages.ts';
import { site } from '../src/lib/strings/site.ts';
import { formatVersion } from '../src/lib/version-format.ts';
import { loadEnv } from './env.ts';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

/** The version of this Varians: fixed by the bundling of the scripts (vite.scripts.config.ts); from source, the package's version alone. */
function cliVersion(): string {
  const version =
    typeof __VARIANS_VERSION__ === 'string'
      ? __VARIANS_VERSION__
      : (process.env.npm_package_version ?? 'unknown');
  const commit = typeof __VARIANS_COMMIT__ === 'string' ? __VARIANS_COMMIT__ : '';
  return formatVersion(version, commit);
}

async function main(): Promise<void> {
  loadEnv();
  const [command, ...args] = process.argv.slice(2);
  if (command === 'version') {
    console.log(cliVersion());
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
        const hash = await archiveWork(db, work.id, root, 'manual export', {
          storageRoot: storage,
        });
        console.log(hash ? `committed ${hash}` : 'nothing changed');
        break;
      }
      case 'export-all': {
        const archived = await archiveChangedWorks(db, root, 'manual export', {
          storageRoot: storage,
        });
        console.log(`${archived.length} work(s) committed`);
        // With --package, the whole installation as a package as well.
        const out = flag(args, 'package');
        if (out) await writePackage(db, [{ kind: 'installation' }], out, storage);
        break;
      }
      case 'export-package': {
        // export-package (--work <slug> | --edition <slug> | --transcription <id> | --all) --out <file.zip>
        const out = flag(args, 'out');
        if (!out)
          throw new Error(
            'usage: export-package (--work <slug> | --edition <slug> | --transcription <id> | --all) --out <file.zip>',
          );
        const scopes: PackageScope[] = [];
        const workSlug = flag(args, 'work');
        if (workSlug) {
          const [w] = await db.select({ id: works.id }).from(works).where(eq(works.slug, workSlug));
          if (!w) throw new Error(`no work with slug ${workSlug}`);
          scopes.push({ kind: 'work', workId: w.id });
        }
        const editionSlug = flag(args, 'edition');
        if (editionSlug) {
          const [e] = await db
            .select({ id: editions.id })
            .from(editions)
            .where(eq(editions.slug, editionSlug));
          if (!e) throw new Error(`no edition with slug ${editionSlug}`);
          scopes.push({ kind: 'edition', editionId: e.id });
        }
        const transcriptionId = flag(args, 'transcription');
        if (transcriptionId) scopes.push({ kind: 'transcription', transcriptionId });
        if (args.includes('--all')) scopes.push({ kind: 'installation' });
        if (scopes.length === 0)
          throw new Error('name what to package: --work, --edition, --transcription or --all');
        await writePackage(db, scopes, out, storage);
        break;
      }
      case 'check-archive': {
        const slug = args[0] && !args[0].startsWith('--') ? args[0] : null;
        const list = await db
          .select({ id: works.id, slug: works.slug })
          .from(works)
          .where(slug ? eq(works.slug, slug) : undefined);
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
        const out = path.resolve(
          flag(args, 'out') ?? path.join(process.cwd(), '..', '..', 'docs', 'formats', 'example'),
        );
        const dir = await writeExample(url, out);
        console.log(`wrote ${dir}`);
        break;
      }
      case 'import-archive': {
        const dir = args[0];
        const email = flag(args, 'user');
        if (!dir || !email)
          throw new Error(
            'usage: import-archive <dir> --user <email> [--on-conflict keep|take] [--dry-run]',
          );
        const policy = flag(args, 'on-conflict');
        if (policy !== undefined && policy !== 'keep' && policy !== 'take')
          throw new Error('--on-conflict is keep or take');
        const user = await userByEmail(db, email);
        // A package (zip or bag), a zipped archive, or an archive directory.
        const result = await importPackage(db, path.resolve(dir), user.id, {
          ...(policy ? { onConflict: policy } : {}),
          dryRun: args.includes('--dry-run'),
          source: path.basename(path.resolve(dir)),
        });
        if (result.refused) {
          console.log(`Nothing was imported: ${result.refused}`);
          for (const p of result.problems) console.log(`  ${p.file}: ${p.message}`);
          process.exitCode = 1;
          break;
        }
        if (result.bag) console.log('The checksums of the package are right.');
        if (result.dryRun) console.log('A preview: nothing was changed.');
        for (const report of result.works) {
          console.log(`work ${report.workId}`);
          for (const d of report.documents) {
            const where = d.segments.length ? ` (segments ${d.segments.join(', ')})` : '';
            const why =
              d.result === 'conflict' ? `: ${site.import.result(d.result, d.reason)}` : '';
            console.log(`  ${d.result.padEnd(12)} ${d.kind} ${d.name}${where}${why}`);
          }
          for (const m of report.matches)
            console.log(
              `  matched      ${m.kind} ${m.incomingId} to ${m.localId} by ${m.by}${m.value ? ` ${m.value}` : ''}`,
            );
          for (const w of report.possibleDuplicates)
            console.log(`  duplicate?   witness ${w.name} may be ${w.localName} (${w.localId})`);
          if (report.persons.created)
            console.log(`  persons new here: ${report.persons.createdNames.join(', ')}`);
          for (const w of report.warnings) console.log(`  warning: ${w}`);
          if (report.documents.some((d) => d.result === 'conflict')) {
            console.log(
              'Conflicting documents were left as they are: import again with --on-conflict keep or --on-conflict take.',
            );
            process.exitCode = 2;
          }
        }
        break;
      }
      case 'pull':
      case 'push': {
        // pull <work-slug> <address of the work there> --user <email> [--token T] [--on-conflict keep|take] [--dry-run]
        // push <work-slug> <address of the work there> --user <email> --token T
        const [slug, address] = args;
        const email = flag(args, 'user');
        if (!slug || !address || !email)
          throw new Error(
            `usage: ${command} <work-slug> <address of the work there> --user <email> [--token <token>]`,
          );
        const [work] = await db.select({ id: works.id }).from(works).where(eq(works.slug, slug));
        if (!work) throw new Error(`no work with slug ${slug}`);
        const parsed = parseRemoteAddress(address);
        if (!parsed)
          throw new Error(
            'give the address of the work there, such as https://example.org/works/iliad',
          );
        const user = await userByEmail(db, email);
        const token = flag(args, 'token') ?? null;
        const transport = httpTransport(parsed.origin, parsed.slug, token);
        const known = (await remotesOf(db, work.id)).find(
          (r) => r.origin === parsed.origin && r.remoteSlug === parsed.slug,
        );
        // The token is kept only where SECRET_KEY allows; otherwise it is used for this run alone.
        const remote =
          known ??
          (
            await addRemote(
              db,
              user,
              work.id,
              address,
              token && process.env.SECRET_KEY ? token : null,
              transport,
            )
          ).remote;
        if (command === 'push') {
          if (!token && !remote.token)
            throw new Error('pushing needs --token, a token of an account there');
          console.log(
            JSON.stringify(
              await pushRemote(db, user, remote, {
                transport: token ? transport : transportOf(remote, user.id),
                storageRoot: storage,
              }),
              null,
              2,
            ),
          );
          break;
        }
        const policy = flag(args, 'on-conflict');
        if (policy !== undefined && policy !== 'keep' && policy !== 'take')
          throw new Error('--on-conflict is keep or take');
        const report = await pullRemote(db, user, remote, {
          transport: token || !remote.token ? transport : transportOf(remote, user.id),
          dryRun: args.includes('--dry-run'),
          ...(policy ? { policy } : {}),
        });
        if (report.refused) {
          console.log(`Nothing was imported: ${report.refused}`);
          process.exitCode = 1;
          break;
        }
        for (const w of report.works)
          for (const d of w.documents)
            console.log(
              `  ${d.result.padEnd(12)} ${d.kind} ${d.name}${d.segments.length ? ` (segments ${d.segments.join(', ')})` : ''}${d.result === 'conflict' ? `: ${site.import.result(d.result, d.reason)}` : ''}`,
            );
        if (report.works.some((w) => w.documents.some((d) => d.result === 'conflict')))
          process.exitCode = 2;
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
        const made = await makeResetLinkFor(db, email, {
          name: process.env.SITE_NAME?.trim() || 'Varians',
          origin: origin.replace(/\/+$/u, ''),
        });
        if (!made) throw new Error(`no user ${email}`);
        console.log(
          `A link to set a new password for ${made.account.name}, valid until ${made.expiresAt.toISOString()} and for one use:`,
        );
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
      case 'conform-pages': {
        // Once after updating to pages as containers of text: every transcript's page breaks name its witness's pages, once, in order. A second run does nothing.
        const outcomes = await conformAll(db, pageStrings.history.reorganized);
        for (const outcome of outcomes) console.log(formatConformance(outcome));
        break;
      }
      default:
        console.log(
          'commands: pull <slug> <address> --user <email>, push <slug> <address> --user <email> --token <t>, export-archive <slug>, export-all [--package <file>], export-package --work|--edition|--transcription|--all --out <file>, check-archive [<slug>], write-example, import-archive <dir> --user <email> [--on-conflict keep|take] [--dry-run], seed-sample --user <email>, make-admin <email>, reset-password <email>, confirm-email <email>, conform-pages, version',
        );
    }
  } finally {
    await pool.end();
  }
}

/** Write a package for the operator: everything, drafts included, as an administrator sees it; review positions stay out. */
async function writePackage(
  db: ReturnType<typeof createDatabase>['db'],
  scopes: PackageScope[],
  out: string,
  storage: string,
): Promise<void> {
  const pkg = await buildPackage(db, { id: 'operator', role: 'administrator' }, scopes, {
    storageRoot: storage,
    ...(process.env.ORIGIN ? { origin: process.env.ORIGIN } : {}),
    agent: `Varians ${cliVersion()}`,
  });
  try {
    await copyFile(pkg.file, path.resolve(out));
    console.log(`wrote ${path.resolve(out)}`);
  } finally {
    await pkg.cleanup();
  }
}

async function userByEmail(db: ReturnType<typeof createDatabase>['db'], email: string) {
  // Addresses are kept as typed and compared without regard to case, as at login.
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
  if (!user) throw new Error(`no user ${email}`);
  return user;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
