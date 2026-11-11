/**
 * Collation in passages on the server: a segment is an address and not a
 * wall. A word divided across a boundary is one word; words merely assigned
 * to the neighbouring segment are found where they are; a variant across a
 * boundary is one variant labelled by the segments of its words; an edit
 * draws the passages around it again; and a published version keeps what it
 * showed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEME_PRESETS,
  exportEditionTei,
  defaultProfile,
  newId,
  type Item,
  type Stream,
  type Token,
} from '@varians/core';
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
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { replaceContent, saveOps } from './documents/service.ts';
import { editionText } from './archive/archive.ts';
import { publishEdition } from './publish.ts';
import { readerTei } from './reader-pages.ts';
import { editionOutline, editionView, refreshView } from './reader.ts';
import { DEFAULT_CONVENTIONS } from './seed/sample.ts';
import { resolveLabels, schemeOfWork } from './segments.ts';
import { setChosenWorks } from './transcription-works.ts';
import { outlineOf } from '../edition/outline.ts';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
let db: Database;
let pool: pg.Pool;
const userId = newId();
const PREFIX = 'passages-test';
const LABELS = ['1.1', '1.2', '1.3', '1.4'];

let segmentIdOf: (label: string) => string;
let workId: string;
let made = 0;

/**
 * A stream from lines: `1.1: a b`, a line that begins the segment 1.1;
 * `: c d`, a line that goes on in the segment before; a word ending in `-`
 * is divided, its next part beginning the next line.
 */
function stream(...lines: string[]): Stream {
  const items: Item[] = [];
  lines.forEach((line, k) => {
    if (k > 0) items.push({ kind: 'break', id: newId(), type: 'line' });
    const [label, text] = line.split(':') as [string, string];
    text
      .split(/\s+/u)
      .filter(Boolean)
      .forEach((word, w) => {
        const joins = word.endsWith('-');
        items.push({
          kind: 'token',
          id: newId(),
          form: joins ? word.slice(0, -1) : word,
          ...(joins ? { joinNext: true } : {}),
          ...(w === 0 && label.trim() ? { segment: { segmentId: segmentIdOf(label.trim()) } } : {}),
        });
      });
  });
  return { items };
}

/** An edition of the work with a transcription for each siglum, all published. */
async function editionWith(
  edition: Stream,
  texts: Record<string, Stream>,
): Promise<{ editionId: string; transcriptionOf: Record<string, string> }> {
  const transcriptionOf: Record<string, string> = {};
  const sigla: { witnessId: string; transcriptionId: string; siglum: string }[] = [];
  for (const [siglum, content] of Object.entries(texts)) {
    const witnessId = newId();
    await db.insert(witnesses).values({
      id: witnessId,
      slug: `${PREFIX}-${++made}`,
      siglum,
      name: `Witness ${siglum}`,
      createdBy: userId,
    });
    const id = newId();
    await db.insert(transcriptions).values({
      id,
      witnessId,
      name: 'Book 1',
      ownerId: userId,
      keepsWrittenForm: false,
      visibility: 'published',
    });
    await setChosenWorks(db, id, [workId]);
    await replaceContent(db, 'transcription', id, userId, 0, content, 'seed');
    transcriptionOf[siglum] = id;
    sigla.push({ witnessId, transcriptionId: id, siglum });
  }
  const editionId = newId();
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: `${PREFIX}-edition-${++made}`,
    title: 'Passages, an edition',
    editors: ['Editor'],
    ownerId: userId,
    conventions: DEFAULT_CONVENTIONS,
  });
  await replaceContent(db, 'edition', editionId, userId, 0, edition, 'start');
  await db.insert(editionSigla).values(sigla.map((s, position) => ({ editionId, ...s, position })));
  return { editionId, transcriptionOf };
}

async function cleanUp() {
  await db.delete(works).where(eq(works.slug, PREFIX));
  const ours = (await db.select({ slug: witnesses.slug }).from(witnesses))
    .map((w) => w.slug)
    .filter((slug) => slug.startsWith(`${PREFIX}-`));
  if (ours.length) await db.delete(witnesses).where(inArray(witnesses.slug, ours));
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(url));
  await cleanUp();
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@test`, name: 'Editor', passwordHash: 'x' });
  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: SCHEME_PRESETS[0]!.name,
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: userId,
  });
  workId = newId();
  await db.insert(works).values({
    id: workId,
    slug: PREFIX,
    title: 'Passages',
    language: 'grc',
    schemeId,
    profile: defaultProfile('grc'),
    createdBy: userId,
  });
  const segments = await resolveLabels(db, await schemeOfWork(db, workId), LABELS);
  segmentIdOf = (label) => segments.get(label)!.id;
});

afterAll(async () => {
  await cleanUp();
  await db.delete(referenceSchemes).where(eq(referenceSchemes.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

/** The labels of the segments of each passage of a view. */
const plan = (view: { segments: Record<string, { segments: { label: string }[] }> }) =>
  Object.values(view.segments).map((p) => p.segments.map((s) => s.label));

/** Every variant of a view: its label, and each reading's words with its sigla. */
function variants(view: Awaited<ReturnType<typeof editionView>>): string[] {
  const labelOf = view.labelOf;
  return Object.values(view.segments).flatMap((p) =>
    p.collation.sites.map((site) => {
      const ids = p.siteSegments[site.index] ?? [];
      const label =
        ids.length > 1
          ? `${labelOf[ids[0]!]}–${labelOf[ids[ids.length - 1]!]}`
          : (labelOf[ids[0]!] ?? '');
      const readings = site.readings.map(
        (r) => `${r.base ? '*' : ''}${r.text || '(nothing)'}: ${r.sigla.join(' ')}`,
      );
      return `${label} ${readings.join(' | ')}`;
    }),
  );
}

describe('collation in passages', () => {
  it('reads a word divided across two segments in one witness and whole in another as one word: no variant', async () => {
    const { editionId } = await editionWith(
      stream('1.1: alpha beta gamma', '1.2: delta epsilon zeta'),
      {
        // A divides gamma across the boundary, its second part in 1.2; B has it whole in 1.1.
        A: stream('1.1: alpha beta gam-', '1.2: ma delta epsilon zeta'),
        B: stream('1.1: alpha beta gamma', '1.2: delta epsilon zeta'),
      },
    );
    const view = await editionView(db, editionId, null);
    expect(variants(view)).toEqual([]);
    // The boundary is crossed by A's word: the two segments are one passage.
    expect(plan(view)).toEqual([['1.1', '1.2']]);
  });

  it('finds a line a witness assigns to the neighbouring segment where it is: no variant', async () => {
    const { editionId } = await editionWith(
      stream('1.1: alpha beta gamma', '1.2: delta epsilon zeta', '1.3: eta theta iota'),
      {
        // A runs its first segment on over the edition's second line.
        A: stream('1.1: alpha beta gamma', ': delta epsilon zeta', '1.3: eta theta iota'),
        B: stream('1.1: alpha beta gamma', '1.2: delta epsilon zeta', '1.3: eta theta iota'),
      },
    );
    const view = await editionView(db, editionId, null);
    expect(variants(view)).toEqual([]);
    expect(plan(view)).toEqual([['1.1', '1.2', '1.3']]);
  });

  it('makes one variant of what lies across a boundary, labelled by the segments of its words', async () => {
    const { editionId } = await editionWith(
      stream('1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta'),
      {
        // A has epsilon at the end of 1.1, where the edition has it at the start of 1.2.
        A: stream('1.1: alpha beta gamma delta epsilon', '1.2: zeta eta theta'),
        // B reads two words otherwise, one on either side of the boundary.
        B: stream('1.1: alpha beta gamma kappa', '1.2: lambda zeta eta theta'),
      },
    );
    const view = await editionView(db, editionId, null);
    expect(variants(view)).toEqual(['1.1–1.2 *delta epsilon: ed. A | kappa lambda: B']);
    // The entry of the apparatus has the same label, and the outline stands it in 1.1.
    const [passage] = Object.values(view.segments);
    expect(passage!.entries.map((e) => e.label)).toEqual(['1.1–1.2']);
    const [site] = outlineOf(passage!).sites;
    expect(site!.segments).toEqual([segmentIdOf('1.1'), segmentIdOf('1.2')]);
  });

  it('links a word a witness is without in one passage to where it has it in another, whichever is asked for', async () => {
    const { editionId } = await editionWith(
      stream(
        '1.1: alpha beta gamma delta epsilon zeta eta theta',
        '1.2: iota kappa lambda mu nu xi omicron pi',
      ),
      {
        // A has the first word of 1.1 in the middle of 1.2.
        A: stream(
          '1.1: beta gamma delta epsilon zeta eta theta',
          '1.2: iota kappa lambda mu alpha nu xi omicron pi',
        ),
        B: stream(
          '1.1: alpha beta gamma delta epsilon zeta eta theta',
          '1.2: iota kappa lambda mu nu xi omicron pi',
        ),
      },
    );
    const [one, two] = [segmentIdOf('1.1'), segmentIdOf('1.2')];
    const linked = (view: Awaited<ReturnType<typeof refreshView>>, at: string) =>
      Object.values(view.segments)
        .find((p) => p.segmentId === at)!
        .collation.sites.find((s) => s.transposition)?.transposition;
    const whole = await refreshView(db, editionId, [one, two]);
    expect(plan(whole)).toEqual([['1.1'], ['1.2']]);
    expect(linked(whole, one)).toMatchObject({ inPassage: two });
    expect(linked(whole, two)).toMatchObject({ inPassage: one });
    // Asked for one passage alone, it has its link all the same.
    expect(linked(await refreshView(db, editionId, [two]), two)).toEqual(linked(whole, two));
  });

  it('draws the passages again after an edit: two segments become one, and two again when it is undone', async () => {
    const { editionId } = await editionWith(
      stream('1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta'),
      {
        A: stream('1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta'),
        B: stream('1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta'),
      },
    );
    const two = await editionView(db, editionId, null);
    expect(plan(two)).toEqual([['1.1'], ['1.2']]);
    // The editor reads otherwise on both sides of the boundary, next to it.
    const items = two.content.items.filter((i): i is Token => i.kind === 'token');
    const [last, first] = [items[3]!, items[4]!];
    const save = async (forms: [string, string]) => {
      const [row] = await db
        .select({ version: editions.version })
        .from(editions)
        .where(eq(editions.id, editionId));
      await saveOps(db, 'edition', editionId, userId, row!.version, [
        { t: 'set', id: last.id, fields: { form: forms[0] } },
        { t: 'set', id: first.id, fields: { form: forms[1] } },
      ]);
    };
    await save(['deltas', 'epsilom']);
    // What the editor asks for after the edit is the passage as it now is, from either segment.
    const after = await refreshView(db, editionId, [segmentIdOf('1.2')]);
    expect(plan(after)).toEqual([['1.1', '1.2']]);
    const one = await editionView(db, editionId, null);
    expect(plan(one)).toEqual([['1.1', '1.2']]);
    // The two words the witnesses read alike are one variant across the boundary.
    expect(variants(one)).toEqual(['1.1–1.2 *deltas epsilom: ed. | delta epsilon: A B']);
    const { outline } = await editionOutline(db, editionId);
    expect(Object.keys(outline)).toEqual([segmentIdOf('1.1')]);
    // Undone: two passages again.
    await save(['delta', 'epsilon']);
    const again = await refreshView(db, editionId, [segmentIdOf('1.1')]);
    expect(plan(again)).toEqual([['1.1']]);
    expect(plan(await editionView(db, editionId, null))).toEqual([['1.1'], ['1.2']]);
  });

  it('keeps a published version as it was when a transcript is edited afterwards', async () => {
    const { editionId, transcriptionOf } = await editionWith(
      stream('1.1: alpha beta gamma', '1.2: delta epsilon zeta', '1.3: eta theta iota'),
      {
        A: stream('1.1: alpha beta gamma', '1.2: delta epsilon zeta', '1.3: eta theta iota'),
        B: stream('1.1: alpha beta gamma', '1.2: delta epsilon xi', '1.3: eta theta iota'),
      },
    );
    const published = await publishEdition(db, editionId, userId);
    const before = await editionView(db, editionId, published.version);
    expect(plan(before)).toEqual([['1.1'], ['1.2'], ['1.3']]);
    expect(variants(before)).toEqual(['1.2 *zeta: ed. A | xi: B']);
    // A's transcript is edited: its second line is given to 1.1, and a word of the third is read otherwise.
    const [row] = await db
      .select({ version: transcriptions.version })
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionOf.A!));
    await replaceContent(
      db,
      'transcription',
      transcriptionOf.A!,
      userId,
      row!.version,
      stream('1.1: alpha beta gamma', ': delta epsilon zeta', '1.3: eta omega iota'),
    );
    const draft = await editionView(db, editionId, null);
    expect(plan(draft)).not.toEqual(plan(before));
    expect(variants(draft)).toContain('1.3 *theta: ed. B | omega: A');
    // The published version shows what it showed.
    const then = await editionView(db, editionId, published.version);
    expect(plan(then)).toEqual(plan(before));
    expect(variants(then)).toEqual(variants(before));
  });
});

/**
 * What a text has, as the TEI says it: the words outside any variant, and at
 * each variant the words of the reading it is in, a variant inside a lemma
 * read the same way. The edition's own words are the lemma's. A witness in no
 * reading of a variant is not there, and has nothing from it. `text` is the
 * words in order, a word that a break or the start of a segment divides
 * written as one; `bySegment` is the words from each start of a segment that
 * the text passes to the next, which for the edition is its segments.
 */
function readBack(
  tei: string,
  siglum: string,
): { text: string; bySegment: Record<string, string> } {
  const body = tei.slice(tei.indexOf('<ab>') + 4, tei.indexOf('</ab>'));
  const mine = `#wit-${siglum}`;
  const stands = (tag: string) =>
    /wit="([^"]*)"/u.exec(tag)?.[1]?.split(' ').includes(mine) ?? false;
  /** Whether what is read now belongs to the text, by element; a variant remembers that its lemma was taken. */
  const frames: { take: boolean; chosen?: boolean }[] = [{ take: true }];
  const bySegment: Record<string, string> = {};
  let segment = '';
  let text = '';
  for (const [piece] of body.matchAll(/<[^>]+>|[^<]+/gu)) {
    const top = frames.at(-1)!;
    if (!piece.startsWith('<')) {
      if (!top.take) continue;
      text += piece;
      bySegment[segment] = (bySegment[segment] ?? '') + piece;
    } else if (piece.startsWith('</')) frames.pop();
    else if (piece.startsWith('<app')) frames.push({ take: top.take, chosen: false });
    else if (piece.startsWith('<lem') || piece.startsWith('<rdg')) {
      const take =
        top.take &&
        (piece.startsWith('<lem')
          ? siglum === 'ed.' || stands(piece)
          : !top.chosen && siglum !== 'ed.' && stands(piece));
      if (take) top.chosen = true;
      if (!piece.endsWith('/>')) frames.push({ take });
    } else if (piece.startsWith('<milestone')) {
      if (top.take) segment = /n="([^"]*)"/u.exec(piece)![1]!;
      if (top.take && !piece.includes('break="no"')) text += ' ';
    } else if (piece.startsWith('<lb') && top.take && !piece.includes('break="no"')) {
      text += ' ';
      bySegment[segment] = (bySegment[segment] ?? '') + ' ';
    }
  }
  const tidy = (words: string) => words.split(/\s+/u).filter(Boolean).join(' ');
  return {
    text: tidy(text),
    bySegment: Object.fromEntries(
      Object.entries(bySegment)
        .map(([n, words]) => [n, tidy(words)] as const)
        .filter(([, words]) => words !== ''),
    ),
  };
}

describe('the TEI of a variant across a boundary', () => {
  /** The TEI as the reader is given it and as the archive writes it. */
  async function teiFiles(editionId: string) {
    const view = await editionView(db, editionId, null);
    const archived = await editionText(db, editionId, new Map(Object.entries(view.labelOf)));
    return {
      view,
      files: {
        reader: readerTei(view),
        archive: exportEditionTei({
          title: view.edition.title,
          baseSiglum: 'ed.',
          witnesses: view.sigla.map((s) => ({ siglum: s.siglum })),
          ...archived.tei,
        }),
      },
    };
  }
  const words = (rows: string[]) =>
    Object.fromEntries(rows.map((row) => row.split(': ') as [string, string]));
  /** The words of a text given in rows, in order, a divided word as one. */
  const running = (rows: string[]) =>
    rows
      .map((row) => row.split(': ')[1]!)
      .join(' ')
      .replace(/- /gu, '');

  it('gives the variant once, the edition its words of each segment and each witness its own words, in the reader’s file and in the archive’s', async () => {
    const own = {
      A: ['1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta'],
      // B has a word in each segment; C has both in the first, where the edition has the one.
      B: ['1.1: alpha beta gamma kappa', '1.2: lambda zeta eta theta'],
      C: ['1.1: alpha beta gamma kappa lambda', '1.2: zeta eta theta'],
    };
    const { editionId } = await editionWith(
      stream('1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta'),
      Object.fromEntries(Object.entries(own).map(([siglum, rows]) => [siglum, stream(...rows)])),
    );
    const { view, files } = await teiFiles(editionId);
    expect(plan(view)).toEqual([['1.1', '1.2']]);
    expect(variants(view)).toEqual(['1.1–1.2 *delta epsilon: ed. A | kappa lambda: B C']);
    for (const tei of Object.values(files)) {
      expect(readBack(tei, 'ed.').bySegment).toEqual(
        words(['1.1: alpha beta gamma delta', '1.2: epsilon zeta eta theta']),
      );
      for (const [siglum, rows] of Object.entries(own))
        expect(readBack(tei, siglum).text, siglum).toBe(running(rows));
      // One variant, with no name, and the second segment begins inside its lemma.
      expect(tei.match(/<app/gu)).toHaveLength(1);
      expect(tei).not.toContain('<app xml:id');
      expect(tei).toMatch(
        /<lem wit="#wit-A">delta(?:<lb\/>)?\s?<milestone unit="segment" n="1\.2"[^>]*\/>epsilon<\/lem><rdg wit="#wit-B #wit-C">kappa lambda<\/rdg>/u,
      );
    }
  });

  it('gives a word the edition divides across the two segments, inside a variant, whole in the lemma, the second segment begun inside it', async () => {
    const edition = ['1.1: alpha beta gam-', '1.2: ma delta epsilon theta'];
    const own = {
      A: edition,
      // B has another word where the edition has the divided one; C has a divided word of its own.
      B: ['1.1: alpha beta kappa', '1.2: delta epsilon theta'],
      C: ['1.1: alpha beta kap-', '1.2: pa delta epsilon theta'],
    };
    const { editionId } = await editionWith(
      stream(...edition),
      Object.fromEntries(Object.entries(own).map(([siglum, rows]) => [siglum, stream(...rows)])),
    );
    const { view, files } = await teiFiles(editionId);
    expect(plan(view)).toEqual([['1.1', '1.2']]);
    expect(variants(view)).toEqual(['1.1 *gamma: ed. A | kappa: B C']);
    for (const tei of Object.values(files)) {
      // The edition has the two parts of its word in the two segments, and they are one word.
      expect(readBack(tei, 'ed.').bySegment).toEqual(
        words(['1.1: alpha beta gam', '1.2: ma delta epsilon theta']),
      );
      expect(readBack(tei, 'ed.').text).toBe('alpha beta gamma delta epsilon theta');
      expect(readBack(tei, 'A').text).toBe(readBack(tei, 'ed.').text);
      for (const siglum of ['B', 'C'])
        expect(readBack(tei, siglum).text, siglum).toBe('alpha beta kappa delta epsilon theta');
      expect(tei.match(/<app/gu)).toHaveLength(1);
      expect(tei).toMatch(
        /<lem wit="#wit-A">gam(?:<lb break="no"\/>)?<milestone unit="segment" n="1\.2"[^>]*break="no"\/>ma<\/lem><rdg wit="#wit-B #wit-C">kappa<\/rdg>/u,
      );
    }
  });
});
