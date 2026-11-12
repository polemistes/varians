/**
 * What may be done with an edition, as the server gives it: the rights each
 * list hands its rows, the deletion that stays on a list, and Owner and
 * Collaborators on Edition Settings.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { newId } from '@varians/core';
import {
  createDatabase,
  editionCollaborators,
  editions,
  ownershipOffers,
  referenceSchemes,
  users,
  works,
  type Database,
  type Role,
} from '@varians/db';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import type { CurrentUser } from '$lib/types';
import { recordActions } from '$lib/strings/record-actions';
import { load as frontPage } from '../../routes/(public)/+page.server';
import { load as editionsPage } from '../../routes/(public)/editions/+page.server';
import { load as minePage } from '../../routes/(app)/mine/+page.server';
import { actions as editActions } from '../../routes/(app)/editions/[slug]/edit/+page.server';
import {
  actions as settingsActions,
  load as settingsPage,
} from '../../routes/(app)/editions/[slug]/settings/+page.server';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { publishEdition } from './publish.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;

const ids = {
  owner: newId(),
  collaborator: newId(),
  stranger: newId(),
  administrator: newId(),
  invitee: newId(),
  scheme: newId(),
  work: newId(),
  draft: newId(),
  published: newId(),
  doomed: newId(),
};
const slugs = {
  draft: `draft-${ids.draft}`,
  published: `published-${ids.published}`,
  doomed: `doomed-${ids.doomed}`,
};

function person(id: string, name: string, role: Role = 'member'): CurrentUser {
  return {
    id,
    email: `${id}@test`,
    name,
    role,
    preferences: {} as CurrentUser['preferences'],
    termsVersion: 1,
  };
}

const owner = person(ids.owner, 'Owner');
const collaborator = person(ids.collaborator, 'Collaborator');
const stranger = person(ids.stranger, 'Stranger');
const administrator = person(ids.administrator, 'Administrator', 'administrator');
const invitee = person(ids.invitee, 'Invitee');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: any) => unknown;
type Outcome = { status: number; data?: Record<string, unknown>; location?: string };

/** Runs a load or a form action as `who`, as SvelteKit would; a thrown redirect or error is its status. */
async function run(
  handler: Handler | undefined,
  who: CurrentUser | null,
  slug = '',
  fields?: Record<string, string>,
): Promise<Outcome> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields ?? {})) body.append(name, value);
  const request = new Request('http://localhost/action', {
    method: fields ? 'POST' : 'GET',
    ...(fields ? { body } : {}),
  });
  try {
    const value = (await handler!({
      request,
      locals: { db, user: who },
      params: { slug },
      url: new URL('http://localhost/path'),
    })) as Record<string, unknown> & { status?: number; data?: Record<string, unknown> };
    // A fail() is an ActionFailure: its status and data.
    if (value && typeof value.status === 'number' && 'data' in value)
      return { status: value.status, data: value.data as Record<string, unknown> };
    return { status: 200, data: value ?? {} };
  } catch (cause) {
    if (isRedirect(cause)) return { status: cause.status, location: cause.location };
    const status = (cause as { status?: number }).status;
    if (typeof status === 'number') return { status };
    throw cause;
  }
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values(
    [owner, collaborator, stranger, administrator, invitee].map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      passwordHash: 'x',
    })),
  );
  await db.insert(referenceSchemes).values({
    id: ids.scheme,
    name: 'l',
    levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }],
  });
  await db.insert(works).values({
    id: ids.work,
    slug: `w-${ids.work}`,
    title: 'W',
    schemeId: ids.scheme,
  });
  const edition = (id: string, slug: string) => ({
    id,
    workId: ids.work,
    slug,
    title: slug,
    ownerId: ids.owner,
    conventions: DEFAULT_CONVENTIONS,
  });
  await db
    .insert(editions)
    .values([
      edition(ids.draft, slugs.draft),
      edition(ids.published, slugs.published),
      edition(ids.doomed, slugs.doomed),
    ]);
  await publishEdition(db, ids.published, ids.owner);
  await db
    .insert(editionCollaborators)
    .values({ editionId: ids.draft, userId: ids.collaborator, grantedBy: ids.owner });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  for (const id of [ids.owner, ids.collaborator, ids.stranger, ids.administrator, ids.invitee])
    await db.delete(users).where(eq(users.id, id));
  await pool.end();
});

type Row = { id: string; can: Record<string, boolean> };
const rowOf = (rows: unknown, id: string) => (rows as Row[]).find((r) => r.id === id)?.can;

const ownerRights = { signedIn: true, edit: true, publish: true, delete: true };
const collaboratorRights = { signedIn: true, edit: true, publish: false, delete: false };
const readerRights = { signedIn: true, edit: false, publish: false, delete: false };
const visitorRights = { signedIn: false, edit: false, publish: false, delete: false };

describe('the rights a list gives each edition', () => {
  it('on Your Work: the owner may do everything, a collaborator edit only', async () => {
    const mine = (await run(minePage, owner)).data!;
    expect(rowOf(mine.editions, ids.draft)).toEqual(ownerRights);
    expect(rowOf(mine.editions, ids.published)).toEqual(ownerRights);
    const shared = (await run(minePage, collaborator)).data!.shared as { editions: Row[] };
    expect(rowOf(shared.editions, ids.draft)).toEqual(collaboratorRights);
    expect(rowOf(shared.editions, ids.published)).toBeUndefined();
  });

  it('on the front page: Continue and the published editions, by viewer', async () => {
    const front = (await run(frontPage, owner)).data!;
    expect(rowOf(front.published, ids.published)).toEqual(ownerRights);
    const recent = (front.recent as { items: (Row & { kind: string })[] }).items;
    expect(rowOf(recent, ids.draft)).toEqual(ownerRights);
    const collaborators = (await run(frontPage, collaborator)).data!;
    expect(rowOf(collaborators.published, ids.published)).toEqual(readerRights);
    expect(rowOf((collaborators.recent as { items: Row[] }).items, ids.draft)).toEqual(
      collaboratorRights,
    );
    expect(rowOf((await run(frontPage, stranger)).data!.published, ids.published)).toEqual(
      readerRights,
    );
    expect(rowOf((await run(frontPage, null)).data!.published, ids.published)).toEqual(
      visitorRights,
    );
  });

  it('on the list of editions, an administrator may do everything', async () => {
    expect(rowOf((await run(editionsPage, administrator)).data!.editions, ids.published)).toEqual(
      ownerRights,
    );
  });
});

describe('deleting an edition', () => {
  it('is refused to a collaborator, in words', async () => {
    const refused = await run(editActions.delete, collaborator, slugs.draft, { stay: '1' });
    expect(refused).toMatchObject({
      status: 403,
      data: { error: recordActions.edition.onlyOwner },
    });
  });

  it('from a list leaves the person on the list, and says so', async () => {
    const deleted = await run(editActions.delete, owner, slugs.doomed, { stay: '1' });
    expect(deleted).toMatchObject({
      status: 200,
      data: { message: recordActions.edition.deleted(slugs.doomed) },
    });
    expect(await db.select().from(editions).where(eq(editions.id, ids.doomed))).toEqual([]);
  });

  it("from the edition's own pages leads to the work's page", async () => {
    const id = newId();
    await db.insert(editions).values({
      id,
      workId: ids.work,
      slug: `gone-${id}`,
      title: 'Gone',
      ownerId: ids.owner,
      conventions: DEFAULT_CONVENTIONS,
    });
    expect(await run(editActions.delete, owner, `gone-${id}`, {})).toEqual({
      status: 303,
      location: `/works/w-${ids.work}`,
    });
  });
});

describe('Owner and Collaborators on Edition Settings', () => {
  const people = recordActions.edition.people;

  it('is loaded for those who may grant, and for nobody else', async () => {
    const forOwner = (await run(settingsPage, owner, slugs.draft)).data!;
    expect(forOwner.people).toMatchObject({
      owner: 'Owner',
      collaborators: [{ userId: ids.collaborator, name: 'Collaborator' }],
      offer: null,
    });
    expect(forOwner.rights).toEqual(ownerRights);
    expect((await run(settingsPage, administrator, slugs.draft)).data!.people).not.toBeNull();
    const forCollaborator = (await run(settingsPage, collaborator, slugs.draft)).data!;
    expect(forCollaborator.people).toBeNull();
    expect(forCollaborator.rights).toEqual(collaboratorRights);
  });

  it('invites a collaborator, and refuses in words what cannot be', async () => {
    const add = (who: CurrentUser, email: string) =>
      run(settingsActions.addCollaborator, who, slugs.draft, { email });
    expect(await add(collaborator, invitee.email)).toMatchObject({
      status: 403,
      data: { error: recordActions.edition.onlyOwner },
    });
    expect(await add(owner, '')).toMatchObject({
      status: 400,
      data: { error: people.emailRequired },
    });
    expect(await add(owner, 'nobody@nowhere.test')).toMatchObject({
      status: 400,
      data: { error: people.noAccount },
    });
    expect(await add(owner, owner.email)).toMatchObject({
      status: 400,
      data: { error: people.isOwner },
    });
    expect(await add(owner, invitee.email.toUpperCase())).toMatchObject({
      status: 200,
      data: { message: people.invited('Invitee') },
    });
    expect(await add(owner, invitee.email)).toMatchObject({
      status: 400,
      data: { error: people.already },
    });
  });

  it('removes a collaborator', async () => {
    const remove = (who: CurrentUser, userId: string) =>
      run(settingsActions.removeCollaborator, who, slugs.draft, { userId });
    expect(await remove(collaborator, ids.invitee)).toMatchObject({ status: 403 });
    expect(await remove(owner, ids.invitee)).toMatchObject({
      status: 200,
      data: { message: people.removed('Invitee') },
    });
    expect(await remove(owner, ids.invitee)).toMatchObject({
      status: 400,
      data: { error: people.notACollaborator },
    });
    const left = await db
      .select()
      .from(editionCollaborators)
      .where(eq(editionCollaborators.editionId, ids.draft));
    expect(left.map((c) => c.userId)).toEqual([ids.collaborator]);
  });

  it('offers the ownership, once at a time, and shows the offer open', async () => {
    const offer = (who: CurrentUser, email: string) =>
      run(settingsActions.offerOwnership, who, slugs.draft, { email });
    expect(await offer(collaborator, invitee.email)).toMatchObject({ status: 403 });
    expect(await offer(owner, owner.email)).toMatchObject({
      status: 400,
      data: { error: people.ownsAlready },
    });
    expect(await offer(owner, invitee.email)).toMatchObject({
      status: 200,
      data: { message: people.offered },
    });
    expect(await offer(owner, stranger.email)).toMatchObject({
      status: 400,
      data: { error: people.offerOpen },
    });
    expect((await run(settingsPage, owner, slugs.draft)).data!.people).toMatchObject({
      offer: { toName: 'Invitee' },
    });
    await db
      .delete(ownershipOffers)
      .where(and(eq(ownershipOffers.kind, 'edition'), eq(ownershipOffers.recordId, ids.draft)));
  });
});
