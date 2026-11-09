/**
 * Importing a package, a zipped archive or an archive directory (PLAN-2 E4):
 * open it (checking a bag's checksums), check its files against the schemas,
 * and import each of its works, or preview the import without changing
 * anything.
 */

import type { Database } from '@varians/db';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { FORMAT_VERSION } from './archive.ts';
import { importArchive, ImportRefused, type ImportOptions, type ImportReport } from './import.ts';
import { openPackage, openPackageZip, PackageError, type ExtractLimits } from './package.ts';
import { validateArchiveDir, type ValidationProblem } from './validate.ts';

/** What a package sent over the web may unpack to: enough for a large work with its images, not enough to fill the disk. */
export const WEB_LIMITS: ExtractLimits = { maxEntries: 50_000, maxBytes: 1024 * 1024 * 1024 };

export interface PackageImportReport {
  /** Whether it was a bag whose checksums were verified. */
  bag: boolean;
  info: Record<string, string>;
  works: ImportReport[];
  /** Files that do not follow the format; none when the import went ahead. */
  problems: ValidationProblem[];
  /** Why nothing was imported, when it was not. */
  refused: string | null;
  dryRun: boolean;
}

/** Import a package (a zip file, or a directory holding a bag or archives). */
export async function importPackage(db: Database, source: string, userId: string, options: ImportOptions & { limits?: ExtractLimits } = {}): Promise<PackageImportReport> {
  const isFile = existsSync(source) && statSync(source).isFile();
  let opened;
  try {
    opened = isFile ? await openPackageZip(source, options.limits) : { ...(await openPackage(source)), dir: null };
  } catch (cause) {
    if (cause instanceof PackageError) return { bag: false, info: {}, works: [], problems: [], refused: cause.message, dryRun: options.dryRun ?? false };
    throw cause;
  }
  try {
    const base: Omit<PackageImportReport, 'works' | 'problems' | 'refused'> = { bag: opened.bag, info: opened.info, dryRun: options.dryRun ?? false };
    if (opened.workDirs.length === 0) return { ...base, works: [], problems: [], refused: 'The package holds no archive of a work (no work.json).' };
    // Files written in this version of the format, or a later one, are checked against its schemas; version 1 archives have none.
    const problems: ValidationProblem[] = [];
    for (const dir of opened.workDirs) {
      const version = Number((JSON.parse(await readFile(path.join(dir, 'work.json'), 'utf8')) as { formatVersion?: unknown }).formatVersion ?? 1);
      if (version > FORMAT_VERSION) return { ...base, works: [], problems: [], refused: `The package is written in version ${version} of the format; this installation reads versions up to ${FORMAT_VERSION}.` };
      if (version < 2) continue;
      for (const p of await validateArchiveDir(dir)) problems.push({ file: `${path.basename(dir)}/${p.file}`, message: p.message });
    }
    if (problems.length) return { ...base, works: [], problems, refused: 'Files of the package do not follow the format.' };
    const works: ImportReport[] = [];
    for (const dir of opened.workDirs) {
      try {
        works.push(await importArchive(db, dir, userId, options));
      } catch (cause) {
        if (cause instanceof ImportRefused) return { ...base, works, problems: [], refused: cause.message };
        throw cause;
      }
    }
    return { ...base, works, problems: [], refused: null };
  } finally {
    if (opened.dir) await rm(opened.dir, { recursive: true, force: true });
  }
}
