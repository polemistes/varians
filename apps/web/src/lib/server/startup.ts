/**
 * Things the server starts once per process: the nightly archive pass and
 * the write-through of changed records into the archive.
 * Imported by hooks.server.ts; a no-op while building and in tests.
 */
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import path from 'node:path';
import { markChangedWorks, startArchiveScheduler } from './archive/schedule.ts';
import { startArchiveWriter } from './archive/queue.ts';
import { pullDueRemotes } from './sync.ts';
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
  const delay = Number(env.ARCHIVE_WRITE_DELAY_SECONDS ?? '60');
  const delaySeconds = Number.isFinite(delay) && delay >= 0 ? delay : 60;
  // Changes made while the server was down, or before the queue existed, are written too.
  void markChangedWorks(db).catch((cause) =>
    console.error('archive: marking changed works failed', cause),
  );
  startArchiveWriter(db, { root: archiveRoot(), storageRoot: storageRoot(), delaySeconds });
  // Remotes set to be pulled every so many hours: looked at hourly.
  const pulls = setInterval(
    () =>
      void pullDueRemotes(db).catch((cause) =>
        console.error('sync: scheduled pulls failed', cause),
      ),
    60 * 60 * 1000,
  );
  pulls.unref?.();
}
