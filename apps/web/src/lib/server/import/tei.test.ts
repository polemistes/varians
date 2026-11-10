import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEME_PRESETS, defaultProfile, newId, segmentRuns, toText } from '@varians/core';
import {
  createDatabase,
  referenceSchemes,
  segments,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { importTeiIntoTranscription, previewTei } from './tei.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = {
  user: newId(),
  scheme: newId(),
  work: newId(),
  witness: newId(),
  transcription: newId(),
};

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>Iliad</title><author>Homer</author></titleStmt><publicationStmt><p/></publicationStmt><sourceDesc><p/></sourceDesc></fileDesc></teiHeader>
  <text><body>
    <div type="edition" n="urn:cts:greekLit:tlg0012.tlg001.perseus-grc2">
      <div type="textpart" subtype="book" n="1">
        <l n="1">μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος</l>
        <l n="2">οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,</l>
        <l n="3">πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν</l>
      </div>
    </div>
  </body></text>
</TEI>`;

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db
    .insert(users)
    .values({ id: ids.user, email: `${ids.user}@test`, name: 'T', passwordHash: 'x' });
  await db
    .insert(referenceSchemes)
    .values({ id: ids.scheme, name: 'epic', levels: SCHEME_PRESETS[0]!.scheme.levels });
  await db.insert(works).values({
    id: ids.work,
    slug: `w-${ids.work}`,
    title: 'W',
    schemeId: ids.scheme,
    profile: defaultProfile('grc'),
  });
  await db
    .insert(witnesses)
    .values({ id: ids.witness, slug: `a-${ids.witness}`, siglum: 'A', name: 'A' });
  await db
    .insert(transcriptions)
    .values({ id: ids.transcription, witnessId: ids.witness, name: 'T', ownerId: ids.user });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(eq(users.id, ids.user));
  await pool.end();
});

describe('TEI import into a transcription', () => {
  it('previews the structure and the proposed mapping', async () => {
    const preview = await previewTei(db, ids.work, XML);
    expect(preview.header.title).toBe('Iliad');
    expect(preview.mapping).toMatchObject({ book: 'book', line: 'line' });
    expect(preview.resolved).toBe(3);
    expect(preview.examples).toEqual(['1.1', '1.2', '1.3']);
    expect(preview.words).toBe(17);
  });

  it('imports the text with segments created and starts set', async () => {
    const preview = await previewTei(db, ids.work, XML);
    const result = await importTeiIntoTranscription(db, {
      transcriptionId: ids.transcription,
      fromVersion: 0,
      workId: ids.work,
      xml: XML,
      mapping: preview.mapping,
      userId: ids.user,
    });
    expect(result.version).toBe(1);
    expect(result.segments).toBe(3);
    expect(toText(result.content).split('\n')).toHaveLength(3);
    const runs = segmentRuns(result.content);
    expect(runs.map((r) => r.segmentId !== null)).toEqual([true, true, true]);
    const created = await db.select().from(segments).where(eq(segments.workId, ids.work));
    expect(created.map((s) => s.label).sort()).toEqual(['1.1', '1.2', '1.3']);
  });
});
