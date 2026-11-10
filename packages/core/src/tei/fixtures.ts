/**
 * Streams and export inputs shared by the TEI tests: the round trip, the
 * export tests and the validation against the RelaxNG schema of the ODD
 * (docs/formats/varians.rng). Not exported from the package.
 */

import type { Attachment } from '../apparatus/render.ts';
import { collate, type CollationText } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import type { Mark, Stream } from '../stream/items.ts';
import { fromText } from '../stream/text.ts';
import { units } from '../stream/words.ts';
import type { EditionExport, EditionSegmentExport } from './apparatus.ts';
import type { ExportPage, ExportZone, TranscriptionExport } from './export.ts';

/** A short transcription with a witness described in full, a page with its image and two zones, and a segment label. */
export function exportInput(): TranscriptionExport & { pages: ExportPage[]; zones: ExportZone[] } {
  return {
    stream: {
      items: [
        { kind: 'break', id: 'b1', type: 'page', pageId: 'p1' },
        {
          kind: 'token',
          id: 't1',
          form: 'ΚΣ',
          marks: [{ kind: 'abbr', attrs: { expan: 'Κύριος' } }],
          segment: { segmentId: 's1' },
        },
        { kind: 'token', id: 't2', form: 'ἄνδ', joinNext: true },
        { kind: 'break', id: 'b2', type: 'line' },
        {
          kind: 'token',
          id: 't3',
          form: 'ρα',
          marks: [{ kind: 'supplied', attrs: { reason: 'lost' }, from: 0, to: 1 }],
        },
        {
          kind: 'object',
          id: 'o1',
          type: 'gap',
          attrs: { reason: 'lost', quantity: 3, unit: 'character' },
        },
        { kind: 'token', id: 't4', form: 'a&b<c', norm: 'abc', segment: { segmentId: 's2' } },
      ],
    },
    title: 'Test & trial',
    language: 'grc',
    witness: {
      siglum: 'A',
      name: 'Venetus A',
      settlement: 'Venice',
      repository: 'Marciana',
      idno: 'Gr. Z. 454',
      date: '10th c.',
      material: 'parchment',
      extent: '327 ff.',
      hands: [{ id: 'h1', label: 'm1', description: 'one hand', main: true }],
      description: 'Iliad',
      form: 'codex',
    },
    pages: [
      {
        id: 'p1',
        label: '12r',
        imageUrl: 'https://images.example/12r.jpg',
        width: 2000,
        height: 3000,
      },
    ],
    zones: [
      {
        id: 'z1',
        pageId: 'p1',
        tokenIds: ['t1'],
        geometry: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } },
      },
      {
        id: 'z2',
        pageId: 'p1',
        tokenIds: ['t2', 't3'],
        geometry: {
          polygon: [
            [0.1, 0.2],
            [0.3, 0.2],
            [0.3, 0.25],
          ],
        },
      },
    ],
    segmentLabels: { s1: '1.1' },
  };
}

/** A transcription with pages, columns, paragraphs, every kind of mark, gaps, a joined word and segment starts. Ids are a1, a2, … */
export function richStream(): Stream {
  const id = sequentialIds('a');
  return {
    items: [
      { kind: 'break', id: id(), type: 'page', pageId: 'p1' },
      { kind: 'object', id: id(), type: 'paratext', attrs: { type: 'head' }, text: 'Ἰλιάδος Α' },
      {
        kind: 'token',
        id: id(),
        form: 'ΜΗΝΗΝ',
        norm: 'μῆνιν',
        segment: { segmentId: 's1' },
        marks: [{ kind: 'unclear' }],
      },
      {
        kind: 'token',
        id: id(),
        form: 'ΑΕΙΔΕ',
        marks: [{ kind: 'supplied', attrs: { reason: 'lost' }, from: 0, to: 2 }],
      },
      { kind: 'token', id: id(), form: 'ΘΑ', marks: [{ kind: 'abbr', attrs: { expan: 'ΘΕΑ' } }] },
      { kind: 'break', id: id(), type: 'line' },
      {
        kind: 'token',
        id: id(),
        form: 'ΠΗΛΗΙ',
        marks: [
          { kind: 'del', attrs: { rend: 'strikethrough' } },
          { kind: 'hi', attrs: { rend: 'rubric' }, from: 0, to: 1 },
        ],
      },
      {
        kind: 'token',
        id: id(),
        form: 'ΠΗΛΗΙΑ',
        joinNext: true,
        marks: [{ kind: 'add', attrs: { place: 'above' } }],
      },
      { kind: 'break', id: id(), type: 'line' },
      { kind: 'token', id: id(), form: 'ΔΕΩ', marks: [{ kind: 'add', attrs: { place: 'above' } }] },
      {
        kind: 'object',
        id: id(),
        type: 'gap',
        attrs: { reason: 'lost', quantity: 3, unit: 'character' },
      },
      {
        kind: 'token',
        id: id(),
        form: 'ΑΧΙ',
        segment: { segmentId: 's2' },
        marks: [
          { kind: 'handShift', attrs: { new: '#h2' } },
          {
            kind: 'gap',
            attrs: { reason: 'illegible', quantity: 1, unit: 'character' },
            from: 2,
            to: 2,
          },
        ],
      },
      {
        kind: 'token',
        id: id(),
        form: 'θεος,',
        marks: [{ kind: 'corr', attrs: { corr: 'θεὸς' }, from: 0, to: 4 }],
      },
      { kind: 'object', id: id(), type: 'note', attrs: { place: 'margin' }, text: 'σχόλιον' },
      { kind: 'break', id: id(), type: 'column', label: 'b' },
      {
        kind: 'token',
        id: id(),
        form: 'abcde',
        marks: [
          { kind: 'unclear', from: 0, to: 3 },
          { kind: 'damage', attrs: { agent: 'water' }, from: 2, to: 5 },
        ],
      },
      { kind: 'object', id: id(), type: 'space', attrs: { quantity: 2, unit: 'character' } },
      { kind: 'object', id: id(), type: 'figure', text: 'a drawing' },
      { kind: 'break', id: id(), type: 'paragraph' },
      {
        kind: 'token',
        id: id(),
        form: 'a&b',
        segment: { segmentId: null },
        marks: [{ kind: 'sic' }, { kind: 'surplus', from: 1, to: 2 }],
      },
      { kind: 'token', id: id(), form: 'ΚΑΓΩ', norm: 'καὶ ἐγώ' },
    ],
  };
}

export const richPages: ExportPage[] = [
  { id: 'p1', label: '12r', imageUrl: 'https://images.example/12r.jpg', width: 2000, height: 3000 },
];
export const richZones: ExportZone[] = [
  {
    id: 'z1',
    pageId: 'p1',
    tokenIds: ['a3', 'a4'],
    geometry: { rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 } },
  },
];
export const richSegmentLabels: Record<string, string> = { s1: '1.1', s2: '1.2' };

/** A variant noted in the carrier, as the mark every token of its span carries. */
export function variant(group: string, reading: string, place: string, hand?: string): Mark {
  return {
    kind: 'variant',
    attrs: hand === undefined ? { group, reading, place } : { group, reading, place, hand },
  };
}

/** Three variants noted in the carrier: one over three words across a line, an omission, a single word. */
export function variantStream(): Stream {
  const ids = sequentialIds('v');
  return {
    items: [
      { kind: 'token', id: ids(), form: 'μῆνιν' },
      {
        kind: 'token',
        id: ids(),
        form: 'ἄειδε',
        marks: [variant('g1', 'ἔννεπε μοι', 'margin', 'm2')],
      },
      {
        kind: 'token',
        id: ids(),
        form: 'θεὰ',
        marks: [{ kind: 'unclear' }, variant('g1', 'ἔννεπε μοι', 'margin', 'm2')],
      },
      { kind: 'break', id: ids(), type: 'line' },
      {
        kind: 'token',
        id: ids(),
        form: 'Πηληϊάδεω',
        marks: [variant('g1', 'ἔννεπε μοι', 'margin', 'm2')],
      },
      { kind: 'token', id: ids(), form: 'Ἀχιλῆος', marks: [variant('g2', '', 'interlinear')] },
      { kind: 'token', id: ids(), form: 'οὐλομένην', marks: [variant('g3', 'οὐλομένη', 'other')] },
    ],
  };
}

/** A witness text for collation, made from plain words. */
export function collationText(id: string, siglum: string, words: string): CollationText {
  const s = fromText(words, { ids: sequentialIds(id) });
  return { id, siglum, units: units(s, 0, s.items.length) };
}

/** One segment of an edition collated against witnesses given as plain words, with attachments by site index. */
export function editionSegment(
  label: string,
  text: string,
  witnesses: CollationText[],
  attachments?: Record<number, Attachment[]>,
): EditionSegmentExport {
  const edition = fromText(text, { ids: sequentialIds(`e${label}-`) });
  const baseUnits = units(edition, 0, edition.items.length);
  const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, witnesses);
  return {
    label,
    items: edition.items,
    baseUnits,
    sites: c.sites,
    ...(attachments ? { attachments } : {}),
  };
}

/** An edition with substitution, omission, addition, a conjecture, an adopted conjecture, a witness that has lost a word and a reported reading. */
export function editionInput(): EditionExport {
  const lacunose = fromText('a c', { ids: sequentialIds('p') });
  lacunose.items.splice(1, 0, { kind: 'object', id: 'g', type: 'gap', attrs: { reason: 'lost' } });
  return {
    title: 'Test edition',
    editors: ['Someone'],
    language: 'en',
    baseSiglum: 'ed.',
    witnesses: [
      { siglum: 'A', name: 'Codex A' },
      { siglum: 'B', name: 'Codex B' },
      { siglum: 'C' },
      { siglum: 'P' },
    ],
    segments: [
      editionSegment(
        '1.1',
        'the quick brown fox\njumps',
        [
          collationText('A', 'A', 'the quick brown fox jumps'),
          collationText('B', 'B', 'the slow fox jumps'),
          collationText('C', 'C', 'the quick brown red fox jumps'),
        ],
        {
          0: [
            {
              kind: 'conjecture',
              id: 'c1',
              text: 'swift',
              name: 'Bentley',
              conjectureKind: 'substitution',
            },
            { kind: 'reported', id: 'r1', text: 'quick', name: 'D', source: 'teste Allen' },
          ],
        },
      ),
      editionSegment(
        '1.2',
        'a b c',
        [
          collationText('A', 'A', 'a x c'),
          { id: 'P', siglum: 'P', units: units(lacunose, 0, lacunose.items.length) },
        ],
        {
          0: [
            {
              kind: 'conjecture',
              id: 'c2',
              text: 'b',
              name: 'M. L. West',
              adopted: true,
              conjectureKind: 'substitution',
              source: '(Ath. 1.12e)',
            },
          ],
        },
      ),
    ],
  };
}
