import { describe, expect, it } from 'vitest';
import type { Item } from '../stream/items.ts';
import {
  exportTranscriptionTei,
  handRefFor,
  markupToken,
  type TranscriptionExport,
} from './export.ts';
import { exportInput } from './fixtures.ts';
import { importTei } from './import.ts';
import { parseXml } from './xml.ts';

const input = exportInput();
const stream = input.stream;

describe('exportTranscriptionTei', () => {
  const xml = exportTranscriptionTei({ ...input, words: true, regularizations: true });

  it('is a well-formed TEI document with a header and a manuscript description', () => {
    expect(() => parseXml(xml)).not.toThrow();
    expect(xml).toContain('<TEI xmlns="http://www.tei-c.org/ns/1.0">');
    expect(xml).toContain('<title>Test &amp; trial</title>');
    expect(xml).toContain('<settlement>Venice</settlement>');
    expect(xml).toContain('<altIdentifier type="siglum"><idno>A</idno></altIdentifier>');
    expect(xml).toContain('<support><material>parchment</material></support>');
    expect(xml).toContain('<objectDesc form="codex">');
    expect(importTei(xml).witness?.form).toBe('codex');
    expect(xml).toContain('<handDesc hands="1">');
    expect(xml).toContain('<handNote xml:id="hand-h1" n="m1" scope="sole">one hand</handNote>');
    expect(xml).toContain('<origDate>10th c.</origDate>');
    expect(xml).toContain('<language ident="grc">grc</language>');
    expect(xml).toContain('<text xml:lang="grc">');
  });

  it('writes the facsimile with zones scaled to the image, polygons as points', () => {
    expect(xml).toContain('<surface xml:id="p-p1" n="12r">');
    expect(xml).toContain(
      '<graphic url="https://images.example/12r.jpg" width="2000px" height="3000px"/>',
    );
    expect(xml).toContain('<zone xml:id="z-z1" ulx="200" uly="300" lrx="600" lry="450"/>');
    expect(xml).toContain('<zone xml:id="z-z2" points="200,600 600,600 600,750"/>');
  });

  it('writes the licence in the publication statement and the sources in the source description', () => {
    const xml = exportTranscriptionTei({
      ...input,
      licence: 'CC BY 4.0',
      sources: "Started from Allen's text (Oxford 1931).",
    });
    expect(xml).toContain(
      '<publicationStmt><authority>Varians</authority><availability><licence>CC BY 4.0</licence></availability></publicationStmt>',
    );
    expect(xml).toContain(`<bibl type="sources">Started from Allen's text (Oxford 1931).</bibl>`);
    expect(() => parseXml(xml)).not.toThrow();
    // Without them, the plain statement as before.
    expect(exportTranscriptionTei(input)).toContain(
      '<publicationStmt><p>Exported from Varians.</p></publicationStmt>',
    );
  });

  it('writes a turned rectangle as its corners, turned in pixels of the image', () => {
    const turned = exportTranscriptionTei({
      ...input,
      zones: [
        {
          ...input.zones![0]!,
          id: 'zr',
          geometry: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, rotate: 90 },
        },
      ],
    });
    // 400 by 300 pixels about the centre (400, 450), a quarter turn clockwise: 300 wide, 400 high.
    expect(turned).toContain('<zone xml:id="z-zr" points="550,250 550,650 250,650 250,250"/>');
  });

  it('writes breaks, words with their zones, marks, gaps, joins and segment milestones', () => {
    expect(xml).toContain('<pb n="12r" facs="#p-p1"/>');
    expect(xml).toContain(
      '<milestone unit="segment" n="1.1"/><w xml:id="w-t1" facs="#z-z1"><choice><abbr>ΚΣ</abbr><expan>Κύριος</expan></choice></w>',
    );
    expect(xml).toContain(
      '<w xml:id="w-t2" part="I" facs="#z-z2">ἄνδ</w><lb break="no"/><w xml:id="w-t3" part="F" facs="#z-z2"><supplied reason="lost">ρ</supplied>α</w>',
    );
    expect(xml).toContain('<gap reason="lost" quantity="3" unit="character"/>');
    expect(xml).toContain(
      '<w xml:id="w-t4"><choice><orig>a&amp;b&lt;c</orig><reg>abc</reg></choice></w>',
    );
    expect(xml).not.toContain('s2');
  });

  it('identifies a witness without place, library or shelfmark by its name, as TEI requires', () => {
    expect(
      exportTranscriptionTei({
        stream,
        title: 'T',
        witness: { siglum: 'P', name: 'P.Oxy. 3.412' },
      }),
    ).toContain(
      '<msIdentifier>\n            <msName>P.Oxy. 3.412</msName>\n            <altIdentifier type="siglum"><idno>P</idno></altIdentifier>\n          </msIdentifier>',
    );
    expect(exportTranscriptionTei({ stream, title: 'T', witness: { siglum: 'P' } })).toContain(
      '<msName>P</msName>',
    );
    expect(xml).not.toContain('<msName>');
  });

  it('ends a text that ends in a divided word with the break that divides a word', () => {
    const items = (...list: Item[]): TranscriptionExport => ({
      stream: { items: list },
      title: 'T',
      words: true,
    });
    const a: Item = { kind: 'token', id: 'a', form: 'ἄνδ', joinNext: true };
    const line: Item = { kind: 'break', id: 'l', type: 'line' };
    expect(exportTranscriptionTei(items(a))).toContain(
      '<w xml:id="w-a" part="I">ἄνδ</w><lb break="no"/></ab>',
    );
    // With a line break of its own after it, a second break says so.
    expect(exportTranscriptionTei(items(a, line))).toContain(
      '<w xml:id="w-a" part="I">ἄνδ</w><lb break="no"/>\n      <lb/></ab>',
    );
  });

  it('says of a segment that begins inside a word that it does not end the word, and of each token which part of the word it is', () => {
    const list: Item[] = [
      { kind: 'token', id: 'a', form: 'ἀνα', joinNext: true, segment: { segmentId: 's1' } },
      { kind: 'token', id: 'b', form: 'στα', joinNext: true, segment: { segmentId: 's2' } },
      { kind: 'break', id: 'l', type: 'line' },
      { kind: 'token', id: 'c', form: 'σις' },
      { kind: 'token', id: 'd', form: 'δε', segment: { segmentId: 's3' } },
    ];
    const input: TranscriptionExport = {
      stream: { items: list },
      title: 'T',
      segmentLabels: { s1: '1', s2: '2', s3: '3' },
    };
    expect(exportTranscriptionTei(input)).toContain(
      '<milestone unit="segment" n="1"/>ἀνα<milestone unit="segment" n="2" break="no"/>στα<lb break="no"/>σις <milestone unit="segment" n="3"/>δε</ab>',
    );
    expect(exportTranscriptionTei({ ...input, words: true })).toContain(
      '<w xml:id="w-a" part="I">ἀνα</w><milestone unit="segment" n="2" break="no"/><w xml:id="w-b" part="M">στα</w><lb break="no"/><w xml:id="w-c" part="F">σις</w> <milestone unit="segment" n="3"/><w xml:id="w-d">δε</w></ab>',
    );
  });

  it('writes plain text without w elements or regularizations when not asked for them', () => {
    const plain = exportTranscriptionTei({ stream, title: 'T' });
    expect(plain).not.toContain('<w ');
    expect(plain).toContain(
      '<choice><abbr>ΚΣ</abbr><expan>Κύριος</expan></choice> ἄνδ<lb break="no"/><supplied reason="lost">ρ</supplied>α <gap',
    );
    expect(plain).not.toContain('<reg>');
    expect(plain).toContain('<sourceDesc>\n        <p>Transcription.</p>');
    expect(plain).not.toContain('<facsimile>');
  });

  it('writes one p per paragraph and objects as their elements', () => {
    const out = exportTranscriptionTei({
      title: 'T',
      stream: {
        items: [
          { kind: 'object', id: 'o1', type: 'paratext', attrs: { type: 'head' }, text: 'Title' },
          { kind: 'token', id: 't1', form: 'a' },
          { kind: 'break', id: 'b1', type: 'paragraph' },
          { kind: 'object', id: 'o2', type: 'note', attrs: { place: 'margin' }, text: 'n' },
          { kind: 'object', id: 'o3', type: 'figure', text: 'a drawing' },
          { kind: 'object', id: 'o4', type: 'space', attrs: { quantity: 1, unit: 'line' } },
          { kind: 'break', id: 'b2', type: 'column', label: 'b' },
          {
            kind: 'token',
            id: 't2',
            form: 'b',
            marks: [{ kind: 'handShift', attrs: { new: '#h2' } }, { kind: 'sic' }],
          },
        ],
      },
    });
    expect(out).toContain(
      '<p><label type="head">Title</label> a</p>\n      <p><note place="margin">n</note> <figure><figDesc>a drawing</figDesc></figure> <space quantity="1" unit="line"/>\n      <cb n="b"/><handShift new="#h2"/><sic>b</sic></p>',
    );
    expect(() => parseXml(out)).not.toThrow();
  });

  it('gives <text> the language most of the words have, lists them all, and marks a word in another', () => {
    const items: Item[] = [
      { kind: 'token', id: 'a', lang: 'la', form: 'arma' },
      { kind: 'token', id: 'b', lang: 'grc', form: 'μῆνιν' },
      { kind: 'token', id: 'c', lang: 'grc', form: 'ἄειδε' },
      { kind: 'token', id: 'd', form: 'nescio' },
    ];
    for (const words of [true, false]) {
      const out = exportTranscriptionTei({ stream: { items }, title: 'T', words });
      expect(out).toContain('<text xml:lang="grc">');
      expect(out).toContain(
        '<langUsage>\n        <language ident="grc">grc</language>\n        <language ident="la">la</language>',
      );
      expect(out).toMatch(/<w[^>]* xml:lang="la">arma<\/w>/u);
      // A word without a language says none, and a word in the language of the text says nothing.
      expect(out).not.toMatch(/xml:lang="[^"]*">(nescio|μῆνιν)/u);
      const back = importTei(out).stream.items.map((i) => (i.kind === 'token' ? i.lang : null));
      expect(back).toEqual(['la', 'grc', 'grc', 'grc']);
    }
    // The first language met wins where two have as many words.
    const even = exportTranscriptionTei({ stream: { items: items.slice(0, 2) }, title: 'T' });
    expect(even).toContain('<text xml:lang="la">');
  });

  it('writes no language where the words have none, and no foreign mark', () => {
    const out = exportTranscriptionTei({
      stream: {
        items: [
          {
            kind: 'token',
            id: 'a',
            form: 'x',
            marks: [{ kind: 'foreign', attrs: { lang: 'la' } }],
          },
        ],
      },
      title: 'T',
      words: true,
    });
    expect(out).not.toContain('xml:lang');
    expect(out).not.toContain('langUsage');
    expect(out).not.toContain('foreign');
  });
});

describe('markupToken', () => {
  it('nests marks that nest and splits marks that overlap', () => {
    expect(
      markupToken('abcde', [
        { kind: 'unclear', from: 0, to: 3 },
        { kind: 'supplied', from: 2, to: 5 },
      ]),
    ).toBe('<unclear>ab<supplied>c</supplied></unclear><supplied>de</supplied>');
    expect(
      markupToken('abcde', [
        { kind: 'del', attrs: { rend: 'erasure' } },
        { kind: 'hi', attrs: { rend: 'rubric' }, from: 1, to: 2 },
      ]),
    ).toBe('<del rend="erasure">a<hi rend="rubric">b</hi>cde</del>');
  });

  it('writes point marks as empty elements, sic/corr as a choice and kinds without an element as seg', () => {
    expect(markupToken('κας', [{ kind: 'gap', attrs: { quantity: 2 }, from: 2, to: 2 }])).toBe(
      'κα<gap quantity="2"/>ς',
    );
    expect(markupToken('θεος', [{ kind: 'corr', attrs: { corr: 'θεὸς' } }])).toBe(
      '<choice><sic>θεος</sic><corr>θεὸς</corr></choice>',
    );
    expect(markupToken('x', [{ kind: 'crux' }])).toBe('<seg type="crux">x</seg>');
    expect(markupToken('a<b', [])).toBe('a&lt;b');
  });
});

describe('hands of corrections', () => {
  it("writes a correction's hand as a pointer to the handNote, the scribe as the main hand, and leaves an unidentified hand unsaid", () => {
    const hands = [
      { id: 'h1', label: 'm1', main: true },
      { id: 'h2', label: 'm2', main: false },
    ];
    const write = { handRef: handRefFor(hands) };
    expect(markupToken('abc', [{ kind: 'del', attrs: { hand: 'h2', seq: 2 } }], write)).toBe(
      '<del hand="#hand-h2" seq="2">abc</del>',
    );
    expect(markupToken('abc', [{ kind: 'add', attrs: { hand: 'scribe' } }], write)).toBe(
      '<add hand="#hand-h1">abc</add>',
    );
    expect(markupToken('abc', [{ kind: 'add', attrs: { hand: 'other', seq: 1 } }], write)).toBe(
      '<add seq="1">abc</add>',
    );
    expect(markupToken('abc', [{ kind: 'del', attrs: { hand: 'm3' } }], write)).toBe(
      '<del hand="#m3">abc</del>',
    );
    expect(
      markupToken('abc', [{ kind: 'del', attrs: { hand: 'scribe' } }], { handRef: handRefFor([]) }),
    ).toBe('<del>abc</del>');
  });
});
