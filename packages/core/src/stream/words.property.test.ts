import { describe, expect, it } from 'vitest';
import {
  RUNS,
  clone,
  picture,
  randomStream,
  runProperty,
  shrinkStream,
  uniqueSegments,
  type Property,
  type Rng,
} from '../testing/random.ts';
import { isObj, isToken, type Id, type Mark, type Stream, type Token } from './items.ts';
import {
  runUnits,
  runsBySegment,
  runsOfSegment,
  segmentRuns,
  segmentUnits,
  units,
  words,
  type CollationState,
} from './words.ts';

function describeState(state: CollationState): string {
  return typeof state === 'string' ? state : JSON.stringify(state);
}

function randomState(rng: Rng): CollationState {
  return rng.weighted<CollationState>([
    ['corrected', 3],
    ['original', 3],
    ['variant', 1],
    [{ kind: 'stage', upTo: rng.between(0, 3) }, 1],
    [{ kind: 'hand', hands: rng.shuffle(['m1', 'm2', 'scribe']).slice(0, rng.between(0, 2)) }, 1],
  ] as const);
}

interface StateCase {
  stream: Stream;
  state: CollationState;
}

function showStateCase(c: StateCase): string {
  return `state: ${describeState(c.state)}\nstream: ${picture(c.stream)}`;
}

function* shrinkStateCase(c: StateCase): Generator<StateCase> {
  for (const stream of shrinkStream(c.stream)) yield { ...c, stream };
}

/** A unit as something to compare. */
function unitKey(u: { text: string; tokenIds: Id[]; gap?: { id: Id } }): string {
  return `${u.text}|${u.tokenIds.join(',')}${u.gap ? `|gap ${u.gap.id}` : ''}`;
}

// ---------------------------------------------------------------------------
// Units over a whole stream and over its segments

function generateSegmented(rng: Rng, size: number, joins: boolean): StateCase {
  const stream = uniqueSegments(
    randomStream(rng, {
      size,
      segmentRate: 0.25,
      parts: 'none',
      marks: ['del', 'add', 'gap', 'unclear', 'hi'],
      norms: true,
      joins,
    }),
  );
  return { stream, state: randomState(rng) };
}

/** Consecutive gap units counted as one: the whole stream merges a broken word's gap into the gap before it. */
function collapseGaps(keys: { text: string; tokenIds: Id[]; gap?: { id: Id } }[]): string[] {
  const out: string[] = [];
  let previousGap = false;
  for (const u of keys) {
    if (u.gap && previousGap) continue;
    previousGap = u.gap !== undefined;
    out.push(unitKey(u));
  }
  return out;
}

function wholeEqualsRuns({ stream, state }: StateCase, collapse = false): void {
  const key = (us: ReturnType<typeof units>) => (collapse ? collapseGaps(us) : us.map(unitKey));
  const whole = key(units(stream, 0, stream.items.length, state));
  const runs = segmentRuns(stream);
  const parts = key(runs.flatMap((run) => units(stream, run.from, run.to, state)));
  expect(parts).toStrictEqual(whole);
  // And a segment's own units are those of its one run.
  for (const run of runs) {
    if (run.segmentId === null) continue;
    expect(segmentUnits(stream, run.segmentId, state).map(unitKey)).toStrictEqual(
      units(stream, run.from, run.to, state).map(unitKey),
    );
  }
}

describe('units over a stream and over its segments (random)', () => {
  // A word belongs to the segment where it begins and is read whole there, so a word divided
  // across the boundary of two segments is one unit over the whole stream and over the runs
  // alike; and a gap is merged with the gap before it only within one segment's run.
  it('equal the units of the whole stream, for a stream whose segments are each in one run', () => {
    runProperty('units: whole stream equals the concatenation over its segments', {
      generate: (rng, size) => generateSegmented(rng, size, true),
      show: showStateCase,
      shrink: shrinkStateCase,
      check: wholeEqualsRuns,
    });
  });

  it('(a word divided across two segments)', () => {
    const stream: Stream = {
      items: [
        { kind: 'token', id: 'a', form: 'ἄλ', joinNext: true, segment: { segmentId: 'u1' } },
        { kind: 'token', id: 'b', form: 'γε', segment: { segmentId: 'u2' } },
      ],
    };
    wholeEqualsRuns({ stream, state: 'corrected' });
    expect(segmentUnits(stream, 'u1')).toEqual([{ text: 'ἄλγε', tokenIds: ['a', 'b'] }]);
    expect(segmentUnits(stream, 'u2')).toEqual([]);
  });

  it('(a gap object, then a word broken by a gap in the next segment)', () => {
    const stream: Stream = {
      items: [
        { kind: 'object', id: 'g', type: 'gap', segment: { segmentId: 'u1' } },
        {
          kind: 'token',
          id: 'b',
          form: 'γε',
          segment: { segmentId: 'u2' },
          marks: [{ kind: 'gap', from: 1, to: 1 }],
        },
      ],
    };
    wholeEqualsRuns({ stream, state: 'corrected' });
  });

  // The same property for streams in which no word is divided across the
  // start of a segment, with consecutive gaps counted as one.
  it('equal the units of the whole stream, where no word is divided across a segment, consecutive gaps counted as one', () => {
    runProperty('units: whole stream equals the concatenation over its segments (tidy)', {
      generate(rng, size) {
        const c = generateSegmented(rng, size, true);
        return { ...c, stream: tidy(c.stream) };
      },
      show: showStateCase,
      shrink: (c) => shrinkTidy(c),
      check: (c) => wholeEqualsRuns(c, true),
    });
  });

  it('are those of the runs taken together, each unit naming the segment its word begins in', () => {
    runProperty('units: runUnits over all runs equals the whole stream', {
      generate: (rng, size) => generateSegmented(rng, size, true),
      show: showStateCase,
      shrink: shrinkStateCase,
      check({ stream, state }) {
        const runs = segmentRuns(stream);
        const together = runUnits(stream, runs, state);
        expect(together.units.map(unitKey)).toStrictEqual(
          units(stream, 0, stream.items.length, state).map(unitKey),
        );
        runs.forEach((run, k) => {
          const end = k + 1 < runs.length ? together.starts[k + 1]! : together.units.length;
          const own = together.units.slice(together.starts[k]!, end);
          expect(own.map(unitKey)).toStrictEqual(
            units(stream, run.from, run.to, state).map(unitKey),
          );
          for (const u of own) expect(u.segmentId).toBe(run.segmentId ?? undefined);
        });
      },
    });
  });
});

describe('runsBySegment (random)', () => {
  it('finds for every segment the runs runsOfSegment finds, whatever the numbering of the parts', () => {
    runProperty('runsBySegment equals runsOfSegment for every segment', {
      generate: (rng, size) => ({
        stream: randomStream(rng, {
          size,
          segmentRate: 0.3,
          parts: 'shuffled',
          nullStarts: true,
        }),
        state: 'corrected' as const,
      }),
      show: showStateCase,
      shrink: shrinkStateCase,
      check({ stream }) {
        const index = runsBySegment(stream);
        const named = new Set(
          segmentRuns(stream).flatMap((run) => (run.segmentId === null ? [] : [run.segmentId])),
        );
        expect(new Set(index.keys())).toStrictEqual(named);
        for (const id of named) expect(index.get(id)).toStrictEqual(runsOfSegment(stream, id));
      },
    });
  });
});

/** The stream with no word divided at the start of a segment. */
function tidy(stream: Stream): Stream {
  const items = clone(stream.items);
  items.forEach((item, i) => {
    if (item.kind === 'break' || !item.segment) return;
    for (let k = i - 1; k >= 0; k--) {
      const before = items[k]!;
      if (isToken(before)) {
        delete before.joinNext;
        break;
      }
      if (isObj(before)) break;
    }
  });
  return { items };
}

function* shrinkTidy(c: StateCase): Generator<StateCase> {
  for (const stream of shrinkStream(c.stream)) yield { ...c, stream: tidy(stream) };
}

// ---------------------------------------------------------------------------
// Corrections and states

type Correction =
  | { kind: 'plain' }
  | { kind: 'del' | 'add'; hand?: string; seq?: number; ranged: boolean };

interface WordSpec {
  /** The tokens of one word: forms. */
  forms: string[];
  correction: Correction;
  norm?: string;
}

interface CorrectionCase {
  words: WordSpec[];
  state: CollationState;
}

function build(c: CorrectionCase): { stream: Stream; firstIds: Id[] } {
  const items: Token[] = [];
  const firstIds: Id[] = [];
  let n = 0;
  for (const word of c.words) {
    word.forms.forEach((form, k) => {
      const token: Token = { kind: 'token', id: `t${++n}`, form };
      if (k === 0) firstIds.push(token.id);
      if (k < word.forms.length - 1) token.joinNext = true;
      if (k === 0 && word.norm !== undefined) token.norm = word.norm;
      if (word.correction.kind !== 'plain') {
        const mark: Mark = { kind: word.correction.kind };
        const attrs: Record<string, string | number> = {};
        if (word.correction.hand !== undefined) attrs.hand = word.correction.hand;
        if (word.correction.seq !== undefined) attrs.seq = word.correction.seq;
        if (Object.keys(attrs).length) mark.attrs = attrs;
        // Covering every letter by a range is the same as covering the token.
        if (word.correction.ranged) {
          mark.from = 0;
          mark.to = Array.from(form).length;
        }
        token.marks = [mark];
      }
      items.push(token);
    });
  }
  return { stream: { items }, firstIds };
}

function generateCorrections(rng: Rng, size: number): CorrectionCase {
  const count = rng.between(1, 2 + size);
  const hands = ['m1', 'm2', 'scribe'];
  const specs: WordSpec[] = Array.from({ length: count }, () => {
    const forms = Array.from(
      {
        length: rng.weighted([
          [1, 5],
          [2, 2],
          [3, 1],
        ] as const),
      },
      () => rng.pick(['ἄλ', 'γε', 'μῆνιν', 'a', 'θεὰ']),
    );
    const roll = rng.int(10);
    const correction: Correction =
      roll < 4
        ? { kind: 'plain' }
        : {
            kind: roll < 7 ? 'del' : 'add',
            ranged: rng.chance(0.2),
            ...(rng.chance(0.7) ? { hand: rng.pick(hands) } : {}),
            ...(rng.chance(0.7) ? { seq: rng.between(1, 3) } : {}),
          };
    const spec: WordSpec = { forms, correction };
    if (rng.chance(0.2)) spec.norm = rng.chance(0.5) ? 'x y' : 'z';
    return spec;
  });
  return { words: specs, state: randomState(rng) };
}

/** Whether a word is read in a state, by the design (3.7): the corrections that apply are made. */
function expectedPresent(correction: Correction, state: CollationState): boolean {
  if (correction.kind === 'plain') return state !== 'variant' || true;
  const applies = (() => {
    if (state === 'original') return false;
    if (typeof state === 'string') return true;
    if (state.kind === 'stage') return correction.seq !== undefined && correction.seq <= state.upTo;
    return correction.hand !== undefined && state.hands.includes(correction.hand);
  })();
  // A deletion that applies removes the word; an addition that does not apply leaves it out.
  return correction.kind === 'del' ? !applies : applies;
}

function showCorrections(c: CorrectionCase): string {
  return `state: ${describeState(c.state)}\n${c.words
    .map((w) => `${w.forms.join('+')}${w.norm ? `~${w.norm}` : ''} ${JSON.stringify(w.correction)}`)
    .join('\n')}`;
}

function* shrinkCorrections(c: CorrectionCase): Generator<CorrectionCase> {
  for (let i = 0; i < c.words.length; i++) {
    if (c.words.length > 1) yield { ...c, words: c.words.filter((_, k) => k !== i) };
  }
  for (let i = 0; i < c.words.length; i++) {
    const w = c.words[i]!;
    if (w.forms.length > 1) {
      const words = c.words.slice();
      words[i] = { ...w, forms: w.forms.slice(0, 1) };
      yield { ...c, words };
    }
    if (w.norm !== undefined) {
      const { norm: _norm, ...rest } = w;
      const words = c.words.slice();
      words[i] = rest;
      yield { ...c, words };
    }
  }
}

describe('corrections in the states of a witness (random)', () => {
  const property: Property<CorrectionCase> = {
    generate: generateCorrections,
    show: showCorrections,
    shrink: shrinkCorrections,
    check(c) {
      const { stream, firstIds } = build(c);
      const read = new Set(
        units(stream, 0, stream.items.length, c.state).flatMap((u) => u.tokenIds),
      );
      c.words.forEach((word, k) => {
        const id = firstIds[k]!;
        expect(
          read.has(id),
          `word ${k + 1} (${word.forms.join('+')}, ${JSON.stringify(word.correction)}) in state ${describeState(c.state)}`,
        ).toBe(expectedPresent(word.correction, c.state));
      });
    },
  };

  it('a deleted word is absent in the corrected state and present in the original; an added word the reverse; the stage and hand states apply the corrections they name', () => {
    runProperty('states: deleted and added words', property);
  });

  it('holds for the two plain states by name', () => {
    runProperty('states: corrected and original', {
      ...property,
      generate(rng, size) {
        return {
          ...generateCorrections(rng, size),
          state: rng.pick(['corrected', 'original'] as const),
        };
      },
    });
  });

  it('reads the same words, the states apart, only where a word is corrected', () => {
    runProperty('states: only corrected words differ between corrected and original', {
      generate: generateCorrections,
      show: showCorrections,
      shrink: shrinkCorrections,
      check(c) {
        const { stream } = build(c);
        const corrected = units(stream, 0, stream.items.length, 'corrected');
        const original = units(stream, 0, stream.items.length, 'original');
        const plainIds = new Set<Id>();
        build(c).firstIds.forEach((id, k) => {
          if (c.words[k]!.correction.kind === 'plain') plainIds.add(id);
        });
        const only = (us: typeof corrected) =>
          us.filter((u) => u.tokenIds.some((id) => plainIds.has(id))).map(unitKey);
        expect(only(corrected)).toStrictEqual(only(original));
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Gaps

describe('a token with a point mark gap (random)', () => {
  it('is never read as a word, in any state', () => {
    runProperty('gap: a word broken by a gap is not read', {
      generate(rng, size) {
        const stream = randomStream(rng, {
          size,
          segments: false,
          marks: ['gap', 'del', 'add', 'unclear'],
          norms: true,
          joins: true,
        });
        return { stream, state: randomState(rng) } as StateCase;
      },
      show: showStateCase,
      shrink: shrinkStateCase,
      check({ stream, state }) {
        const broken = new Set<Id>();
        for (const word of words(stream)) {
          const gapped = word.tokens.some((t) =>
            (t.marks ?? []).some(
              (m) => m.kind === 'gap' && m.from !== undefined && m.from === m.to,
            ),
          );
          if (gapped) for (const t of word.tokens) broken.add(t.id);
        }
        for (const u of units(stream, 0, stream.items.length, state)) {
          if (u.gap) continue;
          for (const id of u.tokenIds)
            expect(broken.has(id), `${id} is read as ${JSON.stringify(u.text)}`).toBe(false);
        }
      },
    });
  });

  // Counterexample (shrunk): the state `variant` and a token that carries a point
  // gap and a variant mark: its variant's reading is read (as the words of the
  // variant, which the token's tokenIds name), so the gap-broken token's id
  // appears on a unit with text. See the pinned case.
  it.fails('also in the state variant, for a token that also carries a variant', () => {
    runProperty('gap: a word broken by a gap is not read, variants included', {
      generate(rng, size) {
        const stream = randomStream(rng, {
          size,
          segments: false,
          marks: ['gap', 'variant'],
          joins: false,
        });
        return { stream, state: 'variant' } as StateCase;
      },
      show: showStateCase,
      shrink: shrinkStateCase,
      check({ stream, state }) {
        const broken = new Set<Id>();
        for (const t of stream.items)
          if (
            isToken(t) &&
            (t.marks ?? []).some((m) => m.kind === 'gap' && m.from !== undefined && m.from === m.to)
          )
            broken.add(t.id);
        for (const u of units(stream, 0, stream.items.length, state)) {
          if (u.gap) continue;
          for (const id of u.tokenIds)
            expect(broken.has(id), `${id} is read as ${JSON.stringify(u.text)}`).toBe(false);
        }
      },
    });
  });

  it.fails('(the shrunk case)', () => {
    const stream: Stream = {
      items: [
        {
          kind: 'token',
          id: 'a',
          form: 'ab',
          marks: [
            { kind: 'gap', from: 1, to: 1 },
            { kind: 'variant', attrs: { group: 'g1', reading: 'x', place: 'margin' } },
          ],
        },
      ],
    };
    const read = units(stream, 0, 1, 'variant').filter((u) => !u.gap);
    expect(read.flatMap((u) => u.tokenIds)).not.toContain('a');
  });
});

void RUNS;
void clone;
