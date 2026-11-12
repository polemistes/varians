/**
 * The registry has no private works, and a conjecture and a reported reading
 * are public from the moment they are entered: a work is seen and listed by
 * everyone, with its published editions and transcripts and all its
 * conjectures and reported readings. What is a person's own and unfinished
 * (a draft edition, with its text, its notes and the conjectures it has
 * adopted, and a draft transcript) stays as invisible to everyone else as it
 * was while the work could be private: through the pages, the lists, the
 * search, the readers, the downloads, the record addresses, and every route
 * of the API.
 *
 * The routes are called as SvelteKit calls them, with the user and the
 * database in `locals`, and a refusal read from the error or the redirect
 * they throw.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromText, newId, type Item, type Stream, type Token } from '@varians/core';
import {
  createDatabase,
  referenceSchemes,
  segments,
  users,
  witnesses,
  works,
  type Conjecture,
  type Database,
  type Edition,
  type ReportedReading,
  type Transcription,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { openPackageZip } from './archive/package.ts';
import { removeWorkCompletely } from './archive/import.ts';
import { grantsFor, type Actor } from './authz.ts';
import { replaceContent } from './documents/service.ts';
import { candidateWitnesses, createEdition } from './editions.ts';
import { loadEditionAccess } from './edition-access.ts';
import { publishedEditions, searchPublishedEditions, searchWorks } from './library.ts';
import { registerConjecture, reportReading } from './conjectures.ts';
import { publishEdition, publishTranscription } from './publish.ts';
import { limits } from './rate-limit.ts';
import {
  createTranscription,
  searchRegistry,
  viewableTranscriptions,
  workOptions,
} from './registry.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { seedSample } from './seed/sample.ts';
import { loadTranscriptionAccess } from './transcription-access.ts';
import { loadWorkbench } from './workbench.ts';

import * as workPage from '../../routes/(public)/works/[slug]/+page.server';
import * as witnessPage from '../../routes/(public)/witnesses/[slug]/+page.server';
import * as searchPage from '../../routes/(public)/search/+page.server';
import * as homePage from '../../routes/(public)/+page.server';
import * as editionsPage from '../../routes/(public)/editions/+page.server';
import * as readerPage from '../../routes/(public)/editions/[slug]/[[segment]]/+page.server';
import * as versionPage from '../../routes/(public)/editions/[slug]/v/[n]/[[segment]]/+page.server';
import * as detailJson from '../../routes/(public)/editions/[slug]/detail.json/+server';
import * as sitesJson from '../../routes/(public)/editions/[slug]/sites.json/+server';
import * as editionTei from '../../routes/(public)/editions/[slug].tei.xml/+server';
import * as editionTxt from '../../routes/(public)/editions/[slug].txt/+server';
import * as editionPackage from '../../routes/(public)/editions/[slug]/package.zip/+server';
import * as syncJson from '../../routes/(public)/works/[slug]/sync.json/+server';
import * as workPackage from '../../routes/(app)/works/[slug]/package.zip/+server';
import * as workArchive from '../../routes/(app)/works/[slug]/archive.zip/+server';
import * as copyEditionPage from '../../routes/(app)/editions/[slug]/copy/+page.server';
import * as workbenchPage from '../../routes/transcriptions/[id]/+page.server';
import * as transcriptionTei from '../../routes/transcriptions/[id]/tei/+server';
import * as transcriptionLeiden from '../../routes/transcriptions/[id]/leiden/+server';
import * as transcriptionPackage from '../../routes/transcriptions/[id]/package.zip/+server';
import * as recordAddress from '../../routes/id/[id]/+server';
import * as apiRegistrySearch from '../../routes/api/registry/search/+server';
import * as apiWorkSegments from '../../routes/api/works/[id]/segments/+server';
import * as apiEditionView from '../../routes/api/editions/[id]/view/+server';
import * as apiEditionOutline from '../../routes/api/editions/[id]/outline/+server';
import * as apiEditionUnits from '../../routes/api/editions/[id]/units/+server';
import * as apiEditionNotes from '../../routes/api/editions/[id]/notes/+server';
import * as apiEditionPublish from '../../routes/api/editions/[id]/publish/+server';
import * as apiEditionConjectures from '../../routes/api/editions/[id]/conjectures/+server';
import * as apiEditionAdoptions from '../../routes/api/editions/[id]/adoptions/+server';
import * as apiDocumentOps from '../../routes/api/documents/[kind]/[id]/ops/+server';
import * as apiDocumentHistory from '../../routes/api/documents/[kind]/[id]/history/+server';
import * as apiDocumentMoments from '../../routes/api/documents/[kind]/[id]/moments/+server';
import * as apiDocumentAt from '../../routes/api/documents/[kind]/[id]/at/[version]/+server';
import * as apiTranscriptionMemory from '../../routes/api/transcriptions/[id]/memory/+server';
import * as apiTranscriptionSegments from '../../routes/api/transcriptions/[id]/segments/+server';
import * as apiTranscriptionSources from '../../routes/api/transcriptions/[id]/sources/+server';
import * as apiTranscriptionZones from '../../routes/api/transcriptions/[id]/zones/+server';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
let tmp: string;

const ownerId = newId();
const strangerId = newId();
const owner: Actor = { id: ownerId, role: 'member' };
const stranger: Actor = { id: strangerId, role: 'member' };
const SLUGS = ['venetus-a', 'venetus-b', 'laurentianus-c', 'townleianus-t'];

/** Words that only the drafts have, to be looked for in anything a route sends. */
const DRAFT_WORDS = 'DRAFTONLYWORD';
/** Words of the conjectures and reported readings, which every route may send. */
const RECORD_WORDS = 'ENTEREDWORD';

let workId: string;
let workSlug: string;
let publishedEdition: Edition;
let draftEdition: Edition;
let publishedTranscription: Transcription;
let draftTranscription: Transcription;
/** The owner's conjecture and reported reading, entered with nothing said of publication. */
let conjecture: Conjecture;
let reading: ReportedReading;
/** A conjecture entered in the draft edition's editor, which the draft edition has adopted. */
let adopted: Conjecture;
let witnessSlug: string;
let reportedSlug: string;

async function clean(): Promise<void> {
  for (const w of await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad')))
    await removeWorkCompletely(db, w.id);
  await db.delete(witnesses).where(inArray(witnesses.slug, SLUGS));
}

/** A transcript's text: one line starting the segment with this label. */
async function lineOf(label: string, text: string): Promise<Stream> {
  const scheme = await schemeOfWork(db, workId);
  const resolved = await resolveLabels(db, scheme, [label]);
  const line = fromText(text, { lang: 'grc' });
  (line.items[0] as Token).segment = { segmentId: resolved.get(label)!.id };
  return { items: line.items as Item[] };
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await clean();
  await db.insert(users).values([
    { id: ownerId, email: `${ownerId}@test`, name: 'Owner', passwordHash: 'x' },
    { id: strangerId, email: `${strangerId}@test`, name: 'Stranger', passwordHash: 'x' },
  ]);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-public-'));

  const sample = await seedSample(db, ownerId);
  workId = sample.workId;
  const [work] = await db.select().from(works).where(eq(works.id, workId));
  workSlug = work!.slug;
  await publishEdition(db, sample.editionId, ownerId);
  const access = await loadEditionAccess(db, owner, sample.editionId);
  publishedEdition = access!.edition;

  // What is the owner's own and unfinished, made after the publication.
  draftEdition = await createEdition(
    db,
    {
      workId,
      title: `Edition ${DRAFT_WORDS}`,
      editors: ['Owner'],
      baseTranscriptionId: null,
      sigla: [],
    },
    ownerId,
  );
  const [segment] = await db.select().from(segments).where(eq(segments.workId, workId)).limit(1);
  const created = await createTranscription(
    db,
    { witnessId: sample.witnessIds.A!, name: `Transcript ${DRAFT_WORDS}` },
    ownerId,
  );
  await replaceContent(
    db,
    'transcription',
    created.id,
    ownerId,
    0,
    await lineOf('1.1', `${DRAFT_WORDS} words`),
    'test',
  );
  draftTranscription = (await loadTranscriptionAccess(db, owner, created.id))!.transcription;
  // The sample publishes its transcripts.
  publishedTranscription = (await db.query.transcriptions.findFirst({
    where: (t, { eq: same }) => same(t.witnessId, sample.witnessIds.B!),
  }))!;
  conjecture = await registerConjecture(
    db,
    {
      workId,
      segmentId: segment!.id,
      kind: 'substitution',
      lemma: `${RECORD_WORDS} lemma`,
      reading: `${RECORD_WORDS} reading`,
    },
    ownerId,
  );
  reading = await reportReading(
    db,
    {
      workId,
      segmentId: segment!.id,
      witnessId: sample.witnessIds.T!,
      lemma: `${RECORD_WORDS} lemma`,
      reading: `${RECORD_WORDS} reading`,
    },
    ownerId,
  );
  // Entered from the editor of the draft edition, the way an editor registers a conjecture of their own and adopts it.
  const entered = await call(apiEditionConjectures.POST, owner, { id: draftEdition.id }, '', {
    method: 'POST',
    body: {
      segmentId: segment!.id,
      kind: 'substitution',
      lemma: `${RECORD_WORDS} adopted lemma`,
      reading: `${RECORD_WORDS} adopted reading`,
      anchorTokenIds: ['a-word-of-the-draft'],
      adopt: true,
    },
  });
  adopted = ((await (entered.value as Response).json()) as { conjecture: Conjecture }).conjecture;
  const [witness] = await db.select().from(witnesses).where(eq(witnesses.id, sample.witnessIds.A!));
  witnessSlug = witness!.slug;
  const [reported] = await db
    .select()
    .from(witnesses)
    .where(eq(witnesses.id, sample.witnessIds.T!));
  reportedSlug = reported!.slug;
}, 120_000);

afterAll(async () => {
  await clean();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, ownerId));
  await db.delete(users).where(inArray(users.id, [ownerId, strangerId]));
  await pool.end();
  await rm(tmp, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = ((event: any) => unknown) | undefined;

interface Outcome {
  /** 200 for an answer, else the status of the error or redirect it threw, or of the response. */
  status: number;
  /** What it answered: the data of a load, or the response. */
  value?: unknown;
  location?: string;
}

let callNumber = 0;

/** Calls a load, endpoint or action as SvelteKit would, as `who`. */
async function call(
  handler: Handler,
  who: Actor | null,
  params: Record<string, string> = {},
  search = '',
  init: { method?: string; body?: unknown } = {},
): Promise<Outcome> {
  if (!handler) throw new Error('no such handler');
  // The downloads are limited per person and per address; the tests are many.
  limits.archiveByUser.clear(who?.id ?? `address:10.0.0.${callNumber}`);
  limits.recordsByAddress.clear(`10.0.0.${callNumber}`);
  const address = `10.0.0.${callNumber++}`;
  const base = 'http://localhost/path';
  const form = init.body instanceof FormData;
  const request = new Request(base + search, {
    method: init.method ?? 'GET',
    headers: { ...(form ? {} : { 'content-type': 'application/json' }), accept: 'text/html' },
    ...(init.body !== undefined
      ? { body: form ? (init.body as FormData) : JSON.stringify(init.body) }
      : {}),
  });
  try {
    const value = await handler({
      locals: { db, user: who },
      params,
      url: new URL(base + search),
      request,
      getClientAddress: () => address,
      cookies: { get: () => undefined },
      fetch,
    });
    if (value instanceof Response) return { status: value.status, value };
    return { status: 200, value };
  } catch (cause) {
    if (isHttpError(cause)) return { status: cause.status };
    if (isRedirect(cause)) return { status: cause.status, location: cause.location };
    throw cause;
  }
}

/** Everything a response or load result says, as one string. */
async function textOf(outcome: Outcome): Promise<string> {
  if (outcome.value instanceof Response) return await outcome.value.clone().text();
  return JSON.stringify(outcome.value ?? null);
}

interface WitnessWorkCounts {
  transcriptionCount: number;
  readingCount: number;
}

const visitor = null;
const viewers: [string, Actor | null][] = [
  ['a visitor', visitor],
  ['another signed-in person', stranger],
];

describe('the work, seen by everyone', () => {
  it.each(viewers)(
    'is seen and listed by %s, with its published editions and transcripts and all its conjectures and reported readings',
    async (_name, who) => {
      const page = await call(workPage.load, who, { slug: workSlug });
      expect(page.status).toBe(200);
      const data = page.value as {
        work: { id: string };
        editions: { id: string }[];
        transcriptions: { id: string }[];
        conjectures: { id: string }[];
        readings: { id: string }[];
      };
      expect(data.work.id).toBe(workId);
      expect(data.editions.map((e) => e.id)).toEqual([publishedEdition.id]);
      expect(data.transcriptions.map((t) => t.id)).toContain(publishedTranscription.id);
      expect(data.conjectures.map((c) => c.id)).toEqual(
        expect.arrayContaining([conjecture.id, adopted.id]),
      );
      expect(data.readings.map((r) => r.id)).toContain(reading.id);

      expect((await searchWorks(db, 'Iliad')).map((w) => w.id)).toContain(workId);
      expect((await searchRegistry(db, 'work', 'Iliad')).map((h) => h.id)).toContain(workId);
      expect((await workOptions(db)).map((w) => w.id)).toContain(workId);
      const found = await call(apiRegistrySearch.GET, who, {}, '?kind=work&q=Iliad');
      expect(await textOf(found)).toContain(workId);
      const labels = await call(apiWorkSegments.GET, who, { id: workSlug });
      expect(labels.status).toBe(200);
      expect(await call(apiWorkSegments.GET, who, { id: workId })).toMatchObject({ status: 200 });

      expect((await call(homePage.load, who)).value).toMatchObject({
        published: expect.arrayContaining([expect.objectContaining({ id: publishedEdition.id })]),
      });
      const listed = (await call(editionsPage.load, who)).value as { editions: { id: string }[] };
      expect(listed.editions.map((e) => e.id)).toEqual([publishedEdition.id]);
      const searched = await call(searchPage.load, who, {}, '?q=Iliad');
      const result = searched.value as { works: { id: string }[]; editions: { id: string }[] };
      expect(result.works.map((w) => w.id)).toContain(workId);
      expect(result.editions.map((e) => e.id)).toContain(publishedEdition.id);

      // The address of the work, of a conjecture and a reported reading, and of a published edition lead to them.
      for (const id of [workId, conjecture.id, adopted.id, reading.id, publishedEdition.id])
        expect((await call(recordAddress.GET, who, { id })).status).toBe(303);
      // The published edition is read by both.
      expect((await call(readerPage.load, who, { slug: publishedEdition.slug })).status).toBe(200);
      expect((await call(editionTei.GET, who, { slug: publishedEdition.slug })).status).toBe(200);
      expect((await call(editionTxt.GET, who, { slug: publishedEdition.slug })).status).toBe(200);
      expect((await call(syncJson.GET, who, { slug: workSlug })).status).toBe(200);
      expect((await call(workPackage.GET, who, { slug: workSlug })).status).toBe(200);
      expect((await call(editionPackage.GET, who, { slug: publishedEdition.slug })).status).toBe(
        200,
      );
    },
    120_000,
  );
});

describe('what is unfinished stays invisible', () => {
  it.each(viewers)(
    'in the lists of the work and of the witness, to %s',
    async (_name, who) => {
      const page = await call(workPage.load, who, { slug: workSlug });
      const data = page.value as {
        editions: { id: string }[];
        transcriptions: { id: string }[];
        conjectures: { id: string }[];
        readings: { id: string }[];
      };
      expect(data.editions.map((e) => e.id)).not.toContain(draftEdition.id);
      expect(data.transcriptions.map((t) => t.id)).not.toContain(draftTranscription.id);
      expect(await textOf(page)).not.toContain(DRAFT_WORDS);
      // The conjecture the draft edition adopted is the work's, listed with the others; nothing in the page says who adopted it.
      expect(await textOf(page)).toContain(adopted.id);
      expect(await textOf(page)).not.toContain(draftEdition.id);

      const witness = await call(witnessPage.load, who, { slug: witnessSlug });
      expect(witness.status).toBe(200);
      expect(await textOf(witness)).not.toContain(DRAFT_WORDS);
      expect(await textOf(witness)).not.toContain(draftTranscription.id);
      // What the page counts for the work is what the viewer may see: the draft transcript is no trace of it, a reported reading is counted.
      const counted = async (slug: string, by: Actor | null) =>
        ((await call(witnessPage.load, by, { slug })).value as { works: WitnessWorkCounts[] })
          .works[0]!;
      const forTranscript = await counted(witnessSlug, who);
      const forOwner = await counted(witnessSlug, owner);
      expect(forTranscript.transcriptionCount).toBe(forOwner.transcriptionCount - 1);
      const forReading = await counted(reportedSlug, who);
      const forOwnerReading = await counted(reportedSlug, owner);
      expect(forReading.readingCount).toBe(forOwnerReading.readingCount);
      expect(forReading.readingCount).toBeGreaterThan(0);

      // Lists and search.
      expect((await publishedEditions(db)).map((e) => e.id)).not.toContain(draftEdition.id);
      expect((await searchPublishedEditions(db, DRAFT_WORDS)).map((e) => e.id)).toEqual([]);
      const searched = await call(searchPage.load, who, {}, `?q=${DRAFT_WORDS}`);
      expect((searched.value as { editions: unknown[] }).editions).toEqual([]);
      const grants = await grantsFor(db, who);
      expect(
        (await candidateWitnesses(db, workId, who, grants)).map((c) => c.transcriptionId),
      ).not.toContain(draftTranscription.id);
      expect((await viewableTranscriptions(db, who, grants)).map((t) => t.id)).not.toContain(
        draftTranscription.id,
      );
    },
    120_000,
  );

  it.each(viewers)(
    'in the reader, the downloads and the record addresses of the draft edition, to %s',
    async (_name, who) => {
      const slug = { slug: draftEdition.slug };
      for (const draft of ['', '?draft=1']) {
        expect((await call(readerPage.load, who, slug, draft)).status).toBe(404);
        expect((await call(readerPage.load, who, { ...slug, segment: '1.1' }, draft)).status).toBe(
          404,
        );
        expect(
          (await call(detailJson.GET, who, slug, `${draft || '?'}${draft ? '&' : ''}segments=x`))
            .status,
        ).toBe(404);
        expect(
          (await call(sitesJson.GET, who, slug, `${draft || '?'}${draft ? '&' : ''}segments=x`))
            .status,
        ).toBe(404);
        expect((await call(editionTei.GET, who, slug, draft)).status).toBe(404);
        expect((await call(editionTxt.GET, who, slug, draft)).status).toBe(404);
      }
      expect((await call(versionPage.load, who, { ...slug, n: '1' })).status).toBe(404);
      expect((await call(editionPackage.GET, who, slug)).status).toBe(404);
      for (const id of [draftEdition.id, draftEdition.slug]) {
        expect((await call(apiEditionView.GET, who, { id })).status).toBe(404);
        expect((await call(apiEditionOutline.GET, who, { id })).status).toBe(404);
        expect((await call(apiEditionUnits.GET, who, { id })).status).toBe(404);
        for (const handler of [
          apiEditionNotes.POST,
          apiEditionPublish.POST,
          apiEditionConjectures.POST,
          apiEditionAdoptions.POST,
        ])
          expect((await call(handler, who, { id }, '', { method: 'POST', body: {} })).status).toBe(
            404,
          );
      }
      const document = { kind: 'edition', id: draftEdition.id };
      expect((await call(apiDocumentOps.GET, who, document)).status).toBe(404);
      expect(
        (
          await call(apiDocumentOps.POST, who, document, '', {
            method: 'POST',
            body: { fromVersion: 0, ops: [] },
          })
        ).status,
      ).toBe(404);
      expect((await call(apiDocumentHistory.GET, who, document)).status).toBe(404);
      expect((await call(apiDocumentAt.GET, who, { ...document, version: '0' })).status).toBe(404);
      expect(
        (
          await call(apiDocumentMoments.POST, who, document, '', {
            method: 'POST',
            body: { version: 0, name: 'x' },
          })
        ).status,
      ).toBe(404);
      expect((await call(recordAddress.GET, who, { id: draftEdition.id })).status).toBe(404);
      expect((await call(recordAddress.GET, who, { id: `${draftEdition.id}.json` })).status).toBe(
        404,
      );
      if (who) {
        // A draft cannot be copied by someone who may not see it, and is answered as one that does not exist.
        const named = new FormData();
        named.set('name', 'A copy');
        const copy = await call(copyEditionPage.actions.default, who, slug, '', {
          method: 'POST',
          body: named,
        });
        expect(copy.status).toBe(404);
        const none = await call(
          copyEditionPage.actions.default,
          who,
          { slug: 'no-such-edition' },
          '',
          {
            method: 'POST',
            body: named,
          },
        );
        expect(none.status).toBe(404);
      }
      // The working text of the published edition is its editors' alone, as before: others get the published versions, through the reader.
      expect((await call(apiEditionView.GET, who, { id: publishedEdition.id })).status).not.toBe(
        200,
      );
      expect(
        (
          await call(apiDocumentOps.POST, who, { kind: 'edition', id: publishedEdition.id }, '', {
            method: 'POST',
            body: { fromVersion: 0, ops: [] },
          })
        ).status,
      ).toBe(404);
    },
    120_000,
  );

  it.each(viewers)(
    'in the workbench, the downloads and the record addresses of the draft transcript, to %s',
    async (_name, who) => {
      const id = { id: draftTranscription.id };
      expect(await loadWorkbench(db, who, draftTranscription.id)).toBeNull();
      expect((await call(workbenchPage.load, who, id)).status).toBe(404);
      expect((await call(transcriptionTei.GET, who, id)).status).toBe(404);
      expect((await call(transcriptionLeiden.GET, who, id)).status).toBe(404);
      expect((await call(transcriptionPackage.GET, who, id)).status).toBe(404);
      for (const handler of [
        apiTranscriptionMemory.GET,
        apiTranscriptionSegments.GET,
        apiTranscriptionSources.GET,
        apiTranscriptionZones.GET,
      ])
        expect((await call(handler, who, id)).status).toBe(404);
      const document = { kind: 'transcription', id: draftTranscription.id };
      expect((await call(apiDocumentOps.GET, who, document)).status).toBe(404);
      expect(
        (
          await call(apiDocumentOps.POST, who, document, '', {
            method: 'POST',
            body: { fromVersion: 0, ops: [] },
          })
        ).status,
      ).toBe(404);
      expect((await call(apiDocumentHistory.GET, who, document)).status).toBe(404);
      expect((await call(apiDocumentAt.GET, who, { ...document, version: '1' })).status).toBe(404);
      expect((await call(recordAddress.GET, who, { id: draftTranscription.id })).status).toBe(404);
      // Its words and its changesets have addresses too.
      const token = draftTranscription.content.items.find((i): i is Token => i.kind === 'token')!;
      expect((await call(recordAddress.GET, who, { id: token.id })).status).toBe(404);
      // A published transcript of the same work is seen.
      expect((await call(workbenchPage.load, who, { id: publishedTranscription.id })).status).toBe(
        200,
      );
      expect(
        (await call(transcriptionTei.GET, who, { id: publishedTranscription.id })).status,
      ).toBe(200);
    },
    120_000,
  );

  it.each(viewers)(
    'in what the addresses of a conjecture and a reported reading say, to %s',
    async (_name, who) => {
      // Both are public, and are answered as JSON, without a state of publication.
      for (const record of [conjecture, adopted, reading]) {
        expect((await call(recordAddress.GET, who, { id: record.id })).status).toBe(303);
        const answered = await call(recordAddress.GET, who, { id: `${record.id}.json` });
        expect(answered.status).toBe(200);
        const text = await textOf(answered);
        expect(text).toContain(record.id);
        expect(text).not.toContain('visibility');
        expect(text).not.toContain(DRAFT_WORDS);
      }
      // A conjecture entered in the draft edition's editor names no draft edition to those who may not see it.
      const fromDraft = JSON.parse(
        await textOf(await call(recordAddress.GET, who, { id: `${adopted.id}.json` })),
      ) as { anchor: unknown };
      expect(fromDraft.anchor).toBeNull();
      const work = await call(recordAddress.GET, who, { id: `${workId}.json` });
      expect(work.status).toBe(200);
      expect(await textOf(work)).not.toContain('"private"');
    },
    120_000,
  );

  it.each(viewers)(
    'in what the readers of the published edition say of the conjectures, to %s',
    async (_name, who) => {
      // The draft edition has adopted a conjecture; the published edition, which has not, shows it as proposed, and nothing names the draft.
      const page = await call(readerPage.load, who, { slug: publishedEdition.slug });
      expect(page.status).toBe(200);
      expect(await textOf(page)).not.toContain(draftEdition.id);
      expect(await textOf(page)).not.toContain(draftEdition.slug);
      expect(await textOf(page)).not.toContain(DRAFT_WORDS);
      for (const download of [editionTei, editionTxt]) {
        const text = await textOf(await call(download.GET, who, { slug: publishedEdition.slug }));
        expect(text).not.toContain(draftEdition.id);
        expect(text).not.toContain(DRAFT_WORDS);
      }
    },
    120_000,
  );

  it.each(viewers)(
    'in what is downloaded of the work, to %s',
    async (_name, who) => {
      const sync = await call(syncJson.GET, who, { slug: workSlug });
      const state = JSON.parse(await textOf(sync)) as { documents: { id: string }[] };
      expect(state.documents.map((d) => d.id)).toContain(publishedEdition.id);
      expect(state.documents.map((d) => d.id)).not.toContain(draftEdition.id);
      expect(state.documents.map((d) => d.id)).not.toContain(draftTranscription.id);

      // The server's own archive holds every draft: it is for administrators, and the rest are sent to the package.
      const archive = await call(workArchive.GET, who, { slug: workSlug });
      expect(archive.status).toBe(who ? 308 : 303);
      if (who) expect(archive.location).toBe(`/works/${workSlug}/package.zip`);

      const download = await call(workPackage.GET, who, { slug: workSlug });
      expect(download.status).toBe(200);
      const file = path.join(tmp, `${newId()}.zip`);
      await writeFile(file, Buffer.from(await (download.value as Response).arrayBuffer()));
      const opened = await openPackageZip(file);
      try {
        const everything: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (/\.(json|ndjson|xml|txt|md|tsv)$/u.test(entry.name))
              everything.push(await readFile(full, 'utf8'));
          }
        };
        await walk(opened.dir);
        const text = everything.join('\n');
        expect(text).toContain(publishedEdition.id);
        // The conjectures and reported readings are all there, those the draft edition adopted among them.
        for (const record of [conjecture, adopted, reading]) expect(text).toContain(record.id);
        expect(text).toContain(RECORD_WORDS);
        // The draft edition and the draft transcript are told of nowhere: not their words, not their ids, not that the edition adopted a conjecture.
        for (const unfinished of [draftEdition.id, draftTranscription.id, DRAFT_WORDS])
          expect(text).not.toContain(unfinished);
        expect(text).not.toContain('a-word-of-the-draft');
        expect(text).not.toContain('"visibility": "private"');
      } finally {
        await rm(opened.dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('is still seen by whoever made it', async () => {
    // The owner sees and reaches everything the others do not.
    expect((await loadEditionAccess(db, owner, draftEdition.id))!.canView).toBe(true);
    expect((await loadTranscriptionAccess(db, owner, draftTranscription.id))!.canView).toBe(true);
    expect(
      (await call(readerPage.load, owner, { slug: draftEdition.slug }, '?draft=1')).status,
    ).toBe(200);
    expect((await call(recordAddress.GET, owner, { id: draftTranscription.id })).status).toBe(303);
    // The owner's address of the conjecture the draft edition adopted says which edition it was entered in.
    const entered = await call(recordAddress.GET, owner, { id: `${adopted.id}.json` });
    expect(await textOf(entered)).toContain(draftEdition.id);
    const page = await call(workPage.load, owner, { slug: workSlug });
    const data = page.value as {
      editions: { id: string }[];
      transcriptions: { id: string }[];
      conjectures: { id: string }[];
      readings: { id: string }[];
    };
    expect(data.editions.map((e) => e.id)).toContain(draftEdition.id);
    expect(data.transcriptions.map((t) => t.id)).toContain(draftTranscription.id);
  }, 120_000);

  it('is made public by publishing, and by nothing else', async () => {
    // Publishing the transcript opens it to the stranger; the draft edition stays closed.
    // Neither the conjectures it has adopted nor the conjectures and reported readings entered meanwhile open it.
    await publishTranscription(db, draftTranscription.id, ownerId);
    expect((await loadTranscriptionAccess(db, stranger, draftTranscription.id))!.canView).toBe(
      true,
    );
    expect((await loadTranscriptionAccess(db, visitor, draftTranscription.id))!.canView).toBe(true);
    expect((await loadEditionAccess(db, stranger, draftEdition.id))!.canView).toBe(false);
    expect((await call(recordAddress.GET, stranger, { id: draftEdition.id })).status).toBe(404);
  }, 120_000);

  it('is open to those who may see a conjecture or a reported reading, whoever enters it, at once', async () => {
    // A stranger enters a conjecture and a reading; the owner of the draft edition and everyone else see them as they are entered.
    const [segment] = await db.select().from(segments).where(eq(segments.workId, workId)).limit(1);
    const entered = await registerConjecture(
      db,
      {
        workId,
        segmentId: segment!.id,
        kind: 'substitution',
        lemma: 'a stranger lemma',
        reading: 'a stranger reading',
      },
      strangerId,
    );
    for (const who of [visitor, owner, stranger]) {
      const page = await call(workPage.load, who, { slug: workSlug });
      const data = page.value as { conjectures: { id: string }[] };
      expect(data.conjectures.map((c) => c.id)).toContain(entered.id);
      expect((await call(recordAddress.GET, who, { id: entered.id })).status).toBe(303);
    }
    // The owner of the draft edition may adopt another person's conjecture at once, and withdraw it.
    const adoption = await call(apiEditionAdoptions.POST, owner, { id: draftEdition.id }, '', {
      method: 'POST',
      body: { conjectureId: entered.id, adopted: true },
    });
    expect(adoption.status).toBe(200);
    const withdrawn = await call(apiEditionAdoptions.POST, owner, { id: draftEdition.id }, '', {
      method: 'POST',
      body: { conjectureId: entered.id, adopted: false },
    });
    expect(withdrawn.status).toBe(200);
    // A conjecture that is not on this work cannot be adopted.
    const unknown = await call(apiEditionAdoptions.POST, owner, { id: draftEdition.id }, '', {
      method: 'POST',
      body: { conjectureId: 'no-such-conjecture', adopted: true },
    });
    expect(unknown.status).toBe(404);
  }, 120_000);
});
