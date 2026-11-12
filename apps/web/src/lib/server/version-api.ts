/**
 * The JSON endpoints of versions, for editions and transcriptions alike:
 * publish with a note, withdraw with a note, delete, list the versions with
 * their changes, and the changes since the version before for the Publish…
 * window. Only the owner or an administrator publishes and withdraws, only an
 * administrator deletes, and only they are answered here; readers are given
 * the versions with the reader's page.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { Database, DocumentKind } from '@varians/db';
import { commitDocument } from './archive/commits';
import { canDeleteVersions, type Actor } from './authz';
import { loadEditionAccess } from './edition-access';
import {
  MAX_NOTE,
  PublishRefused,
  deleteVersion,
  publishEdition,
  publishTranscription,
  withdrawVersion,
} from './publish';
import { parseVersionNumber } from './reader-pages';
import { archiveRoot, storageRoot } from './startup';
import { loadTranscriptionAccess } from './transcription-access';
import { changesSinceLatest, versionsOf } from './versions';
import { versionStrings as v } from '$lib/strings/versions';

/** The record a request names, with the requester's rights on it; a 404 for one they may not see. */
async function accessOf(
  db: Database,
  user: Actor | null,
  kind: DocumentKind,
  id: string,
): Promise<{ id: string; canPublish: boolean }> {
  if (kind === 'edition') {
    const access = await loadEditionAccess(db, user, id);
    if (!access || !access.canView) error(404, 'Not found');
    return { id: access.edition.id, canPublish: access.canPublish };
  }
  const access = await loadTranscriptionAccess(db, user, id);
  if (!access || !access.canView) error(404, 'Not found');
  return { id: access.transcription.id, canPublish: access.canPublish };
}

const note = z
  .string()
  .max(MAX_NOTE, v.noteTooLong(MAX_NOTE))
  .nullish()
  .transform((n) => n ?? null);
const publishBody = z.object({ note });
const withdrawBody = z.object({ number: z.number().int().positive(), note });

async function bodyOf<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed request');
  return parsed.data;
}

/** The archive follows a publication or a withdrawal; a failure there must not undo it. */
async function archiveAfter(
  db: Database,
  kind: DocumentKind,
  id: string,
  reason: string,
  userId: string | null,
): Promise<void> {
  try {
    await commitDocument(db, kind, id, reason, userId, archiveRoot(), {
      storageRoot: storageRoot(),
    });
  } catch (cause) {
    console.error(`archive after ${reason} failed`, cause);
  }
}

/** POST …/publish `{ note }`: a new version; answers `{ number, version, witnessVersions }`. */
export async function publishRequest(
  db: Database,
  user: Actor | null,
  kind: DocumentKind,
  id: string,
  request: Request,
): Promise<Response> {
  const record = await accessOf(db, user, kind, id);
  if (!record.canPublish) error(403, v.onlyOwner);
  const { note: text } = await bodyOf(request, publishBody);
  const userId = user?.id ?? null;
  let result;
  try {
    result =
      kind === 'edition'
        ? await publishEdition(db, record.id, userId, text)
        : await publishTranscription(db, record.id, userId, text);
  } catch (cause) {
    if (cause instanceof PublishRefused)
      return json({ message: cause.message }, { status: cause.status });
    throw cause;
  }
  await archiveAfter(db, kind, record.id, `published version ${result.number}`, userId);
  return json({
    ok: true,
    number: result.number,
    version: result.version,
    witnessVersions: result.witnessVersions,
  });
}

/** POST …/withdraw `{ number, note }`: the version is withdrawn; answers `{ ok: true }`. */
export async function withdrawRequest(
  db: Database,
  user: Actor | null,
  kind: DocumentKind,
  id: string,
  request: Request,
): Promise<Response> {
  const record = await accessOf(db, user, kind, id);
  if (!record.canPublish) error(403, v.onlyOwner);
  const body = await bodyOf(request, withdrawBody);
  const userId = user?.id ?? null;
  try {
    await withdrawVersion(db, kind, record.id, body.number, userId, body.note);
  } catch (cause) {
    if (cause instanceof PublishRefused)
      return json({ message: cause.message }, { status: cause.status });
    throw cause;
  }
  await archiveAfter(db, kind, record.id, `withdrew version ${body.number}`, userId);
  return json({ ok: true });
}

/** DELETE …/versions/n: the version is deleted, by an administrator alone; answers `{ ok: true }`. */
export async function deleteVersionRequest(
  db: Database,
  user: Actor | null,
  kind: DocumentKind,
  id: string,
  n: string,
): Promise<Response> {
  const record = await accessOf(db, user, kind, id);
  if (!canDeleteVersions(user)) error(403, v.onlyAdministrator);
  const number = parseVersionNumber(n);
  try {
    await deleteVersion(db, kind, record.id, number);
  } catch (cause) {
    if (cause instanceof PublishRefused)
      return json({ message: cause.message }, { status: cause.status });
    throw cause;
  }
  await archiveAfter(db, kind, record.id, `deleted version ${number}`, user?.id ?? null);
  return json({ ok: true });
}

/** GET …/versions: every version, newest first, with its note, its withdrawal and its changes. */
export async function versionsRequest(
  db: Database,
  user: Actor | null,
  kind: DocumentKind,
  id: string,
): Promise<Response> {
  const record = await accessOf(db, user, kind, id);
  if (!record.canPublish) error(403, v.onlyOwner);
  const list = await versionsOf(db, kind, record.id);
  return json({
    versions: list.map((x) => ({
      number: x.number,
      version: x.version,
      at: x.at.toISOString(),
      note: x.note,
      personName: x.personName,
      withdrawn: x.withdrawn
        ? {
            at: x.withdrawn.at.toISOString(),
            personName: x.withdrawn.personName,
            note: x.withdrawn.note,
          }
        : null,
      changes: x.changes,
    })),
  });
}

/** GET …/changes: the number the next version will have and the changes since the version before. */
export async function changesRequest(
  db: Database,
  user: Actor | null,
  kind: DocumentKind,
  id: string,
): Promise<Response> {
  const record = await accessOf(db, user, kind, id);
  if (!record.canPublish) error(403, v.onlyOwner);
  return json(await changesSinceLatest(db, kind, record.id));
}
