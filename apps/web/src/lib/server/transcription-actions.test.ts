/**
 * What may be done with a transcript, as the server gives it: the rights each
 * list hands its rows, and the deletion that stays on a list and says, when it
 * is refused, only what the person may see of the editions that name it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { SCHEME_PRESETS, newId, type Stream } from '@varians/core';
import {
  changesets,
  createDatabase,
  editionCollaborators,
  editionSigla,
  editions,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
  type Role,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import type { CurrentUser } from '$lib/types';
import { recordActions } from '$lib/strings/record-actions';
import { registry } from '$lib/strings/registry';
import { load as frontPage } from '../../routes/(public)/+page.server';
import { load as witnessPage } from '../../routes/(public)/witnesses/[slug]/+page.server';
import {
  actions as workActions,
  load as workPage,
} from '../../routes/(public)/works/[slug]/+page.server';
import { load as minePage } from '../../routes/(app)/mine/+page.server';
import { actions as workbenchActions } from '../../routes/transcriptions/[id]/+page.server';
import { replaceContent } from './documents/service.ts';
import { createTranscription, createWitness, createWork } from './registry';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { worksOfTranscription } from './transcription-works.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const tag = newId().slice(-8).toLowerCase();
let db: Database;
let pool: pg.Pool;

function person(role: Role, name: string): CurrentUser {
  const id = newId();
  return {
    id,
    email: `${id}@transcripts.test`,
    name: `${name} ${tag}`,
    role,
    preferences: {} as CurrentUser['preferences'],
    termsVersion: 1,
  };
}

const owner = person('member', 'Owner');
const collaborator = person('member', 'Collaborator');
const stranger = person('member', 'Stranger');
const administrator = person('administrator', 'Administrator');
const siteEditor = person('editor', 'Site editor');
const drafter = person('member', 'Drafter');
const people = [owner, collaborator, stranger, administrator, siteEditor, drafter];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: any) => unknown;
type Outcome = { status: number; data?: Record<string, unknown>; location?: string };

/** Runs a load or a form action as `who`, as SvelteKit would; a thrown redirect or error is its status. */
async function run(
  handler: Handler | undefined,
  who: CurrentUser | null,
  options: { slug?: string; id?: string; fields?: Record<string, string> } = {},
): Promise<Outcome> {
  const body = new FormData();
  for (const [name, value] of Object.entries(options.fields ?? {})) body.append(name, value);
  const request = new Request('http://localhost/action', {
    method: options.fields ? 'POST' : 'GET',
    ...(options.fields ? { body } : {}),
  });
  try {
    const value = (await handler!({
      request,
      locals: { db, user: who },
      params: { slug: options.slug ?? '', id: options.id ?? '' },
      url: new URL('http://localhost/path'),
    })) as Record<string, unknown> & { status?: number; data?: Record<string, unknown> };
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

const ids = {
  work: '',
  witness: '',
  witness2: '',
  published: '',
  draft: '',
  named: '',
  spare: '',
  editionOwn: newId(),
  editionSecret: newId(),
};
let workSlug = '';
let witnessSlug = '';
const SECRET = `Secret edition ${tag}`;
const OWN = `Own edition ${tag}`;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values(
    people.map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      passwordHash: 'x',
    })),
  );
  const work = await createWork(
    db,
    {
      title: `Transcript work ${tag}`,
      language: 'grc',
      scheme: { preset: SCHEME_PRESETS[0]!.name },
    },
    owner.id,
  );
  ids.work = work.id;
  workSlug = work.slug;
  const witness = await createWitness(
    db,
    { siglum: 'T', name: `Transcript witness ${tag}` },
    owner.id,
  );
  ids.witness = witness.id;
  witnessSlug = witness.slug;
  const second = await createWitness(
    db,
    { siglum: 'U', name: `Second transcript witness ${tag}` },
    owner.id,
  );
  ids.witness2 = second.id;
  // Each has a line of the work, which makes it a transcript of the work.
  const scheme = await schemeOfWork(db, work.id);
  const segment = (await resolveLabels(db, scheme, ['1.1'])).get('1.1')!;
  const make = async (name: string, witnessId = witness.id) => {
    const { id } = await createTranscription(db, { witnessId, name }, owner.id);
    const line: Stream = {
      items: [{ kind: 'token', id: newId(), form: 'μῆνιν', segment: { segmentId: segment.id } }],
    };
    await replaceContent(db, 'transcription', id, owner.id, 0, line, 'test');
    return id;
  };
  ids.published = await make(`Published ${tag}`);
  await db
    .update(transcriptions)
    .set({ visibility: 'published' })
    .where(eq(transcriptions.id, ids.published));
  ids.draft = await make(`Draft ${tag}`);
  ids.named = await make(`Named ${tag}`, second.id);
  ids.spare = await make(`Spare ${tag}`);

  // The collaborator edits an edition of the owner's that names the draft; another person's draft names Named.
  const edition = (id: string, title: string, ownerId: string) => ({
    id,
    workId: work.id,
    slug: `transcripts-${id}`,
    title,
    ownerId,
    conventions: DEFAULT_CONVENTIONS,
  });
  await db
    .insert(editions)
    .values([
      edition(ids.editionOwn, OWN, owner.id),
      edition(ids.editionSecret, SECRET, drafter.id),
    ]);
  await db
    .insert(editionCollaborators)
    .values({ editionId: ids.editionOwn, userId: collaborator.id, grantedBy: owner.id });
  await db.insert(editionSigla).values([
    {
      editionId: ids.editionOwn,
      witnessId: witness.id,
      transcriptionId: ids.draft,
      siglum: 'T',
      position: 0,
    },
    {
      editionId: ids.editionOwn,
      witnessId: second.id,
      transcriptionId: ids.named,
      siglum: 'U',
      position: 1,
    },
    {
      editionId: ids.editionSecret,
      witnessId: second.id,
      transcriptionId: ids.named,
      siglum: 'T',
      position: 0,
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(changesets)
    .where(
      inArray(
        changesets.documentId,
        [ids.published, ids.draft, ids.named, ids.spare].filter(Boolean),
      ),
    );
  await db.delete(works).where(inArray(works.id, [ids.work].filter(Boolean)));
  await db
    .delete(witnesses)
    .where(inArray(witnesses.id, [ids.witness, ids.witness2].filter(Boolean)));
  await db.delete(editions).where(inArray(editions.id, [ids.editionOwn, ids.editionSecret]));
  await db.delete(transcriptions).where(
    inArray(
      transcriptions.ownerId,
      people.map((p) => p.id),
    ),
  );
  await db.delete(users).where(
    inArray(
      users.id,
      people.map((p) => p.id),
    ),
  );
  await pool.end();
});

type Row = { id: string; can: Record<string, boolean> };
const canOf = (rows: unknown, id: string) => (rows as Row[]).find((r) => r.id === id)?.can;

const ownerRights = { signedIn: true, edit: true, delete: true };

describe('the rights a list gives each transcript', () => {
  it('on Your Work: the owner may do everything with their own', async () => {
    const mine = (await run(minePage, owner)).data!;
    for (const id of [ids.published, ids.draft, ids.named, ids.spare])
      expect(canOf(mine.transcriptions, id)).toEqual(ownerRights);
  });

  it('on Your Work, shared with a collaborator: edit, and no deletion', async () => {
    const shared = (await run(minePage, collaborator)).data!.shared as { transcriptions: Row[] };
    expect(canOf(shared.transcriptions, ids.draft)).toEqual({
      signedIn: true,
      edit: true,
      delete: false,
    });
    expect(canOf(shared.transcriptions, ids.spare)).toBeUndefined();
  });

  it('on a witness’s page, by viewer', async () => {
    const forViewer = async (who: CurrentUser | null, id: string) =>
      canOf((await run(witnessPage, who, { slug: witnessSlug })).data!.transcriptions, id);
    expect(await forViewer(owner, ids.published)).toEqual(ownerRights);
    expect(await forViewer(administrator, ids.published)).toEqual({
      signedIn: true,
      edit: true,
      delete: true,
    });
    // A site editor may edit anything and delete nothing.
    expect(await forViewer(siteEditor, ids.published)).toEqual({
      signedIn: true,
      edit: true,
      delete: false,
    });
    expect(await forViewer(stranger, ids.published)).toEqual({
      signedIn: true,
      edit: false,
      delete: false,
    });
    expect(await forViewer(null, ids.published)).toEqual({
      signedIn: false,
      edit: false,
      delete: false,
    });
    // A draft is seen by those who may edit it only.
    expect(await forViewer(stranger, ids.draft)).toBeUndefined();
    expect(await forViewer(collaborator, ids.draft)).toEqual({
      signedIn: true,
      edit: true,
      delete: false,
    });
  });

  it('on a work’s page, as on the witness’s', async () => {
    const forViewer = async (who: CurrentUser | null, id: string) =>
      canOf((await run(workPage, who, { slug: workSlug })).data!.transcriptions, id);
    expect(await forViewer(owner, ids.draft)).toEqual(ownerRights);
    expect(await forViewer(stranger, ids.published)).toMatchObject({ edit: false, delete: false });
    expect(await forViewer(stranger, ids.draft)).toBeUndefined();
  });

  it('on the front page, Continue gives each transcript its rights', async () => {
    const front = (await run(frontPage, owner)).data!;
    const recent = (front.recent as { items: (Row & { kind: string })[] }).items;
    const transcripts = recent.filter((r) => r.kind === 'transcription');
    expect(transcripts.length).toBeGreaterThan(0);
    for (const item of transcripts) expect(item.can).toEqual(ownerRights);
  });
});

describe('making a transcript', () => {
  it('from a work’s page makes one of the witness chosen, named after it, with no work of its own', async () => {
    const made = await run(workActions.transcribe, owner, {
      slug: workSlug,
      fields: { witnessId: ids.witness2 },
    });
    expect(made.status).toBe(303);
    const id = made.location!.split('/').pop()!;
    const [row] = await db.select().from(transcriptions).where(eq(transcriptions.id, id));
    expect(row).toMatchObject({
      witnessId: ids.witness2,
      name: registry.transcription.defaultName(`Second transcript witness ${tag}`),
      ownerId: owner.id,
    });
    expect(await worksOfTranscription(db, id)).toEqual([]);
    // Nothing of it is assigned to the work, so the work's page does not list it.
    const listed = (await run(workPage, owner, { slug: workSlug })).data!.transcriptions as Row[];
    expect(listed.map((r) => r.id)).not.toContain(id);
    await db.delete(transcriptions).where(eq(transcriptions.id, id));
  });
});

describe('deleting a transcript', () => {
  it('from a list leaves the person on the list, and says so', async () => {
    const deleted = await run(workbenchActions.delete, owner, {
      id: ids.spare,
      fields: { stay: '1' },
    });
    expect(deleted).toMatchObject({
      status: 200,
      data: { message: recordActions.transcription.deleted },
    });
    expect(await db.select().from(transcriptions).where(eq(transcriptions.id, ids.spare))).toEqual(
      [],
    );
  });

  it('is refused to one who does not own it', async () => {
    expect(
      (await run(workbenchActions.delete, collaborator, { id: ids.draft, fields: { stay: '1' } }))
        .status,
    ).toBe(403);
  });

  it('is refused while an edition names it, saying what the person may see and counting the rest', async () => {
    const refused = await run(workbenchActions.delete, owner, {
      id: ids.named,
      fields: { stay: '1' },
    });
    expect(refused.status).toBe(409);
    const said = String(refused.data!.error);
    expect(said).toContain(OWN);
    expect(said).toContain('another edition that is not published');
    expect(said).not.toContain(SECRET);
    expect(said).not.toContain(drafter.name);
  });

  it('is refused naming each edition to an administrator, who may see every draft', async () => {
    const said = String(
      (await run(workbenchActions.delete, administrator, { id: ids.named, fields: { stay: '1' } }))
        .data!.error,
    );
    expect(said).toContain(OWN);
    expect(said).toContain(SECRET);
  });

  it('from the workbench leads to the witness’s page', async () => {
    const outcome = await run(workbenchActions.delete, owner, { id: ids.published, fields: {} });
    expect(outcome).toEqual({ status: 303, location: `/witnesses/${witnessSlug}` });
  });
});
