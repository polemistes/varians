import { describe, expect, it } from 'vitest';
import {
  attachToSites,
  collate,
  collatePassages,
  exportEditionTei,
  siteSegments,
  units,
  type Item,
  type Stream,
} from '@varians/core';
import { DEFAULT_SIGLA } from './marks';
import { plainText, segmentItems, teiSegments, type ExportSegment } from './export';

/** Two verse segments; the second is printed in two places (a transposed half line) and has a supplement. */
const content: Stream = {
  items: [
    { kind: 'token', id: 'e1', form: 'μῆνιν', segment: { segmentId: 's1' } },
    { kind: 'token', id: 'e2', form: 'ἄειδε' },
    { kind: 'token', id: 'e3', form: 'θεὰ' },
    { kind: 'break', id: 'b1', type: 'line' },
    { kind: 'token', id: 'e4', form: 'οὐλομένην', segment: { segmentId: 's2' } },
    { kind: 'token', id: 'e5', form: 'ἣ', marks: [{ kind: 'supplied' }] },
    { kind: 'break', id: 'b2', type: 'line' },
    { kind: 'token', id: 'e6', form: 'μυρί᾽' },
  ] satisfies Item[],
};

function segmentOf(segmentId: string, label: string, witnessWords: string): ExportSegment {
  const runs = segmentItems(content).find((s) => s.segmentId === segmentId)!;
  const stream: Stream = { items: runs.items };
  const baseUnits = units(stream, 0, stream.items.length);
  const witness = witnessWords
    .split(' ')
    .map((w, i) => ({ text: w, tokenIds: [`${segmentId}w${i}`] }));
  const collation = collate({ id: 'ed', siglum: 'ed.', units: baseUnits }, [
    { id: 'A', siglum: 'A', units: witness },
  ]);
  const attached = attachToSites(
    collation,
    baseUnits,
    segmentId === 's1'
      ? [{ id: 'c1', kind: 'conjecture', lemma: 'θεὰ', reading: 'θεά', name: 'Bentley' }]
      : [],
  );
  return {
    segmentId,
    label,
    segments: [{ segmentId, from: 0, to: baseUnits.length, printed: true }],
    siteSegments: Object.fromEntries(attached.collation.sites.map((s) => [s.index, [segmentId]])),
    collation: attached.collation,
    baseUnits,
    attachments: attached.bySite,
    notes: segmentId === 's2' ? [{ text: 'A note.', author: 'Editor' }] : [],
  };
}

const segments = {
  s1: segmentOf('s1', '1.1', 'μῆνιν ἄειδε θεὰ'),
  s2: segmentOf('s2', '1.2', 'οὐλομένην ἣ μυρία'),
};

describe('plainText', () => {
  it('prints each segment with its label, its continuation indented, its apparatus and notes beneath', () => {
    const text = plainText({
      heading: ['Homer, Iliad', 'Iliad 1', 'Version 1, published 2026-10-02'],
      content,
      segments,
      labelOf: { s1: '1.1', s2: '1.2' },
      conventions: { form: 'positive', latin: true, interpretative: 'separate' },
      siglaOrder: ['A'],
      sigla: DEFAULT_SIGLA,
      noteWord: 'Note',
      interpretativeWord: 'Interpretative',
    });
    expect(text).toBe(
      [
        'Homer, Iliad',
        'Iliad 1',
        'Version 1, published 2026-10-02',
        '',
        '1.1  μῆνιν ἄειδε θεὰ',
        '    Interpretative: 1.1 θεὰ A : θεά Bentley (coni.)',
        '1.2  οὐλομένην ⟨ἣ⟩',
        '     μυρί᾽',
        '    1.2 μυρί᾽ : μυρία A',
        '    Note: A note. (Editor)',
        '',
      ].join('\n'),
    );
  });
});

describe('plainText, divided words and prose', () => {
  /** Two segments: a word divided by the end of a line, then a paragraph of prose with a word divided by a line break. */
  const stream: Stream = {
    items: [
      { kind: 'token', id: 'a1', form: 'ἀνα', joinNext: true, segment: { segmentId: 's1' } },
      { kind: 'break', id: 'b1', type: 'line' },
      { kind: 'token', id: 'a2', form: 'στασις' },
      { kind: 'token', id: 'a3', form: 'δε' },
      { kind: 'break', id: 'b2', type: 'paragraph' },
      { kind: 'token', id: 'a4', form: 'μῆ', joinNext: true, segment: { segmentId: 's2' } },
      { kind: 'break', id: 'b3', type: 'line' },
      { kind: 'token', id: 'a5', form: 'νιν' },
      { kind: 'break', id: 'b4', type: 'line' },
      { kind: 'token', id: 'a6', form: 'ἄειδε' },
    ] satisfies Item[],
  };
  const input = (lineation?: 'verse' | 'prose') => ({
    heading: [],
    content: stream,
    segments: {},
    labelOf: { s1: '1', s2: '2' },
    conventions: { form: 'positive' as const, latin: true, interpretative: 'separate' as const },
    siglaOrder: [],
    sigla: DEFAULT_SIGLA,
    noteWord: 'Note',
    interpretativeWord: 'Interpretative',
    ...(lineation ? { lineation } : {}),
  });

  it('writes the hyphen where a shown line ends, and runs the lines of a prose paragraph on', () => {
    expect(plainText(input('verse'))).toBe(
      ['1  ἀνα-', '   στασις δε', '2  μῆ-', '   νιν', '   ἄειδε', ''].join('\n'),
    );
    expect(plainText(input('prose'))).toBe(['1  ἀναστασις δε', '2  μῆνιν ἄειδε', ''].join('\n'));
    // A paragraph marked as prose is prose where the edition's convention is verse.
    stream.items[4] = { kind: 'break', id: 'b2', type: 'paragraph', lineation: 'prose' };
    expect(plainText(input())).toBe(['1  ἀνα-', '   στασις δε', '2  μῆνιν ἄειδε', ''].join('\n'));
  });
});

describe('teiSegments', () => {
  it('gives the TEI exporter each segment with its units, sites and attachments', () => {
    const out = teiSegments(content, segments, {});
    expect(out.map((s) => s.label)).toEqual(['1.1', '1.2']);
    expect(out[0]!.items.map((i) => i.id)).toEqual(['e1', 'e2', 'e3', 'b1']);
    expect(Object.keys(out[0]!.attachments ?? {})).toHaveLength(1);
    const tei = exportEditionTei({
      title: 'Iliad 1',
      baseSiglum: 'ed.',
      witnesses: [{ siglum: 'A' }],
      segments: out,
    });
    expect(tei).toContain('<rdg type="conjecture" resp="Bentley">θεά</rdg>');
    expect(tei).toContain('<rdg wit="#wit-A">μυρία</rdg>');
  });
});

describe('segmentItems', () => {
  it('gives what opens a line before its first word to that line, not to the line above', () => {
    const stream: Stream = {
      items: [
        { kind: 'object', id: 'sp1', type: 'paratext', text: 'ΑΧΙΛΛΕΥΣ' },
        { kind: 'token', id: 'a1', form: 'μῆνιν', segment: { segmentId: 's1' } },
        { kind: 'break', id: 'b1', type: 'line' },
        { kind: 'object', id: 'sp2', type: 'paratext', text: 'ΑΓΑΜΕΜΝΩΝ' },
        { kind: 'token', id: 'a2', form: 'οὐλομένην', segment: { segmentId: 's2' } },
        { kind: 'break', id: 'b2', type: 'line' },
        { kind: 'object', id: 'end', type: 'paratext', text: 'τέλος' },
      ] satisfies Item[],
    };
    const ids = (segmentId: string) =>
      segmentItems(stream)
        .find((s) => s.segmentId === segmentId)!
        .items.map((i) => i.id);
    // Also at the very start of the text, before any segment begins.
    expect(ids('s1')).toEqual(['sp1', 'a1', 'b1']);
    // The speaker who opens the second line stands in it; what follows the last break stays with the last line.
    expect(ids('s2')).toEqual(['sp2', 'a2', 'b2', 'end']);
  });
});

describe('a variant across the boundary of two segments', () => {
  /** A stream from lines: `s1: a b`, a line that begins the segment s1; a word that ends in `-` is divided. */
  function lines(prefix: string, ...rows: string[]): Stream {
    const items: Item[] = [];
    let n = 0;
    rows.forEach((row, k) => {
      if (k > 0) items.push({ kind: 'break', id: `${prefix}l${k}`, type: 'line' });
      const [segmentId, words] = row.split(':') as [string, string];
      words
        .split(/\s+/u)
        .filter(Boolean)
        .forEach((word, w) => {
          const joins = word.endsWith('-');
          items.push({
            kind: 'token',
            id: `${prefix}${++n}`,
            form: joins ? word.slice(0, -1) : word,
            ...(joins ? { joinNext: true } : {}),
            ...(w === 0 && segmentId.trim() ? { segment: { segmentId: segmentId.trim() } } : {}),
          });
        });
    });
    return { items };
  }

  /** The edition and its witnesses collated in passages, as the server gives them to the exporters. */
  function crossing(
    texts: Record<string, string[]>,
    edition = ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta'],
  ) {
    const stream = lines('E', ...edition);
    const { passages } = collatePassages(
      { id: 'E', siglum: 'ed.', stream },
      Object.entries(texts).map(([siglum, rows]) => ({
        id: siglum,
        siglum,
        stream: lines(siglum, ...rows),
      })),
    );
    const labelOf = Object.fromEntries(
      passages.flatMap((p) => p.segments.map((s) => [s.segmentId, `1.${s.segmentId.slice(1)}`])),
    );
    const exported = Object.fromEntries(
      passages.map((p): [string, ExportSegment] => [
        p.segments[0]!.segmentId,
        {
          segmentId: p.segments[0]!.segmentId,
          label: labelOf[p.segments[0]!.segmentId]!,
          segments: p.segments,
          siteSegments: Object.fromEntries(
            p.collation.sites.map((s) => [s.index, siteSegments(s, p.base.units)]),
          ),
          collation: p.collation,
          baseUnits: p.base.units,
          attachments: {},
        },
      ]),
    );
    return { stream, labelOf, exported, passages };
  }

  it('writes the variant in a part in each segment, each true of its own segment', () => {
    const { stream, labelOf, exported, passages } = crossing({
      A: ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta'],
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    expect(passages.map((p) => p.segments.length)).toEqual([2]);
    const tei = exportEditionTei({
      title: 'Crossing',
      baseSiglum: 'ed.',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      segments: teiSegments(stream, exported, labelOf),
    });
    const abs = tei.match(/<ab [^>]*>.*<\/ab>/gu)!;
    expect(abs).toHaveLength(2);
    // Each segment says what its own witnesses have: B's second word is not in the first segment, nor the edition's in B's.
    expect(abs[0]).toMatch(
      /^<ab n="1.1">alpha beta gamma <app xml:id="([^"]+)" next="#[^"]+"><lem wit="#wit-A">delta<\/lem><rdg wit="#wit-B">kappa<\/rdg><\/app><lb\/><\/ab>$/u,
    );
    expect(abs[1]).toMatch(
      /^<ab n="1.2"><app xml:id="([^"]+)" prev="#[^"]+"><lem wit="#wit-A">epsilon<\/lem><rdg wit="#wit-B">lambda<\/rdg><\/app> zeta eta theta<\/ab>$/u,
    );
  });

  it('writes a variant at a point whose words lie in two segments in a part at the end of the one and the start of the other', () => {
    const { stream, labelOf, exported } = crossing(
      {
        A: ['s1: alpha beta', 's2: gamma delta'],
        B: ['s1: alpha beta kappa', 's2: lambda gamma delta'],
      },
      ['s1: alpha beta', 's2: gamma delta'],
    );
    const tei = exportEditionTei({
      title: 'Point',
      baseSiglum: 'ed.',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      segments: teiSegments(stream, exported, labelOf),
    });
    const abs = tei.match(/<ab [^>]*>.*<\/ab>/gu)!;
    expect(abs[0]).toMatch(
      /^<ab n="1.1">alpha beta(?:<lb\/>)?<app xml:id="[^"]+" next="#[^"]+"><lem wit="#wit-A"\/><rdg wit="#wit-B">kappa<\/rdg><\/app><\/ab>$/u,
    );
    expect(abs[1]).toMatch(
      /^<ab n="1.2"><app xml:id="[^"]+" prev="#[^"]+"><lem wit="#wit-A"\/><rdg wit="#wit-B">lambda<\/rdg><\/app> gamma delta<\/ab>$/u,
    );
  });

  it('writes a variant over a word the edition divides across the two segments in a part in each, the rest of the word in the lemma of the second', () => {
    const edition = ['s1: alpha beta gam-', 's2: ma delta epsilon'];
    const { stream, labelOf, exported } = crossing(
      {
        A: edition,
        B: ['s1: alpha beta kappa', 's2: delta epsilon'],
      },
      edition,
    );
    const tei = exportEditionTei({
      title: 'Divided',
      baseSiglum: 'ed.',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      segments: teiSegments(stream, exported, labelOf),
    });
    const abs = tei.match(/<ab [^>]*>.*<\/ab>/gu)!;
    expect(abs[0]).toMatch(
      /^<ab n="1.1">alpha beta <app xml:id="[^"]+" next="#[^"]+"><lem wit="#wit-A">gam<\/lem><rdg wit="#wit-B">kappa<\/rdg><\/app><lb\/><\/ab>$/u,
    );
    expect(abs[1]).toMatch(
      /^<ab n="1.2"><app xml:id="[^"]+" prev="#[^"]+"><lem wit="#wit-A">ma<\/lem><rdg wit="#wit-B"\/><\/app> delta epsilon<\/ab>$/u,
    );
  });

  it('leaves the plain text as it was: the whole variant once, under the segment it begins in, labelled by both', () => {
    const { stream, labelOf, exported } = crossing({
      A: ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta'],
      B: ['s1: alpha beta gamma kappa', 's2: lambda zeta eta theta'],
    });
    const text = plainText({
      heading: [],
      content: stream,
      segments: exported,
      labelOf,
      conventions: { form: 'positive', latin: true, interpretative: 'separate' },
      siglaOrder: ['A', 'B'],
      sigla: DEFAULT_SIGLA,
      noteWord: 'Note',
      interpretativeWord: 'Interpretative',
    });
    expect(text).toBe(
      [
        '1.1  alpha beta gamma delta',
        '    1.1–1.2 delta epsilon A : kappa lambda B',
        '1.2  epsilon zeta eta theta',
        '',
      ].join('\n'),
    );
  });

  it('writes a variant within one segment whole, with no name and no links', () => {
    const { stream, labelOf, exported } = crossing({
      A: ['s1: alpha beta gamma delta', 's2: epsilon zeta eta theta'],
      B: ['s1: alpha beta kappa delta', 's2: epsilon zeta eta theta'],
    });
    const tei = exportEditionTei({
      title: 'Within',
      baseSiglum: 'ed.',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      segments: teiSegments(stream, exported, labelOf),
    });
    expect(tei).toContain(
      '<ab n="1.1">alpha beta <app><lem wit="#wit-A">gamma</lem><rdg wit="#wit-B">kappa</rdg></app> delta<lb/></ab>',
    );
    expect(tei).not.toContain('xml:id="app');
  });

  it('gives a segment the edition does not print as words a witness has after the segment before it', () => {
    const { stream, labelOf, exported } = crossing(
      {
        A: ['s1: alpha beta', 's2: gamma delta', 's3: epsilon zeta'],
        B: ['s1: alpha beta', 's3: epsilon zeta'],
      },
      ['s1: alpha beta', 's3: epsilon zeta'],
    );
    const tei = exportEditionTei({
      title: 'Not printed',
      baseSiglum: 'ed.',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      segments: teiSegments(stream, exported, labelOf),
    });
    // In the TEI: a reading at the end of the printed segment before it, the edition's side empty.
    expect(tei.match(/<ab [^>]*>.*<\/ab>/gu)).toEqual([
      '<ab n="1.1">alpha beta<lb/><app><lem wit="#wit-B"/><rdg wit="#wit-A">gamma delta</rdg></app></ab>',
      '<ab n="1.3">epsilon zeta</ab>',
    ]);
    // In the print apparatus: words added, under the label of the segment they are.
    const text = plainText({
      heading: [],
      content: stream,
      segments: exported,
      labelOf,
      conventions: { form: 'positive', latin: true, interpretative: 'separate' },
      siglaOrder: ['A', 'B'],
      sigla: DEFAULT_SIGLA,
      noteWord: 'Note',
      interpretativeWord: 'Interpretative',
    });
    expect(text).toBe(
      ['1.1  alpha beta', '    1.2 B : gamma delta add. A', '1.3  epsilon zeta', ''].join('\n'),
    );
  });
});
