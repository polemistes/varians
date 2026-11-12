import { describe, expect, it } from 'vitest';
import { applySiteKinds, collate, siteKey, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import type { Token } from '../stream/items.ts';
import { fromText } from '../stream/text.ts';
import { units } from '../stream/words.ts';
import { exportEditionTei } from './apparatus.ts';
import { collatedLines, passageText, type CollatedLines } from './fixtures.ts';

/** The start of a segment, as the text of an edition has it. */
const M = (label: string) => `<milestone unit="segment" n="${label}"/>`;

function text(id: string, siglum: string, words: string): CollationText {
  const s = fromText(words, { lang: 'grc', ids: sequentialIds(id) });
  return { id, siglum, units: units(s, 0, s.items.length) };
}

describe('exportEditionTei', () => {
  it('writes the text with app, lem and rdg for substitution, omission, addition and lacuna', () => {
    const edition = fromText('the quick brown fox\njumps', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('A', 'A', 'the quick brown fox jumps'),
      text('B', 'B', 'the slow fox jumps'),
      text('C', 'C', 'the quick brown red fox jumps'),
    ]);
    const xml = exportEditionTei({
      title: 'Test edition',
      editors: ['Someone'],
      baseSiglum: 'ed.',
      witnesses: [
        { siglum: 'A', name: 'Codex A' },
        { siglum: 'B', name: 'Codex B' },
        { siglum: 'C' },
      ],
      runs: [{ label: '1.1', items: edition.items }],
      passages: [
        {
          baseUnits,
          sites: c.sites,
          attachments: {
            0: [
              {
                kind: 'conjecture',
                id: 'c1',
                text: 'swift',
                name: 'Bentley',
                conjectureKind: 'substitution',
              },
            ],
          },
        },
      ],
    });
    expect(xml).toContain('<witness xml:id="wit-A" n="A">Codex A</witness>');
    // Who proposed the conjecture is listed in the header, and the reading points there.
    expect(xml).toContain(
      [
        '        <listBibl>',
        '          <head>Scholars and sources named in the apparatus</head>',
        '          <bibl><author xml:id="resp-Bentley">Bentley</author></bibl>',
        '        </listBibl>',
      ].join('\n'),
    );
    expect(xml).toContain(
      `${M('1.1')}the <app><lem wit="#wit-A #wit-C">quick brown</lem><rdg wit="#wit-B">slow</rdg><rdg type="conjecture" resp="#resp-Bentley">swift</rdg></app> <app><lem wit="#wit-A #wit-B"/><rdg wit="#wit-C">red</rdg></app> fox<lb/>jumps\n        </ab>`,
    );
  });

  it('writes a word that a line break divides with the break inside it, said not to end the word, and a paragraph break typed by its kind', () => {
    const edition = fromText('ἀνα στασις δε μῦθος', { lang: 'grc', ids: sequentialIds('e') });
    (edition.items[0] as Token).joinNext = true;
    edition.items.splice(1, 0, { kind: 'break', id: 'b1', type: 'line' });
    // A paragraph, and one marked as prose; one of the edition's own kind.
    edition.items.splice(4, 0, { kind: 'break', id: 'b2', type: 'paragraph', lineation: 'prose' });
    edition.items.push({ kind: 'break', id: 'b3', type: 'paragraph' });
    const baseUnits = units(edition, 0, edition.items.length);
    const xml = exportEditionTei({
      title: 'Test edition',
      witnesses: [],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: [] }],
    });
    expect(xml).toContain(
      `${M('1')}ἀνα<lb break="no"/>στασις δε<lb/><lb type="prose"/>μῦθος<lb/><lb/>\n        </ab>`,
    );
  });

  it('writes a lemma over a word that a line break divides with the break inside it, as text outside a variant is written', () => {
    const edition = fromText('the won der grows', { lang: 'en', ids: sequentialIds('e') });
    (edition.items[1] as Token).joinNext = true;
    edition.items.splice(2, 0, { kind: 'break', id: 'b1', type: 'line' });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('B', 'B', 'the wander grows'),
    ]);
    expect(c.sites).toHaveLength(1);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'B' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: c.sites }],
    });
    expect(xml).toContain(
      `${M('1')}the <app><lem>won<lb break="no"/>der</lem><rdg wit="#wit-B">wander</rdg></app> grows\n        </ab>`,
    );
  });

  it('writes a lemma of two words with a line break between them with the break inside it', () => {
    const edition = fromText('alpha beta gamma', { lang: 'en', ids: sequentialIds('e') });
    edition.items.splice(1, 0, { kind: 'break', id: 'b1', type: 'line' });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('B', 'B', 'kappa lambda gamma'),
    ]);
    expect(c.sites).toHaveLength(1);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'B' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: c.sites }],
    });
    expect(xml).toContain(
      `${M('1')}<app><lem>alpha<lb/>beta</lem><rdg wit="#wit-B">kappa lambda</rdg></app> gamma\n        </ab>`,
    );
  });

  it('writes words joined without a break between them as one', () => {
    const edition = fromText('ἀνα στασις δε', { lang: 'grc', ids: sequentialIds('e') });
    (edition.items[0] as Token).joinNext = true;
    const baseUnits = units(edition, 0, edition.items.length);
    const xml = exportEditionTei({
      title: 'Test edition',
      witnesses: [],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: [] }],
    });
    expect(xml).toContain(`${M('1')}ἀναστασις δε\n        </ab>`);
  });

  it('marks an adopted conjecture on the lemma and names a witness that has lost the words nowhere', () => {
    const edition = fromText('a b c', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const lacunose = fromText('a c', { lang: 'en', ids: sequentialIds('p') });
    lacunose.items.splice(1, 0, {
      kind: 'object',
      id: 'g',
      type: 'gap',
      attrs: { reason: 'lost' },
    });
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('A', 'A', 'a x c'),
      { id: 'P', siglum: 'P', units: units(lacunose, 0, lacunose.items.length) },
    ]);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'P' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [
        {
          baseUnits,
          sites: c.sites,
          attachments: {
            0: [
              {
                kind: 'conjecture',
                id: 'c',
                text: 'b',
                name: 'Editor',
                adopted: true,
                conjectureKind: 'substitution',
              },
            ],
          },
        },
      ],
    });
    expect(xml).toContain('<bibl><author xml:id="resp-Editor">Editor</author></bibl>');
    expect(xml).toContain('<app><lem resp="#resp-Editor">b</lem><rdg wit="#wit-A">x</rdg></app>');
  });

  it('names the witness of a reported reading as a witness, listing one that the conspectus does not have, and points at the source stated', () => {
    const edition = fromText('a b c', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [text('A', 'A', 'a x c')]);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'T' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [
        {
          baseUnits,
          sites: c.sites,
          attachments: {
            0: [
              { kind: 'reported', id: 'r1', text: 'y', name: 'T', source: '(Allen)' },
              { kind: 'reported', id: 'r2', text: 'z', name: 'D' },
            ],
          },
        },
      ],
    });
    expect(xml).toContain(
      '<rdg wit="#wit-A">x</rdg><rdg type="reported" wit="#wit-T" source="#src-1">y</rdg><rdg type="reported" wit="#wit-D">z</rdg>',
    );
    expect(xml).toContain('<witness xml:id="wit-D" n="D">D</witness>');
    expect(xml).toContain('<bibl xml:id="src-1">Allen</bibl>');
  });

  it('points a conjecture of the edition itself at its editors, a conjecture with an address at its record, and two scholars whose names make one name at two', () => {
    const edition = fromText('a b c', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [text('A', 'A', 'a x c')]);
    const input = {
      title: 't',
      editors: ['First Editor', 'Second Editor'],
      witnesses: [{ siglum: 'A' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [
        {
          baseUnits,
          sites: c.sites,
          attachments: {
            0: [
              { kind: 'conjecture' as const, id: 'c1', text: 'y', name: 'this edition' },
              {
                kind: 'conjecture' as const,
                id: 'c2',
                text: 'z',
                name: 'West¹',
                source: '(Ath. 1.12e)',
              },
              {
                kind: 'conjecture' as const,
                id: 'c3',
                text: 'w',
                name: 'West²',
                source: 'Ath. 1.12e',
              },
            ],
          },
        },
      ],
    };
    const xml = exportEditionTei(input);
    expect(xml).toContain(
      '<editor xml:id="editor-1">First Editor</editor><editor xml:id="editor-2">Second Editor</editor>',
    );
    expect(xml).toContain(
      '<rdg type="conjecture" resp="#editor-1 #editor-2">y</rdg><rdg type="conjecture" resp="#resp-West_" source="#src-1">z</rdg><rdg type="conjecture" resp="#resp-West_-2" source="#src-1">w</rdg>',
    );
    expect(xml).toContain('<bibl><author xml:id="resp-West_-2">West²</author></bibl>');
    // The source stated twice, with brackets and without, is one source.
    expect(xml.match(/<bibl xml:id="src-/gu)).toHaveLength(1);
    expect(xml).not.toContain('this edition');
    // With the prefixes declared, a conjecture points at its record too.
    const archived = exportEditionTei({ ...input, origin: 'https://varians.example' });
    expect(archived).toContain(
      '<rdg type="conjecture" resp="#resp-West_" source="conj:c2 #src-1">z</rdg>',
    );
    // Without editors, a conjecture of the edition itself names nobody.
    expect(exportEditionTei({ ...input, editors: [] })).toContain('<rdg type="conjecture">y</rdg>');
  });

  it('types the places of the same letters read otherwise as interpretative', () => {
    const edition = fromText('ἦ μέγα', { lang: 'grc', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [text('A', 'A', 'ἢ μέγα')]);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: c.sites }],
    });
    expect(xml).toContain('<app type="interpretative"><lem>ἦ</lem><rdg wit="#wit-A">ἢ</rdg></app>');
  });

  it('writes a place the editor judges minor with its kind, the grade as a subtype of it', () => {
    const edition = fromText('red fox runs', { lang: 'en', ids: sequentialIds('e') });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      text('A', 'A', 'red dog runs'),
      text('B', 'B', 'red fox walks'),
    ]);
    const keyOf = (word: string) =>
      siteKey(c.sites.find((s) => s.readings.some((r) => r.text === word))!, baseUnits);
    const marked = applySiteKinds(
      c,
      baseUnits,
      new Map([
        [keyOf('dog'), { minor: true }],
        [keyOf('walks'), { minor: true, kind: 'interpretative' as const }],
      ]),
    );
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: marked.sites }],
    });
    expect(xml).toContain(
      '<app type="textual" subtype="minor"><lem wit="#wit-B">fox</lem><rdg wit="#wit-A">dog</rdg></app>',
    );
    expect(xml).toContain(
      '<app type="interpretative" subtype="minor"><lem wit="#wit-A">runs</lem><rdg wit="#wit-B">walks</rdg></app>',
    );
  });

  it('writes speakers, headings and marginal notes as typed labels, leaves out variants noted in a carrier, and has no empty witness list', () => {
    const edition = fromText('a b', { lang: 'en', ids: sequentialIds('e') });
    edition.items.unshift(
      { kind: 'object', id: 's', type: 'paratext', attrs: { type: 'speaker' }, text: 'ΧΟ.' },
      { kind: 'object', id: 'h', type: 'paratext', attrs: { type: 'head' }, text: 'Α' },
      { kind: 'object', id: 'm', type: 'paratext', attrs: { type: 'margin' }, text: '5' },
      { kind: 'object', id: 'st', type: 'paratext', attrs: { type: 'stage' }, text: 'exit' },
    );
    const last = edition.items[edition.items.length - 1]!;
    if (last.kind === 'token')
      last.marks = [{ kind: 'variant', attrs: { group: 'g', reading: 'c', place: 'margin' } }];
    const baseUnits = units(edition, 0, edition.items.length);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: [] }],
    });
    expect(xml).toContain(
      `${M('1')}<label type="speaker">ΧΟ.</label> <label type="head">Α</label> <label type="margin">5</label> <stage>exit</stage> a b\n        </ab>`,
    );
    expect(xml).not.toContain('<listWit>');
    expect(xml).toContain('<sourceDesc>\n        <p>Edition.</p>\n      </sourceDesc>');
  });
});

/** The text between the tags of the edition's block, the lines of the file run together. */
function block(xml: string): string {
  const from = xml.indexOf('<ab>') + 4;
  return xml.slice(from, xml.indexOf('</ab>')).replace(/\n\s*/gu, ' ').trim();
}

/** The same edition with a line break before each segment after the first, as a text in lines has. */
function inLines(collated: CollatedLines): CollatedLines {
  const items = collated.edition.items.flatMap((item, k) =>
    k > 0 && item.kind === 'token' && item.segment
      ? [{ kind: 'break' as const, id: `br${k}`, type: 'line' as const }, item]
      : [item],
  );
  return { ...collated, edition: { items } };
}

function tei(
  collated: CollatedLines,
  sigla: string[],
  options: Parameters<typeof passageText>[1] = {},
): string {
  return block(
    exportEditionTei({
      title: 't',
      baseSiglum: 'ed.',
      witnesses: sigla.map((siglum) => ({ siglum })),
      ...passageText(collated, options),
    }),
  );
}

describe('the text of an edition in TEI, its segments begun by milestones', () => {
  it('declares in the header that the text is cited by milestones and that the apparatus is by parallel segmentation', () => {
    const xml = exportEditionTei({ title: 't', witnesses: [], runs: [], passages: [] });
    expect(xml).toContain(
      '<encodingDesc><refsDecl><refState unit="segment"/></refsDecl><variantEncoding method="parallel-segmentation" location="internal"/></encodingDesc>',
    );
    expect(xml).toContain('<div type="edition">\n        <ab></ab>\n      </div>');
  });

  it('begins each segment on a line of the file, with its id and URN where it first begins', () => {
    const edition = fromText('alpha beta gamma', { lang: 'en', ids: sequentialIds('e') });
    const [a, b, c] = edition.items as Token[];
    const xml = exportEditionTei({
      title: 't',
      witnesses: [],
      runs: [
        { items: [{ kind: 'break', id: 'p', type: 'paragraph', lineation: 'prose' }] },
        { label: '1.1', id: 'S1', urn: 'urn:cts:x:1.1', items: [a!] },
        { label: '1.2', id: 'S2', items: [b!] },
        { label: '1.1', id: 'S1', urn: 'urn:cts:x:1.1', items: [c!] },
      ],
      passages: [],
    });
    expect(xml).toContain(
      [
        '        <ab><lb/><lb type="prose"/>',
        '          <milestone unit="segment" n="1.1" xml:id="seg-S1" corresp="urn:cts:x:1.1"/>alpha',
        '          <milestone unit="segment" n="1.2" xml:id="seg-S2"/>beta',
        '          <milestone unit="segment" n="1.1"/>gamma',
        '        </ab>',
      ].join('\n'),
    );
  });

  it('writes a word divided across two segments as one word, the start of the second inside it', () => {
    const collated = collatedLines(['1: alpha gam-', '2: ma delta'], {
      A: ['1: alpha gam-', '2: ma delta'],
    });
    expect(tei(collated, ['A'])).toBe(
      `${M('1')}alpha gam<milestone unit="segment" n="2" break="no"/>ma delta`,
    );
    // In lines, the break and the start both stand inside the word.
    expect(tei(inLines(collated), ['A'])).toBe(
      `${M('1')}alpha gam<lb break="no"/><milestone unit="segment" n="2" break="no"/>ma delta`,
    );
    const words = exportEditionTei({
      title: 't',
      witnesses: [],
      words: true,
      ...passageText(collated),
    });
    expect(block(words)).toBe(
      `${M('1')}<w xml:id="w-E1">alpha</w> <w xml:id="w-E2" part="I">gam</w><milestone unit="segment" n="2" break="no"/><w xml:id="w-E3" part="F">ma</w> <w xml:id="w-E4">delta</w>`,
    );
  });

  it('writes a variant across a boundary as one variant, the start of the segment inside its lemma', () => {
    const collated = inLines(
      collatedLines(['1: alpha beta', '2: gamma delta'], {
        A: ['1: alpha beta', '2: gamma delta'],
        B: ['1: alpha kappa', '2: lambda delta'],
      }),
    );
    expect(tei(collated, ['A', 'B'])).toBe(
      `${M('1')}alpha <app><lem wit="#wit-A">beta<lb/>${M('2')}gamma</lem><rdg wit="#wit-B">kappa lambda</rdg></app> delta`,
    );
  });

  it('writes a variant over a word the segments divide with the start inside the word, in the lemma', () => {
    const collated = collatedLines(['1: alpha gam-', '2: ma delta'], {
      A: ['1: alpha gam-', '2: ma delta'],
      B: ['1: alpha kappa', '2: delta'],
    });
    expect(tei(collated, ['A', 'B'])).toBe(
      `${M('1')}alpha <app><lem wit="#wit-A">gam<milestone unit="segment" n="2" break="no"/>ma</lem><rdg wit="#wit-B">kappa</rdg></app> delta`,
    );
  });

  it('writes the variant of a witness without a whole segment around the variants inside the segment', () => {
    const collated = inLines(
      collatedLines(['1: alpha beta', '2: gamma delta epsilon', '3: zeta eta'], {
        A: ['1: alpha beta', '2: gamma delta epsilon', '3: zeta eta'],
        B: ['1: alpha beta', '2: gamma kappa epsilon', '3: zeta eta'],
        C: ['1: alpha beta', '3: zeta eta'],
      }),
    );
    expect(tei(collated, ['A', 'B', 'C'])).toBe(
      `${M('1')}alpha beta<lb/> ${M('2')}<app><lem wit="#wit-A #wit-B">gamma <app><lem wit="#wit-A">delta</lem><rdg wit="#wit-B">kappa</rdg></app> epsilon</lem><rdg wit="#wit-C"/></app><lb/> ${M('3')}zeta eta`,
    );
  });

  it('writes a segment the edition does not print between the two it prints, begun by its own milestone in the reading', () => {
    const collated = inLines(
      collatedLines(['1: alpha beta', '3: epsilon zeta'], {
        A: ['1: alpha beta', '2: gamma delta', '3: epsilon zeta'],
        B: ['1: alpha beta', '3: epsilon zeta'],
      }),
    );
    expect(tei(collated, ['A', 'B'])).toBe(
      `${M('1')}alpha beta<lb/><app><lem wit="#wit-B"/><rdg wit="#wit-A">${M('2')}gamma delta</rdg></app> ${M('3')}epsilon zeta`,
    );
  });

  it('puts words a witness adds at the end of a segment before the break that ends it, and words added at the start of one after its start', () => {
    const atEnd = inLines(
      collatedLines(['1: alpha beta', '2: gamma delta'], {
        A: ['1: alpha beta extra', '2: gamma delta'],
        B: ['1: alpha beta', '2: gamma delta'],
      }),
    );
    expect(tei(atEnd, ['A', 'B'])).toBe(
      `${M('1')}alpha beta <app><lem wit="#wit-B"/><rdg wit="#wit-A">extra</rdg></app><lb/> ${M('2')}gamma delta`,
    );
    const atStart = inLines(
      collatedLines(['1: alpha beta', '2: gamma delta'], {
        A: ['1: alpha beta', '2: more gamma delta'],
        B: ['1: alpha beta', '2: gamma delta'],
      }),
    );
    expect(tei(atStart, ['A', 'B'])).toBe(
      `${M('1')}alpha beta<lb/> ${M('2')}<app><lem wit="#wit-B"/><rdg wit="#wit-A">more</rdg></app> gamma delta`,
    );
  });

  it('writes a variant over a lacuna of the edition around the lacuna', () => {
    const collated = collatedLines(['1: alpha [] gamma'], { A: ['1: alpha beta gamma'] });
    expect(tei(collated, ['A'])).toBe(
      `${M('1')}alpha <app><lem><gap reason="lost"/></lem><rdg wit="#wit-A">beta</rdg></app> gamma`,
    );
  });

  it('writes the variant of a witness without a segment in pieces where another variant lies across its start', () => {
    // Made by hand: the collation divides a variant at the start of a segment that a witness is without.
    const collated = collatedLines(['1: alpha beta', '2: gamma delta'], {
      A: ['1: alpha beta', '2: gamma delta'],
      B: ['1: alpha kappa', '2: lambda delta'],
    });
    const [across] = collated.passage.collation.sites;
    expect(across).toMatchObject({ baseFrom: 1, baseTo: 3 });
    const reading = (sigla: string[], text: string, base = false) => ({
      text,
      fold: text,
      textIds: sigla,
      sigla,
      units: {},
      omission: text === '',
      lacunose: false,
      base,
    });
    const without = {
      index: 1,
      columnFrom: 2,
      columnTo: 4,
      baseFrom: 2,
      baseTo: 4,
      readings: [reading(['ed.', 'A', 'B'], 'gamma delta', true), reading(['C'], '')],
      kind: 'textual' as const,
      wanting: true,
    };
    const input = passageText(collated, {
      attachments: {
        1: [
          {
            kind: 'conjecture',
            id: 'c',
            text: 'omega',
            name: 'West',
            conjectureKind: 'substitution',
          },
        ],
      },
    });
    input.passages[0]!.sites.push(without);
    const xml = block(
      exportEditionTei({
        title: 't',
        baseSiglum: 'ed.',
        witnesses: ['A', 'B', 'C'].map((siglum) => ({ siglum })),
        ...input,
      }),
    );
    expect(xml).toBe(
      `${M('1')}alpha <app><lem wit="#wit-A">beta ${M('2')}<app xml:id="app-1-2-1" next="#app-1-2-2"><lem wit="#wit-A #wit-B">gamma</lem><rdg wit="#wit-C"/><rdg type="conjecture" resp="#resp-West">omega</rdg></app></lem><rdg wit="#wit-B">kappa lambda</rdg></app> <app xml:id="app-1-2-2" prev="#app-1-2-1"><lem wit="#wit-A #wit-B">delta</lem><rdg wit="#wit-C"/><rdg type="conjecture" resp="#resp-West"/></app>`,
    );
  });
});
