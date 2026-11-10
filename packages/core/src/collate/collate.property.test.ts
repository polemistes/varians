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
import { collate, witnessesAt, type Collation, type CollationText, type Site } from './collate.ts';

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

  // A loss at the same point in the base and in a witness is no difference between them.
  it('gives no place of variation when every witness is the base, gaps included', () => {
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

  it('(the shrunk case: a base gap and a witness with the same gap)', () => {
    const c: TextsCase = {
      base: [null],
      witnesses: [{ siglum: 'A', words: [null], present: true }],
    };
    expect(run(c).collation.sites).toHaveLength(0);
  });

  // A witness E equal to the base stands among the others, wherever. The
  // counterexamples are rare (about one case in a thousand: seeds 1025, 1145
  // and 499 for the three kinds of input), so the property starts just before
  // the seed that found one.
  const equalToBase = (
    options: Parameters<typeof randomTexts>[2],
    firstSeed?: number,
  ): Property<TextsCase> => ({
    ...(firstSeed === undefined ? {} : { firstSeed, runs: 40 }),
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

  // Each witness is aligned with the base alone: what another witness adds cannot draw it away.
  // The seeds are those at which the alignment of one witness after another failed.
  const FOUND_AT: Record<string, number> = {
    'witnesses close to the base': 1020,
    'witnesses drawn freely': 1140,
    'with gaps': 495,
  };
  for (const [name, options] of KINDS) {
    it(`never puts a witness equal to the base in a reading other than the base's (${name})`, () => {
      runProperty(
        `collate: a witness equal to the base stands in the base's reading (${name})`,
        equalToBase(options, FOUND_AT[name]),
      );
    });
  }

  it('never puts a witness equal to the base in another reading (the shrunk case)', () => {
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

/** One place lies within the other: it covers a stretch of it, or a point strictly inside it. */
function within(inner: Site, outer: Site): boolean {
  if (inner === outer || outer.baseTo === outer.baseFrom) return false;
  if (inner.baseTo === inner.baseFrom)
    return outer.baseFrom < inner.baseFrom && inner.baseFrom < outer.baseTo;
  return (
    outer.baseFrom <= inner.baseFrom &&
    inner.baseTo <= outer.baseTo &&
    !(outer.baseFrom === inner.baseFrom && outer.baseTo === inner.baseTo)
  );
}

/**
 * Where a witness is not there, as the columns of the collation show it: the
 * base's units it has lost (a gap of its stands against a word of the base,
 * or it has nothing for a word beside a gap), and the points between the
 * base's units where it has a gap of its own.
 */
function lossesOf(built: Built, collation: Collation, textId: string) {
  const units = new Set<number>();
  const points = new Set<number>();
  let slot = 0;
  for (const column of collation.columns) {
    const baseCell = column.cells.get(built.base.id);
    const cell = column.cells.get(textId);
    if (baseCell) {
      slot = baseCell.unitIndex + 1;
      if (cell?.lacunose && !built.base.units[baseCell.unitIndex]!.gap)
        units.add(baseCell.unitIndex);
    } else if (cell?.lacunose) points.add(slot);
  }
  return { units, points };
}

/** Whether a witness with these losses is there at a place, the place over the whole segment aside. */
function thereAt(site: Site, losses: ReturnType<typeof lossesOf>): boolean {
  if (site.baseTo > site.baseFrom) {
    for (let b = site.baseFrom; b < site.baseTo; b++) if (losses.units.has(b)) return false;
    return true;
  }
  return !(
    losses.units.has(site.baseFrom - 1) ||
    losses.units.has(site.baseFrom) ||
    losses.points.has(site.baseFrom)
  );
}

/**
 * Every word of every text is accounted for: it stands in a reading of some
 * place, or at a position where every text that is there reads with the
 * base, or where its witness is not there: within a place over a word the
 * witness has lost, or beside a loss of the witness.
 */
function covered(c: TextsCase): void {
  const { built, collation } = run(c);
  const anchored = new Map<string, Set<number>>();
  for (const column of collation.anchors.map((a) => collation.columns[a]!)) {
    for (const [textId, cell] of column.cells) {
      const set = anchored.get(textId) ?? new Set<number>();
      set.add(cell.unitIndex);
      anchored.set(textId, set);
    }
  }
  for (const text of [built.base, ...built.witnesses]) {
    if (collation.absent.includes(text.id)) continue;
    text.units.forEach((u, index) => {
      if (u.gap) return;
      const sites = collation.sites.filter((site) =>
        site.readings.some((r) => r.units[text.id]?.includes(u)),
      );
      const here = anchored.get(text.id)?.has(index) ? 1 : 0;
      let excused = false;
      if (sites.length + here === 0 && text.id !== built.base.id) {
        const losses = lossesOf(built, collation, text.id);
        let slot = 0;
        let paired: number | null = null;
        for (const column of collation.columns) {
          const baseCell = column.cells.get(built.base.id);
          if (column.cells.get(text.id)?.unitIndex === index) {
            paired = baseCell ? baseCell.unitIndex : null;
            break;
          }
          if (baseCell) slot = baseCell.unitIndex + 1;
        }
        const notThere = collation.sites.filter((site) => !site.wanting && !thereAt(site, losses));
        excused =
          paired !== null
            ? notThere.some((site) => site.baseFrom <= paired && paired < site.baseTo)
            : losses.units.has(slot - 1) ||
              losses.units.has(slot) ||
              losses.points.has(slot) ||
              notThere.some((site) => site.baseFrom < slot && slot < site.baseTo);
      }
      const message = `${text.id} unit ${index + 1} "${u.text}": in ${sites.length} places and ${here} positions of agreement, not excused by a loss\n${describeSites(collation)}`;
      expect(sites.length + here > 0 || excused, message).toBe(true);
    });
  }
}

/**
 * A witness's departure from the base is reported once: none of its words
 * stands in two readings other than the base's, and where one place lies
 * within another, a witness with a reading of its own at the wider one
 * stands in no reading of the narrower.
 */
function reportedOnce(c: TextsCase): void {
  const { built, collation } = run(c);
  for (const text of built.witnesses) {
    text.units.forEach((u, index) => {
      if (u.gap) return;
      const sites = collation.sites.filter((site) =>
        site.readings.some((r) => !r.base && r.units[text.id]?.includes(u)),
      );
      const message = `${text.id} unit ${index + 1} "${u.text}": in ${sites.length} readings other than the base's\n${describeSites(collation)}`;
      expect(sites.length, message).toBeLessThanOrEqual(1);
    });
  }
  // A witness whose text runs on without the whole segment stands in the place over all of it and nowhere else.
  for (const whole of collation.sites.filter((s) => s.wanting)) {
    const lacking = whole.readings
      .filter((r) => !r.base && r.omission)
      .flatMap((r) => r.textIds)
      .filter((id) => built.witnesses.find((w) => w.id === id)!.units.length === 0);
    for (const site of collation.sites) {
      if (site === whole) continue;
      for (const reading of site.readings)
        for (const id of reading.textIds)
          expect(lacking.includes(id), `${id} lacks the segment\n${describeSites(collation)}`).toBe(
            false,
          );
    }
  }
  for (const outer of collation.sites) {
    const own = new Set(outer.readings.filter((r) => !r.base).flatMap((r) => r.textIds));
    for (const inner of collation.sites) {
      if (!within(inner, outer)) continue;
      for (const reading of inner.readings)
        for (const id of reading.textIds)
          expect(
            own.has(id),
            `${id} at places ${outer.index} and ${inner.index}\n${describeSites(collation)}`,
          ).toBe(false);
    }
  }
}

/**
 * No two places have the same extent. Two places that share a word of the
 * base lie one within the other, unless one of them is only an omission or a
 * loss, which keeps its extent whatever it overlaps. A place within another
 * stands before it, and otherwise the places stand in the order of the text.
 */
function placesAreNestedAndInOrder(c: TextsCase): void {
  const { collation } = run(c);
  const sites = collation.sites;
  sites.forEach((site, k) => expect(site.index).toBe(k));
  const wordless = (site: Site) => site.readings.every((r) => r.base || r.text === '');
  for (const a of sites) {
    expect(a.baseFrom).toBeLessThanOrEqual(a.baseTo);
    for (const b of sites) {
      if (a.index >= b.index) continue;
      const where = `places ${a.index} and ${b.index}\n${describeSites(collation)}`;
      expect(a.baseFrom === b.baseFrom && a.baseTo === b.baseTo, `one extent twice: ${where}`).toBe(
        false,
      );
      if (within(a, b)) continue;
      expect(within(b, a), `the wider place first: ${where}`).toBe(false);
      expect(a.baseTo, `the later place first: ${where}`).toBeLessThanOrEqual(b.baseTo);
      if (a.baseTo > b.baseFrom && a.baseTo > a.baseFrom && b.baseTo > b.baseFrom)
        expect(
          wordless(a) || wordless(b),
          `two readings overlapping without one within the other: ${where}`,
        ).toBe(true);
    }
  }
}

/** A place over words whose only readings besides the base's are that the words are not in a witness. */
function absenceOnly(site: Site): boolean {
  return site.baseTo > site.baseFrom && site.readings.every((r) => r.base || r.omission);
}

/** Whether a witness has a word of its own standing with one of the base's words a place covers. */
function hasWordsAt(built: Built, collation: Collation, site: Site, textId: string): boolean {
  return collation.columns.some((column) => {
    const baseCell = column.cells.get(built.base.id);
    const cell = column.cells.get(textId);
    return (
      baseCell !== undefined &&
      baseCell.unitIndex >= site.baseFrom &&
      baseCell.unitIndex < site.baseTo &&
      cell !== undefined &&
      !cell.lacunose &&
      cell.unitIndex >= 0
    );
  });
}

/**
 * Who is there: no reading but the base's is lacunose; a witness is in at
 * most one reading of a place; a witness that has lost a unit of the base,
 * or has a gap of its own at a point, is in no reading of a place over it
 * (the place over the whole segment aside, where every witness with a word
 * of the segment is there, and a place whose only other readings are
 * absence, where a witness with some of the words is there and stands with
 * the base); a text with no word of the segment is absent; and the
 * witnesses a place names are those of its readings, in the order they
 * were given.
 */
function whoIsThere(c: TextsCase): void {
  const { built, collation } = run(c);
  const order = built.witnesses.map((w) => w.id);
  for (const site of collation.sites) {
    const where = `place ${site.index}\n${describeSites(collation)}`;
    for (const reading of site.readings)
      expect(reading.lacunose && !reading.base, `a lacunose reading at ${where}`).toBe(false);
    const named = site.readings.flatMap((r) => r.textIds);
    expect(new Set(named).size, `a text in two readings at ${where}`).toBe(named.length);
    const there = witnessesAt(site, built.base.id, order);
    expect(there).toEqual(order.filter((id) => named.includes(id)));
    for (const text of built.witnesses) {
      if (collation.absent.includes(text.id)) {
        expect(named.includes(text.id), `${text.id} is absent, at ${where}`).toBe(false);
        continue;
      }
      if (site.wanting) continue;
      if (thereAt(site, lossesOf(built, collation, text.id))) continue;
      // Where the only other readings are that the words are not in a witness, a witness that has
      // lost some of the words and has others is there, and stands with the base.
      if (absenceOnly(site) && hasWordsAt(built, collation, site, text.id)) {
        const reading = site.readings.find((r) => r.textIds.includes(text.id));
        expect(reading?.base, `${text.id} has some of the words, at ${where}`).toBe(true);
        continue;
      }
      expect(named.includes(text.id), `${text.id} is not there, at ${where}`).toBe(false);
    }
  }
  for (const text of built.witnesses) {
    const words = text.units.some((u) => !u.gap);
    if (!words && !(text.present && text.units.length === 0))
      expect(collation.absent, `${text.id} has no word of the segment`).toContain(text.id);
  }
}

describe('collation: every word is accounted for, places nested and in order (random)', () => {
  for (const [name, options] of KINDS) {
    it(`every word stands in a reading or at a position of full agreement (${name})`, () => {
      runProperty(
        `collate: every word is in a place or at a position of agreement (${name})`,
        textsProperty(options, covered),
      );
    });

    it(`a departure from the base is reported once (${name})`, () => {
      runProperty(`collate: reported once (${name})`, textsProperty(options, reportedOnce));
    });

    it(`a place speaks only of the witnesses that are there (${name})`, () => {
      runProperty(`collate: who is there (${name})`, textsProperty(options, whoIsThere));
    });

    it(`places share words only by lying one within another, and stand in order (${name})`, () => {
      runProperty(
        `collate: places nested and in order (${name})`,
        textsProperty(options, placesAreNestedAndInOrder),
      );
    });
  }

  // The words of a transposition that keep their place read with the base and
  // lie inside the place all the same: `a b c` against `c b a` is one place.
  it('a word that keeps its place inside a transposition stands in the place', () => {
    const { collation } = run({
      base: ['a', 'b', 'c'],
      witnesses: [{ siglum: 'A', words: ['c', 'b', 'a'], present: true }],
    });
    expect(collation.sites.map((s) => [s.baseFrom, s.baseTo])).toEqual([[0, 3]]);
  });

  // The case at which the places once overlapped: B transposes `a` and `b`
  // (with a word added before), and A leaves `a` out. B's reading in words is
  // one place, in which A is accounted for over the whole stretch.
  it('a reading in words accounts for every witness over its whole stretch', () => {
    const c: TextsCase = {
      base: ['a', 'b'],
      witnesses: [
        { siglum: 'A', words: ['b'], present: true },
        { siglum: 'B', words: ['c', 'b', 'a'], present: true },
      ],
    };
    placesAreNestedAndInOrder(c);
    reportedOnce(c);
    expect(show(run(c).collation)).toEqual(['[0,2) a b ed. | b A | c b a B']);
  });

  // An omission swallows nothing: what another witness reads otherwise inside
  // the stretch is a place of its own, in which the omitting witness does not stand.
  it('a small variant inside an omission is a place of its own, without the omitting witness', () => {
    const c: TextsCase = {
      base: ['a', 'b', 'c', 'd'],
      witnesses: [
        { siglum: 'A', words: ['a', 'd'], present: true },
        { siglum: 'B', words: ['a', 'x', 'c', 'd'], present: true },
      ],
    };
    placesAreNestedAndInOrder(c);
    reportedOnce(c);
    expect(show(run(c).collation)).toEqual(['[1,2) b ed. | x B', '[1,3) b c ed. B | om. A']);
  });
});

// A segment the base does not print: the base has no units, the witnesses have
// the segment's words, lose some of them, or run on without it.
describe('collation: a segment the base does not print (random)', () => {
  const unprinted: Property<TextsCase> = {
    generate(rng, size) {
      const c = randomTexts(rng, size, { gaps: true, witnesses: [1, 4] });
      return {
        base: [],
        witnesses: c.witnesses.map((w) => (rng.chance(0.3) ? { ...w, words: [] } : w)),
      };
    },
    show: showTexts,
    *shrink(c) {
      for (const smaller of shrinkTexts(c)) if (smaller.base.length === 0) yield smaller;
    },
    check(c) {
      covered(c);
      reportedOnce(c);
      whoIsThere(c);
      placesAreNestedAndInOrder(c);
      // A witness whose text runs on without the segment stands with the base wherever some witness has words.
      const { built, collation } = run(c);
      for (const site of collation.sites) {
        const base = site.readings.find((r) => r.base)!;
        for (const w of built.witnesses)
          if (w.units.length === 0) expect(base.textIds).toContain(w.id);
      }
    },
  };
  it('accounts for every word and stands the witnesses without it with the base', () => {
    runProperty('collate: a segment the base does not print', unprinted);
  });
});

// ---------------------------------------------------------------------------
// The order of the witnesses

/**
 * A place and its readings, with the sigla of each reading in order of name.
 * A reading is told by its fold: where two witnesses write one reading with a
 * grave and an acute, it is printed as the first of them in the order given
 * has it, which is the one thing the order decides.
 */
function signature(collation: Collation): string[] {
  return collation.sites
    .map((s) => {
      const readings = s.readings
        .map(
          (r) =>
            `${r.base ? '*' : ''}${r.fold}${r.omission ? '[om]' : ''}${r.lacunose ? '[lac]' : ''}<-${[...r.sigla].sort().join('')}`,
        )
        .sort()
        .join(' | ');
      return `${s.wanting ? 'W' : ''}[${s.baseFrom},${s.baseTo}) ${readings}`;
    })
    .sort();
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

describe('collation: the order of the witnesses does not matter (random)', () => {
  for (const [name, options] of [
    ['witnesses close to the base', { witnesses: [2, 4] }],
    ['witnesses drawn freely', { free: true, witnesses: [2, 4] }],
    ['with gaps', { gaps: true, witnesses: [2, 4] }],
  ] as const) {
    it(`gives the same places and readings in whatever order the witnesses come (${name})`, () => {
      const cases = Math.max(RUNS, 100);
      for (let seed = 1; seed <= cases; seed++) {
        const c = randomTexts(new Rng(seed), 1 + (seed % 8), options);
        const orders = permutations(c.witnesses.length);
        const reference = run(c, orders[0]).collation;
        for (const order of orders.slice(1)) {
          const other = run(c, order).collation;
          expect(
            signature(other),
            `seed ${seed}, order ${order.join('')}\n${showTexts(c)}\n${describeSites(reference)}\nagainst\n${describeSites(other)}`,
          ).toEqual(signature(reference));
        }
      }
    });
  }

  // The two cases in which the order once changed the apparatus.
  it('the cases that once differed', () => {
    for (const c of [
      { base: ['a'], witnesses: [words('A', ['b']), words('B', ['a', 'c'])] },
      { base: ['ἔπερσεν'], witnesses: [words('A', ['ἔπερσεν', 'ὃς']), words('B', ['πολλὰ'])] },
    ] satisfies TextsCase[]) {
      expect(signature(run(c, [1, 0]).collation)).toEqual(signature(run(c, [0, 1]).collation));
    }
  });
});

function show(collation: Collation): string[] {
  return collation.sites.map(
    (s) =>
      `[${s.baseFrom},${s.baseTo}) ${s.readings.map((r) => `${r.text || 'om.'} ${r.sigla.join(' ')}`).join(' | ')}`,
  );
}

function words(siglum: string, list: string[]): TextsCase['witnesses'][number] {
  return { siglum, words: list, present: true };
}
