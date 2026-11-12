/**
 * Streams and export inputs shared by the TEI tests: the round trip, the
 * export tests and the validation against the RelaxNG schema of the ODD
 * (docs/formats/varians.rng). Not exported from the package.
 */

import type { Attachment } from '../apparatus/render.ts';
import { collate, type CollationText, type Site } from '../collate/collate.ts';
import { collatePassages, type Passage } from '../collate/passage.ts';
import { sequentialIds } from '../ids.ts';
import type { Item, Mark, Stream } from '../stream/items.ts';
import { fromText } from '../stream/text.ts';
import { segmentRuns, units } from '../stream/words.ts';
import type { EditionExport, EditionPassageExport, EditionRunExport } from './apparatus.ts';
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
          lang: 'grc',
          form: 'ΚΣ',
          marks: [{ kind: 'abbr', attrs: { expan: 'Κύριος' } }],
          segment: { segmentId: 's1' },
        },
        { kind: 'token', id: 't2', lang: 'grc', form: 'ἄνδ', joinNext: true },
        { kind: 'break', id: 'b2', type: 'line' },
        {
          kind: 'token',
          id: 't3',
          lang: 'grc',
          form: 'ρα',
          marks: [{ kind: 'supplied', attrs: { reason: 'lost' }, from: 0, to: 1 }],
        },
        {
          kind: 'object',
          id: 'o1',
          type: 'gap',
          attrs: { reason: 'lost', quantity: 3, unit: 'character' },
        },
        {
          kind: 'token',
          id: 't4',
          lang: 'grc',
          form: 'a&b<c',
          norm: 'abc',
          segment: { segmentId: 's2' },
        },
      ],
    },
    title: 'Test & trial',
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
  return withLanguages({
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
  });
}

/** Every word in Greek but those in Latin letters, which are in Latin: a text in two languages. */
function withLanguages(stream: Stream): Stream {
  return {
    items: stream.items.map((item) => {
      if (item.kind !== 'token') return item;
      const { kind, id, ...rest } = item;
      return { kind, id, lang: /[a-z]/u.test(item.form) ? 'la' : 'grc', ...rest };
    }),
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
  const s = fromText(words, { lang: 'en', ids: sequentialIds(id) });
  return { id, siglum, units: units(s, 0, s.items.length) };
}

/** The text and the variants of an edition, as the exporter takes them. */
export type EditionText = Pick<EditionExport, 'runs' | 'passages'>;

/**
 * Segments of an edition, each collated by itself against witnesses given
 * as plain words, with attachments by site index: a run and a passage for each.
 */
export function editionSegments(
  ...segments: {
    label: string;
    text: string;
    witnesses: CollationText[];
    attachments?: Record<number, Attachment[]>;
  }[]
): EditionText {
  const runs: EditionRunExport[] = [];
  const passages: EditionPassageExport[] = [];
  for (const { label, text, witnesses, attachments } of segments) {
    const edition = fromText(text, { lang: 'en', ids: sequentialIds(`e${label}-`) });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, witnesses);
    runs.push({ label, items: edition.items });
    passages.push({ baseUnits, sites: c.sites, ...(attachments ? { attachments } : {}) });
  }
  return { runs, passages };
}

/** An edition with substitution, omission, addition, a conjecture, an adopted conjecture, a witness that has lost a word and a reported reading. */
export function editionInput(): EditionExport {
  const lacunose = fromText('a c', { lang: 'en', ids: sequentialIds('p') });
  lacunose.items.splice(1, 0, { kind: 'object', id: 'g', type: 'gap', attrs: { reason: 'lost' } });
  return {
    title: 'Test edition',
    editors: ['Someone'],
    baseSiglum: 'ed.',
    witnesses: [
      { siglum: 'A', name: 'Codex A' },
      { siglum: 'B', name: 'Codex B' },
      { siglum: 'C' },
      { siglum: 'P' },
    ],
    ...editionSegments(
      {
        label: '1.1',
        text: 'the quick brown fox\njumps',
        witnesses: [
          collationText('A', 'A', 'the quick brown fox jumps'),
          collationText('B', 'B', 'the slow fox jumps'),
          collationText('C', 'C', 'the quick brown red fox jumps'),
        ],
        attachments: {
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
      },
      {
        label: '1.2',
        text: 'a b c',
        witnesses: [
          collationText('A', 'A', 'a x c'),
          { id: 'P', siglum: 'P', units: units(lacunose, 0, lacunose.items.length) },
        ],
        attachments: {
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
      },
    ),
  };
}

/**
 * A stream from lines: `s1: a b`, a line that begins the segment s1; `: c`,
 * one that goes on in the segment before; `[]` is a gap, the words lost; a
 * word that ends in `-` is divided, its next part beginning the next line.
 */
export function linesStream(prefix: string, ...lines: string[]): Stream {
  const items: Item[] = [];
  let n = 0;
  for (const line of lines) {
    const [label, text] = line.split(':') as [string, string];
    let starts = label.trim();
    for (const word of text.split(/\s+/u).filter(Boolean)) {
      const id = `${prefix}${++n}`;
      if (word === '[]') items.push({ kind: 'object', id, type: 'gap', attrs: { reason: 'lost' } });
      else {
        const joins = word.endsWith('-');
        items.push({
          kind: 'token',
          id,
          form: joins ? word.slice(0, -1) : word,
          ...(joins ? { joinNext: true } : {}),
          ...(starts ? { segment: { segmentId: starts } } : {}),
        });
        starts = '';
      }
    }
  }
  return { items };
}

/** A passage of an edition collated, and the edition's stream. */
export interface CollatedLines {
  passage: Passage;
  edition: Stream;
}

/** The edition and its witnesses given as lines, collated in passages; the passage looked at is the first unless another is asked for. */
export function collatedLines(
  edition: string[],
  texts: Record<string, string[]>,
  passageAt = 0,
): CollatedLines {
  const stream = linesStream('E', ...edition);
  const { passages } = collatePassages(
    { id: 'E', siglum: 'ed.', stream },
    Object.entries(texts).map(([siglum, rows]) => ({
      id: siglum,
      siglum,
      stream: linesStream(siglum, ...rows),
    })),
  );
  return { passage: passages[passageAt]!, edition: stream };
}

/**
 * The text of an edition collated in a passage, as the exporter is given
 * it: the runs of its segments in the order of the text, labelled by their
 * ids, and the passage with its segments, those the edition does not print
 * labelled too.
 */
export function passageText(
  { passage, edition }: CollatedLines,
  options: { attachments?: Record<number, Attachment[]>; mark?: (site: Site) => Site } = {},
): EditionText {
  const runs: EditionRunExport[] = segmentRuns(edition)
    .filter((run) => run.segmentId !== null)
    .map((run) => ({ label: run.segmentId!, items: edition.items.slice(run.from, run.to) }));
  return {
    runs,
    passages: [
      {
        baseUnits: passage.base.units,
        sites: passage.collation.sites.map(options.mark ?? ((s: Site) => s)),
        ...(options.attachments ? { attachments: options.attachments } : {}),
        segments: passage.segments.map((s) => ({
          segmentId: s.segmentId,
          printed: s.printed,
          label: s.segmentId,
        })),
      },
    ],
  };
}
