import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isBreak, isToken, type Item, type Mark, type Stream } from '../stream/items.ts';
import { exportTranscriptionTei } from './export.ts';
import { richPages, richSegmentLabels, richStream, richZones, variantStream } from './fixtures.ts';
import { importTei } from './import.ts';

const original: Stream = richStream();
const pages = richPages;
const zones = richZones;
const segmentLabels = richSegmentLabels;

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
    const result = importTei(xml, { ids: sequentialIds(), as: 'verbatim' });
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
    const result = importTei(xml, { ids: sequentialIds(), as: 'verbatim' });
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
      { ids: sequentialIds(), as: 'verbatim' },
    );
    const twice = importTei(
      exportTranscriptionTei({
        stream: once.stream,
        title: 'T',
        words: true,
        regularizations: true,
      }),
      { ids: sequentialIds(), as: 'verbatim' },
    );
    expect(essence(twice.stream.items)).toEqual(essence(once.stream.items));
  });
});

describe('TEI round trip of variants noted in the carrier', () => {
  const stream: Stream = variantStream();

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
      const result = importTei(xml, { ids: sequentialIds(), as: 'verbatim' });
      expect(result.warnings).toEqual([]);
      expect(renumbered(result.stream.items)).toEqual(renumbered(stream.items));
    }
  });
});

describe('TEI round trip of paratext', () => {
  it('writes paratext that TEI allows in no line as a typed label, and reads every kind back with its subtype', () => {
    const ids = sequentialIds('x');
    const kinds = [
      'head',
      'speaker',
      'stage',
      'label',
      'trailer',
      'fw',
      'byline',
      'dateline',
      'opener',
      'closer',
      'salute',
      'signed',
      'docAuthor',
      'docTitle',
      'argument',
      'epigraph',
    ];
    const items: Item[] = [];
    for (const type of kinds) {
      items.push({
        kind: 'object',
        id: ids(),
        type: 'paratext',
        attrs: { type },
        text: `the ${type}`,
      });
      items.push({ kind: 'break', id: ids(), type: 'line' });
    }
    items.push({
      kind: 'object',
      id: ids(),
      type: 'paratext',
      attrs: { type: 'head', subtype: 'chapter' },
      text: 'Α',
    });
    items.push({ kind: 'break', id: ids(), type: 'line' });
    items.push({
      kind: 'object',
      id: ids(),
      type: 'paratext',
      attrs: { type: 'label', subtype: 'number' },
      text: '3',
    });
    const xml = exportTranscriptionTei({ stream: { items }, title: 'T' });
    expect(xml).toContain('<label type="head">the head</label>');
    expect(xml).toContain('<label type="speaker">the speaker</label>');
    expect(xml).toContain('<stage>the stage</stage>');
    expect(xml).toContain('<fw>the fw</fw>');
    expect(xml).toContain('<label type="head" subtype="chapter">Α</label>');
    expect(xml).toContain('<label type="number">3</label>');
    expect(xml).not.toMatch(/<(head|speaker|trailer)\b/u);
    const result = importTei(xml, { ids: sequentialIds(), as: 'verbatim' });
    expect(result.warnings).toEqual([]);
    expect(essence(result.stream.items)).toEqual(essence(items));
  });
});

describe('TEI round trip of text on no page', () => {
  it('writes the text before the first page break before the first <pb/> and reads it back there', () => {
    const stream: Stream = {
      items: [
        { kind: 'token', id: 'u1', form: 'ἄνδρα' },
        { kind: 'token', id: 'u2', form: 'μοι' },
        { kind: 'break', id: 'pb1', type: 'page', pageId: 'p1' },
        { kind: 'token', id: 'a1', form: 'μῆνιν' },
        { kind: 'break', id: 'lb1', type: 'line' },
        { kind: 'token', id: 'a2', form: 'ἄειδε' },
        { kind: 'break', id: 'pb2', type: 'page', pageId: 'p2' },
        { kind: 'token', id: 'b1', form: 'θεὰ' },
      ],
    };
    const pagesHere = [
      { id: 'p1', label: '12r' },
      { id: 'p2', label: '12v' },
    ];
    const xml = exportTranscriptionTei({ stream, title: 'T', pages: pagesHere, words: true });
    expect(xml.indexOf('ἄνδρα')).toBeLessThan(xml.indexOf('<pb n="12r"'));
    const result = importTei(xml, { ids: sequentialIds(), as: 'verbatim' });
    expect(essence(result.stream.items)).toEqual(essence(stream.items));
    expect(result.pages.map((p) => [p.label, p.itemIndex])).toEqual([
      ['12r', 2],
      ['12v', 6],
    ]);
  });
});
