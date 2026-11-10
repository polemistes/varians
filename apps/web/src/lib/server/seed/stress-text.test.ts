import { describe, expect, it } from 'vitest';
import {
  PAGE_LINES,
  VOCABULARY,
  accentVariant,
  capitals,
  composition,
  generateStress,
  itacism,
  makeRandom,
  nearWord,
  summarizeStress,
  type StressItem,
  type StressLine,
  type StressText,
  type StressWitness,
} from './stress-text.ts';
import { agreementFold, archetypeLetters } from '@varians/core';

const full = generateStress({});

function wordsOf(items: StressItem[]) {
  return items.flatMap((i) => (i.kind === 'word' ? [i] : []));
}

function mainLines(w: StressWitness): StressLine[] {
  return w.entries.filter((e): e is StressLine => e.kind === 'line' && e.work === 'main');
}

/** What a line reads: deleted words out, the others by their read forms. */
function readOf(line: StressLine): string[] {
  return wordsOf(line.items)
    .filter((i) => !(i.marks ?? []).some((m) => m.kind === 'del'))
    .map((i) => i.norm ?? i.form);
}

const hasMark = (text: StressText, kind: string, key?: string) =>
  text.witnesses.some(
    (w) =>
      (key === undefined || w.key === key) &&
      w.entries.some(
        (e) =>
          e.kind === 'line' &&
          wordsOf(e.items).some((i) => (i.marks ?? []).some((m) => m.kind === kind)),
      ),
  );

describe('the random generator', () => {
  it('is the same for a seed and different for another', () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    expect([a.next(), a.next(), a.int(100)]).toEqual([b.next(), b.next(), b.int(100)]);
    expect(makeRandom(8).next()).not.toBe(makeRandom(7).next());
  });

  it('forks that do not depend on how much of the parent was used', () => {
    const a = makeRandom(3);
    const b = makeRandom(3);
    for (let i = 0; i < 50; i++) a.next();
    expect(a.fork('x').next()).toBe(b.fork('x').next());
  });
});

describe('the vocabulary and the disguises of a word', () => {
  it('is some 150 accented Greek words, with elided forms, all composed', () => {
    expect(new Set(VOCABULARY).size).toBe(VOCABULARY.length);
    expect(VOCABULARY.length).toBeGreaterThanOrEqual(140);
    expect(VOCABULARY.every((w) => w === w.normalize('NFC'))).toBe(true);
    expect(VOCABULARY.filter((w) => w.endsWith('᾽')).length).toBeGreaterThanOrEqual(10);
    expect(VOCABULARY).toContain('δ᾽');
  });

  it('gives an accent variant with the same letters, and a near word with other ones', () => {
    const rng = makeRandom(1);
    for (const word of ['ἔθηκε', 'θεῶν', 'πάλιν', 'ὁρᾷς', 'τοῦ']) {
      for (let i = 0; i < 10; i++) {
        const v = accentVariant(word, rng);
        expect(v).not.toBe(word);
        expect(archetypeLetters(v)).toBe(archetypeLetters(word));
        expect(agreementFold(v)).not.toBe(agreementFold(word));
      }
    }
    for (const word of ['ἔθηκε', 'πάντων', 'βίου']) {
      const near = nearWord(word, rng);
      expect(near).not.toBe('');
      expect(archetypeLetters(near)).not.toBe(archetypeLetters(word));
    }
  });

  it('writes capitals without accents, and itacisms in lower case with the accents kept', () => {
    expect(capitals('πάντων,')).toBe('ΠΑΝΤΩΝ');
    expect(capitals('δ᾽')).toBe('Δ');
    const rng = makeRandom(2);
    const changed = VOCABULARY.map((w) => itacism(w, rng)).filter((w, i) => w !== VOCABULARY[i]);
    expect(changed.length).toBeGreaterThan(100);
  });
});

describe('the stress text at the default size', () => {
  it('is deterministic from the seed', () => {
    expect(JSON.stringify(generateStress({ lines: 60, witnesses: 10, seed: 5 }))).toBe(
      JSON.stringify(generateStress({ lines: 60, witnesses: 10, seed: 5 })),
    );
    expect(JSON.stringify(generateStress({ lines: 60, witnesses: 10, seed: 6 }))).not.toBe(
      JSON.stringify(generateStress({ lines: 60, witnesses: 10, seed: 5 })),
    );
  });

  it('has 1300 lines of five to nine words, and 25 manuscripts, 4 papyri and 1 witness only reported', () => {
    expect(full.base).toHaveLength(1300);
    expect(full.base.every((l) => l.length >= 5 && l.length <= 9)).toBe(true);
    const s = summarizeStress(full);
    expect([s.witnesses, s.manuscripts, s.papyri, s.reported]).toEqual([30, 25, 4, 1]);
    expect(full.witnesses.find((w) => w.type === 'reported')!.entries).toEqual([]);
  });

  it('has manuscripts that differ from the text in about a line in four', () => {
    const shares = Object.values(summarizeStress(full).differing);
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean).toBeGreaterThan(0.18);
    expect(mean).toBeLessThan(0.32);
  });

  it('has three families with errors of their own, so that agreement has structure', () => {
    const family = (f: number) =>
      full.witnesses.filter(
        (w) =>
          w.type === 'manuscript' &&
          w.family === f &&
          !w.roles.some((r) => /follows|covers|lacks/u.test(r)),
      );
    const [a, b] = [family(0), family(1)];
    expect(a.length).toBeGreaterThan(2);
    // Two manuscripts of one family share more lines that differ from the text than two of different families.
    const differing = (w: StressWitness) =>
      new Set(
        mainLines(w)
          .filter((l) => readOf(l).join(' ') !== full.base[l.number - 1]!.join(' '))
          .map((l) => l.number),
      );
    const shared = (x: StressWitness, y: StressWitness) =>
      [...differing(x)].filter((n) => differing(y).has(n)).length;
    expect(shared(a[0]!, a[1]!)).toBeGreaterThan(shared(a[0]!, b[0]!) * 1.5);
  });

  it('has the coverage, pages and hands the brief asks for', () => {
    const manuscripts = full.witnesses.filter((w) => w.type === 'manuscript');
    const partial = manuscripts.filter((w) => w.roles.some((r) => r.startsWith('covers')));
    const losses = manuscripts.filter((w) => w.roles.some((r) => r.startsWith('lacks')));
    const contaminated = manuscripts.filter((w) => w.roles.some((r) => r.startsWith('follows')));
    expect([partial.length, losses.length, contaminated.length]).toEqual([5, 3, 3]);
    for (const w of partial) expect(mainLines(w).length).toBeLessThan(1300 * 0.8);
    for (const w of losses) {
      const lost = w.entries.filter((e) => e.kind === 'lost');
      expect(lost).toHaveLength(1);
      expect(lost[0]!.kind === 'lost' && lost[0]!.lines).toBeGreaterThan(0);
    }
    // Pages: 25 lines to a page, labelled 1r, 1v, 2r.
    const plain = manuscripts[0]!;
    expect(plain.pages.slice(0, 4)).toEqual(['1r', '1v', '2r', '2v']);
    const onFirstPage = plain.pageOf.filter((p, i) => p === 0 && plain.entries[i]!.kind === 'line');
    expect(onFirstPage).toHaveLength(PAGE_LINES);
    const unplaced = manuscripts.filter((w) => w.roles.some((r) => r.startsWith('first 30')));
    expect(unplaced).toHaveLength(2);
    for (const w of unplaced) {
      const lines = w.entries
        .map((e, i) => ({ e, p: w.pageOf[i] }))
        .filter((x) => x.e.kind === 'line');
      expect(lines.slice(0, 30).every((x) => x.p === null)).toBe(true);
      expect(lines[30]!.p).toBe(0);
    }
    const bare = manuscripts.filter((w) => w.pages.length === 0);
    expect(bare).toHaveLength(1);
    expect(bare[0]!.pageOf.every((p) => p === null)).toBe(true);
    // Half keep a diplomatic form.
    expect(manuscripts.filter((w) => w.keepsWrittenForm).length).toBe(12);
  });

  it('has two corrected manuscripts with hands, stages and states', () => {
    const corrected = full.witnesses.filter((w) => w.states.length > 0);
    expect(corrected).toHaveLength(2);
    const [three] = corrected.filter((w) => w.hands.length === 3);
    expect(three!.hands.map((h) => h.label)).toEqual(['Scribe', 'm2', 'm3']);
    expect(three!.hands.filter((h) => h.main)).toHaveLength(1);
    for (const w of corrected) {
      const lines = mainLines(w);
      const share =
        lines.filter((l) =>
          wordsOf(l.items).some((i) =>
            (i.marks ?? []).some((m) => m.kind === 'del' || m.kind === 'add'),
          ),
        ).length / lines.length;
      expect(share).toBeGreaterThan(0.015);
      expect(share).toBeLessThan(0.06);
      // A deleted word and an added one as two adjacent tokens, and some bare ones.
      let pairs = 0;
      let bareDeleted = 0;
      let bareAdded = 0;
      for (const l of lines) {
        const items = wordsOf(l.items);
        items.forEach((item, i) => {
          const marks = item.marks ?? [];
          const del = marks.find((m) => m.kind === 'del');
          const add = marks.find((m) => m.kind === 'add');
          if (del && items[i + 1]?.marks?.some((m) => m.kind === 'add')) pairs++;
          else if (del) bareDeleted++;
          else if (add && !items[i - 1]?.marks?.some((m) => m.kind === 'del')) bareAdded++;
          for (const m of [del, add]) {
            if (!m) continue;
            expect(typeof m.attrs?.hand).toBe('string');
            expect(typeof m.attrs?.seq).toBe('number');
            expect(['scribe', ...w.hands.map((h) => h.id)]).toContain(m.attrs!.hand);
          }
        });
      }
      expect(pairs).toBeGreaterThan(5);
      expect(bareDeleted).toBeGreaterThan(0);
      expect(bareAdded).toBeGreaterThan(0);
    }
    expect(corrected.flatMap((w) => w.states.map((s) => s.kind)).sort()).toEqual(
      expect.arrayContaining(['original', 'stage', 'hand']),
    );
  });

  it('has one manuscript with variants noted in the margin, two with scholia, two that abbreviate', () => {
    const withVariants = full.witnesses.filter((w) => w.variantSiglum);
    expect(withVariants).toHaveLength(1);
    const lines = mainLines(withVariants[0]!);
    const share =
      lines.filter((l) => wordsOf(l.items).some((i) => i.marks?.some((m) => m.kind === 'variant')))
        .length / lines.length;
    expect(share).toBeGreaterThan(0.008);
    expect(share).toBeLessThan(0.05);
    for (const l of lines)
      for (const i of wordsOf(l.items)) {
        const v = (i.marks ?? []).filter((m) => m.kind === 'variant');
        expect(v.length).toBeLessThanOrEqual(1);
        for (const m of v) {
          expect(typeof m.attrs?.group).toBe('string');
          expect(typeof m.attrs?.reading).toBe('string');
        }
      }
    const scholia = full.witnesses.filter((w) =>
      w.entries.some((e) => e.kind === 'line' && e.work === 'scholia'),
    );
    expect(scholia).toHaveLength(2);
    for (const w of scholia) {
      const order = w.entries.map((e) => (e.kind === 'line' ? e.work : e.kind));
      // Standing between the lines of the first work.
      expect(order.indexOf('scholia')).toBeGreaterThan(0);
      expect(order[order.indexOf('scholia') + 1]).toBe('main');
    }
    const abbreviating = full.witnesses.filter((w) =>
      w.entries.some(
        (e) =>
          e.kind === 'line' &&
          wordsOf(e.items).some((i) => i.marks?.some((m) => m.kind === 'abbr')),
      ),
    );
    expect(abbreviating).toHaveLength(2);
    for (const w of abbreviating) {
      for (const l of mainLines(w))
        for (const i of wordsOf(l.items)) {
          const abbr = i.marks?.find((m) => m.kind === 'abbr');
          if (abbr) {
            expect(typeof abbr.attrs?.expan).toBe('string');
            expect(i.norm).toBeDefined();
          }
        }
    }
  });

  it('has unclear letters, notes, paragraphoi, spaces and changes of hand', () => {
    expect(hasMark(full, 'unclear')).toBe(true);
    expect(hasMark(full, 'handShift')).toBe(true);
    const objects = full.witnesses.flatMap((w) =>
      w.entries.flatMap((e) => (e.kind === 'line' ? e.items : [])),
    );
    expect(
      objects.some(
        (i) => i.kind === 'object' && i.type === 'mark' && i.attrs?.rend === 'paragraphos',
      ),
    ).toBe(true);
    expect(objects.some((i) => i.kind === 'object' && i.type === 'space')).toBe(true);
    expect(objects.some((i) => i.kind === 'object' && i.type === 'note' && i.text)).toBe(true);
  });

  it('does not write a circumflex or an iota subscript on a short vowel', () => {
    const impossible = /[εο][\u0313\u0314\u0301\u0300]*[\u0342\u0345]/u;
    for (const w of full.witnesses)
      for (const e of w.entries)
        if (e.kind === 'line')
          for (const i of wordsOf(e.items))
            expect(impossible.test((i.norm ?? i.form).normalize('NFD'))).toBe(false);
  });

  it('has papyri broken in every line, in columns or fragments, with lines lost between', () => {
    const papyri = full.witnesses.filter((w) => w.type === 'papyrus');
    expect(papyri).toHaveLength(4);
    for (const w of papyri) {
      const lines = mainLines(w);
      expect(lines.length).toBeGreaterThanOrEqual(25);
      expect(lines.length).toBeLessThanOrEqual(120);
      const broken = (l: StressLine) =>
        l.items.some(
          (i) =>
            i.kind === 'gap' ||
            (i.kind === 'word' &&
              (i.marks ?? []).some((m) => m.kind === 'gap' || m.kind === 'unclear')),
        );
      expect(lines.every(broken)).toBe(true);
      expect(w.keepsWrittenForm).toBe(true);
      expect(w.pages.length).toBeGreaterThan(1);
      expect(w.entries.filter((e) => e.kind === 'lost').length).toBeGreaterThan(0);
    }
    // A word broken by a gap keeps its surviving letters and a point mark.
    const point = papyri
      .flatMap((w) => mainLines(w))
      .flatMap((l) => wordsOf(l.items))
      .flatMap((i) => (i.marks ?? []).filter((m) => m.kind === 'gap' && m.from !== undefined));
    expect(point.length).toBeGreaterThan(10);
    for (const m of point) {
      expect(m.from).toBe(m.to);
      expect(m.attrs).toMatchObject({ unit: 'character' });
      expect(['lost', 'illegible']).toContain(m.attrs!.reason);
      expect(typeof m.attrs!.quantity).toBe('number');
    }
    const leading = papyri.flatMap((w) => mainLines(w)).filter((l) => l.items[0]!.kind === 'gap');
    const trailing = papyri
      .flatMap((w) => mainLines(w))
      .filter((l) => l.items[l.items.length - 1]!.kind === 'gap');
    expect(leading.length).toBeGreaterThan(10);
    expect(trailing.length).toBeGreaterThan(10);
  });

  it('does not let diplomatic spelling alter what is read', () => {
    // With no differences made, every complete manuscript reads as the text, whatever it writes.
    const plain = generateStress({ lines: 120, witnesses: 14, seed: 3, rateScale: 0 });
    let checked = 0;
    for (const w of plain.witnesses.filter((w) => w.type === 'manuscript' && w.keepsWrittenForm)) {
      for (const l of mainLines(w)) {
        const read = readOf(l);
        expect(read.join(' ')).toBe(plain.base[l.number - 1]!.join(' '));
        checked++;
      }
      expect(
        wordsOf(w.entries.flatMap((e) => (e.kind === 'line' ? e.items : []))).some(
          (i) => i.norm !== undefined && i.form !== i.norm,
        ),
      ).toBe(true);
    }
    expect(checked).toBeGreaterThan(200);
    expect(plain.witnesses.filter((w) => w.keepsWrittenForm).length).toBeGreaterThan(2);
  });

  it('has places where one manuscript varies over three or four words and two others differ in one word each', () => {
    const complete = full.witnesses.filter(
      (w) => w.type === 'manuscript' && mainLines(w).length > 1250 && w.key !== 'ms01',
    );
    const byLine = (w: StressWitness) =>
      new Map(mainLines(w).map((l) => [l.number, readOf(l)] as const));
    const maps = complete.map(byLine);
    let found = 0;
    for (let n = 1; n <= 1300; n++) {
      const text = full.base[n - 1]!;
      const diffs = maps.map((m) => {
        const read = m.get(n);
        if (!read || read.length !== text.length) return null;
        const at = read.map((w, i) => (w !== text[i] ? i : -1)).filter((i) => i >= 0);
        return at;
      });
      const wide = diffs.filter(
        (d) => d && d.length >= 3 && d.length <= 4 && d[d.length - 1]! - d[0]! === d.length - 1,
      );
      const narrow = diffs.filter((d) => d && d.length === 1);
      if (wide.length >= 1 && narrow.length >= 2) {
        const w = wide[0]!;
        const inside = narrow.filter((d) => d![0]! >= w[0]! && d![0]! <= w[w.length - 1]!);
        if (inside.length >= 2 && new Set(inside.map((d) => d![0])).size >= 2) found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(5);
  });

  it('has about 120 conjectures of every kind, forty bibliography entries, forty reported readings and the editors plan', () => {
    expect(full.conjectures.length).toBe(120);
    const kinds = new Set(full.conjectures.map((c) => c.kind));
    expect([...kinds].sort()).toEqual([
      'addition',
      'deletion',
      'lacuna',
      'substitution',
      'supplement',
      'transposition',
    ]);
    for (const c of full.conjectures) {
      expect(c.proposer).not.toBe('');
      if (c.kind === 'supplement') expect(full.conjectures[c.supplements!]!.kind).toBe('lacuna');
      if (c.kind === 'transposition') expect(c.sequence).toEqual([c.line + 1, c.line]);
    }
    expect(full.conjectures.filter((c) => c.note).length).toBeGreaterThan(20);
    expect(new Set(full.conjectures.map((c) => c.proposer)).size).toBeGreaterThan(10);
    expect(full.bibliography).toHaveLength(40);
    expect(new Set(full.bibliography.map((b) => b.key)).size).toBe(40);
    expect(full.reported).toHaveLength(40);
    // A conjecture's lemma is the real words of the base witness at its line.
    const real = full.conjectures.filter((c) => c.lemma !== '' && c.kind === 'substitution');
    const matching = real.filter((c) =>
      (full.baseWitnessWords[c.line - 1] ?? []).join(' ').includes(c.lemma),
    );
    expect(matching.length / real.length).toBeGreaterThan(0.85);
    const adopted = full.conjectures.filter((c) => c.adopt);
    expect(adopted.length).toBeGreaterThanOrEqual(15);
    expect(adopted.length).toBeLessThanOrEqual(35);
    expect(new Set(adopted.map((c) => c.kind)).size).toBe(6);
    expect(full.editors.speakers.length).toBeGreaterThan(70);
    expect(full.editors.emendations).toHaveLength(15);
    expect(full.editors.notes).toHaveLength(30);
  });

  it('is based on a complete, plain and undamaged manuscript', () => {
    const base = full.witnesses.find((w) => w.key === full.baseWitness)!;
    expect(base.keepsWrittenForm).toBe(false);
    // Complete but for the lines its family's ancestor or it itself left out.
    expect(mainLines(base).length).toBeGreaterThan(1250);
    expect(base.states).toEqual([]);
    expect(base.entries.every((e) => e.kind === 'line' && e.work === 'main')).toBe(true);
    expect(
      base.entries
        .flatMap((e) => (e.kind === 'line' ? e.items : []))
        .every((i) => i.kind !== 'gap'),
    ).toBe(true);
  });
});

describe('the stress text at a small size', () => {
  const small = generateStress({ lines: 40, witnesses: 8, seed: 9 });

  it('scales the witnesses down and keeps one of each kind', () => {
    expect(composition(8)).toEqual({ manuscripts: 6, papyri: 1, reported: 1 });
    expect(small.witnesses.map((w) => w.type)).toEqual([
      ...Array(6).fill('manuscript'),
      'papyrus',
      'reported',
    ]);
    expect(small.witnesses.some((w) => w.states.length > 0)).toBe(true);
    expect(small.witnesses.some((w) => w.variantSiglum)).toBe(true);
    expect(small.witnesses.some((w) => w.entries.some((e) => e.kind === 'lost'))).toBe(true);
    expect(
      small.witnesses.some((w) => w.entries.some((e) => e.kind === 'line' && e.work === 'scholia')),
    ).toBe(true);
    expect(new Set(small.conjectures.map((c) => c.kind)).size).toBe(6);
  });

  it('keeps every page shape: the entries and their pages agree', () => {
    for (const w of small.witnesses) {
      expect(w.pageOf).toHaveLength(w.entries.length);
      for (const p of w.pageOf) if (p !== null) expect(p).toBeLessThan(w.pages.length);
      // Pages come in order.
      const seen = w.pageOf.filter((p): p is number => p !== null);
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    }
  });

  it('copes with the smallest sizes', () => {
    for (const witnesses of [1, 2, 3, 4, 5]) {
      const text = generateStress({ lines: 12, witnesses, seed: 1 });
      expect(text.witnesses).toHaveLength(witnesses);
      expect(text.witnesses[0]!.key).toBe(text.baseWitness);
    }
  });
});
