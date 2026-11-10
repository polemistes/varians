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
