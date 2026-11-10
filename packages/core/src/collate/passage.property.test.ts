import { describe, expect, it } from 'vitest';
import { adoptReading, siteTokenIds } from '../edition/adopt.ts';
import { sequentialIds } from '../ids.ts';
import { isToken, type Id, type Item, type Stream } from '../stream/items.ts';
import { applyOps } from '../stream/ops.ts';
import { segmentRuns } from '../stream/words.ts';
import {
  COLLATION_WORDS,
  runProperty,
  shrinkList,
  type Property,
  type Rng,
} from '../testing/random.ts';
import { DEFAULT_FOLD, fold } from '../normalize/fold.ts';
import { collatePassages, type StreamText } from './passage.ts';

/**
 * A work in segments, an edition of it and witnesses, as words. Each word a
 * witness has carries a key in the edition's words: the index of the word
 * it reads (kept, read otherwise, or moved), or for a word it adds, the
 * point it is added at, a little before the edition's word after it (it
 * goes with the segment before a boundary there) or at it (with the
 * segment after). A witness's segments are cut where its keys pass the
 * edition's boundaries: so a boundary set elsewhere in the edition is set
 * alike in every witness.
 */
interface Case {
  base: string[];
  /** The index of the edition's word at which each segment after the first begins, increasing. */
  bounds: number[];
  witnesses: { siglum: string; words: { text: string; key: number }[] }[];
}

interface Built {
  edition: StreamText;
  witnesses: StreamText[];
}

const segmentName = (k: number) => `s${String(k + 1).padStart(2, '0')}`;

/** A stream of words cut into segments before the word indexes `cuts`, each segment on a line of its own; a segment without words is an object that begins it, so that the text runs on without its words. */
function streamOf(prefix: string, words: string[], cuts: number[], divide?: Divide): Stream {
  const items: Item[] = [];
  let n = 0;
  const edges = [0, ...cuts, words.length];
  for (let k = 0; k + 1 < edges.length; k++) {
    if (k > 0) items.push({ kind: 'break', id: `${prefix}l${k}`, type: 'line' });
    const segment = { segmentId: segmentName(k) };
    const from = edges[k]!;
    const to = edges[k + 1]!;
    if (from === to) items.push({ kind: 'object', id: `${prefix}o${k}`, type: 'mark', segment });
    for (let i = from; i < to; i++) {
      const form = words[i]!;
      const token = { kind: 'token' as const, id: `${prefix}${++n}`, form };
      if (i === from) Object.assign(token, { segment });
      // The last word of the segment before a boundary divided: its tail begins the next segment's line.
      if (divide && divide.boundary === k + 1 && i === to - 1 && to < words.length) {
        const letters = Array.from(form);
        const at = Math.min(Math.max(1, divide.at), letters.length - 1);
        items.push({ ...token, form: letters.slice(0, at).join(''), joinNext: true });
        items.push({ kind: 'break', id: `${prefix}l${k + 1}`, type: 'line' });
        items.push({
          kind: 'token',
          id: `${prefix}${++n}`,
          form: letters.slice(at).join(''),
          segment: { segmentId: segmentName(k + 1) },
        });
        // The next segment's own first word then follows on its line, without a start of its own.
        const next = words[to]!;
        items.push({ kind: 'token', id: `${prefix}${++n}`, form: next });
        k++;
        const after = edges[k + 1]!;
        for (let j = to + 1; j < after; j++)
          items.push({ kind: 'token', id: `${prefix}${++n}`, form: words[j]! });
        break;
      }
      items.push(token);
    }
  }
  return { items };
}

/** A word divided across a boundary in one text: `text` -1 for the edition. */
interface Divide {
  text: number;
  boundary: number;
  at: number;
}

function cutsOf(keys: number[], bounds: number[]): number[] {
  return bounds.map((b) => keys.filter((k) => k < b).length);
}

function build(c: Case, divide?: Divide): Built {
  const edition: StreamText = {
    id: 'E',
    siglum: 'ed.',
    stream: streamOf('E', c.base, c.bounds, divide?.text === -1 ? divide : undefined),
  };
  const witnesses = c.witnesses.map((w, k) => ({
    id: `W${k + 1}`,
    siglum: w.siglum,
    stream: streamOf(
      `W${k + 1}.`,
      w.words.map((x) => x.text),
      cutsOf(
        w.words.map((x) => x.key),
        c.bounds,
      ),
      divide?.text === k ? divide : undefined,
    ),
  }));
  return { edition, witnesses };
}

/**
 * The variants as their words, readings and witnesses, and whether a
 * witness's word is linked to another spot: everything but the segments,
 * the passages and the indexes of sites. A variant at a point is told by
 * the edition's words on either side of it. Which of two equal words of the
 * edition a variant lies on is not told: where the edition has the same
 * word twice and a witness once, which of the two it is without is a tie of
 * the alignment that the context decides, and the segments are context.
 */
function variants({ edition, witnesses }: Built): string[] {
  const { passages } = collatePassages(edition, witnesses);
  const out: string[] = [];
  const all = passages.flatMap((p) => p.base.units.map((u) => u.text));
  let offset = 0;
  for (const passage of passages) {
    for (const site of passage.collation.sites) {
      const from = site.baseFrom + offset;
      const where =
        site.baseTo > site.baseFrom ? '' : `${all[from - 1] ?? '^'}_${all[from] ?? '$'} `;
      const readings = site.readings
        .map(
          (r) =>
            `${r.base ? '*' : ''}${r.fold}${r.omission ? '[om]' : ''}<${[...r.sigla].sort().join('')}`,
        )
        .sort()
        .join(' | ');
      const link = site.transposition;
      const linked =
        link && (link.inPassage !== undefined || link.withSite !== site.index)
          ? ` linked ${[...link.textIds].sort().join('')}`
          : '';
      out.push(`${where}${readings}${linked}`);
    }
    offset += passage.base.units.length;
  }
  return out.sort();
}

/** The words of the pool with letters of their own: no two of them differ only in accents or breathings. */
const DISTINCT = COLLATION_WORDS.filter(
  (w, k) => COLLATION_WORDS.findIndex((v) => bareLetters(v) === bareLetters(w)) === k,
);

function bareLetters(word: string): string {
  return fold(word, { ...DEFAULT_FOLD, stripDiacritics: true });
}

interface GenerateOptions {
  /** Witnesses as the edition is, and no more. */
  mutate?: boolean;
  /**
   * No two of the edition's words have the same letters, and a word a
   * witness reads otherwise or adds has letters no word of the edition has:
   * where no word stands twice, no alignment has a tie between two of them.
   */
  tidy?: boolean;
  /** Witnesses may move a word anywhere, not only to the next place. */
  far?: boolean;
}

function generate(rng: Rng, size: number, options: GenerateOptions = {}): Case {
  const segments = rng.between(2, Math.min(options.tidy ? 4 : 5, 2 + Math.floor(size / 3)));
  const lengths = Array.from({ length: segments }, () => rng.between(1, options.tidy ? 3 : 4));
  const distinct = rng.shuffle(DISTINCT);
  const base = lengths.flatMap((l) =>
    Array.from({ length: l }, () => (options.tidy ? distinct.pop()! : rng.pick(COLLATION_WORDS))),
  );
  // In a tidy case the witnesses' own words are those the edition does not have.
  const pool = options.tidy ? distinct : COLLATION_WORDS;
  const bounds: number[] = [];
  let at = 0;
  for (const l of lengths.slice(0, -1)) bounds.push((at += l));
  const count = rng.between(1, 3);
  const witnesses: Case['witnesses'] = [];
  for (let k = 0; k < count; k++) {
    const words = base.map((text, i) => ({ text, key: i }));
    const edits = options.mutate === false ? 0 : rng.between(0, 1 + Math.floor(size / 3));
    for (let e = 0; e < edits; e++) {
      const kind = rng.int(options.far === false ? 4 : 5);
      const i = words.length === 0 ? 0 : rng.int(words.length);
      if (kind === 0 && words.length > 0) words[i] = { ...words[i]!, text: rng.pick(pool) };
      else if (kind === 1 && words.length > 1) words.splice(i, 1);
      else if (kind === 2) {
        // Added before the word at i (or at the end): with the segment before or after a boundary there.
        const before = words[i]?.key ?? base.length;
        words.splice(i, 0, { text: rng.pick(pool), key: rng.chance(0.5) ? before - 0.5 : before });
      } else if (kind === 3 && words.length > 1) {
        const j = Math.min(words.length - 1, i + 1);
        [words[i], words[j]] = [words[j]!, words[i]!];
      } else if (kind === 4 && words.length > 1) {
        const [moved] = words.splice(i, 1);
        words.splice(rng.int(words.length + 1), 0, moved!);
      }
    }
    witnesses.push({ siglum: String.fromCharCode(65 + k), words });
  }
  return { base, bounds, witnesses };
}

/** The words a witness may add: in a tidy case, those with letters no word of the edition has. */
function foreignTo(c: Case, options: GenerateOptions): string[] {
  if (!options.tidy) return COLLATION_WORDS;
  const own = new Set(c.base.map(bareLetters));
  return DISTINCT.filter((w) => !own.has(bareLetters(w)));
}

function show(c: Case): string {
  const segmented = (words: string[], cuts: number[]) => {
    const parts: string[] = [];
    let from = 0;
    for (const cut of [...cuts, words.length]) {
      parts.push(words.slice(from, cut).join(' '));
      from = cut;
    }
    return parts.join(' | ');
  };
  return [
    `ed.: ${segmented(c.base, c.bounds)}`,
    ...c.witnesses.map(
      (w) =>
        `${w.siglum}: ${segmented(
          w.words.map((x) => x.text),
          cutsOf(
            w.words.map((x) => x.key),
            c.bounds,
          ),
        )}   keys ${w.words.map((x) => x.key).join(' ')}`,
    ),
  ].join('\n');
}

function* shrinkCase<C extends { case: Case }>(c: C): Generator<C> {
  for (const witnesses of shrinkList(c.case.witnesses, 1))
    yield { ...c, case: { ...c.case, witnesses } };
  for (let k = 0; k < c.case.witnesses.length; k++)
    for (const words of shrinkList(c.case.witnesses[k]!.words)) {
      const witnesses = c.case.witnesses.slice();
      witnesses[k] = { ...witnesses[k]!, words };
      yield { ...c, case: { ...c.case, witnesses } };
    }
}

// ---------------------------------------------------------------------------

interface Moved {
  case: Case;
  /** Which boundary moves, and by how many words. */
  boundary: number;
  by: number;
}

/** The case with a boundary of the edition moved, or null where a segment would be left without words. */
function moved(c: Case, boundary: number, by: number): Case | null {
  const edges = [0, ...c.bounds, c.base.length];
  const to = c.bounds[boundary]! + by;
  if (to <= edges[boundary]! || to >= edges[boundary + 2]!) return null;
  const bounds = c.bounds.slice();
  bounds[boundary] = to;
  return { ...c, bounds };
}

/** Moving a segment boundary by a word or two, alike in every text, changes no variant. */
const principle = (options: GenerateOptions): Property<Moved> => ({
  generate(rng, size) {
    const c = generate(rng, size, options);
    return { case: c, boundary: rng.int(c.bounds.length), by: rng.pick([-2, -1, 1, 2]) };
  },
  show: (m) => `${show(m.case)}\nboundary ${m.boundary + 1} moved by ${m.by}`,
  shrink: shrinkCase,
  check(m) {
    const other = moved(m.case, m.boundary, m.by);
    if (!other) return;
    const before = variants(build(m.case));
    const after = variants(build(other));
    expect(after, `before:\n${before.join('\n')}\nafter:\n${after.join('\n')}`).toEqual(before);
  },
});

interface Divided {
  case: Case;
  divide: Divide;
}

/** A word divided across a boundary gives the variants of the same word undivided, in the segment where it begins. */
const divided = (options: GenerateOptions): Property<Divided> => ({
  generate(rng, size) {
    const c = generate(rng, size, options);
    return {
      case: c,
      divide: {
        text: rng.int(c.witnesses.length + 1) - 1,
        boundary: rng.between(1, c.bounds.length),
        at: rng.between(1, 4),
      },
    };
  },
  show: (d) => `${show(d.case)}\ndivided: ${JSON.stringify(d.divide)}`,
  shrink: shrinkCase,
  check(d) {
    // A word of two letters or more, at the end of a segment of the text with words in the next.
    const words =
      d.divide.text < 0
        ? d.case.base.map((text, key) => ({ text, key }))
        : d.case.witnesses[d.divide.text]?.words;
    if (!words) return;
    const edges = [
      0,
      ...cutsOf(
        words.map((x) => x.key),
        d.case.bounds,
      ),
      words.length,
    ];
    const end = edges[d.divide.boundary]!;
    if (end <= edges[d.divide.boundary - 1]! || end >= edges[d.divide.boundary + 1]!) return;
    if (Array.from(words[end - 1]!.text).length < 2) return;
    const whole = variants(build(d.case));
    const parts = variants(build(d.case, d.divide));
    expect(parts, `whole:\n${whole.join('\n')}\ndivided:\n${parts.join('\n')}`).toEqual(whole);
  },
});

interface Added {
  case: Case;
  witness: number;
  boundary: number;
  word: string;
}

/** Words a witness adds at a boundary give the same variant whether its transcript sets them at the end of the one segment or the start of the other. */
const added = (options: GenerateOptions): Property<Added> => ({
  generate(rng, size) {
    const c = generate(rng, size, options);
    return {
      case: c,
      witness: rng.int(c.witnesses.length),
      boundary: rng.int(c.bounds.length),
      word: rng.pick(foreignTo(c, options)),
    };
  },
  show: (a) =>
    `${show(a.case)}\n${a.word} added by witness ${a.witness + 1} at boundary ${a.boundary + 1}`,
  shrink: shrinkCase,
  check(a) {
    if (!a.case.witnesses[a.witness]) return;
    const at = a.case.bounds[a.boundary]!;
    const side = (key: number): Case => {
      const witnesses = a.case.witnesses.slice();
      const w = witnesses[a.witness]!;
      const cut = w.words.filter((x) => x.key < at).length;
      // The word is put where the witness's segments meet, with the segment before or after.
      witnesses[a.witness] = {
        ...w,
        words: [...w.words.slice(0, cut), { text: a.word, key }, ...w.words.slice(cut)],
      };
      return { ...a.case, witnesses };
    };
    const one = variants(build(side(at - 0.5)));
    const other = variants(build(side(at)));
    expect(other, `at the end:\n${one.join('\n')}\nat the start:\n${other.join('\n')}`).toEqual(
      one,
    );
  },
});

interface Across {
  case: Case;
  witness: number;
  boundary: number;
  by: number;
}

/** A word a witness has at the end of one segment where the edition has it at the start of the next (or the reverse) is no variant when the texts are otherwise alike. */
const across = (options: GenerateOptions): Property<Across> => ({
  generate(rng, size) {
    const c = generate(rng, size, { ...options, mutate: false });
    return {
      case: c,
      witness: rng.int(c.witnesses.length),
      boundary: rng.int(c.bounds.length),
      by: rng.pick([-1, 1]),
    };
  },
  show: (m) => `${show(m.case)}\nwitness ${m.witness + 1}, boundary ${m.boundary + 1} by ${m.by}`,
  check(m) {
    // The witness's boundary falls a word later (or earlier) than the edition's.
    const at = m.case.bounds[m.boundary]!;
    const witnesses = m.case.witnesses.map((w, k) =>
      k !== m.witness
        ? w
        : {
            ...w,
            words: w.words.map((x) =>
              m.by > 0 && x.key === at
                ? { ...x, key: at - 0.5 }
                : m.by < 0 && x.key === at - 1
                  ? { ...x, key: at }
                  : x,
            ),
          },
    );
    expect(variants(build({ ...m.case, witnesses }))).toEqual([]);
  },
});

const TIDY: GenerateOptions = { tidy: true };

describe('passages: the segments name the variants and change nothing else (random)', () => {
  // Where no word of the edition has the letters of another, and a witness's own words are none
  // of the edition's: no alignment has a tie between two equal words. Witnesses move words
  // anywhere.
  it('moving a segment boundary by a word or two, alike in every text, changes no variant', () => {
    runProperty('passages: a boundary moved changes no variant (tidy)', principle(TIDY));
  });

  it('a word divided across a boundary gives the variants of the same word undivided', () => {
    runProperty('passages: a divided word is the word undivided (tidy)', divided(TIDY));
  });

  it('words a witness adds at a boundary give the same variant at the end of the one segment or the start of the other', () => {
    runProperty('passages: an addition at a boundary, on either side of it (tidy)', added(TIDY));
  });

  it('a word a witness has at the end of one segment where the edition has it at the start of the next is no variant', () => {
    runProperty('passages: a word across the boundary in a witness otherwise alike', across({}));
  });
});

describe('passages, where the edition has a word twice (random)', () => {
  // Counterexamples (shrunk; pinned below), about one case in a thousand. Where the edition has
  // the same word twice near a boundary (Τροίης Τροίης, ἦ | ἦ, ἐπεὶ | ἐπεὶ, ἀνδρα | ανδρα) and a
  // witness has it once, or has words moved about, which of the two the witness has is a tie of
  // the alignment, and a longer stretch resolves the tie otherwise than a shorter one. Where the
  // segments are cut, or a word is divided, decides how long the stretch is, so the variants
  // differ: not in what any witness reads, but in which of the equal words they are told
  // against, and so in how the variants are drawn around them. The properties start just before
  // the seeds that found them.
  it.fails('moving a segment boundary changes no variant', () => {
    runProperty('passages: a boundary moved changes no variant', {
      ...principle({}),
      firstSeed: 1120,
      runs: 40,
    });
  });

  it.fails('moving a segment boundary changes no variant (the shrunk case)', () => {
    principle({}).check({
      case: {
        base: ['ἀνδρα', 'πλάγχθη', 'ὃς', 'Τροίης', 'Τροίης', 'ἦ', 'ἦ', 'ἔννεπε', 'ὃς'],
        bounds: [3, 4, 5, 6],
        witnesses: [
          {
            siglum: 'A',
            words: [
              { text: 'ὃς', key: 2 },
              { text: 'Τροίης', key: 3 },
              { text: 'Τροίης', key: 4 },
              { text: 'ἦ', key: 5 },
              { text: 'ἔννεπε', key: 7 },
            ],
          },
          {
            siglum: 'B',
            words: [
              { text: 'ἦ', key: 5 },
              { text: 'Τροίης', key: 4 },
              { text: 'ἦ', key: 6 },
              { text: 'ἔννεπε', key: 7 },
              { text: 'ὃς', key: 8 },
            ],
          },
        ],
      },
      boundary: 3,
      by: 2,
    });
  });

  it.fails('a word divided across a boundary gives the variants of the same word undivided', () => {
    runProperty('passages: a divided word is the word undivided', {
      ...divided({}),
      firstSeed: 1080,
      runs: 40,
    });
  });

  it.fails('a word divided across a boundary (the shrunk case)', () => {
    divided({}).check({
      case: {
        base: ['ἐπεὶ', 'ἐπεὶ', 'πολλὰ', 'ἀνδρα', 'Τροίης', 'ἤ'],
        bounds: [1, 3],
        witnesses: [
          {
            siglum: 'B',
            words: [
              { text: 'ἐπεὶ', key: 0 },
              { text: 'πολλὰ', key: 2 },
              { text: 'ἦ', key: 3.5 },
              { text: 'ἐπεὶ', key: 1 },
            ],
          },
        ],
      },
      divide: { text: -1, boundary: 1, at: 3 },
    });
  });

  it.fails('words a witness adds at a boundary give the same variant on either side of it', () => {
    runProperty('passages: an addition at a boundary, on either side of it', {
      ...added({}),
      firstSeed: 60,
      runs: 40,
    });
  });

  it.fails('words a witness adds at a boundary (the shrunk case)', () => {
    added({}).check({
      case: {
        base: ['ἀνδρα', 'ανδρα', 'πτολίεθρον', 'ἱερὸν'],
        bounds: [1, 2],
        witnesses: [
          {
            siglum: 'A',
            words: [
              { text: 'ἀνδρα', key: 0 },
              { text: 'πτολίεθρον', key: 2 },
              { text: 'ανδρα', key: 1 },
              { text: 'ἤ', key: 3 },
            ],
          },
        ],
      },
      witness: 0,
      boundary: 1,
      word: 'ἀνδρα',
    });
  });
});

// ---------------------------------------------------------------------------
// The order of the witnesses, and adopting

describe('passages: the order of the witnesses does not matter (random)', () => {
  for (const [name, options] of [
    ['tidy', TIDY],
    ['words twice', {}],
  ] as const) {
    it(`gives the same variants in whatever order the witnesses come (${name})`, () => {
      runProperty(`passages: the order of the witnesses (${name})`, {
        generate: (rng, size) => ({ case: generate(rng, size, options) }),
        show: (c) => show(c.case),
        shrink: shrinkCase,
        check(c) {
          const built = build(c.case);
          const reference = variants(built);
          const reversed = variants({ ...built, witnesses: [...built.witnesses].reverse() });
          expect(reversed).toEqual(reference);
        },
      });
    });
  }
});

/** The segment every token and object of a stream belongs to. */
function membership(stream: Stream): Map<Id, Id | null> {
  const out = new Map<Id, Id | null>();
  for (const run of segmentRuns(stream))
    for (let i = run.from; i < run.to; i++) {
      const item = stream.items[i]!;
      if (item.kind !== 'break') out.set(item.id, run.segmentId);
    }
  return out;
}

describe('adopting a reading in a passage (random)', () => {
  it('changes the segment of no word it leaves, and gives each new word the segment its witness gives it', () => {
    runProperty('passages: adopting a reading keeps every segment', {
      generate: (rng, size) => ({ case: generate(rng, size), ownLine: rng.chance(0.5) }),
      show: (a) => `${show(a.case)}\nown line: ${a.ownLine}`,
      shrink: shrinkCase,
      check({ case: c, ownLine }) {
        const built = build(c);
        const stream = built.edition.stream;
        const before = membership(stream);
        const { passages } = collatePassages(built.edition, built.witnesses);
        for (const passage of passages)
          for (const site of passage.collation.sites)
            for (const reading of site.readings) {
              if (reading.base) continue;
              for (const textId of reading.textIds) {
                const where = `${reading.text || 'om.'} of ${textId} at [${site.baseFrom},${site.baseTo}) of ${passage.segments.map((s) => s.segmentId).join('+')}`;
                const after = applyOps(
                  stream,
                  adoptReading(stream, site, passage.base.units, reading, textId, {
                    ids: sequentialIds('n'),
                    ownLine,
                  }),
                ).stream;
                const now = membership(after);
                const replaced = new Set(siteTokenIds(site, passage.base.units));
                for (const [id, segment] of before) {
                  if (replaced.has(id)) continue;
                  expect(now.get(id), `${id} after adopting ${where}`).toBe(segment);
                }
                const fresh = after.items.filter((t) => isToken(t) && t.id.startsWith('n'));
                const units = (reading.units[textId] ?? []).filter((u) => !u.gap);
                expect(
                  fresh.map((t) => now.get(t.id)),
                  `the new words after adopting ${where}`,
                ).toEqual(units.map((u) => u.segmentId));
              }
            }
      },
    });
  });
});
