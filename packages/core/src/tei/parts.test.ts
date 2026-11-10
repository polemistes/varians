import { describe, expect, it } from 'vitest';
import type { Attachment } from '../apparatus/render.ts';
import type { Reading, Site } from '../collate/collate.ts';
import type { Unit } from '../stream/words.ts';
import { exportEditionTei } from './apparatus.ts';
import { collatedLines, passageSegments, type CollatedLines } from './fixtures.ts';
import { variantParts } from './parts.ts';

const made = collatedLines;
type Made = CollatedLines;

const WORK = ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta'];

/** The `<ab>` of each of the passage's printed segments as the exporter writes them, the variants in parts where they lie across segments. */
function written(
  made: Made,
  options: {
    attachments?: Record<number, Attachment[]>;
    mark?: (site: Site) => Site;
  } = {},
): string[] {
  const xml = exportEditionTei({
    title: 't',
    baseSiglum: 'ed.',
    witnesses: ['A', 'B', 'C', 'D', 'E', 'P'].map((siglum) => ({ siglum })),
    segments: passageSegments(made, options),
  });
  return xml.match(/<ab [^>]*>.*<\/ab>/gu) ?? [];
}

const readings = (site: Site) =>
  site.readings.map((r) => `${r.base ? '*' : ''}${r.text || '-'}: ${r.sigla.join(' ')}`);

describe('variantParts', () => {
  it('writes a variant across two segments in a part in each, each true of its own segment', () => {
    const two = made(WORK, {
      A: ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta'],
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    expect(two.passage.collation.sites.map(readings)).toEqual([
      ['*delta epsilon: ed. A', 'kappa lambda: B'],
    ]);
    expect(written(two)).toEqual([
      '<ab n="s1">alpha beta gamma <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">delta</lem><rdg wit="#wit-B">kappa</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">epsilon</lem><rdg wit="#wit-B">lambda</rdg></app> zeta eta theta</ab>',
    ]);
  });

  it('gives each part the edition’s words and the witnesses’ words of its own segment', () => {
    const { passage } = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    const parts = variantParts(
      passage.collation.sites[0]!,
      { segments: passage.segments, baseUnits: passage.base.units },
      [],
      { key: 'v' },
    )!;
    expect(parts.map((p) => p.segmentId)).toEqual(['s1', 's2']);
    // Indexes are those of the segment's own units: the last of four, and the first of four.
    expect(parts.map((p) => [p.site.baseFrom, p.site.baseTo])).toEqual([
      [3, 4],
      [0, 1],
    ]);
    expect(parts.map((p) => p.site.readings.map((r) => `${r.text}: ${r.sigla.join(' ')}`))).toEqual(
      [
        ['delta: ed. A', 'kappa: B'],
        ['epsilon: ed. A', 'lambda: B'],
      ],
    );
    expect(parts.map((p) => p.link)).toEqual([
      { id: 'v-1', next: 'v-2', kind: 'textual' },
      { id: 'v-2', prev: 'v-1', kind: 'textual' },
    ]);
  });

  it('writes a variant across three segments, the middle part linked both ways', () => {
    const three = made(['s1: alpha beta gamma', 's2: delta', 's3: epsilon zeta eta'], {
      A: ['s1: alpha beta gamma', 's2: delta', 's3: epsilon zeta eta'],
      B: ['s1: alpha beta kappa', 's2: lambda', 's3: mu zeta eta'],
    });
    expect(written(three)).toEqual([
      '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">gamma</lem><rdg wit="#wit-B">kappa</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1" next="#app-p-0-3"><lem wit="#wit-A">delta</lem><rdg wit="#wit-B">lambda</rdg></app></ab>',
      '<ab n="s3"><app xml:id="app-p-0-3" prev="#app-p-0-2"><lem wit="#wit-A">epsilon</lem><rdg wit="#wit-B">mu</rdg></app> zeta eta</ab>',
    ]);
  });

  it('puts a witness that has both words in the first segment in a reading of nothing in the second', () => {
    const one = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa lambda', 's2: zeta eta theta'],
    });
    expect(written(one)).toEqual([
      '<ab n="s1">alpha beta gamma <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">delta</lem><rdg wit="#wit-B">kappa lambda</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">epsilon</lem><rdg wit="#wit-B"/></app> zeta eta theta</ab>',
    ]);
  });

  it('groups witnesses that read alike in a part into one reading there', () => {
    const several = made(WORK, {
      A: WORK,
      // B and D divide the two words as the edition does; C has both in the first segment.
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
      C: ['s1: alpha beta gamma kappa lambda', 's2: zeta eta theta'],
      D: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    expect(written(several)).toEqual([
      '<ab n="s1">alpha beta gamma <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">delta</lem><rdg wit="#wit-B #wit-D">kappa</rdg><rdg wit="#wit-C">kappa lambda</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">epsilon</lem><rdg wit="#wit-B #wit-D">lambda</rdg><rdg wit="#wit-C"/></app> zeta eta theta</ab>',
    ]);
  });

  describe('readings of the whole that agree in one part and differ in another', () => {
    // Two witnesses that read two words otherwise, each as a reading of its own over both words: this
    // is how a variant over a stretch that another witness moves holds them.
    const unit = (text: string, segmentId: string): Unit => ({ text, tokenIds: [text], segmentId });
    const passage = {
      segments: [
        { segmentId: 's1', from: 0, to: 4, printed: true },
        { segmentId: 's2', from: 4, to: 8, printed: true },
      ],
      baseUnits: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'].map(
        (w, i) => unit(w, i < 4 ? 's1' : 's2'),
      ),
    };
    const reading = (words: [string, string][], textId: string, siglum: string): Reading => ({
      text: words.map(([w]) => w).join(' '),
      fold: words.map(([w]) => w.toLowerCase()).join(' '),
      textIds: [textId],
      sigla: [siglum],
      units: { [textId]: words.map(([w, s]) => unit(w, s)) },
      omission: false,
      lacunose: false,
      base: false,
    });
    const site: Site = {
      index: 0,
      columnFrom: 3,
      columnTo: 5,
      baseFrom: 3,
      baseTo: 5,
      kind: 'textual',
      readings: [
        {
          ...reading(
            [
              ['delta', 's1'],
              ['epsilon', 's2'],
            ],
            'E',
            'ed.',
          ),
          base: true,
        },
        reading(
          [
            ['kappa', 's1'],
            ['lambda', 's2'],
          ],
          'B',
          'B',
        ),
        reading(
          [
            ['Kappa', 's1'],
            ['mu', 's2'],
          ],
          'C',
          'C',
        ),
      ],
    };

    it('are one reading in the part where they agree, as the fold says, with the first witness’s words', () => {
      const parts = variantParts(site, passage, [], { key: 'v' })!;
      const text = (k: number) =>
        parts[k]!.site.readings.map((r) => `${r.text}: ${r.sigla.join(' ')}`);
      expect(text(0)).toEqual(['delta: ed.', 'kappa: B C']);
      expect(text(1)).toEqual(['epsilon: ed.', 'lambda: B', 'mu: C']);
    });

    it('differ again where the fold tells them apart', () => {
      const strict = {
        caseFold: false,
        stripPunctuation: false,
        stripDiacritics: false,
        latinUV: false,
      };
      const parts = variantParts(site, passage, [], { key: 'v', fold: strict })!;
      expect(parts[0]!.site.readings.map((r) => `${r.text}: ${r.sigla.join(' ')}`)).toEqual([
        'delta: ed.',
        'kappa: B',
        'Kappa: C',
      ]);
    });
  });

  it('leaves a witness that is not there out of every part', () => {
    const lost = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
      // P has lost the words of the variant, on both sides of the boundary.
      P: ['s1: alpha beta gamma []', 's2: [] zeta eta theta'],
    });
    const abs = written(lost);
    expect(abs).toHaveLength(2);
    expect(abs.join('')).not.toContain('wit-P');
    expect(abs[0]).toContain('<lem wit="#wit-A">delta</lem><rdg wit="#wit-B">kappa</rdg>');
  });

  it('writes a conjecture’s words in the first part and the record alone in the later ones', () => {
    const conjecture = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    const attachments = {
      0: [
        {
          kind: 'conjecture',
          id: 'c1',
          text: 'rho sigma',
          name: 'Bentley',
          source: '(Ath. 1.12e)',
        },
        { kind: 'reported', id: 'r1', text: 'tau upsilon', name: 'D' },
      ] satisfies Attachment[],
    };
    expect(written(conjecture, { attachments })).toEqual([
      '<ab n="s1">alpha beta gamma <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">delta</lem><rdg wit="#wit-B">kappa</rdg><rdg type="conjecture" resp="Bentley" source="(Ath. 1.12e)">rho sigma</rdg><rdg type="reported" resp="D">tau upsilon</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">epsilon</lem><rdg wit="#wit-B">lambda</rdg><rdg type="conjecture" resp="Bentley" source="(Ath. 1.12e)"/><rdg type="reported" resp="D"/></app> zeta eta theta</ab>',
    ]);
  });

  it('marks the lemma of every part with an adopted conjecture', () => {
    const adopted = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    const attachments = {
      0: [
        { kind: 'conjecture', id: 'c1', text: 'delta epsilon', name: 'Bentley', adopted: true },
      ] satisfies Attachment[],
    };
    const abs = written(adopted, { attachments });
    expect(abs[0]).toContain('<lem wit="#wit-A" resp="Bentley">delta</lem>');
    expect(abs[1]).toContain('<lem wit="#wit-A" resp="Bentley">epsilon</lem>');
    expect(abs.join('')).not.toContain('type="conjecture"');
  });

  it('repeats the kind and the grade on every part', () => {
    const minor = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    const abs = written(minor, { mark: (site) => ({ ...site, minor: true }) });
    expect(abs[0]).toContain(
      '<app xml:id="app-p-0-1" type="textual" subtype="minor" next="#app-p-0-2">',
    );
    expect(abs[1]).toContain(
      '<app xml:id="app-p-0-2" type="textual" subtype="minor" prev="#app-p-0-1">',
    );
  });

  it('keeps the kind of the whole where a conjecture’s words are only in the first part', () => {
    // The same letters read otherwise across the boundary: interpretative, and its conjecture has the same letters.
    const same = made(['s1: μῆνιν ἦ', 's2: μέγα ἔργον'], {
      A: ['s1: μῆνιν ἦ', 's2: μέγα ἔργον'],
      B: ['s1: μῆνιν ἢ', 's2: μέγᾱ ἔργον'],
    });
    const attachments = {
      0: [{ kind: 'conjecture', id: 'c1', text: 'ἦ μέγα', name: 'Bentley' }] satisfies Attachment[],
    };
    const abs = written(same, { attachments });
    expect(same.passage.collation.sites[0]!.kind).toBe('interpretative');
    expect(abs[0]).toContain('<app xml:id="app-p-0-1" type="interpretative" next="#app-p-0-2">');
    // The conjecture has no words here, which alone would make the part textual.
    expect(abs[1]).toContain('<app xml:id="app-p-0-2" type="interpretative" prev="#app-p-0-1">');
  });

  it('writes a variant at a point whose witness words lie in two segments in parts at the end of the one and the start of the other', () => {
    const point = made(['s1: alpha beta', 's2: gamma delta'], {
      A: ['s1: alpha beta', 's2: gamma delta'],
      B: ['s1: alpha beta kappa', 's2: lambda gamma delta'],
    });
    expect(written(point)).toEqual([
      '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A"/><rdg wit="#wit-B">kappa</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A"/><rdg wit="#wit-B">lambda</rdg></app> gamma delta</ab>',
    ]);
  });

  it('names a witness that reads as the edition does in a part in the lemma there, and gives it no reading', () => {
    // C has the edition's second word, in another case, where B has another; both have the first word the same.
    const edition = [
      ['delta', 's1'],
      ['epsilon', 's2'],
    ] as const;
    const word = (text: string, segmentId: string): Unit => ({ text, tokenIds: [text], segmentId });
    const reading = (words: readonly (readonly [string, string])[], id: string): Reading => ({
      text: words.map(([w]) => w).join(' '),
      fold: words.map(([w]) => w.toLowerCase()).join(' '),
      textIds: [id],
      sigla: [id],
      units: { [id]: words.map(([w, s]) => word(w, s)) },
      omission: false,
      lacunose: false,
      base: id === 'ed.',
    });
    const site: Site = {
      index: 0,
      columnFrom: 0,
      columnTo: 2,
      baseFrom: 0,
      baseTo: 2,
      kind: 'textual',
      readings: [
        reading(edition, 'ed.'),
        reading(
          [
            ['kappa', 's1'],
            ['lambda', 's2'],
          ],
          'B',
        ),
        reading(
          [
            ['kappa', 's1'],
            ['Epsilon', 's2'],
          ],
          'C',
        ),
      ],
    };
    const parts = variantParts(
      site,
      {
        segments: [
          { segmentId: 's1', from: 0, to: 1, printed: true },
          { segmentId: 's2', from: 1, to: 2, printed: true },
        ],
        baseUnits: edition.map(([w, s]) => word(w, s)),
      },
      [],
      { key: 'v' },
    )!;
    expect(parts.map((p) => p.site.readings.map((r) => `${r.text}: ${r.sigla.join(' ')}`))).toEqual(
      [
        ['delta: ed.', 'kappa: B C'],
        ['epsilon: ed. C', 'lambda: B'],
      ],
    );
  });

  it('names a witness that has nothing in a part where the edition has nothing in the lemma there', () => {
    // B has both added words in the first segment, C in the second; the edition has neither.
    const point = made(['s1: alpha beta', 's2: gamma delta'], {
      A: ['s1: alpha beta', 's2: gamma delta'],
      B: ['s1: alpha beta kappa lambda', 's2: gamma delta'],
      C: ['s1: alpha beta', 's2: kappa lambda gamma delta'],
    });
    expect(written(point)).toEqual([
      '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A #wit-C"/><rdg wit="#wit-B">kappa lambda</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A #wit-B"/><rdg wit="#wit-C">kappa lambda</rdg></app> gamma delta</ab>',
    ]);
  });

  it('writes a part in which every witness stands with the lemma, with its links', () => {
    const crossing = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    // B’s second word, as it is made to read here, has the edition’s letters: B agrees in the second part.
    const mark = (site: Site): Site => ({
      ...site,
      readings: site.readings.map((r) =>
        r.base
          ? r
          : {
              ...r,
              units: Object.fromEntries(
                Object.entries(r.units).map(([id, units]) => [
                  id,
                  units.map((u) => (u.text === 'lambda' ? { ...u, text: 'Epsilon' } : u)),
                ]),
              ),
            },
      ),
    });
    expect(written(crossing, { mark })).toEqual([
      '<ab n="s1">alpha beta gamma <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">delta</lem><rdg wit="#wit-B">kappa</rdg></app></ab>',
      '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A #wit-B">epsilon</lem></app> zeta eta theta</ab>',
    ]);
  });

  it('gives the words of a segment the edition does not print to the printed segment before it', () => {
    const between = made(['s1: alpha beta', 's3: gamma delta'], {
      A: ['s1: alpha beta', 's3: gamma delta'],
      B: ['s1: alpha beta kappa', 's2: lambda', 's3: mu gamma delta'],
    });
    expect(between.passage.segments.map((s) => `${s.segmentId}${s.printed ? '' : '*'}`)).toEqual([
      's1',
      's2*',
      's3',
    ]);
    expect(written(between)).toEqual([
      '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A"/><rdg wit="#wit-B">kappa lambda</rdg></app></ab>',
      '<ab n="s3"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A"/><rdg wit="#wit-B">mu</rdg></app> gamma delta</ab>',
    ]);
  });

  it('keeps a segment the edition does not print as one variant at the end of the printed segment before it', () => {
    const unprinted = made(['s1: alpha beta', 's3: gamma delta'], {
      A: ['s1: alpha beta', 's2: kappa lambda', 's3: gamma delta'],
      B: ['s1: alpha beta', 's3: gamma delta'],
    });
    const [site] = unprinted.passage.collation.sites;
    expect(
      variantParts(
        site!,
        { segments: unprinted.passage.segments, baseUnits: unprinted.passage.base.units },
        [],
        { key: 'v' },
      ),
    ).toBeNull();
    expect(written(unprinted)).toEqual([
      '<ab n="s1">alpha beta <app><lem wit="#wit-B"/><rdg wit="#wit-A">kappa lambda</rdg></app></ab>',
      '<ab n="s3">gamma delta</ab>',
    ]);
  });

  it('gives a word of a segment that is no part of the variant to the nearest part: the first before it, the last after it', () => {
    // B’s words of the variant begin in the segment before it, and end in the one after.
    const outside = made(['s1: a', 's2: b', 's3: c', 's4: d'], {
      A: ['s1: a', 's2: b', 's3: c', 's4: d'],
      B: ['s1: a w', 's2: x', 's3: y', 's4: z d'],
    });
    const [site] = outside.passage.collation.sites;
    expect(readings(site!)).toEqual(['*b c: ed. A', 'w x y z: B']);
    const parts = variantParts(
      site!,
      { segments: outside.passage.segments, baseUnits: outside.passage.base.units },
      [],
      { key: 'v' },
    )!;
    expect(parts.map((p) => p.segmentId)).toEqual(['s2', 's3']);
    expect(parts.map((p) => p.site.readings[1]!.text)).toEqual(['w x', 'y z']);
  });

  describe('a word of the edition divided across two segments', () => {
    const divided = ['s1: alpha beta gam-', 's2: ma delta epsilon'];

    it('is a variant in two parts where it is the variant’s only word: the lemma has each part of the word, the witness has its word where it begins', () => {
      const one = made(divided, {
        A: divided,
        B: ['s1: alpha beta kappa', 's2: delta epsilon'],
      });
      const [site] = one.passage.collation.sites;
      expect(readings(site!)).toEqual(['*gamma: ed. A', 'kappa: B']);
      expect(written(one)).toEqual([
        '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">gam</lem><rdg wit="#wit-B">kappa</rdg></app></ab>',
        '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">ma</lem><rdg wit="#wit-B"/></app> delta epsilon</ab>',
      ]);
    });

    it('has the tail and the whole words after it in the lemma of the later part', () => {
      const more = made(divided, {
        A: divided,
        B: ['s1: alpha beta kappa', 's2: lambda epsilon'],
      });
      expect(written(more)).toEqual([
        '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">gam</lem><rdg wit="#wit-B">kappa</rdg></app></ab>',
        '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">ma delta</lem><rdg wit="#wit-B">lambda</rdg></app> epsilon</ab>',
      ]);
    });

    it('keeps a witness’s own divided word whole, in the part where it begins', () => {
      const both = made(divided, {
        A: divided,
        B: ['s1: alpha beta kap-', 's2: pa delta epsilon'],
      });
      expect(written(both)).toEqual([
        '<ab n="s1">alpha beta <app xml:id="app-p-0-1" next="#app-p-0-2"><lem wit="#wit-A">gam</lem><rdg wit="#wit-B">kappa</rdg></app></ab>',
        '<ab n="s2"><app xml:id="app-p-0-2" prev="#app-p-0-1"><lem wit="#wit-A">ma</lem><rdg wit="#wit-B"/></app> delta epsilon</ab>',
      ]);
    });

    it('is written whole where the tokens are not given: as before', () => {
      const one = made(divided, {
        A: divided,
        B: ['s1: alpha beta kappa', 's2: delta epsilon'],
      });
      const [site] = one.passage.collation.sites;
      expect(
        variantParts(
          site!,
          { segments: one.passage.segments, baseUnits: one.passage.base.units },
          [],
          { key: 'v' },
        ),
      ).toBeNull();
    });
  });

  it('writes a variant within one segment as it is: no name, no links', () => {
    const within = made(WORK, {
      A: WORK,
      B: ['s1: alpha beta kappa delta', 's2: epsilon zeta eta theta'],
    });
    const [site] = within.passage.collation.sites;
    expect(
      variantParts(
        site!,
        { segments: within.passage.segments, baseUnits: within.passage.base.units },
        [],
        { key: 'v' },
      ),
    ).toBeNull();
    expect(written(within)).toEqual([
      '<ab n="s1">alpha beta <app><lem wit="#wit-A">gamma</lem><rdg wit="#wit-B">kappa</rdg></app> delta</ab>',
    ]);
  });

  it('names the parts of different variants apart', () => {
    const two = made(
      ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta', 's3: iota kappa lambda mu'],
      {
        A: ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta', 's3: iota kappa lambda mu'],
        B: ['s1: alpha beta gamma nu', 's2: xi zeta eta omicron', 's3: pi kappa lambda mu'],
      },
    );
    const ids = written(two)
      .join('')
      .match(/xml:id="[^"]+"/gu)!;
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(2);
  });
});
