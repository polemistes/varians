import { describe, expect, it } from 'vitest';
import { attachToSites, type AttachmentCandidate } from '../apparatus/attach.ts';
import { apparatusEntries, printedSigla } from '../apparatus/render.ts';
import {
  collate,
  type Collation,
  type CollationText,
  type Reading,
  type Site,
} from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { agreementFold, trimPunctuation } from '../normalize/fold.ts';
import type { Item, Stream, Token } from '../stream/items.ts';
import { applyOps, type Op } from '../stream/ops.ts';
import { units, type Unit } from '../stream/words.ts';
import {
  assume,
  RUNS,
  randomTexts,
  runProperty,
  shrinkTexts,
  showTexts,
  unitsOf,
  type Property,
  type TextsCase,
} from '../testing/random.ts';
import { adoptReading, siteTokenIds } from './adopt.ts';

/** A text case with the random choices the property makes, kept in the case so that it can be shrunk and replayed. */
interface AdoptCase extends TextsCase {
  picks: number[];
}

function generate(rng: Parameters<typeof randomTexts>[0], size: number): AdoptCase {
  const c = randomTexts(rng, size, { witnesses: [1, 3], length: 2 + 2 * size });
  return { ...c, picks: [rng.next(), rng.next(), rng.next()] };
}

function* shrink(c: AdoptCase): Generator<AdoptCase> {
  for (const smaller of shrinkTexts(c)) yield { ...smaller, picks: c.picks };
}

const show = (c: AdoptCase): string =>
  `${showTexts(c)}\npicks: ${c.picks.map((p) => p.toFixed(2)).join(' ')}`;

/** The edition: the base words as tokens `e1 …` with a line break after every fourth word, the first beginning segment `s1`. */
function editionOf(words: readonly (string | null)[]): Stream {
  const ids = sequentialIds('e');
  const items: Item[] = [];
  words.forEach((word, k) => {
    if (k > 0 && k % 4 === 0) items.push({ kind: 'break', id: `l${k}`, type: 'line' });
    const token: Token = { kind: 'token', id: ids(), form: word ?? '' };
    if (k === 0) token.segment = { segmentId: 's1' };
    items.push(token);
  });
  return { items };
}

const baseUnitsOf = (edition: Stream): Unit[] => units(edition, 0, edition.items.length);

function witnessTexts(c: TextsCase): CollationText[] {
  return c.witnesses.map((w, k) => {
    const text: CollationText = {
      id: `W${k + 1}`,
      siglum: w.siglum,
      units: unitsOf(`W${k + 1}`, w.words),
    };
    if (w.present) text.present = true;
    return text;
  });
}

function collateEdition(
  edition: Stream,
  texts: CollationText[],
): { collation: Collation; baseUnits: Unit[] } {
  const baseUnits = baseUnitsOf(edition);
  return { collation: collate({ id: 'E', siglum: 'ed.', units: baseUnits }, texts), baseUnits };
}

interface Choice {
  site: Site;
  reading: Reading;
  textId: string;
}

/** Every reading of a witness that is not the base's and not a lacuna, at a place of the segment. */
function choices(collation: Collation, exclude: string[] = []): Choice[] {
  const out: Choice[] = [];
  for (const site of collation.sites) {
    if (site.wanting) continue;
    for (const reading of site.readings) {
      if (reading.base || reading.lacunose) continue;
      for (const textId of reading.textIds)
        if (!exclude.includes(textId)) out.push({ site, reading, textId });
    }
  }
  return out;
}

const pickOf = <T>(xs: T[], p: number): T =>
  xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

const wordsOf = (edition: Stream): string[] => baseUnitsOf(edition).map((u) => u.text);

function insertedIds(ops: Op[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops)
    if (op.t === 'insert' || op.t === 'replace') for (const i of op.items) ids.add(i.id);
  return ids;
}

function describeSites(collation: Collation): string {
  return collation.sites
    .map(
      (s) =>
        `site ${s.index}${s.wanting ? ' (wanting)' : ''} base[${s.baseFrom},${s.baseTo}): ` +
        s.readings
          .map(
            (r) =>
              `${r.base ? '*' : ''}"${r.text}"${r.omission ? ' om.' : ''}${r.lacunose ? ' lac.' : ''} ${r.sigla.join('')}`,
          )
          .join(' | '),
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Adopting a witness's reading

/** The adopted place in the edition as it now stands: the words the adoption made, or the point where words were taken out. */
function adoptedPlace(
  first: { baseUnits: Unit[] },
  second: { baseUnits: Unit[] },
  site: Site,
  ops: Op[],
): { words: number[]; point: number } {
  const fresh = insertedIds(ops);
  const words = second.baseUnits.flatMap((u, i) =>
    u.tokenIds.some((id) => fresh.has(id)) ? [i] : [],
  );
  const previous = first.baseUnits[site.baseFrom - 1]?.tokenIds.at(-1);
  const q =
    previous === undefined ? -1 : second.baseUnits.findIndex((u) => u.tokenIds.includes(previous));
  return { words, point: q + 1 };
}

/** Whether a text has its word `unitIndex` in the column of the edition's word `baseIndex`, and the two agree by fold. */
function alignedWith(
  collation: Collation,
  baseUnits: Unit[],
  text: CollationText,
  baseIndex: number,
): boolean {
  const column = collation.columns.find((col) => col.cells.get('E')?.unitIndex === baseIndex);
  const cell = column?.cells.get(text.id);
  if (!cell || cell.unitIndex < 0) return false;
  return (
    agreementFold(text.units[cell.unitIndex]!.text) === agreementFold(baseUnits[baseIndex]!.text)
  );
}

/** Whether a text has a word of its own in the columns between two words of the edition, where the edition has none. */
function hasWordBetween(collation: Collation, text: CollationText, point: number): boolean {
  const columnOf = (index: number): number =>
    collation.columns.findIndex((col) => col.cells.get('E')?.unitIndex === index);
  const from = point === 0 ? -1 : columnOf(point - 1);
  const to = columnOf(point);
  const end = to < 0 ? collation.columns.length : to;
  for (let c = from + 1; c < end; c++) {
    const cell = collation.columns[c]!.cells.get(text.id);
    if (cell && cell.unitIndex >= 0) return true;
  }
  return false;
}

function adoptWitnessReading(c: AdoptCase) {
  const edition = editionOf(c.base);
  const texts = witnessTexts(c);
  const first = collateEdition(edition, texts);
  const options = choices(first.collation);
  assume(options.length > 0, 'no witness reading to adopt');
  const { site, reading, textId } = pickOf(options, c.picks[0]!);
  const ops = adoptReading(edition, site, first.baseUnits, reading, textId, {
    ids: sequentialIds('n'),
  });
  const adopted = applyOps(edition, ops).stream;
  // The edition now reads as the witness does at the site, and as before elsewhere.
  const wanted = reading.units[textId]!.filter((u) => !u.gap).map((u) => u.text);
  const before = first.baseUnits.slice(0, site.baseFrom).map((u) => u.text);
  const after = first.baseUnits.slice(site.baseTo).map((u) => u.text);
  expect(wordsOf(adopted)).toStrictEqual([...before, ...wanted, ...after]);
  const second = collateEdition(adopted, texts);
  const text = texts.find((t) => t.id === textId)!;
  return { first, second, site, reading, textId, ops, text };
}

const adoptedWitnessAgrees: Property<AdoptCase> = {
  generate,
  show,
  shrink,
  check(c) {
    const { first, second, site, reading, textId, ops, text } = adoptWitnessReading(c);
    const place = adoptedPlace(first, second, site, ops);
    const where = `${textId} (${reading.sigla.join('')}) adopted\nbefore:\n${describeSites(first.collation)}\nafter:\n${describeSites(second.collation)}`;
    // Every word the adoption made stands in a column with the witness's word, and where words were taken out the witness has none.
    for (const i of place.words)
      expect(
        alignedWith(second.collation, second.baseUnits, text, i),
        `word ${i + 1}: ${where}`,
      ).toBe(true);
    if (place.words.length === 0)
      expect(
        hasWordBetween(second.collation, text, place.point),
        `a word where it was taken out: ${where}`,
      ).toBe(false);
  },
};

/** The statement at the level of sites: at the sites over the adopted words, the witness is in the edition's reading. */
const adoptedWitnessAgreesAtSites: Property<AdoptCase> = {
  generate,
  show,
  shrink,
  check(c) {
    const { first, second, site, reading, textId, ops } = adoptWitnessReading(c);
    const place = adoptedPlace(first, second, site, ops);
    let sites: Site[];
    if (place.words.length > 0) {
      const from = place.words[0]!;
      const last = place.words[place.words.length - 1]!;
      sites = second.collation.sites.filter(
        (s) =>
          !s.wanting &&
          (s.baseFrom === s.baseTo
            ? s.baseFrom > from && s.baseFrom <= last
            : s.baseTo > from && s.baseFrom <= last),
      );
    } else {
      sites = second.collation.sites.filter(
        (s) => !s.wanting && s.baseFrom === s.baseTo && s.baseFrom === place.point,
      );
    }
    for (const s of sites) {
      const base = s.readings.find((r) => r.base)!;
      expect(
        base.textIds,
        `${textId} (${reading.sigla.join('')}) adopted, but at site ${s.index} it is not with the edition\nbefore:\n${describeSites(first.collation)}\nafter:\n${describeSites(second.collation)}`,
      ).toContain(textId);
    }
  },
};

describe('adopting a reading (random)', () => {
  // Counterexample (shrunk; one case in about a thousand, so run over more
  // cases): the edition `Μοῦσα`, witnesses A `η Μοῦσα μάλα` and B `μάλα
  // πτολίεθρον Μοῦσα μάλα Μοῦσα`. At the first place (an addition before the
  // edition's word: A `η`, B `μάλα πτολίεθρον`) B's reading is adopted, and the
  // edition reads `μάλα πτολίεθρον Μοῦσα`, which is how B begins. Collated again
  // (A first, then B) the edition's three words are against A's `η Μοῦσα μάλα`:
  // A is put with the edition's `μάλα` and `Μοῦσα` standing unmatched
  // before it (one match either way, the tie goes that way), and B, aligned
  // to those columns, has its `πτολίεθρον` against A's `η`: B's words are not
  // in the edition's columns, and B reads `μάλα πτολίεθρον Μοῦσα μάλα Μοῦσα` in
  // one reading against the edition's three words. The witness whose reading
  // was just adopted does not agree with the edition where it was adopted, because
  // each witness is aligned to the columns the witnesses before it made, where
  // an exact match scores the same wherever it stands. (Aligned in the other
  // order, B first, all is as it should be.) The same fault as the
  // witness equal to the base in the collation tests.
  it.fails(
    'makes the edition read as the witness does, and collating again shows the witness agreeing there, word by word',
    () => {
      runProperty('adopt: the witness agrees with the edition at the place adopted', {
        ...adoptedWitnessAgrees,
        runs: Math.max(RUNS, 4000),
      });
    },
  );

  it.fails('(the shrunk case)', () => {
    adoptedWitnessAgrees.check({
      base: ['Μοῦσα'],
      witnesses: [
        { siglum: 'A', words: ['η', 'Μοῦσα', 'μάλα'], present: true },
        { siglum: 'B', words: ['μάλα', 'πτολίεθρον', 'Μοῦσα', 'μάλα', 'Μοῦσα'], present: true },
      ],
      picks: [0.41, 0.57, 0.16],
    });
  });

  // The same at the level of sites. Counterexample (shrunk): the edition `ἄνδρα ἦ`,
  // witnesses B `ἄνδρα ἦ Μοῦσα` and C `Μοῦσα ἦ ἀνδρα`. The sites are `ἄνδρα`
  // (C: `Μοῦσα`) and, after `ἦ`, an addition (B: `Μοῦσα`, C: `ἀνδρα`). C's reading
  // at the first is adopted, and the edition reads `Μοῦσα ἦ`; C's `Μοῦσα ἦ`
  // agrees with it. But B now has the edition's two words in the other order,
  // so one site covers both words (a transposition, anchors included), and C,
  // who differs from the edition at its end (`ἀνδρα`), is in a reading other
  // than the edition's at that site. Agreeing "at the place" cannot be read off the
  // site that covers it, since sites grow over what stands beside the place;
  // the statement above, by word, is the one that holds.
  it.fails('also at the level of sites, where the sites over the place may cover more', () => {
    runProperty(
      'adopt: the witness is in the base reading at the sites over the place',
      adoptedWitnessAgreesAtSites,
    );
  });
});

// ---------------------------------------------------------------------------
// Adopting, then adopting the former reading back

/** A case with a witness Z that is a copy of the edition, which is the edition's former reading. */
function withCopy(c: AdoptCase): TextsCase {
  return {
    base: c.base,
    witnesses: [{ siglum: 'Z', words: [...c.base], present: true }, ...c.witnesses],
  };
}

/** Adopt a reading of another witness, then the copy's reading at the place where it differs, collating again each time, until the copy agrees. */
function adoptAndAdoptBack(c: AdoptCase) {
  const edition = editionOf(c.base);
  const texts = witnessTexts(withCopy(c));
  const first = collateEdition(edition, texts);
  const options = choices(first.collation, ['W1']);
  assume(options.length > 0, 'no witness reading to adopt');
  const { site, reading, textId } = pickOf(options, c.picks[0]!);
  let current = applyOps(
    edition,
    adoptReading(edition, site, first.baseUnits, reading, textId, { ids: sequentialIds('n') }),
  ).stream;
  const made = sequentialIds('m');
  const rounds: string[] = [];
  for (let round = 0; round < 8; round++) {
    const now = collateEdition(current, texts);
    const places = now.collation.sites.filter(
      (s) => !s.wanting && s.readings.some((r) => !r.base && r.textIds.includes('W1')),
    );
    if (round === 0) assume(places.length > 0, 'the copy agrees everywhere');
    if (places.length === 0) return { current, rounds, edition };
    const s = places[0]!;
    rounds.push(describeSites(now.collation));
    const r = s.readings.find((x) => x.textIds.includes('W1'))!;
    current = applyOps(
      current,
      adoptReading(current, s, now.baseUnits, r, 'W1', { ids: made }),
    ).stream;
  }
  return { current, rounds, edition, unfinished: true };
}

/** The edition's words as it had them. */
const formerWords = (c: AdoptCase): string[] => c.base.map((w) => w ?? '');

/** The words of the edition as it was, compared exactly or by the fold collation compares by. */
function restoredWords(c: AdoptCase, mode: 'exact' | 'fold'): void {
  const done = adoptAndAdoptBack(c);
  expect(
    'unfinished' in done,
    `the copy still differs after eight adoptions\n${done.rounds.join('\n--\n')}`,
  ).toBe(false);
  const now = wordsOf(done.current);
  const was = formerWords(c);
  const message = `after adopting back\n${done.rounds.join('\n--\n')}`;
  if (mode === 'exact') expect(now, message).toStrictEqual(was);
  else
    expect(
      now.map((w) => agreementFold(w)),
      message,
    ).toStrictEqual(was.map((w) => agreementFold(w)));
}

const adoptAndBack = (mode: 'exact' | 'fold'): Property<AdoptCase> => ({
  generate,
  show,
  shrink,
  check: (c) => restoredWords(c, mode),
});

describe('adopting and adopting back (random)', () => {
  it('restores the edition’s words (to the fold) when the edition’s former reading is adopted back', () => {
    runProperty(
      'adopt: adopting a reading and then the former one restores the words, to the fold',
      adoptAndBack('fold'),
    );
  });

  it('restores them with one adoption when the former reading differs at one place', () => {
    runProperty('adopt: adopting back at the one place restores the words, to the fold', {
      ...adoptAndBack('fold'),
      check(c) {
        const done = adoptAndAdoptBack(c);
        assume(done.rounds.length === 1, 'the copy differs at more than one place');
        expect(wordsOf(done.current).map((w) => agreementFold(w))).toStrictEqual(
          formerWords(c).map((w) => agreementFold(w)),
        );
      },
    });
  });

  // Exactly, in the letters of each word, it does not hold, and cannot. The
  // fold does not tell `Μοῦσα` from `μοῦσα`, so the collation does not see
  // the difference and the edition keeps the witness's spelling of a word the
  // two agree on. Counterexample (shrunk): the edition `ἤ Μοῦσα ἔπερσεν`, a
  // witness B `Μοῦσα μοῦσα ἤ ἔπερσεν` (and the copy Z of the edition): B's
  // reading is adopted at the place of `Μοῦσα`... and the copy's reading
  // adopted back at the places where it now differs (`ἤ` and `Μοῦσα`
  // elsewhere); the edition ends `ἤ μοῦσα ἔπερσεν`. A consequence of the
  // design (case is not a variant), not a fault: adopting a reading imports
  // the witness's spelling of every word it replaces, and nothing later shows
  // that the spelling changed.
  it.fails('restores the edition’s words exactly, case included', () => {
    runProperty('adopt: adopting a reading and then the former one restores the words, exactly', {
      ...adoptAndBack('exact'),
      runs: Math.max(RUNS, 4000),
    });
  });
  it.fails('restores the edition’s words exactly (the shrunk case)', () => {
    restoredWords(
      {
        base: ['ἤ', 'Μοῦσα', 'ἔπερσεν'],
        witnesses: [{ siglum: 'B', words: ['Μοῦσα', 'μοῦσα', 'ἤ', 'ἔπερσεν'], present: true }],
        picks: [0.17, 0.83, 0.37],
      },
      'exact',
    );
  });
});

// ---------------------------------------------------------------------------
// Attaching a conjecture to the place of its lemma

describe('attaching conjectures (random)', () => {
  /** A lemma as the design compares words: by fold, a grave counting as an acute (`agreementFold`). */
  const foldKey = (lemma: string): string =>
    lemma
      .split(/\s+/u)
      .filter((w) => w)
      .map((w) => agreementFold(w))
      .join(' ');

  const placesOf = (collation: Collation, baseUnits: Unit[]): { site: Site; lemma: string }[] =>
    collation.sites
      .filter((s) => !s.wanting && s.baseTo > s.baseFrom)
      .map((site) => ({
        site,
        lemma: baseUnits
          .slice(site.baseFrom, site.baseTo)
          .map((u) => u.text)
          .join(' '),
      }));

  /** Sites over the same base words as another: a token or a lemma cannot tell them apart. */
  const overlapping = (collation: Collation): boolean => {
    const plain = collation.sites.filter((s) => !s.wanting);
    return plain.some((a, k) =>
      plain
        .slice(k + 1)
        .some(
          (b) =>
            a.baseFrom < b.baseTo &&
            b.baseFrom < a.baseTo &&
            a.baseTo > a.baseFrom &&
            b.baseTo > b.baseFrom,
        ),
    );
  };

  const attaches = (anchored: boolean, overlapsAllowed: boolean): Property<AdoptCase> => ({
    generate,
    show,
    shrink,
    check(c) {
      const edition = editionOf(c.base);
      const { collation, baseUnits } = collateEdition(edition, witnessTexts(c));
      // Where places overlap (see the collation tests) a token stands in two of them.
      if (!overlapsAllowed) assume(!overlapping(collation), 'the places overlap');
      const places = placesOf(collation, baseUnits);
      assume(places.length > 0, 'no place of variation over base words');
      const { site, lemma } = pickOf(places, c.picks[0]!);
      const candidate: AttachmentCandidate = {
        id: 'c1',
        kind: 'conjecture',
        lemma,
        reading: 'zzz',
        name: 'X',
        conjectureKind: 'substitution',
      };
      if (anchored) candidate.anchorTokenIds = baseUnits[site.baseFrom]!.tokenIds;
      else {
        // Without an anchor the lemma alone must tell the place: it must be the words of one place only.
        assume(
          places.filter((p) => foldKey(p.lemma) === foldKey(lemma)).length === 1,
          'the lemma stands at two places',
        );
      }
      const attached = attachToSites(collation, baseUnits, [candidate]);
      expect(attached.unplaced, 'the conjecture was left unplaced').toHaveLength(0);
      const where = Object.entries(attached.bySite)
        .filter(([, list]) => list.some((a) => a.id === 'c1'))
        .map(([index]) => Number(index));
      expect(
        where,
        `attached to sites ${where.join(',')}, not ${site.index}\n${describeSites(collation)}`,
      ).toStrictEqual([site.index]);
    },
  });

  it('a conjecture whose lemma is the words at a place, and which names its first word, attaches to that place', () => {
    runProperty('attach: lemma and token anchor find the place', attaches(true, false));
  });

  it('a conjecture whose lemma is the words at a place, and that stand nowhere else, attaches to that place', () => {
    runProperty('attach: the lemma alone finds the place', attaches(false, true));
  });

  // The anchor is looked up by the first site that holds its token, so where
  // places overlap (the fault of `buildSites` shown in the collation tests) a
  // conjecture can be attached to the wrong one. Counterexample (shrunk): the
  // edition `ἔπερσεν ὅς Τροίης`, A `ὅς ἔννεπε Τροίης`, B `ἔννεπε ἔπερσεν ὅς`:
  // site 1, over `ἔπερσεν`, lies inside site 0, over `ἔπερσεν ὅς`, and a
  // conjecture on `ἔπερσεν` named by its token is attached to site 0.
  it.fails('(with places that overlap) the token anchor finds the place', () => {
    runProperty(
      'attach: lemma and token anchor find the place, overlapping places allowed',
      attaches(true, true),
    );
  });
});

// ---------------------------------------------------------------------------
// The apparatus names every witness at every place

describe('the apparatus (random)', () => {
  it('has an entry for every place with a variant, and names each witness of the place once', () => {
    runProperty('apparatus: every witness named once at every place', {
      generate,
      show,
      shrink,
      check(c) {
        const edition = editionOf(c.base);
        const { collation } = collateEdition(edition, witnessTexts(c));
        const entries = apparatusEntries(collation, '1', {});
        for (const site of collation.sites) {
          const others = site.readings.filter((r) => !r.base);
          const entry = entries.find((e) => e.siteIndex === site.index);
          if (others.length === 0) {
            expect(entry, `an entry for site ${site.index} without variants`).toBeUndefined();
            continue;
          }
          expect(
            entry,
            `no entry for site ${site.index}\n${describeSites(collation)}`,
          ).toBeDefined();
          const base = site.readings.find((r) => r.base)!;
          const named = [...entry!.lemmaSigla, ...entry!.variants.flatMap((v) => v.sigla)].sort();
          const expected = site.readings
            .flatMap((r) => printedSigla(r))
            .filter((s) => s !== 'ed.')
            .sort();
          expect(named, `witnesses named at site ${site.index}`).toStrictEqual(expected);
          expect(new Set(named).size).toBe(named.length);
          expect(entry!.variants).toHaveLength(others.length);
          if (!site.wanting) expect(entry!.lemma).toBe(trimPunctuation(base.text));
        }
      },
    });
  });
});
