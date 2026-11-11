/**
 * Sync between installations (Data Format 2 section 11):
 * explicit, by a maintainer. An installation exposes what it holds of a
 * work (sync.json) and the work's package; another compares, pulls the
 * package and imports it as section 5.3 says, or pushes its own package to
 * the first with a token, which imports it keeping its own text where the
 * two conflict. No live replication.
 */

import {
  licenceCompatible,
  licenceInfo,
  newId,
  isDataLicence,
  type DataLicence,
} from '@varians/core';
import {
  changesets,
  editionSigla,
  editions,
  transcriptionSegments,
  transcriptionWorks,
  transcriptions,
  users,
  workRemotes,
  type Database,
} from '@varians/db';
import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FORMAT_BASE, FORMAT_VERSION } from './archive/archive.ts';
import { importPackage, type PackageImportReport } from './archive/import-package.ts';
import type { ConflictPolicy } from './archive/import.ts';
import { buildPackage, scopeFilters } from './archive/package.ts';
import { isAdministrator, type Actor } from './authz.ts';
import { readTextCapped, safeFetch } from './safe-fetch.ts';
import { dataLicence } from './settings.ts';
import { decryptSecret, encryptSecret } from './tokens.ts';

export interface SyncDocument {
  id: string;
  kind: 'transcription' | 'edition';
  head: string | null;
  version: number;
}

export interface SyncState {
  $schema: string;
  formatVersion: number;
  origin: string;
  workId: string;
  licence: string;
  documents: SyncDocument[];
}

async function headAt(
  db: Database,
  kind: 'transcription' | 'edition',
  id: string,
  upTo: number | null,
): Promise<string | null> {
  const [row] = await db
    .select({ id: changesets.id })
    .from(changesets)
    .where(
      and(
        eq(changesets.documentKind, kind),
        eq(changesets.documentId, id),
        isNotNull(changesets.version),
        upTo !== null ? lte(changesets.version, upTo) : undefined,
      ),
    )
    .orderBy(desc(changesets.version))
    .limit(1);
  return row?.id ?? null;
}

/** The transcriptions in a work's archive: chosen for it, assigning text to it, or named by a conspectus of one of its editions. */
async function connectedTranscriptions(db: Database, workId: string) {
  const ids = new Set<string>();
  for (const r of await db
    .selectDistinct({ id: transcriptionSegments.transcriptionId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId)))
    ids.add(r.id);
  for (const r of await db
    .select({ id: transcriptionWorks.transcriptionId })
    .from(transcriptionWorks)
    .where(eq(transcriptionWorks.workId, workId)))
    ids.add(r.id);
  for (const r of await db
    .select({ id: editionSigla.transcriptionId })
    .from(editionSigla)
    .innerJoin(editions, eq(editions.id, editionSigla.editionId))
    .where(eq(editions.workId, workId)))
    if (r.id) ids.add(r.id);
  return ids.size
    ? db
        .select()
        .from(transcriptions)
        .where(inArray(transcriptions.id, [...ids]))
    : [];
}

/** What this installation holds of a work, as a viewer may see it: the documents with their heads. Null when there is no such work. */
export async function syncState(
  db: Database,
  viewer: Actor | null,
  workId: string,
  origin: string,
): Promise<SyncState | null> {
  const filters = await scopeFilters(db, viewer, [{ kind: 'work', workId }]);
  const only = filters.get(workId);
  if (!only) return null;
  const documents: SyncDocument[] = [];
  for (const t of await connectedTranscriptions(db, workId)) {
    if (!only.transcription(t)) continue;
    documents.push({
      id: t.id,
      kind: 'transcription',
      head: await headAt(db, 'transcription', t.id, null),
      version: t.version,
    });
  }
  for (const e of await db.select().from(editions).where(eq(editions.workId, workId))) {
    if (!only.edition(e)) continue;
    const working = only.editionWorking(e);
    if (!working && e.publishedVersion === null) continue;
    const version = working ? e.version : e.publishedVersion!;
    documents.push({
      id: e.id,
      kind: 'edition',
      head: await headAt(db, 'edition', e.id, working ? null : version),
      version,
    });
  }
  documents.sort((a, b) => a.id.localeCompare(b.id));
  return {
    $schema: `${FORMAT_BASE}sync.schema.json`,
    formatVersion: FORMAT_VERSION,
    origin,
    workId,
    licence: dataLicence(),
    documents,
  };
}

/** How another installation is reached: over HTTP, or directly in the tests. */
export interface RemoteTransport {
  sync(): Promise<SyncState>;
  /** The work's package, as a zip file in a temporary directory, which the caller removes. */
  download(): Promise<{ file: string; cleanup(): Promise<void> }>;
  /** Send a package; the other installation's report comes back. */
  upload(file: string): Promise<unknown>;
}

export class RemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** An address of a work on another installation, as a person copies it: https://example.org/works/iliad. */
export function parseRemoteAddress(address: string): { origin: string; slug: string } | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = /^\/works\/([^/]+)\/?$/u.exec(url.pathname);
  if (!match) return null;
  return { origin: url.origin, slug: decodeURIComponent(match[1]!) };
}

const MAX_PACKAGE = 2 * 1024 * 1024 * 1024;

/** Another installation over HTTP, through the guarded fetch (public addresses only). */
export function httpTransport(
  origin: string,
  slug: string,
  token: string | null,
  allow?: (address: string) => boolean,
): RemoteTransport {
  const base = `${origin.replace(/\/+$/u, '')}/works/${encodeURIComponent(slug)}`;
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const opts = allow ? { allow } : {};
  return {
    async sync() {
      const response = await safeFetch(`${base}/sync.json`, {
        headers: { accept: 'application/json', ...auth },
        ...opts,
      });
      if (!response.ok)
        throw new RemoteError(
          `The other installation answered ${response.status} for the work's state.`,
        );
      const state = JSON.parse(await readTextCapped(response, 5 * 1024 * 1024)) as SyncState;
      if (typeof state.workId !== 'string' || !Array.isArray(state.documents))
        throw new RemoteError('The other installation did not answer with the state of a work.');
      return state;
    },
    async download() {
      const response = await safeFetch(`${base}/package.zip`, { headers: auth, ...opts });
      if (!response.ok || !response.body)
        throw new RemoteError(
          `The other installation answered ${response.status} for the package.`,
        );
      const dir = await mkdtemp(path.join(os.tmpdir(), 'varians-pull-'));
      const file = path.join(dir, 'package.zip');
      let bytes = 0;
      const counted = Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream,
      ).on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PACKAGE) counted.destroy(new RemoteError('The package is too large.'));
      });
      try {
        await pipeline(counted, createWriteStream(file));
      } catch (cause) {
        await rm(dir, { recursive: true, force: true });
        throw cause;
      }
      return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
    },
    async upload(file) {
      if (!token)
        throw new RemoteError('Pushing needs a token of an account on the other installation.');
      const response = await safeFetch(`${origin.replace(/\/+$/u, '')}/api/import`, {
        method: 'POST',
        body: await readFile(file),
        headers: { 'content-type': 'application/zip', accept: 'application/json', ...auth },
        ...opts,
      });
      const text = await readTextCapped(response, 5 * 1024 * 1024);
      if (!response.ok)
        throw new RemoteError(
          `The other installation refused the package (${response.status}): ${text.slice(0, 300)}`,
        );
      return JSON.parse(text) as unknown;
    },
  };
}

export type DocumentDifference = 'same' | 'differs' | 'only-there' | 'only-here';

/** Which documents differ between this installation and another's state. */
export async function compareSync(
  db: Database,
  viewer: Actor | null,
  workId: string,
  theirs: SyncState,
): Promise<{ id: string; kind: string; difference: DocumentDifference }[]> {
  const ours = await syncState(db, viewer, workId, '');
  const mine = new Map((ours?.documents ?? []).map((d) => [d.id, d] as const));
  const out: { id: string; kind: string; difference: DocumentDifference }[] = [];
  for (const d of theirs.documents) {
    const here = mine.get(d.id);
    out.push({
      id: d.id,
      kind: d.kind,
      difference: !here ? 'only-there' : here.head === d.head ? 'same' : 'differs',
    });
    mine.delete(d.id);
  }
  for (const d of mine.values()) out.push({ id: d.id, kind: d.kind, difference: 'only-here' });
  return out;
}

/** Whether records under a remote's licence may come here; a plain refusal naming both otherwise. */
export function licenceRefusal(theirs: string): string | null {
  const ours = dataLicence();
  if (!isDataLicence(theirs))
    return `The other installation names no licence this installation knows (${theirs}).`;
  if (licenceCompatible(theirs as DataLicence, ours)) return null;
  return `Records licensed under ${licenceInfo(theirs)!.name} cannot be published under ${licenceInfo(ours)!.name}, the licence of this installation.`;
}

export type Remote = typeof workRemotes.$inferSelect;

/** How to reach a remote as an account: with the stored token only for the account that gave it, without one for the other maintainers. */
export function transportOf(remote: Remote, userId: string): RemoteTransport {
  const own = remote.token && remote.createdBy === userId;
  return httpTransport(remote.origin, remote.remoteSlug, own ? decryptSecret(remote.token!) : null);
}

/** Whether an account may use the remote's token (to push, or to pull drafts). */
export function usesToken(remote: Remote, userId: string): boolean {
  return remote.token !== null && remote.createdBy === userId;
}

/** Record another installation's copy of a work, after asking it for its state. */
export async function addRemote(
  db: Database,
  user: Actor,
  workId: string,
  address: string,
  token: string | null,
  transport?: RemoteTransport,
): Promise<{ remote: Remote; state: SyncState }> {
  const parsed = parseRemoteAddress(address);
  if (!parsed)
    throw new RemoteError(
      'Give the address of the work on the other installation, such as https://example.org/works/iliad.',
    );
  if (token && parsed.origin.startsWith('http:'))
    throw new RemoteError('A token is sent only to an address that begins with https.');
  const reach = transport ?? httpTransport(parsed.origin, parsed.slug, token);
  const state = await reach.sync();
  const [remote] = await db
    .insert(workRemotes)
    .values({
      id: newId(),
      workId,
      origin: parsed.origin,
      remoteWorkId: state.workId,
      remoteSlug: parsed.slug,
      token: token ? encryptSecret(token) : null,
      createdBy: user.id,
    })
    .returning();
  return { remote: remote!, state };
}

/** Pull a remote: its package imported here as section 5.3 says, or previewed. */
export async function pullRemote(
  db: Database,
  user: Actor,
  remote: Remote,
  options: { policy?: ConflictPolicy; dryRun?: boolean; transport?: RemoteTransport } = {},
): Promise<PackageImportReport> {
  const transport = options.transport ?? transportOf(remote, user.id);
  const state = await transport.sync();
  const refusal = licenceRefusal(state.licence);
  const base = { bag: false, info: {}, works: [], problems: [], dryRun: options.dryRun ?? false };
  if (refusal) return { ...base, refused: refusal };
  if (state.workId !== remote.remoteWorkId)
    return {
      ...base,
      refused: 'The other installation now answers with another work at this address.',
    };
  const pkg = await transport.download();
  try {
    const report = await importPackage(db, pkg.file, user.id, {
      ...(isAdministrator(user) ? {} : { actor: user }),
      onConflict: options.policy ?? 'report',
      dryRun: options.dryRun ?? false,
      source: remote.origin,
    });
    if (!options.dryRun)
      await db
        .update(workRemotes)
        .set({ lastPulledAt: new Date(), lastReport: summary(report) })
        .where(eq(workRemotes.id, remote.id));
    return report;
  } finally {
    await pkg.cleanup();
  }
}

/** Push this installation's package of the work to a remote, which imports it keeping its own text where they conflict. */
export async function pushRemote(
  db: Database,
  user: Actor,
  remote: Remote,
  options: { transport?: RemoteTransport; storageRoot?: string; origin?: string } = {},
): Promise<unknown> {
  const transport = options.transport ?? transportOf(remote, user.id);
  const pkg = await buildPackage(db, user, [{ kind: 'work', workId: remote.workId }], {
    ...(options.storageRoot ? { storageRoot: options.storageRoot } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  });
  try {
    const report = await transport.upload(pkg.file);
    await db
      .update(workRemotes)
      .set({ lastReport: { pushed: new Date().toISOString(), report } })
      .where(eq(workRemotes.id, remote.id));
    return report;
  } finally {
    await pkg.cleanup();
  }
}

/** What a pull did, briefly, for the work's page. */
export function summary(report: PackageImportReport): unknown {
  return {
    at: new Date().toISOString(),
    refused: report.refused,
    documents: report.works.flatMap((w) =>
      w.documents.map((d) => ({
        name: d.name,
        kind: d.kind,
        result: d.result,
        segments: d.segments,
        // Why two texts conflict, for the wording of the report; other reasons stay here.
        ...(d.result === 'conflict' && d.reason ? { reason: d.reason } : {}),
      })),
    ),
  };
}

/** The remotes of a work. */
export async function remotesOf(db: Database, workId: string): Promise<Remote[]> {
  return db
    .select()
    .from(workRemotes)
    .where(eq(workRemotes.workId, workId))
    .orderBy(workRemotes.createdAt);
}

/** Pull every remote whose interval has passed, conflicts reported and left; for the scheduler. */
export async function pullDueRemotes(
  db: Database,
  log: (m: string) => void = console.log,
): Promise<number> {
  let pulled = 0;
  for (const remote of await db
    .select()
    .from(workRemotes)
    .where(isNotNull(workRemotes.pullEveryHours))) {
    const due =
      !remote.lastPulledAt ||
      Date.now() - remote.lastPulledAt.getTime() >= remote.pullEveryHours! * 3600_000;
    if (!due || !remote.createdBy) continue;
    const [account] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, remote.createdBy));
    if (!account) continue;
    try {
      await pullRemote(db, account, remote, { policy: 'report' });
      pulled++;
    } catch (error) {
      log(
        `sync: pulling ${remote.origin} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return pulled;
}
