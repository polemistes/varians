import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, segmentIds } from '@varians/core';
import {
  changesets,
  conjectures,
  createDatabase,
  editionAdoptions,
  editions,
  reportedReadings,
  transcriptions,
  users,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { eq, inArray, like } from 'drizzle-orm';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { writeArchive } from '../archive/archive.ts';
import { hasXmllint, validateArchiveDir, validateTeiFiles } from '../archive/validate.ts';
import { loadDocument } from '../documents/service.ts';
import { editionView } from '../reader.ts';
import {
  PageDescriptionError,
  expectedLine,
  findWords,
  hunksOf,
  matchedPairs,
  occurrences,
  parseDescription,
  piecesOf,
  planPage,
  readerLine,
  removePage,
  seedPage,
  type PageDescription,
  type PageSeedResult,
} from './page.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
const SLUG = 'page-test';
let db: Database;
let pool: pg.Pool;
let root: string;
const ownerId = newId();

/**
 * A page of made-up Greek, five lines, that has every field of a description:
 * the base reads otherwise than the print at several places (a word order, a
 * spelling, a word no witness has), two witnesses have lines in another order,
 * one notes a variant in its margin, a lacuna is posited, a word is supplied,
 * and some sources are only cited.
 */
const description = (): unknown => ({
  about: 'Made-up lines for the tests.',
  assumptions: ['Witnesses not named have the printed text.'],
  work: { slug: SLUG, title: 'The Invented Page', author: 'Nobody', language: 'grc' },
  edition: { title: 'The Invented Page, as printed', base: 'A' },
  speakers: { 'Αρ.': 'ΑΡΙΣΤΩΝ', 'Βε.': 'ΒΕΝΔΙΣ' },
  witnesses: [
    { siglum: 'A', name: 'Codex Alpha', transcribed: true },
    { siglum: 'B', name: 'Codex Beta', transcribed: true },
    { siglum: 'C', name: 'Codex Gamma', transcribed: true },
    { siglum: 'D', name: 'Codex Delta', transcribed: false, note: 'rarely cited' },
  ],
  groups: [{ siglum: 'g', members: ['B', 'C'], note: 'the consensus of B and C' }],
  conventions: { all: 'codd.', rest: 'cett.' },
  lines: [
    { n: '1', text: '{Αρ.} ὁ ποιητὴς ἔγραψε βιβλίον μικρόν βιβλίον πάνυ,' },
    { n: '2', text: 'ἀλλ᾽ οὐκ ἔμελλε τοῖς πολίταις ἀρέσειν· {Βε.} τί δαί;' },
    { n: '3', text: 'ἡ μὲν πόλις ἐκείνη χαλεπῶς ἐδέξατο τοὺς ξένους' },
    { n: '4', text: '{Βε.} καὶ ἀπῆλθον οἱ ξένοι ταχέως πρὸς τὴν θάλατταν {lacuna}' },
    { n: '5', text: '{Αρ.} ὁ δὲ νεανίας ἔμεινε μόνος ἐν τῷ ἄστει.' },
  ],
  variants: [
    { line: '1', from: 'βιβλίον μικρόν', to: 'μικρόν βιβλίον', witnesses: ['A', 'B', 'C'] },
    { line: '2', from: 'ἀρέσειν·', to: 'ἀρέσαι·', witnesses: ['A'] },
    { line: '2', from: 'τί δαί;', to: 'τί δ᾽ αὖ;', witnesses: ['B'] },
    { line: '2', from: 'ἔμελλε', to: 'ἔμελλεν', witnesses: ['C'], assumed: true },
    { line: '3', from: 'ἐδέξατο', to: 'ἐδέχετο', witnesses: ['A', 'B', 'C'] },
    { line: '4', from: 'ταχέως', to: 'ταχὺ', witnesses: ['B', 'C'] },
    { line: '4', from: 'ταχὺ', to: 'ὀξέως', witnesses: ['C'] },
    { line: '5', from: 'ἄστει.', to: 'ἄστε.', witnesses: ['A', 'B', 'C'] },
  ],
  lineOrder: [
    { witnesses: ['A'], move: ['2'], after: '3', printed: '2 post 3 A' },
    { witnesses: ['C'], move: ['5'], after: '3' },
  ],
  marginalia: [{ line: '3', witness: 'B', state: 'γρ', on: 'πόλις', variant: 'ἄστυ' }],
  conjectures: [
    {
      line: '1',
      lemma: 'βιβλίον μικρόν',
      reading: 'βιβλίον μικρόν',
      for: 'μικρόν βιβλίον',
      by: 'Pellam',
      adopted: true,
    },
    {
      line: '1',
      lemma: 'βιβλίον',
      after: 'ἔγραψε',
      reading: 'βίβλον',
      by: 'Quill',
      adopted: false,
    },
    { line: '2', lemma: 'ἔμελλε', reading: 'ἔμελλεν', by: 'Quill', adopted: false },
    {
      line: '3',
      lemma: 'ἐδέξατο',
      reading: 'ἐδέξατο',
      for: 'ἐδέχετο',
      by: 'Orrin',
      adopted: true,
    },
    {
      line: '4',
      kind: 'lacuna',
      after: 'θάλατταν',
      by: 'Orrin',
      adopted: true,
      exempliGratia: '⟨καὶ ἐπλεύσαν⟩',
    },
    {
      line: '5',
      lemma: 'ἄστει.',
      reading: 'ἄστει.',
      for: 'ἄστε.',
      by: 'Pellam',
      adopted: true,
      kind: 'supplement',
    },
  ],
  reported: [
    { line: '2', lemma: 'πολίταις', reading: 'πολίτας', source: 'schol. in loc.' },
    {
      line: '3',
      lemma: 'ἐκείνη',
      reading: 'ἐκείνη',
      source: 'Lex. s.v.',
      withLemma: true,
      note: 'but elsewhere otherwise',
    },
    { line: '4', lemma: 'θάλατταν', reading: 'θάλασσαν', source: 'D', witness: 'D' },
    { line: '4', lines: ['4', '5'], reading: '', source: 'Epit.' },
  ],
  speakerNotes: [{ line: '1', printed: 'ΑΡΙΣΤΩΝ] ΑΡΙΣΤΟΝ Quill' }],
  printed: {
    '1': 'βιβλίον μικρόν Pellam: μικρόν βιβλίον codd.',
    '3': 'ἐδέξατο Orrin: ἐδέχετο codd.',
  },
});

const described = (change?: (d: Record<string, any>) => void): PageDescription => {
  const d = description() as Record<string, any>;
  change?.(d);
  return parseDescription(d);
};

/** The problems of a description that cannot be used. */
const problemsOf = (change: (d: Record<string, any>) => void): string[] => {
  try {
    planPage(described(change));
  } catch (error) {
    if (error instanceof PageDescriptionError) return error.problems;
    throw error;
  }
  return [];
};

describe('a description, before the database', () => {
  it('has its lines read as words, speakers and the lacuna mark', () => {
    expect(piecesOf('{Αρ.} ἄ β {lacuna}')).toEqual([
      { kind: 'speaker', label: 'Αρ.' },
      { kind: 'word', text: 'ἄ' },
      { kind: 'word', text: 'β' },
      { kind: 'lacuna' },
    ]);
    expect(piecesOf('ἄ {β')).toBe('a brace with no partner');
    expect(piecesOf('ἄ {} β')).toBe('empty braces');
  });

  it('gives each witness the text the variants imply, by line and in the order it has them', () => {
    const plan = planPage(described());
    const witness = (siglum: string) => plan.witnesses.find((w) => w.siglum === siglum)!;
    const read = (siglum: string, n: string) => witness(siglum).words.get(n)!.join(' ');
    expect(read('A', '1')).toBe('ὁ ποιητὴς ἔγραψε μικρόν βιβλίον βιβλίον πάνυ,');
    expect(read('A', '2')).toBe('ἀλλ᾽ οὐκ ἔμελλε τοῖς πολίταις ἀρέσαι· τί δαί;');
    expect(read('B', '2')).toBe('ἀλλ᾽ οὐκ ἔμελλε τοῖς πολίταις ἀρέσειν· τί δ᾽ αὖ;');
    expect(read('C', '2')).toBe('ἀλλ᾽ οὐκ ἔμελλεν τοῖς πολίταις ἀρέσειν· τί δαί;');
    expect(read('B', '3')).toBe('ἡ μὲν πόλις ἐκείνη χαλεπῶς ἐδέχετο τοὺς ξένους');
    // Several variants on one line of one witness apply in turn, the second on what the first left.
    expect(read('C', '4')).toBe('καὶ ἀπῆλθον οἱ ξένοι ὀξέως πρὸς τὴν θάλατταν');
    expect(read('B', '4')).toBe('καὶ ἀπῆλθον οἱ ξένοι ταχὺ πρὸς τὴν θάλατταν');
    expect(read('A', '4')).toBe('καὶ ἀπῆλθον οἱ ξένοι ταχέως πρὸς τὴν θάλατταν');
    expect(read('A', '5')).toBe('ὁ δὲ νεανίας ἔμεινε μόνος ἐν τῷ ἄστε.');
    expect(witness('A').order).toEqual(['1', '3', '2', '4', '5']);
    expect(witness('B').order).toEqual(['1', '2', '3', '4', '5']);
    expect(witness('C').order).toEqual(['1', '2', '3', '5', '4']);
    expect(witness('B').variantSiglum).toBe('Bγρ');
    expect(witness('A').variantSiglum).toBeNull();
  });

  it('says what it cannot express, in general terms', () => {
    const plan = planPage(described());
    expect(plan.deviations.join(' ')).toMatch(/indirect/u);
    expect(plan.deviations.join(' ')).toMatch(/order of words/u);
    expect(plan.deviations.join(' ')).toMatch(/whole word/u);
    expect(plan.deviations.join(' ')).toMatch(/speaker/u);
  });

  it('names the entry at fault', () => {
    // Each change makes one entry wrong; the problems named are those of that entry.
    const fault = (change: (d: Record<string, any>) => void) => problemsOf(change);
    expect(fault((d) => (d.variants[1].from = 'ἀρέσκειν·'))).toEqual([
      'variants[1] (line 2, from "ἀρέσκειν·"): "from" occurs 0 times in the line as A has it by this point (it must occur once)',
    ]);
    expect(fault((d) => (d.variants[0].from = 'βιβλίον'))).toEqual(
      ['A', 'B', 'C']
        .map(
          () =>
            'variants[0] (line 1, from "βιβλίον"): "from" occurs 2 times in the line as A has it by this point (it must occur once)',
        )
        .map((message, k) => message.replace(' as A ', ` as ${['A', 'B', 'C'][k]} `)),
    );
    expect(fault((d) => (d.variants[2].witnesses = ['Z']))).toEqual([
      'variants[2] (line 2, from "τί δαί;"): the siglum Z is not among the witnesses',
    ]);
    expect(fault((d) => (d.variants[2].witnesses = ['D']))).toEqual([
      'variants[2] (line 2, from "τί δαί;"): D is not transcribed, so it has no text to read otherwise',
    ]);
    expect(fault((d) => (d.edition.base = 'Q'))).toContain(
      'edition.base: the siglum Q is not among the witnesses',
    );
    expect(
      fault((d) => (d.lines[1].text = '{Χο.} ἀλλ᾽ οὐκ ἔμελλε τοῖς πολίταις ἀρέσειν· τί δαί;')),
    ).toEqual(['lines[1] (n 2): the speaker {Χο.} is not among the speakers']);
    expect(fault((d) => (d.conjectures[3].for = 'ἐδέχετο ὁ'))).toEqual([
      expect.stringMatching(/^conjectures\[3\] \(line 3, by Orrin\): A, the base, has the words/u),
    ]);
    expect(fault((d) => (d.marginalia[0].on = 'πόλ'))).toEqual([
      expect.stringMatching(
        /^marginalia\[0\] \(line 3, witness B\).*does not stand on word boundaries/u,
      ),
    ]);
    expect(fault((d) => (d.reported[1].reading = 'ἐκεῖνος'))).toEqual([
      expect.stringMatching(/^reported\[1\].*support the lemma/u),
    ]);
    expect(fault((d) => delete d.conjectures[1].after)).toEqual([
      expect.stringMatching(/^conjectures\[1\].*stands 2 times in the printed line/u),
    ]);
    expect(fault((d) => (d.conjectures[4].after = 'πρὸς'))).toEqual([
      expect.stringMatching(/^conjectures\[4\].*the line has no lacuna mark after πρὸς/u),
    ]);
    expect(fault((d) => (d.lineOrder[0].after = '9'))).toEqual([
      'lineOrder[0] (move 2 after 9): there is no line 9',
    ]);
  });

  it('names the entries whose shape is wrong', () => {
    const wrong = description() as Record<string, any>;
    delete wrong.variants[0].witnesses;
    wrong.lines[2].n = 3;
    expect(() => parseDescription(wrong)).toThrow(/lines\[2\]\.n/u);
    expect(() => parseDescription(wrong)).toThrow(/variants\[0\]\.witnesses/u);
  });
});

describe('the words compared', () => {
  it('counts overlapping occurrences and finds runs of words', () => {
    expect(occurrences('aaa', 'aa')).toBe(2);
    expect(occurrences('abc', 'x')).toBe(0);
    expect(findWords(['a', 'b', 'a', 'b'], ['a', 'b'])).toEqual([0, 2]);
    expect(findWords(['a', 'b', 'c', 'b'], ['b'], 'a')).toEqual([1]);
  });

  it('finds where two lists of words differ', () => {
    expect(matchedPairs(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(hunksOf(['a', 'b', 'c'], ['a', 'x', 'y', 'c'])).toEqual([
      { a0: 1, a1: 2, b0: 1, b1: 3 },
    ]);
    expect(hunksOf(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(hunksOf([], ['a'])).toEqual([{ a0: 0, a1: 0, b0: 0, b1: 1 }]);
  });
});

let result: PageSeedResult;

const clean = () => removePage(db, SLUG);

describe('seedPage, with a page of made-up Greek', () => {
  beforeAll(async () => {
    ({ db, pool } = createDatabase(url));
    await clean();
    await db
      .insert(users)
      .values({ id: ownerId, email: `${ownerId}@test`, name: 'Page Seeder', passwordHash: 'x' });
    root = await mkdtemp(path.join(os.tmpdir(), 'varians-page-'));
    result = await seedPage(db, ownerId, described());
  }, 60_000);

  afterAll(async () => {
    await clean();
    await db.delete(users).where(eq(users.id, ownerId));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });

  const editorView = () =>
    editionView(db, result.editionId, null, {
      kind: 'editor',
      viewer: { id: ownerId, role: 'member' },
    });

  it('makes the work, the witnesses (the cited ones too) and a transcript of those transcribed', async () => {
    expect(result.existed).toBe(false);
    expect(Object.keys(result.transcriptionIds).sort()).toEqual(['A', 'B', 'C']);
    expect(Object.keys(result.witnessIds)).toEqual(
      expect.arrayContaining(['A', 'B', 'C', 'D', 'schol. in loc.', 'Lex. s.v.', 'Epit.']),
    );
    expect(result.done.segments).toBe(5);
    expect(result.groups).toEqual([
      { siglum: 'g', members: ['B', 'C'], note: 'the consensus of B and C' },
    ]);
    expect(result.conventions).toEqual({ all: 'codd.', rest: 'cett.' });
    const [indirect] = await db
      .select({ category: witnesses.category })
      .from(witnesses)
      .where(eq(witnesses.id, result.witnessIds['Epit.']!));
    expect(indirect!.category).toBe('indirect');
  });

  it('gives every transcript the words the description implies, line by line, in its own order', async () => {
    const plan = planPage(described());
    const segmentOf = new Map(Object.entries(result.segmentIds));
    for (const w of plan.witnesses.filter((w) => w.transcribed)) {
      const { content } = await loadDocument(
        db,
        'transcription',
        result.transcriptionIds[w.siglum]!,
      );
      expect(
        segmentIds(content).map((id) => [...segmentOf].find(([, v]) => v === id)![0]),
        w.siglum,
      ).toEqual(w.order);
      // Words by segment: the first token begins the line, the rest follow.
      let current: string | null = null;
      const read = new Map<string, string[]>();
      for (const item of content.items) {
        if (item.kind === 'break') continue;
        if (item.segment?.segmentId) current = item.segment.segmentId;
        if (item.kind !== 'token') continue;
        const n = [...segmentOf].find(([, v]) => v === current)![0];
        read.set(n, [...(read.get(n) ?? []), item.form]);
      }
      for (const n of w.order) expect(read.get(n), `${w.siglum} ${n}`).toEqual(w.words.get(n));
    }
    // The checks above rest on the plan; here are the words themselves, for two of the lines.
    const b = await loadDocument(db, 'transcription', result.transcriptionIds.B!);
    expect(b.content.items.filter((i) => i.kind === 'token').map((i) => i.form)).toContain('δ᾽');
    const c = await loadDocument(db, 'transcription', result.transcriptionIds.C!);
    expect(c.content.items.filter((i) => i.kind === 'token').map((i) => i.form)).toContain('ὀξέως');
  });

  it('notes the margin’s variant on the words of the witness, as the stress seeder writes one', async () => {
    const { content } = await loadDocument(db, 'transcription', result.transcriptionIds.B!);
    const marked = content.items.filter(
      (i) => i.kind === 'token' && i.marks?.some((m) => m.kind === 'variant'),
    );
    expect(marked.map((i) => (i.kind === 'token' ? i.form : ''))).toEqual(['πόλις']);
    expect(marked[0]!.kind === 'token' && marked[0]!.marks![0]!.attrs).toMatchObject({
      reading: 'ἄστυ',
      place: 'margin',
    });
  });

  it('has an edition that reads the printed text, line by line, speakers and lacuna included', async () => {
    const view = await editorView();
    const plan = planPage(described());
    for (const line of plan.lines) {
      const id = result.segmentIds[line.n]!;
      expect(readerLine(view.content, id).replace(/[⟨⟩]/gu, ''), line.n).toBe(expectedLine(line));
    }
    expect(view.lines.filter((l) => l.label !== null).map((l) => l.label)).toEqual(['1', '5']);
    expect(Object.keys(view.segments)).toHaveLength(5);
  });

  it('puts the lines in the printed order whatever order the base has them', async () => {
    const view = await editorView();
    const [loaded] = await db
      .select({ content: editions.content })
      .from(editions)
      .where(eq(editions.id, result.editionId));
    expect(segmentIds(loaded!.content)).toEqual(
      ['1', '2', '3', '4', '5'].map((n) => result.segmentIds[n]!),
    );
    expect(view.edition.id).toBe(result.editionId);
  });

  it('reports a line a witness has elsewhere, by the witness', async () => {
    const view = await editorView();
    const bySiglum = (siglum: string) => view.order.filter((o) => o.siglum === siglum);
    expect(view.order.length).toBeGreaterThan(0);
    expect(bySiglum('A').length).toBeGreaterThan(0);
    expect(bySiglum('C').length).toBeGreaterThan(0);
    expect(bySiglum('B')).toEqual([]);
    const movedByC = bySiglum('C').flatMap((o) => o.moved);
    expect(movedByC.length).toBeGreaterThan(0);
  });

  it('names a conjecture the edition adopted as the source of the lemma', async () => {
    const view = await editorView();
    const entries = (n: string) => view.segments[result.segmentIds[n]!]!.entries;
    const orrin = entries('3').find((e) => e.adopted?.name === 'Orrin');
    expect(orrin).toBeDefined();
    expect(orrin!.lemma).toBe('ἐδέξατο');
    expect(orrin!.adopted!.conjectureKind).toBe('substitution');
    const pellam = entries('1').find((e) => e.adopted?.name === 'Pellam');
    expect(pellam).toBeDefined();
    // And the record is on the edition: adopted, so that deletions, lacunae and transpositions are attributed.
    const adopted = await db
      .select({ id: editionAdoptions.conjectureId })
      .from(editionAdoptions)
      .where(eq(editionAdoptions.editionId, result.editionId));
    const rows = await db
      .select({ proposer: conjectures.proposer, kind: conjectures.kind })
      .from(conjectures)
      .where(
        inArray(
          conjectures.id,
          adopted.map((a) => a.id),
        ),
      );
    expect(rows.map((r) => `${r.proposer} ${r.kind}`).sort()).toEqual([
      'Orrin lacuna',
      'Orrin substitution',
      'Pellam substitution',
      'Pellam supplement',
    ]);
  });

  it('has a conjecture of every other kind registered, those not adopted too, and the supplement naming its lacuna', async () => {
    const rows = await db.select().from(conjectures).where(eq(conjectures.workId, result.workId));
    expect(rows).toHaveLength(7);
    const lacuna = rows.find((r) => r.kind === 'lacuna')!;
    const filling = rows.find((r) => r.supplementsId !== null)!;
    expect(filling.supplementsId).toBe(lacuna.id);
    expect(filling.reading).toBe('καὶ ἐπλεύσαν');
    expect(rows.filter((r) => r.proposer === 'Quill')).toHaveLength(2);
    // A lemma that stands twice in the printed line is told apart by the word it follows.
    expect(rows.find((r) => r.reading === 'βίβλον')!.anchor).not.toBeNull();
  });

  it('has the edition’s lacuna, speakers and supplied word as objects and marks of the text', async () => {
    const view = await editorView();
    const items = view.content.items;
    expect(items.filter((i) => i.kind === 'object' && i.type === 'lacuna')).toHaveLength(1);
    const speakers = items.filter(
      (i) => i.kind === 'object' && i.type === 'paratext' && i.attrs?.type === 'speaker',
    );
    expect(speakers.map((i) => (i.kind === 'object' ? i.text : ''))).toEqual([
      'Αρ.',
      'Βε.',
      'Βε.',
      'Αρ.',
    ]);
    expect(speakers.map((i) => (i.kind === 'object' ? i.attrs?.who : null))).toEqual([
      'ΑΡΙΣΤΩΝ',
      'ΒΕΝΔΙΣ',
      'ΒΕΝΔΙΣ',
      'ΑΡΙΣΤΩΝ',
    ]);
    // A speaker who opens a line carries the line's start; none is a word.
    const opening = speakers.find((i) => i.kind === 'object' && i.segment);
    expect(opening).toBeDefined();
    const supplied = items.filter(
      (i) => i.kind === 'token' && i.marks?.some((m) => m.kind === 'supplied'),
    );
    expect(supplied.map((i) => (i.kind === 'token' ? i.form : ''))).toEqual(['ἄστει.']);
  });

  it('has the reported readings in place, each for its witness', async () => {
    const view = await editorView();
    const rows = await db
      .select()
      .from(reportedReadings)
      .where(eq(reportedReadings.workId, result.workId));
    expect(rows).toHaveLength(5);
    const toD = rows.find((r) => r.witnessId === result.witnessIds.D)!;
    // The source that is the witness's own siglum is not printed twice.
    expect(toD.source).toBeNull();
    expect(
      rows.find((r) => r.source === null && r.note === 'but elsewhere otherwise'),
    ).toBeDefined();
    // A source that is no witness of the description is the siglum of the witness made for it, and is not printed twice either.
    expect(rows.filter((r) => r.source !== null)).toEqual([]);
    const placed = Object.values(view.segments).flatMap((s) =>
      Object.values(s.attachments)
        .flat()
        .filter((a) => a.kind === 'reported'),
    );
    const unplaced = Object.values(view.segments).flatMap((s) =>
      s.unplaced.filter((a) => a.kind === 'reported'),
    );
    expect(placed.length + unplaced.length).toBe(5);
    expect(placed.map((a) => a.name)).toEqual(expect.arrayContaining(['D', 'schol. in loc.']));
  });

  it('has an apparatus the application can derive: places of variation, the base’s and the other witnesses’', async () => {
    const view = await editorView();
    const sites = Object.values(view.segments).flatMap((s) => s.collation.sites);
    expect(sites.length).toBeGreaterThan(3);
    const sigla = view.sigla.map((s) => s.siglum);
    expect(sigla).toEqual(['A', 'B', 'C', 'D', 'schol. in loc.', 'Lex. s.v.', 'Epit.']);
    expect(view.sigla.find((s) => s.siglum === 'B')!.variantSiglum).toBe('Bγρ');
    expect(view.sigla.find((s) => s.siglum === 'D')!.transcriptionId).toBeNull();
  });

  it('does nothing again for a work that exists', async () => {
    const again = await seedPage(db, ownerId, described());
    expect(again.existed).toBe(true);
    expect(again.workId).toBe(result.workId);
    expect(again.editionId).toBe(result.editionId);
    expect(again.transcriptionIds).toEqual(result.transcriptionIds);
  });

  it('is an archive that the application writes and validates, the TEI too', async () => {
    const dir = await writeArchive(db, result.workId, root);
    expect(await validateArchiveDir(dir)).toEqual([]);
    if (hasXmllint()) expect(await validateTeiFiles(dir)).toEqual([]);
    else console.warn('xmllint is not installed: the archive TEI is NOT validated.');
  }, 60_000);

  it('is taken out again with everything made for it, and can be seeded again', async () => {
    await removePage(db, SLUG);
    expect(
      await db
        .select({ id: works.id })
        .from(works)
        .where(like(works.slug, `${SLUG}%`)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: witnesses.id })
        .from(witnesses)
        .where(like(witnesses.slug, `${SLUG}-%`)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: changesets.id })
        .from(changesets)
        .where(
          inArray(changesets.documentId, [
            result.editionId,
            ...Object.values(result.transcriptionIds),
          ]),
        ),
    ).toEqual([]);
    expect(
      await db
        .select({ id: transcriptions.id })
        .from(transcriptions)
        .where(inArray(transcriptions.id, Object.values(result.transcriptionIds))),
    ).toEqual([]);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId))).toHaveLength(
      1,
    );
    const again = await seedPage(db, ownerId, described());
    expect(again.existed).toBe(false);
  }, 60_000);

  it('refuses a description that does not fit, and writes nothing', async () => {
    await removePage(db, SLUG);
    const wrong = described((d) => (d.variants[0].from = 'βιβλίον'));
    await expect(seedPage(db, ownerId, wrong)).rejects.toThrow(/variants\[0\]/u);
    expect(await db.select({ id: works.id }).from(works).where(eq(works.slug, SLUG))).toEqual([]);
  });
});

// Every description under local/ (kept out of the repository), when there is one: it must seed and its view run.

const here = path.dirname(new URL(import.meta.url).pathname);
const localRoot = process.env.VARIANS_LOCAL ?? path.resolve(here, '../../../../../../local');
const localPages = existsSync(localRoot)
  ? readdirSync(localRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(localRoot, e.name, 'page.json'))
      .filter((file) => existsSync(file))
  : [];

describe.skipIf(localPages.length === 0)('the descriptions under local/', () => {
  it.each(localPages)(
    'seed, and the view of the edition runs: %s',
    async (file) => {
      const { db, pool } = createDatabase(url);
      const owner = newId();
      const parsed = parseDescription(JSON.parse(readFileSync(file, 'utf8')));
      try {
        await removePage(db, parsed.work.slug);
        await db
          .insert(users)
          .values({ id: owner, email: `${owner}@test`, name: 'Page Seeder', passwordHash: 'x' });
        const seeded = await seedPage(db, owner, parsed);
        expect(seeded.existed).toBe(false);
        const view = await editionView(db, seeded.editionId, null, {
          kind: 'editor',
          viewer: { id: owner, role: 'member' },
        });
        expect(Object.keys(view.segments)).toHaveLength(parsed.lines.length);
      } finally {
        await removePage(db, parsed.work.slug);
        await db.delete(users).where(eq(users.id, owner));
        await pool.end();
      }
    },
    120_000,
  );
});
