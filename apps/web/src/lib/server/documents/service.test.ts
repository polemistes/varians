/**
 * The save protocol against a real PostgreSQL: run with the test database
 * migrated (DATABASE_URL_TEST or the default below).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultProfile, fromText, newId, sequentialIds, toText, type Stream } from '@varians/core';
import { createDatabase, referenceSchemes, segments, transcriptions, users, witnesses, works, type Database } from '@varians/db';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { CHECKPOINT_EVERY, VersionConflict, documentAt, history, saveOps } from './service.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = { user: newId(), scheme: newId(), work: newId(), witness: newId(), transcription: newId(), segment: newId() };

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values({ id: ids.user, email: `${ids.user}@test`, name: 'T', passwordHash: 'x' });
  await db.insert(referenceSchemes).values({ id: ids.scheme, name: 'line', levels: [{ key: 'line', label: 'Line', type: 'number', separator: '' }] });
  await db.insert(works).values({ id: ids.work, slug: `w-${ids.work}`, title: 'W', schemeId: ids.scheme, profile: defaultProfile('grc') });
  await db.insert(segments).values({ id: ids.segment, workId: ids.work, address: { line: '1' }, label: '1', sortKey: '00000001' });
  await db.insert(witnesses).values({ id: ids.witness, slug: `a-${ids.witness}`, siglum: 'A', name: 'A' });
  await db.insert(transcriptions).values({ id: ids.transcription, witnessId: ids.witness, name: 'T', ownerId: ids.user });
});

afterAll(async () => {
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(eq(users.id, ids.user));
  await pool.end();
});

describe('saveOps', () => {
  it('applies operations, bumps the version and records the changeset with its reverse', async () => {
    const stream: Stream = fromText('μῆνιν ἄειδε', { ids: sequentialIds('a') });
    (stream.items[0] as { segment?: unknown }).segment = { segmentId: ids.segment };
    const first = await saveOps(db, 'transcription', ids.transcription, ids.user, 0, [{ t: 'insert', after: null, items: stream.items }]);
    expect(first.version).toBe(1);
    expect(toText(first.content)).toBe('μῆνιν ἄειδε');
    const second = await saveOps(db, 'transcription', ids.transcription, ids.user, 1, [{ t: 'set', id: 'a2', fields: { form: 'ἄειδε,' } }]);
    expect(second.version).toBe(2);
    const log = await history(db, 'transcription', ids.transcription);
    expect(log.map((c) => c.version)).toEqual([2, 1]);
    expect(log[0]!.reverse).toEqual([{ t: 'set', id: 'a2', fields: { form: 'ἄειδε' } }]);
    const indexed = await db.query.transcriptionSegments.findMany({ where: (t, { eq }) => eq(t.transcriptionId, ids.transcription) });
    expect(indexed).toHaveLength(1);
    expect(indexed[0]!.foldText).toBe('μῆνιν ἄειδε');
    expect(indexed[0]!.unitCount).toBe(2);
  });

  it('refuses a stale version and hands back what changed since', async () => {
    await expect(saveOps(db, 'transcription', ids.transcription, ids.user, 1, [{ t: 'set', id: 'a1', fields: { form: 'x' } }])).rejects.toBeInstanceOf(VersionConflict);
    try {
      await saveOps(db, 'transcription', ids.transcription, ids.user, 1, [{ t: 'set', id: 'a1', fields: { form: 'x' } }]);
    } catch (error) {
      const conflict = error as VersionConflict;
      expect(conflict.current.version).toBe(2);
      expect(conflict.since.map((c) => c.version)).toEqual([2]);
    }
  });

  it('rebuilds the document as it stood at an earlier version', async () => {
    const atOne = await documentAt(db, 'transcription', ids.transcription, 1);
    expect(toText(atOne)).toBe('μῆνιν ἄειδε');
    const atTwo = await documentAt(db, 'transcription', ids.transcription, 2);
    expect(toText(atTwo)).toBe('μῆνιν ἄειδε,');
  });

  it('writes a checkpoint every so many versions and reads forward from it', async () => {
    let version = 2;
    while (version < CHECKPOINT_EVERY + 2) {
      const result = await saveOps(db, 'transcription', ids.transcription, ids.user, version, [{ t: 'set', id: 'a1', fields: { form: `v${version + 1}` } }]);
      version = result.version;
    }
    const checkpoint = await db.query.checkpoints.findFirst({ where: (t, { eq }) => eq(t.documentId, ids.transcription) });
    expect(checkpoint?.version).toBe(CHECKPOINT_EVERY);
    const at = await documentAt(db, 'transcription', ids.transcription, CHECKPOINT_EVERY + 1);
    expect(toText(at).startsWith(`v${CHECKPOINT_EVERY + 1}`)).toBe(true);
  });
});
