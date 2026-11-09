/**
 * Things the server starts once per process: the nightly archive pass.
 * Imported by hooks.server.ts; a no-op while building and in tests.
 */
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import path from 'node:path';
import { startArchiveScheduler } from './archive/schedule.ts';
import { storageDir } from './images/storage.ts';
import { db } from './db';

let started = false;

/** The storage root: one setting, read in one place (images/storage.ts). */
export function storageRoot(): string {
  return storageDir();
}

export function archiveRoot(): string {
  return path.join(storageRoot(), 'archives');
}

export function startBackgroundWork(): void {
  if (started || building || env.ARCHIVE_SCHEDULER === 'off' || process.env.VITEST) return;
  started = true;
  const hours = Number(env.ARCHIVE_INTERVAL_HOURS ?? '24');
  startArchiveScheduler({
    db,
    root: archiveRoot(),
    storageRoot: storageRoot(),
    intervalMs: Math.max(1, hours) * 60 * 60 * 1000,
  });
}
