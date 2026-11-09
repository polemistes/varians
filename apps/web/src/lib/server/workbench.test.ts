/**
 * The workbench's server logic against the test database (DATABASE_URL_TEST
 * or the default below, migrated). Every record made here is removed again.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOps, defaultProfile, detectNumbering, fromText, isBreak, isToken, newId, sequentialIds, toText, type Break, type Stream, type Token } from '@varians/core';
import {
  changesets,
  createDatabase,
  pages,
  referenceSchemes,
  segments,
  transcriptionWorks,
  transcriptions,
  users,
  witnesses,
  works,
  zones,
  type Database,
} from '@varians/db';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { saveOps, VersionConflict } from './documents/service.ts';
import {
  deleteTranscription,
  exportTei,
  isFetchableUrl,
  importLayoutInto,
  importLeidenInto,
  importPlainTextInto,
  importTeiInto,
  layoutKind,
  loadWorkbench,
  matchPageLabels,
  matchPages,
  namePageBreaks,
  placeImport,
  appendSources,
  saveSettings,
  type ImportTarget,
} from './workbench.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const ids = {
  owner: newId(),
  other: newId(),
  scheme: newId(),
  work: newId(),
  witness: newId(),
  transcription: newId(),
  draft: newId(),
  page1: newId(),
  page2: newId(),
};
const owner = () => ({ id: ids.owner, role: 'member' as const });
const stranger = () => ({ id: ids.other, role: 'member' as const });

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await db.insert(users).values([
    { id: ids.owner, email: `${ids.owner}@test`, name: 'Owner', passwordHash: 'x' },
    { id: ids.other, email: `${ids.other}@test`, name: 'Other', passwordHash: 'x' },
  ]);
  await db.insert(referenceSchemes).values({
    id: ids.scheme,
    name: 'book and line',
    levels: [
      { key: 'book', label: 'Book', type: 'number', separator: '' },
      { key: 'line', label: 'Line', type: 'number', separator: '.' },
    ],
  });
  await db.insert(works).values({ id: ids.work, slug: `w-${ids.work}`, title: 'Iliad', schemeId: ids.scheme, profile: defaultProfile('grc') });
  // The owner made the witness and so maintains it.
  await db.insert(witnesses).values({ id: ids.witness, slug: `a-${ids.witness}`, siglum: 'A', name: 'Venetus A', createdBy: ids.owner });
  await db.insert(pages).values([
    { id: ids.page1, witnessId: ids.witness, label: '12r', position: 1 },
    { id: ids.page2, witnessId: ids.witness, label: '12v', position: 2 },
  ]);
  await db.insert(transcriptions).values([
    { id: ids.transcription, witnessId: ids.witness, name: 'Iliad 1', ownerId: ids.owner, keepsWrittenForm: true },
    { id: ids.draft, witnessId: ids.witness, name: 'Draft', ownerId: ids.owner },
  ]);
  await db.insert(transcriptionWorks).values({ transcriptionId: ids.transcription, workId: ids.work });
});

afterAll(async () => {
  await db.delete(changesets).where(inArray(changesets.documentId, [ids.transcription, ids.draft]));
  await db.delete(witnesses).where(eq(witnesses.id, ids.witness));
  await db.delete(works).where(eq(works.id, ids.work));
  await db.delete(referenceSchemes).where(eq(referenceSchemes.id, ids.scheme));
  await db.delete(users).where(inArray(users.id, [ids.owner, ids.other]));
  await pool.end();
});

function target(fromVersion: number, replace = false, transcriptionId = ids.transcription): ImportTarget {
  return { transcriptionId, witnessId: ids.witness, fromVersion, userId: ids.owner, replace, createPages: true };
}

async function version(id = ids.transcription): Promise<number> {
  const [row] = await db.select({ version: transcriptions.version }).from(transcriptions).where(eq(transcriptions.id, id));
  return row!.version;
}

describe('matching pages', () => {
  const existing = [
    { id: 'a', label: '12r' },
    { id: 'b', label: '12v', imagePath: 'images/b/scan-0042.jpg' },
    { id: 'c', label: '13r' },
  ];

  it('matches by label, by the end of a file name, and by the stored image', () => {
    expect(
      matchPageLabels(existing, [
        { label: '12R' },
        { label: 'venA_13r', fileName: 'venA_13r.jpg' },
        { label: '5', fileName: 'scan-0042.tif' },
        { label: '14r' },
      ]),
    ).toEqual(['a', 'c', 'b', null]);
  });

  it('matches a page once and does not take a label inside a word', () => {
    expect(matchPageLabels(existing, [{ label: '12r' }, { label: '12r' }])).toEqual(['a', null]);
    expect(matchPageLabels(existing, [{ label: 'x12r' }])).toEqual([null]);
  });

  it('creates the pages the witness lacks at its end, and names them on the breaks', async () => {
    const result = await matchPages(db, ids.witness, [{ label: '12v' }, { label: '13r' }], { create: true });
    expect(result.ids[0]).toBe(ids.page2);
    expect(result.matched).toBe(1);
    expect(result.created).toBe(1);
    const [created] = await db.select().from(pages).where(eq(pages.id, result.ids[1]!));
    expect(created).toMatchObject({ label: '13r', position: 3, witnessId: ids.witness });
    const stream: Stream = { items: [{ kind: 'break', id: 'b1', type: 'page', label: '12v' }, { kind: 'token', id: 't1', form: 'a' }] };
    expect(namePageBreaks(stream, result.ids).items[0]).toEqual({ kind: 'break', id: 'b1', type: 'page', pageId: ids.page2 });
    await db.delete(pages).where(eq(pages.id, result.ids[1]!));
  });
});

describe('placeImport', () => {
  const shape = (stream: Stream) => stream.items.map((i) => (i.kind === 'break' ? (i.type === 'page' ? `#${i.pageId ?? '?'}` : '/') : i.kind === 'token' ? i.form : i.id)).join(' ');

  it('puts text without pages on no page, after a line break, or on the page asked for', () => {
    const current: Stream = { items: [{ kind: 'token', id: 'u', form: 'u' }, { kind: 'break', id: 'pb1', type: 'page', pageId: 'p1' }, { kind: 'token', id: 'a', form: 'a' }] };
    const imported = fromText('c d', { ids: sequentialIds('n') });
    const unplaced = placeImport(current, imported, { replace: false, pageOrder: ['p1', 'p2'], ids: sequentialIds('x') });
    expect(shape(unplaced.content)).toBe('u / c d #p1 a');
    expect(unplaced.unplaced).toBe(2);
    const onPage = placeImport(current, fromText('c d', { ids: sequentialIds('n') }), { replace: false, placement: { to: 'page', pageId: 'p2' }, pageOrder: ['p1', 'p2'], ids: sequentialIds('x') });
    expect(shape(onPage.content)).toBe('u #p1 a #p2 c d');
    expect(onPage.unplaced).toBe(0);
    expect(shape(applyOps(current, onPage.ops).stream)).toBe(shape(onPage.content));
  });

  it('sends the text of matched page breaks to their pages and the rest to no page, in the order of the file', () => {
    const current: Stream = { items: [{ kind: 'break', id: 'pb1', type: 'page', pageId: 'p1' }, { kind: 'token', id: 'a', form: 'a' }] };
    const imported: Stream = {
      items: [
        { kind: 'token', id: 'i0', form: 'lead' },
        { kind: 'break', id: 'i1', type: 'page', pageId: 'p2' },
        { kind: 'token', id: 'i2', form: 'two' },
        { kind: 'break', id: 'i3', type: 'page', label: 'xx' },
        { kind: 'token', id: 'i4', form: 'lost' },
        { kind: 'break', id: 'i5', type: 'page', pageId: 'p1' },
        { kind: 'token', id: 'i6', form: 'one' },
      ],
    };
    const placed = placeImport(current, imported, { replace: false, pageOrder: ['p1', 'p2'], ids: sequentialIds('x') });
    expect(shape(placed.content)).toBe('lead / lost #p1 a / one #p2 two');
    expect(placed.unplaced).toBe(2);
    const replaced = placeImport(current, imported, { replace: true, pageOrder: ['p1', 'p2'], ids: sequentialIds('x') });
    expect(shape(replaced.content)).toBe('lead / lost #p1 one #p2 two');
  });

  it('keeps the segments the file gave its words', () => {
    const current: Stream = { items: [{ kind: 'token', id: 'a', form: 'a', segment: { segmentId: 's1' } }, { kind: 'break', id: 'pb1', type: 'page', pageId: 'p1' }] };
    const imported: Stream = { items: [{ kind: 'token', id: 'x', form: 'x' }, { kind: 'token', id: 'y', form: 'y', segment: { segmentId: 's2' } }] };
    const placed = placeImport(current, imported, { replace: false, pageOrder: ['p1'], ids: sequentialIds('x') });
    expect(placed.content.items.find((i) => i.id === 'x')).toMatchObject({ segment: { segmentId: null } });
  });
});

describe('loadWorkbench', () => {
  it('loads the page data for the owner and refuses a stranger a draft', async () => {
    const data = await loadWorkbench(db, owner(), ids.transcription);
    expect(data?.witness).toMatchObject({ siglum: 'A', name: 'Venetus A' });
    expect(data?.pages.map((p) => p.label)).toEqual(['12r', '12v']);
    expect(data?.works.map((w) => w.id)).toEqual([ids.work]);
    expect(data?.works[0]?.levels.map((l) => l.key)).toEqual(['book', 'line']);
    expect(data?.canEdit).toBe(true);
    expect(data?.canDelete).toBe(true);
    expect(data?.canMaintainWitness).toBe(true);
    expect(await loadWorkbench(db, stranger(), ids.transcription)).toBeNull();
    expect(await loadWorkbench(db, null, 'no-such-id')).toBeNull();
  });
});

describe('imports', () => {
  it('imports plain text numbered every line, then appends Leiden', async () => {
    const text = 'μῆνιν ἄειδε θεὰ\nοὐλομένην ἣ μυρί᾽';
    const pattern = detectNumbering(text).find((p) => p.kind === 'every-line')!;
    const first = await importPlainTextInto(db, target(await version()), { text, pattern, startLabel: '1.1', workId: ids.work });
    expect(first.segments).toBe(2);
    expect(toText(first.content)).toBe(text);
    const data = await loadWorkbench(db, owner(), ids.transcription);
    expect(Object.values(data!.segments).map((s) => s.label).sort()).toEqual(['1.1', '1.2']);

    const leiden = await importLeidenInto(db, target(first.version), 'πολλὰς [δ᾽] ἰφθίμους');
    expect(leiden.version).toBe(first.version + 1);
    expect(toText(leiden.content)).toBe(`${text}\nπολλὰς δ᾽ ἰφθίμους`);
    const supplied = leiden.content.items.find((i) => isToken(i) && i.form === 'δ᾽') as Token;
    expect(supplied.marks?.[0]?.kind).toBe('supplied');
  });

  it('refuses an import against an old version', async () => {
    await expect(importLeidenInto(db, target(0), 'x')).rejects.toBeInstanceOf(VersionConflict);
  });

  it('imports TEI with its structure mapped and its pages matched or created, replacing the text', async () => {
    const xml = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><div type="textpart" subtype="book" n="1">
      <pb n="12r"/><l n="1">μῆνιν ἄειδε</l><l n="2">οὐλομένην ἣ</l><pb n="14r"/><l n="3">πολλὰς δ᾽</l></div></body></text></TEI>`;
    const result = await importTeiInto(db, target(await version(), true), { xml, workId: ids.work, mapping: { book: 'book', line: 'line' } });
    expect(result.segments).toBe(3);
    expect(result.pagesMatched).toBe(1);
    expect(result.pagesCreated).toBe(1);
    const breaks = result.content.items.filter((i): i is Break => isBreak(i) && i.type === 'page');
    expect(breaks[0]!.pageId).toBe(ids.page1);
    const [created] = await db.select().from(pages).where(eq(pages.id, breaks[1]!.pageId!));
    expect(created?.label).toBe('14r');
    const exported = await exportTei(db, ids.transcription, 'https://varians.test');
    expect(exported?.xml).toContain('<milestone unit="segment" n="1.3"/>');
    expect(exported?.xml).toContain('<pb');
    await db.delete(pages).where(eq(pages.id, created!.id));
  });

  it('imports PAGE XML into an empty transcription with a zone per word', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15">
  <Page imageFilename="venA_12v.jpg" imageWidth="1000" imageHeight="2000">
    <TextRegion id="r1">
      <TextLine id="l1">
        <Coords points="100,100 900,100 900,200 100,200"/>
        <Word id="w1"><Coords points="100,100 300,100 300,200 100,200"/><TextEquiv><Unicode>μῆνιν</Unicode></TextEquiv></Word>
        <Word id="w2"><Coords points="320,100 600,100 600,200 320,200"/><TextEquiv><Unicode>ἄειδε</Unicode></TextEquiv></Word>
      </TextLine>
    </TextRegion>
    <ImageRegion id="i1"><Coords points="0,1500 1000,1500 1000,2000 0,2000"/></ImageRegion>
  </Page>
</PcGts>`;
    expect(layoutKind(xml)).toBe('page');
    const result = await importLayoutInto(db, target(await version(ids.draft), false, ids.draft), xml);
    expect(result.pagesMatched).toBe(1);
    expect(result.zones).toBe(3);
    expect(result.content.items[0]).toMatchObject({ kind: 'break', type: 'page', pageId: ids.page2 });
    const rows = await db.select().from(zones).where(eq(zones.transcriptionId, ids.draft));
    expect(rows.every((z) => z.pageId === ids.page2)).toBe(true);
    expect(rows.filter((z) => z.tokenIds.length === 1)).toHaveLength(2);
    expect(rows.find((z) => z.feature)?.feature).toEqual({ kind: 'figure' });
  });
});

describe('ALTO and sources', () => {
  it('imports ALTO into a transcription after its text, on its own page', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#">
  <Description><sourceImageInformation><fileName>scan_13r.tif</fileName></sourceImageInformation></Description>
  <Layout><Page ID="p1" WIDTH="2000" HEIGHT="3000">
    <PrintSpace><TextBlock ID="b1"><TextLine ID="l1">
      <String CONTENT="ΛΗΤΟΥΣ" HPOS="100" VPOS="100" WIDTH="300" HEIGHT="80"/><SP/>
      <String CONTENT="ΚΑΙ" HPOS="420" VPOS="100" WIDTH="150" HEIGHT="80"/>
    </TextLine></TextBlock></PrintSpace>
  </Page></Layout>
</alto>`;
    expect(layoutKind(xml)).toBe('alto');
    const before = await version();
    const result = await importLayoutInto(db, target(before), xml);
    expect(result.pagesCreated).toBe(1);
    expect(result.zones).toBe(2);
    const breaks = result.content.items.filter((i): i is Break => isBreak(i) && i.type === 'page');
    const created = breaks[breaks.length - 1]!;
    const [page] = await db.select().from(pages).where(eq(pages.id, created.pageId!));
    expect(page?.label).toBe('scan_13r');
    await db.delete(pages).where(eq(pages.id, page!.id));
  });

  it('fetches only public http and https URLs', () => {
    expect(isFetchableUrl('https://raw.githubusercontent.com/x/y.xml')).toBe(true);
    expect(isFetchableUrl('http://localhost:5173/x')).toBe(false);
    expect(isFetchableUrl('http://192.168.1.10/x')).toBe(false);
    expect(isFetchableUrl('http://[::1]/x')).toBe(false);
    expect(isFetchableUrl('file:///etc/passwd')).toBe(false);
    expect(isFetchableUrl('not a url')).toBe(false);
  });
});

describe('settings and deletion', () => {
  it('gives every word a read form when the written form is switched on, and folds them back when off', async () => {
    const start = await version(ids.draft);
    const off = await saveSettings(db, ids.draft, { name: 'Draft', keepsWrittenForm: true, displayAsWritten: false, fromVersion: start, userId: ids.owner });
    expect(off.version).toBe(start + 1);
    const words = off.content!.items.filter(isToken);
    expect(words.every((t) => t.norm === t.form)).toBe(true);
    // Correct one written form; then switch the written form off: the read form stays the word.
    const ops = [{ t: 'set' as const, id: words[0]!.id, fields: { form: 'ΜΗΝΙΝ', unchecked: true } }];
    const edited = await saveOps(db, 'transcription', ids.draft, ids.owner, off.version, ops);
    const back = await saveSettings(db, ids.draft, { name: 'Renamed', keepsWrittenForm: false, displayAsWritten: true, fromVersion: edited.version, userId: ids.owner });
    const first = back.content!.items.find(isToken)!;
    expect(first).toMatchObject({ form: 'μῆνιν' });
    expect(first.norm).toBeUndefined();
    expect(first.unchecked).toBeUndefined();
    const [row] = await db.select().from(transcriptions).where(eq(transcriptions.id, ids.draft));
    expect(row).toMatchObject({ name: 'Renamed', keepsWrittenForm: false, displayAsWritten: true });
  });

  it('keeps its sources and note on rights, and adds a named source of an import on a line of its own', async () => {
    const now = await version(ids.draft);
    const saved = await saveSettings(db, ids.draft, { name: 'Renamed', keepsWrittenForm: false, displayAsWritten: true, sources: 'Collated from the microfilm.', rightsNote: 'By courtesy of the library.', fromVersion: now, userId: ids.owner });
    expect(saved).toMatchObject({ sources: 'Collated from the microfilm.', rightsNote: 'By courtesy of the library.' });
    await appendSources(db, ids.draft, 'T. W. Allen, Homeri Ilias (Oxford 1931)');
    await appendSources(db, ids.draft, 'T. W. Allen, Homeri Ilias (Oxford 1931)');
    const [row] = await db.select().from(transcriptions).where(eq(transcriptions.id, ids.draft));
    expect(row!.sources).toBe('Collated from the microfilm.\nT. W. Allen, Homeri Ilias (Oxford 1931)');
    // Settings saved without the fields leave them as they are.
    const again = await saveSettings(db, ids.draft, { name: 'Renamed', keepsWrittenForm: false, displayAsWritten: true, fromVersion: now, userId: ids.owner });
    expect(again.rightsNote).toBe('By courtesy of the library.');
  });

  it('deletes a transcription with its zones and history', async () => {
    await deleteTranscription(db, ids.draft);
    expect(await db.select().from(transcriptions).where(eq(transcriptions.id, ids.draft))).toEqual([]);
    expect(await db.select().from(zones).where(eq(zones.transcriptionId, ids.draft))).toEqual([]);
    expect(await db.select().from(changesets).where(eq(changesets.documentId, ids.draft))).toEqual([]);
    expect(await db.select().from(segments).where(eq(segments.workId, ids.work))).not.toEqual([]);
  });
});
