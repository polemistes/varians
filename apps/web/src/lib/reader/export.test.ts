import { describe, expect, it } from 'vitest';
import {
  attachToSites,
  collate,
  exportEditionTei,
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
