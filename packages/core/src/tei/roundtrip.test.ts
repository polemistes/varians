import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isBreak, isToken, type Item, type Mark, type Stream } from '../stream/items.ts';
import { exportTranscriptionTei } from './export.ts';
import { importTei } from './import.ts';

const ids = sequentialIds('a');
const id = () => ids();

/** A transcription with pages, columns, paragraphs, every kind of mark, gaps, a joined word and segment starts. */
const original: Stream = {
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

const pages = [
  { id: 'p1', label: '12r', imageUrl: 'https://images.example/12r.jpg', width: 2000, height: 3000 },
];
const zones = [
  {
    id: 'z1',
    pageId: 'p1',
    tokenIds: ['a3', 'a4'],
    geometry: { rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 } },
  },
];
const segmentLabels = { s1: '1.1', s2: '1.2' };

function sortedMarks(marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks) return undefined;
  return [...marks].sort(
    (a, b) =>
      (a.from ?? -1) - (b.from ?? -1) ||
      (a.to ?? -1) - (b.to ?? -1) ||
      a.kind.localeCompare(b.kind),
  );
}

/** What the round trip must keep: everything but ids, page ids and segment ids. */
function essence(items: Item[]): unknown[] {
  return items.map((item) => {
    if (isToken(item)) {
      const out: Record<string, unknown> = { form: item.form };
      if (item.norm !== undefined) out.norm = item.norm;
      if (item.joinNext) out.joinNext = true;
      const marks = sortedMarks(item.marks);
      if (marks) out.marks = marks;
      return out;
    }
    if (isBreak(item)) {
      const out: Record<string, unknown> = { break: item.type };
      if (item.type !== 'page' && item.label !== undefined) out.label = item.label;
      return out;
    }
    const out: Record<string, unknown> = { object: item.type };
    if (item.attrs) out.attrs = item.attrs;
    if (item.text !== undefined) out.text = item.text;
    return out;
  });
}

function segmentLabelsAt(stream: Stream, labels: Record<string, string>): [number, string][] {
  const out: [number, string][] = [];
  stream.items.forEach((item, index) => {
    const segmentId = item.kind === 'break' ? undefined : item.segment?.segmentId;
    const label = segmentId === null || segmentId === undefined ? undefined : labels[segmentId];
    if (label !== undefined) out.push([index, label]);
  });
  return out;
}

describe('TEI round trip', () => {
  it('exports with words and reads back the same tokens, marks, read forms, joins, breaks, objects, pages and segment labels', () => {
    const xml = exportTranscriptionTei({
      stream: original,
      title: 'Iliad',
      language: 'grc',
      pages,
      zones,
      segmentLabels,
      words: true,
      regularizations: true,
    });
    const result = importTei(xml, { ids: sequentialIds() });
    expect(result.warnings).toEqual([]);
    expect(essence(result.stream.items)).toEqual(essence(original.items));
    expect(result.stream.items.map((i) => i.id)).not.toEqual(original.items.map((i) => i.id));
    expect(result.pages).toEqual([
      { label: '12r', facs: '#p-p1', imageUrl: 'https://images.example/12r.jpg', itemIndex: 0 },
    ]);
    expect(result.segmentStarts.map((s) => [s.itemIndex, s.parts] as const)).toEqual(
      segmentLabelsAt(original, segmentLabels).map(([index, label]) => [
        index,
        [{ unit: 'segment', n: label }],
      ]),
    );
    expect(result.header).toEqual({ title: 'Iliad', language: 'grc' });
  });

  it('exports as plain text and reads back the same words', () => {
    const xml = exportTranscriptionTei({
      stream: original,
      title: 'Iliad',
      pages,
      segmentLabels,
      regularizations: true,
    });
    const result = importTei(xml, { ids: sequentialIds() });
    expect(result.warnings).toEqual([]);
    expect(essence(result.stream.items)).toEqual(essence(original.items));
  });

  it('survives a second trip unchanged', () => {
    const once = importTei(
      exportTranscriptionTei({
        stream: original,
        title: 'T',
        pages,
        words: true,
        regularizations: true,
      }),
      { ids: sequentialIds() },
    );
    const twice = importTei(
      exportTranscriptionTei({
        stream: once.stream,
        title: 'T',
        words: true,
        regularizations: true,
      }),
      { ids: sequentialIds() },
    );
    expect(essence(twice.stream.items)).toEqual(essence(once.stream.items));
  });
});

describe('TEI round trip of variants noted in the carrier', () => {
  const variant = (group: string, reading: string, place: string, hand?: string): Mark => ({
    kind: 'variant',
    attrs: hand === undefined ? { group, reading, place } : { group, reading, place, hand },
  });
  const ids = sequentialIds('v');
  const stream: Stream = {
    items: [
      { kind: 'token', id: ids(), form: 'μῆνιν' },
      { kind: 'token', id: ids(), form: 'ἄειδε', marks: [variant('g1', 'ἔννεπε μοι', 'margin', 'm2')] },
      { kind: 'token', id: ids(), form: 'θεὰ', marks: [{ kind: 'unclear' }, variant('g1', 'ἔννεπε μοι', 'margin', 'm2')] },
      { kind: 'break', id: ids(), type: 'line' },
      { kind: 'token', id: ids(), form: 'Πηληϊάδεω', marks: [variant('g1', 'ἔννεπε μοι', 'margin', 'm2')] },
      { kind: 'token', id: ids(), form: 'Ἀχιλῆος', marks: [variant('g2', '', 'interlinear')] },
      { kind: 'token', id: ids(), form: 'οὐλομένην', marks: [variant('g3', 'οὐλομένη', 'other')] },
    ],
  };

  /** Group ids are made anew on import: compare them by order of first appearance. */
  function renumbered(items: Item[]): unknown[] {
    const groups = new Map<string, string>();
    return essence(items).map((entry) => {
      const marks = (entry as { marks?: Mark[] }).marks;
      if (!marks) return entry;
      return {
        ...(entry as object),
        marks: marks.map((m) => {
          if (m.kind !== 'variant') return m;
          const group = String(m.attrs?.group);
          if (!groups.has(group)) groups.set(group, `g${groups.size + 1}`);
          return { ...m, attrs: { ...m.attrs, group: groups.get(group) } };
        }),
      };
    });
  }

  it('writes a variant as app, lem and rdg around its words', () => {
    const xml = exportTranscriptionTei({ stream, title: 'T' });
    expect(xml).toContain(
      'μῆνιν <app><lem>ἄειδε <unclear>θεὰ</unclear>\n      <lb/>Πηληϊάδεω</lem><rdg type="margin" hand="#m2">ἔννεπε μοι</rdg></app>' +
        ' <app><lem>Ἀχιλῆος</lem><rdg type="interlinear"></rdg></app> <app><lem>οὐλομένην</lem><rdg type="other">οὐλομένη</rdg></app>',
    );
    expect(xml).not.toContain('<variant');
  });

  it('reads the same variants back, with words and as plain text', () => {
    for (const words of [true, false]) {
      const xml = exportTranscriptionTei({ stream, title: 'T', words });
      const result = importTei(xml, { ids: sequentialIds() });
      expect(result.warnings).toEqual([]);
      expect(renumbered(result.stream.items)).toEqual(renumbered(stream.items));
    }
  });
});
