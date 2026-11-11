/**
 * Make New Edition and Edition Settings through their form actions: an
 * edition made with its name and a conspectus whose witnesses need not have
 * transcripts, the witnesses and transcripts made in the page's windows, and
 * every part of the settings saved at once or not at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { newId } from '@varians/core';
import {
  createDatabase,
  editionSigla,
  editions,
  referenceSchemes,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { and, eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import type { ConspectusWitness, TranscriptChoice } from '$lib/edition/conspectus';
import type { CurrentUser } from '$lib/types';
import { actions as newActions } from '../../routes/(app)/editions/new/+page.server';
import { actions as settingsActions } from '../../routes/(app)/editions/[slug]/settings/+page.server';
import { grantsFor } from './authz.ts';
import { loadEditionContext } from './collation.ts';
import { conspectusWitnesses } from './edition-form.ts';
import { createTranscription } from './registry.ts';
import { DEFAULT_CONVENTIONS, seedSample, type SampleResult } from './seed/sample.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const strangerId = newId();
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];
const stamp = newId().slice(-6).toLowerCase();

const person = (id: string, name: string): CurrentUser => ({
  id,
  email: `${id}@test`,
  name,
  role: 'member',
  preferences: {} as CurrentUser['preferences'],
  termsVersion: 1,
});
const owner = person(userId, 'Editor');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (event: any) => unknown;
type Result = { status?: number; data?: Record<string, unknown>; [key: string]: unknown };

/** Runs a form action with these fields as SvelteKit would; a redirect comes back as its location. */
async function run(
  action: Action | undefined,
  fields: Record<string, string | string[]>,
  slug = '',
): Promise<Result & { location?: string }> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const one of Array.isArray(value) ? value : [value]) body.append(name, one);
  const request = new Request('http://localhost/action', { method: 'POST', body });
  try {
    return (await action!({ request, locals: { db, user: owner }, params: { slug } })) as Result;
  } catch (thrown) {
    if (isRedirect(thrown)) return { location: thrown.location };
    throw thrown;
  }
}

/** The fields Edition Settings always sends. */
const settingsForm = (extra: Record<string, string | string[]> = {}) => ({
  title: 'The Iliad, book 1',
  editors: ['Editor'],
  preface: '',
  sources: '',
  rightsNote: '',
  lineation: 'verse',
  numberEvery: '5',
  apparatus: 'positive',
  latin: 'on',
  interpretative: 'separate',
  speakerDisplay: 'margin',
  ...extra,
});

async function conspectusOf(editionId: string) {
  return db
    .select({
      witnessId: editionSigla.witnessId,
      transcriptionId: editionSigla.transcriptionId,
      siglum: editionSigla.siglum,
    })
    .from(editionSigla)
    .where(eq(editionSigla.editionId, editionId))
    .orderBy(editionSigla.position);
}

async function clean(): Promise<void> {
  await db.delete(works).where(eq(works.slug, 'iliad'));
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
  const made = await db
    .select({ id: witnesses.id })
    .from(witnesses)
    .where(eq(witnesses.createdBy, userId));
  if (made.length) {
    const ids = made.map((w) => w.id);
    await db.delete(transcriptions).where(inArray(transcriptions.witnessId, ids));
    await db.delete(witnesses).where(inArray(witnesses.id, ids));
  }
}

let sample: SampleResult;
const witnessOf = async (slug: string) =>
  (await db.select().from(witnesses).where(eq(witnesses.slug, slug)))[0]!;
const transcriptOf = async (witnessId: string) =>
  (await db.select().from(transcriptions).where(eq(transcriptions.witnessId, witnessId)))[0]!;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' },
    { id: strangerId, email: `${strangerId}@test`, name: 'Stranger', passwordHash: 'x' },
  ]);
  sample = await seedSample(db, userId);
});

afterAll(async () => {
  await clean();
  await db.delete(transcriptions).where(eq(transcriptions.ownerId, strangerId));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(inArray(users.id, [userId, strangerId]));
  await pool.end();
});

describe('Make New Edition', () => {
  it('refuses without a work or a name, saying so by the fields', async () => {
    const refused = await run(newActions.create, { workId: '', title: ' ', sigla: '[]' });
    expect(refused.status).toBe(400);
    const errors = refused.data!.errors as Record<string, string[]>;
    expect(errors.work).toEqual(['Choose a work.']);
    expect(errors.title).toEqual(['Give the edition a name.']);
  });

  it('makes an edition with an empty text, its conspectus naming witnesses with and without transcripts', async () => {
    // A witness registered in the window, and a transcript of it made in another for the work.
    const added = await run(newActions.addWitness, {
      name: `Codex Novus ${stamp}`,
      siglum: 'N',
      category: 'manuscript',
    });
    const fresh = added.witness as ConspectusWitness;
    expect(fresh).toMatchObject({ siglum: 'N', transcripts: [] });
    const made = await run(newActions.newTranscript, {
      witnessId: fresh.id,
      workId: sample.workId,
      name: 'Iliad 1',
    });
    const transcript = made.transcript as TranscriptChoice;
    expect(transcript).toMatchObject({ name: 'Iliad 1', own: true });
    // A witness known only from reported readings: no transcript at all.
    const reported = (await run(newActions.addWitness, { name: `Papyrus ${stamp}`, siglum: 'Π' }))
      .witness as ConspectusWitness;
    const a = await witnessOf('venetus-a');
    const aText = await transcriptOf(a.id);

    const saved = await run(newActions.create, {
      workId: sample.workId,
      title: `A new edition ${stamp}`,
      editors: ['Editor', ''],
      sigla: JSON.stringify([
        { witnessId: a.id, transcriptionId: aText.id, siglum: 'A' },
        { witnessId: fresh.id, transcriptionId: transcript.id, siglum: 'N' },
        { witnessId: reported.id, transcriptionId: null, siglum: 'Π' },
      ]),
    });
    expect(saved.location).toMatch(/^\/editions\/a-new-edition-[a-z0-9-]+\/settings$/);
    const slug = saved.location!.split('/')[2]!;
    const [edition] = await db.select().from(editions).where(eq(editions.slug, slug));
    expect(edition).toMatchObject({ title: `A new edition ${stamp}`, editors: ['Editor'] });
    expect(edition!.conventions).toEqual(DEFAULT_CONVENTIONS);
    expect(await conspectusOf(edition!.id)).toEqual([
      { witnessId: a.id, transcriptionId: aText.id, siglum: 'A' },
      { witnessId: fresh.id, transcriptionId: transcript.id, siglum: 'N' },
      { witnessId: reported.id, transcriptionId: null, siglum: 'Π' },
    ]);
    const context = await loadEditionContext(db, edition!.id);
    expect(context.edition.content.items).toEqual([]);
    await db.delete(editions).where(eq(editions.id, edition!.id));
  });

  it("refuses a conspectus naming another person's draft, or a siglum twice, and makes nothing", async () => {
    const c = await witnessOf('laurentianus-c');
    const draft = await createTranscription(
      db,
      { witnessId: c.id, workIds: [sample.workId], name: 'Not yours' },
      strangerId,
    );
    const title = `Refused ${stamp}`;
    const theirs = await run(newActions.create, {
      workId: sample.workId,
      title,
      sigla: JSON.stringify([{ witnessId: c.id, transcriptionId: draft.id, siglum: 'C' }]),
    });
    expect(theirs.status).toBe(400);
    expect((theirs.data!.errors as Record<string, string[]>).sigla).toHaveLength(1);
    const twice = await run(newActions.create, {
      workId: sample.workId,
      title,
      sigla: JSON.stringify([
        { witnessId: c.id, transcriptionId: null, siglum: 'C' },
        { witnessId: (await witnessOf('venetus-b')).id, transcriptionId: null, siglum: 'C' },
      ]),
    });
    expect((twice.data!.errors as Record<string, string[]>).sigla).toEqual([
      'The siglum C is used twice.',
    ]);
    expect(await db.select().from(editions).where(eq(editions.title, title))).toEqual([]);
  });
});

describe('the transcripts a row may collate', () => {
  it("are the person's own and the published, with or without text of the work, never another person's draft", async () => {
    const c = await witnessOf('laurentianus-c');
    const own = await createTranscription(db, { witnessId: c.id, name: 'Of no work yet' }, userId);
    const found = (
      await conspectusWitnesses(db, owner, await grantsFor(db, owner), [c.id], sample.workId)
    )[c.id]!;
    const names = found.transcripts.map((t) => t.name);
    expect(names).toContain('Of no work yet');
    expect(names).not.toContain('Not yours');
    expect(found.transcripts.find((t) => t.id === own.id)!.segments).toBe(0);
    expect(found.transcripts.find((t) => t.id !== own.id)!.segments).toBeGreaterThan(0);
  });
});

describe('Edition Settings', () => {
  it('saves the name, the descriptive fields, the conventions and the conspectus at once', async () => {
    const before = await conspectusOf(sample.editionId);
    const b = before.find((x) => x.siglum === 'B')!;
    const saved = await run(
      settingsActions.save,
      settingsForm({
        title: 'The Iliad, book 1, revised',
        preface: 'A preface.',
        numberEvery: '10',
        lineation: 'prose',
        // B without its transcript, under another siglum, first; the others go.
        sigla: JSON.stringify([{ witnessId: b.witnessId, transcriptionId: null, siglum: 'Bb' }]),
      }),
      sample.editionSlug,
    );
    expect(saved).toMatchObject({ ok: true });
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    expect(edition).toMatchObject({ title: 'The Iliad, book 1, revised', preface: 'A preface.' });
    expect(edition!.conventions).toMatchObject({ numberEvery: 10, lineation: 'prose' });
    expect(await conspectusOf(sample.editionId)).toEqual([
      { witnessId: b.witnessId, transcriptionId: null, siglum: 'Bb' },
    ]);

    // The conspectus as it was, back again: a transcript it names may stay.
    expect(
      await run(
        settingsActions.save,
        settingsForm({ sigla: JSON.stringify(before.map((x) => ({ ...x }))) }),
        sample.editionSlug,
      ),
    ).toMatchObject({ ok: true });
    expect(await conspectusOf(sample.editionId)).toEqual(before);
  });

  it('saves nothing while one part is refused, and leaves the conspectus when the form has none', async () => {
    const before = await conspectusOf(sample.editionId);
    const refused = await run(
      settingsActions.save,
      settingsForm({
        title: 'Never saved',
        sigla: JSON.stringify([
          { ...before[0]!, siglum: 'X' },
          { ...before[1]!, siglum: 'X' },
        ]),
      }),
      sample.editionSlug,
    );
    expect(refused.status).toBe(400);
    const [edition] = await db.select().from(editions).where(eq(editions.id, sample.editionId));
    expect(edition!.title).not.toBe('Never saved');
    expect(await conspectusOf(sample.editionId)).toEqual(before);

    const noName = await run(settingsActions.save, settingsForm({ title: '' }), sample.editionSlug);
    expect((noName.data!.errors as Record<string, string[]>).title).toEqual([
      'Give the edition a name.',
    ]);

    await run(settingsActions.save, settingsForm({ title: 'Kept' }), sample.editionSlug);
    expect(await conspectusOf(sample.editionId)).toEqual(before);
  });

  it('is refused to someone who may not edit the edition', async () => {
    const body = new FormData();
    body.append('title', 'Taken over');
    const request = new Request('http://localhost/action', { method: 'POST', body });
    await expect(
      Promise.resolve(
        (settingsActions.save as Action)({
          request,
          locals: { db, user: person(strangerId, 'Stranger') },
          params: { slug: sample.editionSlug },
        }),
      ),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    const [edition] = await db
      .select({ title: editions.title })
      .from(editions)
      .where(and(eq(editions.id, sample.editionId)));
    expect(edition!.title).not.toBe('Taken over');
  });
});
