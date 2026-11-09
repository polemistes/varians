/**
 * A check of the archive (PLAN-2 A4): write a work afresh into a temporary
 * directory and compare it file by file with the stored archive, so that the
 * write-through can be shown to produce the same files as a full write.
 */

import type { Database } from '@varians/db';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeArchive, type ArchiveWriters } from './archive.ts';

export interface ArchiveDifferences {
  /** Files a full write has that the stored archive lacks. */
  missing: string[];
  /** Files the stored archive has that a full write does not. */
  extra: string[];
  /** Files whose contents differ. */
  changed: string[];
}

async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (prefix === '' && entry.name === '.git') continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(dir, rel)));
    else out.push(rel);
  }
  return out;
}

/** Compare two archive directories, ignoring `.git`. */
export async function compareArchiveDirs(expected: string, actual: string): Promise<ArchiveDifferences> {
  const want = new Set(await filesUnder(expected));
  const have = new Set(await filesUnder(actual));
  const differences: ArchiveDifferences = { missing: [], extra: [], changed: [] };
  for (const file of want) {
    if (!have.has(file)) differences.missing.push(file);
    else if (!(await readFile(path.join(expected, file))).equals(await readFile(path.join(actual, file)))) differences.changed.push(file);
  }
  for (const file of have) if (!want.has(file)) differences.extra.push(file);
  for (const list of Object.values(differences)) list.sort();
  return differences;
}

/** Write the work afresh and compare it with its stored archive under `root`. */
export async function checkArchive(db: Database, work: { id: string; slug: string }, root: string, writers: ArchiveWriters = {}): Promise<ArchiveDifferences> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-check-'));
  try {
    const fresh = await writeArchive(db, work.id, tmp, writers);
    return await compareArchiveDirs(fresh, path.join(root, work.slug));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export function isClean(d: ArchiveDifferences): boolean {
  return d.missing.length === 0 && d.extra.length === 0 && d.changed.length === 0;
}
