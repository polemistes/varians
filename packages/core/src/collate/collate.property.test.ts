import { describe, expect, it } from 'vitest';
import {
  RUNS,
  Rng,
  clone,
  randomTexts,
  runProperty,
  shrinkTexts,
  showTexts,
  unitsOf,
  type Property,
  type TextsCase,
} from '../testing/random.ts';
import { collate, type Collation, type CollationText, type Site } from './collate.ts';

interface Built {
  base: CollationText;
  witnesses: CollationText[];
}

function build(c: TextsCase, order?: readonly number[]): Built {
  const base: CollationText = { id: 'B', siglum: 'ed.', units: unitsOf('B', c.base) };
  const witnesses = (order ?? c.witnesses.map((_, k) => k)).map((k) => {
    const w = c.witnesses[k]!;
    const text: CollationText = {
      id: `W${k + 1}`,
      siglum: w.siglum,
      units: unitsOf(`W${k + 1}`, w.words),
    };
    if (w.present) text.present = true;
    return text;
  });
  return { base, witnesses };
}

function run(c: TextsCase, order?: readonly number[]): { built: Built; collation: Collation } {
  const built = build(c, order);
  return { built, collation: collate(built.base, built.witnesses) };
}

const nonWanting = (collation: Collation): Site[] => collation.sites.filter((s) => !s.wanting);

function describeSites(collation: Collation): string {
  return collation.sites
    .map(
      (s) =>
        `site ${s.index}${s.wanting ? ' (wanting)' : ''} base[${s.baseFrom},${s.baseTo}) cols[${s.columnFrom},${s.columnTo}): ` +
        s.readings
          .map(
            (r) =>
              `${r.base ? '*' : ''}"${r.text}"${r.omission ? ' om.' : ''}${r.lacunose ? ' lac.' : ''} ${r.sigla.join('')}`,
          )
          .join(' | '),
    )
    .join('\n');
}

const textsProperty = (
  options: Parameters<typeof randomTexts>[2],
  check: (c: TextsCase) => void,
): Property<TextsCase> => ({
  generate: (rng, size) => randomTexts(rng, size, options),
  show: showTexts,
  shrink: shrinkTexts,
  check,
});

/** Inputs of every sort: close to the base, drawn freely, with gaps. */
const KINDS: [name: string, options: Parameters<typeof randomTexts>[2]][] = [
  ['witnesses close to the base', { witnesses: [1, 4] }],
  ['witnesses drawn freely', { free: true, witnesses: [1, 4] }],
  ['with gaps', { gaps: true, witnesses: [1, 4] }],
];

describe('collation (random)', () => {
  for (const [name, options] of KINDS) {
    it(`gives the same result for the same inputs (${name})`, () => {
      runProperty(`collate: deterministic (${name})`, {
        ...textsProperty(options, (c) => {
          const first = run(c).collation;
          const second = run(clone(c)).collation;
          expect(second).toStrictEqual(first);
        }),
      });
    });
  }

  it('gives no place of variation when every witness is the base', () => {
    runProperty('collate: witnesses identical to the base give no places', {
      ...textsProperty({ witnesses: [1, 4] }, (c) => {
        const same: TextsCase = {
          base: c.base,
          witnesses: c.witnesses.map((w) => ({ ...w, words: [...c.base], present: true })),
        };
        const { collation } = run(same);
        expect(collation.sites, describeSites(collation)).toHaveLength(0);
      }),
    });
  });

  // Counterexample (shrunk): the base `a [gap] b` and a witness that is the
  // same: one site at the gap, with the base's reading ("om. ed.") and the
  // witness's ("lac. A"). A gap in the base is never an anchor, so its column
  // is always a site, and the witness's gap marks it lacunose there. Smaller
  // still: the base `[gap]` alone, with a witness that is the same gap (a lost
  // witness, left out of the alignment) or none: one site that holds only the
  // base's own reading. Where gaps are only the witnesses' (an edition has none
  // as units) this does not arise; whether a base's gap should be read as
  // agreed with is for the design.
  it.fails('gives no place of variation when every witness is the base, gaps included', () => {
    runProperty('collate: witnesses identical to a base with gaps give no places', {
      generate(rng, size) {
        const c = randomTexts(rng, size, { witnesses: [1, 3] });
        const base = c.base.map((w) => (rng.chance(0.3) ? null : w));
        return {
          base,
          witnesses: c.witnesses.map((w) => ({ ...w, words: [...base], present: true })),
        };
      },
      show: showTexts,
      shrink: shrinkTexts,
      check(c) {
        const { collation } = run(c);
        expect(collation.sites, describeSites(collation)).toHaveLength(0);
      },
    });
  });

  it.fails('(the shrunk case: a base gap and a witness with the same gap)', () => {
    const c: TextsCase = {
      base: [null],
      witnesses: [{ siglum: 'A', words: [null], present: true }],
    };
    expect(run(c).collation.sites).toHaveLength(0);
  });

  // A witness E equal to the base stands among the others, wherever. The
  // counterexamples are rare (about one case in a thousand), so the property
  // runs over more cases than the others.
  const equalToBase = (options: Parameters<typeof randomTexts>[2]): Property<TextsCase> => ({
    runs: Math.max(RUNS, 4000),
    generate(rng, size) {
      const c = randomTexts(rng, size, { ...options, length: 3 + 2 * size });
      // The base without gaps; a copy of it stands among the witnesses.
      c.base = c.base.map((w, k) => w ?? `w${k}`);
      const copy = { siglum: 'E', words: [...c.base], present: true };
      c.witnesses.splice(rng.int(c.witnesses.length + 1), 0, copy);
      return c;
    },
    show: showTexts,
    *shrink(c) {
      // E follows the base when the base is shortened.
      for (const smaller of shrinkTexts(c)) {
        yield {
          base: smaller.base,
          witnesses: smaller.witnesses.map((w) =>
            w.siglum === 'E' ? { ...w, words: [...smaller.base] } : w,
          ),
        };
      }
    },
    check(c) {
      const at = c.witnesses.findIndex((w) => w.siglum === 'E');
      if (at < 0) return;
      const { collation } = run(c);
      for (const site of collation.sites) {
        for (const reading of site.readings) {
          if (!reading.textIds.includes(`W${at + 1}`)) continue;
          expect(
            reading.base,
            `W${at + 1} (equal to the base) is in the reading "${reading.text}", not the base's\n${describeSites(collation)}`,
          ).toBe(true);
        }
      }
    },
  });

  // Counterexample (shrunk by a search of many small random cases): the base
  // `c`, witnesses A `c d b`, B `c c` and E `c`, E being equal to the base and
  // aligned last. B's second `c` opened a column of its own, which E's `c`
  // matches exactly as well as the base's column: the tie goes to the new
  // column. So E is reported as omitting the base's word (`c`: ed. A B, om. E)
  // and as reading `c` in an added place (om. ed., `d b` A, `c` B E). The
  // alignment gives an exact match the same score in whichever column it
  // stands, and does not prefer the column of the base.
  for (const [name, options] of KINDS) {
    it.fails(
      `never puts a witness equal to the base in a reading other than the base's (${name})`,
      () => {
        runProperty(
          `collate: a witness equal to the base stands in the base's reading (${name})`,
          equalToBase(options),
        );
      },
    );
  }

  it.fails('never puts a witness equal to the base in another reading (the shrunk case)', () => {
    equalToBase({}).check({
      base: ['c'],
      witnesses: [
        { siglum: 'A', words: ['c', 'd', 'b'], present: true },
        { siglum: 'B', words: ['c', 'c'], present: true },
        { siglum: 'E', words: ['c'], present: true },
      ],
    });
  });
});

/**
 * Every word of every text is accounted for: it stands in exactly one site's
 * reading, or at an anchor (a position of full agreement). The property is
 * checked in three parts: `covered` (every word is in a site or at an
 * anchor), `once` (no word is in the readings of two sites) and `exclusive`
 * (the two together, with "or" read as exclusive: a word at an anchor stands in
 * no site).
 */
function accounted(c: TextsCase, mode: 'covered' | 'once' | 'exclusive'): void {
  const { built, collation } = run(c);
  const anchored = new Map<string, Set<number>>();
  for (const column of collation.anchors.map((a) => collation.columns[a]!)) {
    for (const [textId, cell] of column.cells) {
      const set = anchored.get(textId) ?? new Set<number>();
      set.add(cell.unitIndex);
      anchored.set(textId, set);
    }
  }
  const texts = [built.base, ...built.witnesses];
  for (const text of texts) {
    if (collation.absent.includes(text.id)) continue;
    text.units.forEach((u, index) => {
      if (u.gap) return;
      const sites = nonWanting(collation).filter((site) =>
        site.readings.some((r) => r.units[text.id]?.includes(u)),
      );
      const here = anchored.get(text.id)?.has(index) ? 1 : 0;
      const where = `${text.id} unit ${index + 1} "${u.text}"`;
      const message = `${where}: in ${sites.length} sites and ${here} anchors\n${describeSites(collation)}`;
      if (mode === 'exclusive') expect(sites.length + here, message).toBe(1);
      else if (mode === 'once') expect(sites.length, message).toBeLessThanOrEqual(1);
      else expect(sites.length + here, message).toBeGreaterThanOrEqual(1);
    });
  }
}

function placesStandInOrder(c: TextsCase): void {
  const { collation } = run(c);
  const sites = collation.sites;
  sites.forEach((site, k) => expect(site.index).toBe(k));
  const plain = nonWanting(collation);
  for (let k = 0; k + 1 < plain.length; k++) {
    const a = plain[k]!;
    const b = plain[k + 1]!;
    const where = `sites ${a.index} and ${b.index}\n${describeSites(collation)}`;
    expect(a.columnFrom, where).toBeLessThanOrEqual(a.columnTo);
    expect(a.columnTo, `columns overlap: ${where}`).toBeLessThanOrEqual(b.columnFrom);
    expect(a.baseFrom, where).toBeLessThanOrEqual(a.baseTo);
    expect(a.baseTo, `base words overlap: ${where}`).toBeLessThanOrEqual(b.baseFrom);
  }
  // The only site that overlaps is the one of the witnesses lacking the segment, and it comes last.
  const wanting = sites.filter((s) => s.wanting);
  expect(wanting.length).toBeLessThanOrEqual(1);
  if (wanting.length === 1) expect(sites[sites.length - 1]!.wanting).toBe(true);
}

describe('collation: every word is accounted for, places in order (random)', () => {
  for (const [name, options] of KINDS) {
    it(`every word stands in a reading or at a position of full agreement (${name})`, () => {
      runProperty(
        `collate: every word is in a site or at an anchor (${name})`,
        textsProperty(options, (c) => accounted(c, 'covered')),
      );
    });
  }

  // "In exactly one reading or at a position of full agreement", read with an
  // inclusive "or", also needs that no word is in two sites' readings. That
  // fails, from the fault shown at the overlapping places below.
  for (const [name, options] of KINDS) {
    it.fails(`no word stands in the readings of two sites (${name})`, () => {
      runProperty(
        `collate: no word is in two sites (${name})`,
        textsProperty(options, (c) => accounted(c, 'once')),
      );
    });
  }

  // Read with an exclusive "or" (a word at an anchor is in no site) it fails
  // more easily. Counterexample (shrunk): the base `a b` and a witness `b a`.
  // The two words are transposed, so the one site covers both and the anchor
  // between them (the column where the witness agrees with the base on `b`)
  // lies inside it: `b` is at an anchor and in the site's reading. That is how
  // a transposition is built ("the sites of the stretch, anchors between them
  // included, become one site"), so I take it for a feature of the model and
  // the exclusive reading for too strict.
  for (const [name, options] of KINDS) {
    it.fails(
      `a word stands in exactly one reading or at a position of full agreement, not both (${name})`,
      () => {
        runProperty(
          `collate: every word accounted for, exclusively (${name})`,
          textsProperty(options, (c) => accounted(c, 'exclusive')),
        );
      },
    );
  }

  it.fails('a word at an anchor is not in a site too (the shrunk case)', () => {
    accounted(
      {
        base: ['a', 'b'],
        witnesses: [{ siglum: 'A', words: ['b', 'a'], present: true }],
      },
      'exclusive',
    );
  });

  // Counterexample (shrunk; found by trying every text of up to three words
  // over three letters): the base `a b`, a witness A `b` and a witness B
  // `c b a`. Site 0 covers base[0,2) and columns [0,4) (B's transposition of
  // `a` and `b`), and site 1, base[0,1), columns [2,3), lies inside it: the
  // sites overlap and `a` is in the readings of both. `buildSites` joins the
  // runs a transposition links, and when other runs lie between them it
  // replaces the first by the union and removes only the second, so the runs
  // between stay and overlap the union. A fault of the core.
  for (const [name, options] of KINDS) {
    it.fails(`places do not overlap and stand in order (${name})`, () => {
      runProperty(`collate: places in order (${name})`, textsProperty(options, placesStandInOrder));
    });
  }

  it.fails('places do not overlap (the shrunk case)', () => {
    placesStandInOrder({
      base: ['a', 'b'],
      witnesses: [
        { siglum: 'A', words: ['b'], present: true },
        { siglum: 'B', words: ['c', 'b', 'a'], present: true },
      ],
    });
  });

  it.fails('a word stands in one reading only (the shrunk case)', () => {
    accounted(
      {
        base: ['a', 'b'],
        witnesses: [
          { siglum: 'A', words: ['b'], present: true },
          { siglum: 'B', words: ['c', 'b', 'a'], present: true },
        ],
      },
      'once',
    );
  });
});

// ---------------------------------------------------------------------------
// The order of the witnesses: measured, not asserted

/** A place and its readings, with the sigla of each reading in order of name. */
function signature(collation: Collation): string[] {
  return collation.sites
    .map((s) => {
      const readings = s.readings
        .map(
          (r) =>
            `${r.base ? '*' : ''}${r.text}${r.omission ? '[om]' : ''}${r.lacunose ? '[lac]' : ''}<-${[...r.sigla].sort().join('')}`,
        )
        .sort()
        .join(' | ');
      return `${s.wanting ? 'W' : ''}[${s.baseFrom},${s.baseTo}) ${readings}`;
    })
    .sort();
}

function places(collation: Collation): string[] {
  return collation.sites.map((s) => `${s.wanting ? 'W' : ''}[${s.baseFrom},${s.baseTo})`).sort();
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const go = (rest: number[], taken: number[]) => {
    if (rest.length === 0) out.push(taken);
    rest.forEach((x, i) => go([...rest.slice(0, i), ...rest.slice(i + 1)], [...taken, x]));
  };
  go(
    Array.from({ length: n }, (_, k) => k),
    [],
  );
  return out;
}

function size(c: TextsCase): number {
  return c.base.length + c.witnesses.reduce((n, w) => n + w.words.length, 0);
}

describe('collation: does the order of the witnesses matter? (measured, not asserted)', () => {
  for (const [name, options] of [
    ['witnesses close to the base', { witnesses: [2, 4] }],
    ['witnesses drawn freely', { free: true, witnesses: [2, 4] }],
    ['with gaps', { gaps: true, witnesses: [2, 4] }],
  ] as const) {
    it(`measures it (${name})`, () => {
      const cases = Math.max(RUNS, 300);
      let changedPlaces = 0;
      let changedReadings = 0;
      let all = 0;
      const examples: {
        c: TextsCase;
        a: number[];
        b: number[];
        first: Collation;
        second: Collation;
      }[] = [];
      for (let seed = 1; seed <= cases; seed++) {
        const c = randomTexts(new Rng(seed), 1 + (seed % 8), options);
        all++;
        const orders = permutations(c.witnesses.length);
        const reference = run(c, orders[0]).collation;
        let differs = false;
        let placesDiffer = false;
        let other: number[] | undefined;
        for (const order of orders.slice(1)) {
          const second = run(c, order).collation;
          if (JSON.stringify(signature(second)) !== JSON.stringify(signature(reference))) {
            if (!differs) other = order;
            differs = true;
          }
          if (JSON.stringify(places(second)) !== JSON.stringify(places(reference)))
            placesDiffer = true;
        }
        if (differs) {
          changedReadings++;
          examples.push({
            c,
            a: orders[0]!,
            b: other!,
            first: reference,
            second: run(c, other!).collation,
          });
        }
        if (placesDiffer) changedPlaces++;
      }
      examples.sort((x, y) => size(x.c) - size(y.c));
      const pct = (n: number) => `${((100 * n) / all).toFixed(1)}%`;
      const lines = [
        `[measure] order of witnesses, ${name}: ${all} random inputs (2 to 4 witnesses, every permutation tried)`,
        `[measure]   some permutation changes the set of places: ${changedPlaces} (${pct(changedPlaces)})`,
        `[measure]   some permutation changes the places or their readings: ${changedReadings} (${pct(changedReadings)})`,
      ];
      for (const e of examples.slice(0, 2)) {
        lines.push(
          `[measure]   example (${size(e.c)} words), the witnesses in order ${e.a.map((k) => e.c.witnesses[k]!.siglum).join('')} then ${e.b.map((k) => e.c.witnesses[k]!.siglum).join('')}`,
          ...showTexts(e.c)
            .split('\n')
            .map((l) => `[measure]     ${l}`),
          '[measure]     first order:',
          ...describeSites(e.first)
            .split('\n')
            .map((l) => `[measure]       ${l}`),
          '[measure]     second order:',
          ...describeSites(e.second)
            .split('\n')
            .map((l) => `[measure]       ${l}`),
        );
      }
      console.log(lines.join('\n'));
      expect(all).toBeGreaterThan(0);
    });
  }

  it('measures it over every small input: two witnesses, texts of one to two words over three letters, a base of one to three', () => {
    const letters = ['a', 'b', 'c'];
    const texts = (max: number): string[][] => {
      const out: string[][] = [];
      let layer: string[][] = [[]];
      for (let n = 1; n <= max; n++) {
        layer = layer.flatMap((w) => letters.map((l) => [...w, l]));
        out.push(...layer);
      }
      return out;
    };
    let all = 0;
    let changed = 0;
    let smallest: TextsCase | undefined;
    for (const base of texts(3))
      for (const a of texts(2))
        for (const b of texts(2)) {
          const c: TextsCase = {
            base,
            witnesses: [
              { siglum: 'A', words: a, present: true },
              { siglum: 'B', words: b, present: true },
            ],
          };
          all++;
          const first = signature(run(c, [0, 1]).collation);
          const second = signature(run(c, [1, 0]).collation);
          if (JSON.stringify(first) !== JSON.stringify(second)) {
            changed++;
            if (!smallest || size(c) < size(smallest)) smallest = c;
          }
        }
    const lines = [
      `[measure] order of two witnesses over every small input: ${all} inputs, ${changed} (${((100 * changed) / all).toFixed(1)}%) read differently when the witnesses are given in the other order`,
    ];
    if (smallest) {
      lines.push(
        ...showTexts(smallest)
          .split('\n')
          .map((l) => `[measure]     ${l}`),
        '[measure]     A then B:',
        ...describeSites(run(smallest, [0, 1]).collation)
          .split('\n')
          .map((l) => `[measure]       ${l}`),
        '[measure]     B then A:',
        ...describeSites(run(smallest, [1, 0]).collation)
          .split('\n')
          .map((l) => `[measure]       ${l}`),
      );
    }
    console.log(lines.join('\n'));
    expect(all).toBeGreaterThan(0);
  });
});
