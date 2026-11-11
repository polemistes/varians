/// <reference types="node" />
/**
 * Every kind of TEI the core writes is valid against the RelaxNG schema
 * generated from the ODD (docs/formats/varians.rng), checked with xmllint.
 * Without xmllint the tests are skipped with a warning. When TEI_ALL_RNG
 * names tei_all.rng of the same TEI release (build-rng.sh fetches it into
 * tools/tei/), every document is also checked against it, which shows that
 * the customization is a pure restriction of TEI.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Attachment } from '../apparatus/render.ts';
import { collate, type Site } from '../collate/collate.ts';
import { sequentialIds } from '../ids.ts';
import { NOT_TRANSCRIBED_ATTRS, type Item, type Stream, type Token } from '../stream/items.ts';
import { fromText } from '../stream/text.ts';
import { units } from '../stream/words.ts';
import { exportEditionTei } from './apparatus.ts';
import { exportTranscriptionTei, type TranscriptionExport } from './export.ts';
import {
  collatedLines,
  collationText,
  editionInput,
  editionSegments,
  exportInput,
  passageText,
  richPages,
  richSegmentLabels,
  richStream,
  richZones,
  variantStream,
} from './fixtures.ts';
import { importTei } from './import.ts';

const RNG = fileURLToPath(new URL('../../../../docs/formats/varians.rng', import.meta.url));
const xmllint = spawnSync('xmllint', ['--version']).error === undefined;
const UNCHECKED =
  'xmllint is not installed: the TEI exports are NOT validated against docs/formats/varians.rng.';
if (!xmllint) console.warn(UNCHECKED);

const dir = xmllint ? mkdtempSync(join(tmpdir(), 'varians-tei-')) : '';
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
let count = 0;

const TEI_ALL = process.env.TEI_ALL_RNG;
/** tei_all is large: xmllint takes seconds to compile it for every document. */
const slow = { timeout: TEI_ALL ? 600_000 : 20_000 };

/** The errors of a document against a schema, empty when it is valid. */
function schemaErrors(xml: string, schema: string): string[] {
  const file = join(dir, `doc-${++count}.xml`);
  writeFileSync(file, xml);
  const run = spawnSync('xmllint', ['--noout', '--relaxng', schema, file], { encoding: 'utf8' });
  if (run.status === 0) return [];
  return run.stderr
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.endsWith('fails to validate'))
    .map((line) => line.replace(`${file}:`, 'line '));
}

/**
 * The Schematron rules of TEI that xmllint does not check and that the
 * writers could break (see BUILD.md): msId_minimal and subtypeTyped.
 */
function ruleErrors(xml: string): string[] {
  const out: string[] = [];
  if (/<msIdentifier>\s*(<altIdentifier|<\/msIdentifier>)/u.test(xml))
    out.push('msId_minimal: an msIdentifier is empty or begins with altIdentifier');
  for (const tag of xml.match(/<[A-Za-z][^>]*>/gu) ?? []) {
    if (/\ssubtype="/u.test(tag) && !/\stype="/u.test(tag)) out.push(`subtypeTyped: ${tag}`);
  }
  return out;
}

/** The errors of a document against varians.rng and TEI's rules, and against tei_all when it is given. */
function errors(xml: string): string[] {
  const own = [...schemaErrors(xml, RNG), ...ruleErrors(xml)];
  if (!TEI_ALL) return own;
  return [...own, ...schemaErrors(xml, TEI_ALL).map((line) => `tei_all: ${line}`)];
}

function transcription(input: Partial<TranscriptionExport> & { stream: Stream }): string {
  return exportTranscriptionTei({ title: 'T', ...input });
}

describe.skipIf(!xmllint)('the RelaxNG schema of the ODD', slow, () => {
  it('rejects what it should: a head inside a block, an element not in the subset, a closed value outside its list', () => {
    const doc = (body: string) =>
      `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>t</title></titleStmt><publicationStmt><p>p</p></publicationStmt><sourceDesc><p>s</p></sourceDesc></fileDesc></teiHeader><text><body>${body}</body></text></TEI>`;
    expect(schemaErrors(doc('<ab>a</ab>'), RNG)).toEqual([]);
    expect(schemaErrors(doc('<ab><head>a</head></ab>'), RNG)).not.toEqual([]);
    expect(schemaErrors(doc('<ab><quote>b</quote></ab>'), RNG)).not.toEqual([]);
    expect(schemaErrors(doc('<ab><name>b</name></ab>'), RNG)).not.toEqual([]);
    expect(schemaErrors(doc('<ab><milestone unit="page" n="1"/>a</ab>'), RNG)).not.toEqual([]);
    expect(schemaErrors(doc('<ab><app type="major"><lem>a</lem></app></ab>'), RNG)).not.toEqual([]);
    expect(
      schemaErrors(doc('<ab><app type="textual" subtype="minor"><lem>a</lem></app></ab>'), RNG),
    ).toEqual([]);
    expect(
      schemaErrors(doc('<ab><app type="textual" subtype="major"><lem>a</lem></app></ab>'), RNG),
    ).not.toEqual([]);
  });
});

describe.skipIf(!xmllint)('transcription TEI is valid', slow, () => {
  it('with words, regularizations, the witness described in full, the facsimile with zones, licence and sources', () => {
    const xml = exportTranscriptionTei({
      ...exportInput(),
      words: true,
      regularizations: true,
      licence: 'CC BY-SA 4.0',
      sources: 'Started from Allen’s text (Oxford 1931).',
    });
    expect(errors(xml)).toEqual([]);
  });

  it('as plain text, without witness, pages or language', () => {
    expect(errors(transcription({ stream: exportInput().stream }))).toEqual([]);
  });

  it('with the signs of a papyrus: numbers, glyphs, rules, another language, quotations, symbols, what is said of a gap', () => {
    const epidoc = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><ab><lb n="1"/><num value="16">ιϛ</num> <num value="1/32" rend="tick">λβ</num> <foreign xml:lang="la">comes</foreign> <q>ὁ γὰρ</q> <g type="stauros"/> <unclear><g type="check"/></unclear> <g type="chirho">☧</g> <expan><ex>ἔτους</ex></expan> <expan>Καρ<ex cert="low">ανίδι</ex></expan> <milestone rend="paragraphos" unit="undefined"/> <lb n="2"/><gap reason="illegible" quantity="15" unit="line"><desc>vestiges</desc></gap> <add place="above">ὅλων<certainty match=".." locus="name"/></add> κα<gap reason="illegible" quantity="2" unit="character"><desc>vestiges</desc></gap>ς <hi rend="diaeresis">ἱ</hi>οῦ <handShift new="m2" cert="low"/>τοῦ <del rend="slashes">τῆς</del></ab></body></text></TEI>`;
    const read = importTei(epidoc, { ids: sequentialIds() });
    expect(read.warnings).toEqual([]);
    for (const words of [true, false]) {
      const xml = transcription({ stream: read.stream, words, regularizations: true });
      expect(errors(xml)).toEqual([]);
      // And it reads back as it was.
      const again = importTei(xml, { ids: sequentialIds() });
      expect(again.stream).toEqual(read.stream);
    }
  });

  it('with every kind of mark, paragraphs, columns, notes, figures, spaces and segment milestones', () => {
    for (const words of [true, false]) {
      const xml = transcription({
        stream: richStream(),
        title: 'Iliad',
        language: 'grc',
        pages: richPages,
        zones: richZones,
        segmentLabels: richSegmentLabels,
        words,
        regularizations: true,
      });
      expect(errors(xml)).toEqual([]);
    }
  });

  it('with variants noted in the carrier, with and without words', () => {
    for (const words of [true, false]) {
      const xml = transcription({
        stream: variantStream(),
        witness: {
          siglum: 'A',
          hands: [
            { id: 'm1', label: 'm1', main: true },
            { id: 'm2', label: 'm2' },
          ],
        },
        words,
      });
      expect(errors(xml)).toEqual([]);
    }
  });

  it('with corrections by hand and stage, hand shifts and several hands', () => {
    const stream: Stream = {
      items: [
        {
          kind: 'token',
          id: 't1',
          form: 'abc',
          marks: [{ kind: 'del', attrs: { hand: 'h2', seq: 2, rend: 'erasure' } }],
        },
        {
          kind: 'token',
          id: 't2',
          form: 'def',
          marks: [{ kind: 'add', attrs: { hand: 'scribe', place: 'above', seq: 1 } }],
        },
        {
          kind: 'token',
          id: 't3',
          form: 'ghi',
          marks: [
            { kind: 'add', attrs: { hand: 'other' } },
            { kind: 'handShift', attrs: { new: '#hand-h2' } },
          ],
        },
        { kind: 'token', id: 't4', form: 'jkl', marks: [{ kind: 'del', attrs: { hand: 'm3' } }] },
      ],
    };
    const xml = transcription({
      stream,
      witness: {
        siglum: 'V',
        hands: [
          { id: 'h1', label: 'm1', description: 'the scribe', main: true },
          { id: 'h2', label: 'm2', description: 'a corrector' },
          { id: 'h3', label: 'm3' },
        ],
      },
      words: true,
    });
    expect(errors(xml)).toEqual([]);
  });

  it('with every feature the importer reads', () => {
    const stream: Stream = {
      items: [
        {
          kind: 'token',
          id: 't1',
          form: 'abcd',
          marks: [
            { kind: 'subst' },
            { kind: 'del', from: 0, to: 2 },
            { kind: 'add', from: 2, to: 4 },
          ],
        },
        {
          kind: 'token',
          id: 't2',
          form: 'efg',
          marks: [
            { kind: 'restore', from: 0, to: 1 },
            { kind: 'retrace', from: 1, to: 2 },
            { kind: 'mod', from: 2, to: 3 },
          ],
        },
        {
          kind: 'token',
          id: 't3',
          form: 'hij',
          marks: [
            { kind: 'redo', attrs: { hand: '#h2' }, from: 1, to: 1 },
            { kind: 'undo', from: 2, to: 2 },
            { kind: 'secl', from: 2, to: 3 },
          ],
        },
        { kind: 'token', id: 't4', form: 'klm', marks: [{ kind: 'orig' }] },
        { kind: 'token', id: 't5', form: 'κς', marks: [{ kind: 'abbr' }] },
        {
          kind: 'token',
          id: 't6',
          form: 'nop',
          marks: [
            { kind: 'crux' },
            { kind: 'note', attrs: { text: 'a note at a point' }, from: 1, to: 1 },
          ],
        },
        { kind: 'token', id: 't7', form: 'qrs', marks: [{ kind: 'note', from: 0, to: 2 }] },
        {
          kind: 'token',
          id: 't8',
          form: 'tuv',
          marks: [
            { kind: 'unclear', attrs: { reason: 'faded', cert: 'low' } },
            { kind: 'space', attrs: { quantity: 1, unit: 'character' }, from: 1, to: 1 },
          ],
        },
        {
          kind: 'token',
          id: 't9',
          form: 'wxy',
          marks: [
            { kind: 'supplied', attrs: { reason: 'omitted', resp: '#ed' } },
            { kind: 'damage', attrs: { agent: 'hole', degree: 'medium' } },
          ],
        },
        {
          kind: 'token',
          id: 't10',
          form: 'zz',
          marks: [
            { kind: 'hi', attrs: { rend: 'superscript' } },
            {
              kind: 'gap',
              attrs: { reason: 'illegible', quantity: 2, unit: 'character' },
              from: 2,
              to: 2,
            },
          ],
        },
      ],
    };
    for (const words of [true, false])
      expect(errors(transcription({ stream, words, regularizations: true }))).toEqual([]);
  });

  it('with paratext of every kind the importer reads, notes, figures, scribal marks and lacunae', () => {
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
      'margin',
    ];
    const ids = sequentialIds('x');
    const items: Item[] = [{ kind: 'break', id: ids(), type: 'page', label: '1' }];
    for (const type of kinds) {
      items.push({ kind: 'object', id: ids(), type: 'paratext', attrs: { type }, text: type });
      items.push({ kind: 'token', id: ids(), form: 'w' });
    }
    items.push(
      {
        kind: 'object',
        id: ids(),
        type: 'paratext',
        attrs: { type: 'head', subtype: 'chapter' },
        text: 'Α',
      },
      {
        kind: 'object',
        id: ids(),
        type: 'paratext',
        attrs: { type: 'fw', subtype: 'catch', place: 'bottom' },
        text: 'καί',
      },
      {
        kind: 'object',
        id: ids(),
        type: 'paratext',
        attrs: { type: 'label', subtype: 'number' },
        text: '3',
      },
      { kind: 'object', id: ids(), type: 'paratext', text: 'untyped' },
      {
        kind: 'object',
        id: ids(),
        type: 'note',
        attrs: { place: 'margin', type: 'gloss' },
        text: 'σχόλιον',
      },
      {
        kind: 'object',
        id: ids(),
        type: 'figure',
        attrs: { url: 'https://images.example/f.png' },
        text: 'a drawing',
      },
      { kind: 'object', id: ids(), type: 'figure' },
      { kind: 'object', id: ids(), type: 'mark', attrs: { function: 'insertion' }, text: '⸓' },
      { kind: 'object', id: ids(), type: 'lacuna', attrs: { extent: 'several lines' } },
      { kind: 'object', id: ids(), type: 'gap', attrs: { reason: 'lost', extent: 'unknown' } },
      { kind: 'object', id: ids(), type: 'gap', attrs: { ...NOT_TRANSCRIBED_ATTRS } },
      {
        kind: 'object',
        id: ids(),
        type: 'gap',
        attrs: { ...NOT_TRANSCRIBED_ATTRS, quantity: 3, unit: 'line' },
      },
      { kind: 'object', id: ids(), type: 'space', attrs: { quantity: 1, unit: 'line' } },
      { kind: 'break', id: ids(), type: 'column', label: 'b' },
      { kind: 'token', id: ids(), form: 'end' },
    );
    for (const words of [true, false])
      expect(errors(transcription({ stream: { items }, words }))).toEqual([]);
  });

  it('with witnesses described in part: a siglum only, a shelfmark without a library, a name only, nothing', () => {
    const stream = exportInput().stream;
    for (const witness of [
      { siglum: 'A' },
      { settlement: 'Paris', idno: 'gr. 2036' },
      { name: 'Codex Parisinus' },
      {},
      { material: 'papyrus', form: 'scroll' as const },
    ]) {
      expect(errors(transcription({ stream, witness }))).toEqual([]);
    }
  });

  it('with pages without images, a turned zone and zones on a page whose size is not known', () => {
    const input = exportInput();
    const xml = transcription({
      stream: input.stream,
      pages: [
        { id: 'p1', label: '12r' },
        { id: 'p2', label: '12v', imageUrl: 'iiif/12v.jpg' },
      ],
      zones: [
        {
          id: 'z1',
          pageId: 'p1',
          tokenIds: ['t1'],
          geometry: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, rotate: 30 },
        },
        {
          id: 'z2',
          pageId: 'p2',
          tokenIds: ['t2'],
          geometry: { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        },
      ],
      words: true,
    });
    expect(errors(xml)).toEqual([]);
  });

  it('after an import of TEI from elsewhere, written back', () => {
    const foreign = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>X</title></titleStmt><publicationStmt><p/></publicationStmt><sourceDesc><p/></sourceDesc></fileDesc></teiHeader>
      <text><body><div type="edition"><div type="textpart" subtype="book" n="1">
        <head>Βιβλίον Α</head>
        <sp><speaker>ΧΟ.</speaker><l n="1">μῆνιν <unclear reason="damage">ἄει</unclear>δε <choice><abbr>θα</abbr><expan>θεὰ</expan></choice></l>
        <l n="2"><subst><del rend="erasure">α</del><add place="above">β</add></subst> <supplied reason="lost">γ</supplied><gap reason="lost" quantity="2" unit="character"/> <hi rend="italic" xml:lang="la">vale</hi><note xml:lang="la" place="margin">nota</note></l></sp>
        <trailer>τέλος</trailer>
      </div></div></body></text></TEI>`;
    const imported = importTei(foreign, { ids: sequentialIds('i') });
    // The parser drops the prefix of xml:lang; it is written back with it.
    expect(transcription({ stream: imported.stream })).toContain(
      '<hi rend="italic" xml:lang="la">vale</hi>',
    );
    for (const words of [true, false])
      expect(
        errors(transcription({ stream: imported.stream, words, regularizations: true })),
      ).toEqual([]);
  });
});

describe.skipIf(!xmllint)('edition TEI is valid', slow, () => {
  it('with the apparatus by parallel segmentation: substitution, omission, addition, lacuna, conjectures and reported readings', () => {
    const xml = exportEditionTei({
      ...editionInput(),
      licence: 'CC BY-SA 4.0',
      sources: 'Allen 1931.',
      preface: 'A preface.',
    });
    expect(errors(xml)).toEqual([]);
  });

  it('with interpretative places, paratext, gaps, notes, paragraphs and adopted supplements', () => {
    const text = editionSegments({
      label: '2',
      text: 'ἦ μέγα\nἔργον',
      witnesses: [collationText('A', 'A', 'ἢ μέγα ἔργον')],
    });
    const items = text.runs[0]!.items;
    const ids = sequentialIds('o');
    items.unshift(
      { kind: 'object', id: ids(), type: 'paratext', attrs: { type: 'speaker' }, text: 'ΧΟ.' },
      { kind: 'object', id: ids(), type: 'paratext', attrs: { type: 'head' }, text: 'Α' },
      { kind: 'object', id: ids(), type: 'paratext', attrs: { type: 'stage' }, text: 'exit' },
      { kind: 'object', id: ids(), type: 'paratext', attrs: { type: 'margin' }, text: '5' },
    );
    items.push(
      { kind: 'object', id: ids(), type: 'lacuna', attrs: { extent: 'a line' } },
      {
        kind: 'object',
        id: ids(),
        type: 'gap',
        attrs: { reason: 'lost', quantity: 3, unit: 'character' },
      },
      { kind: 'object', id: ids(), type: 'gap', attrs: { ...NOT_TRANSCRIBED_ATTRS } },
      { kind: 'object', id: ids(), type: 'note', text: 'a note' },
      { kind: 'object', id: ids(), type: 'space' },
      { kind: 'object', id: ids(), type: 'figure', text: 'a drawing' },
      { kind: 'break', id: ids(), type: 'paragraph', lineation: 'prose' },
      { kind: 'token', id: ids(), form: 'μῦθος' },
      { kind: 'break', id: ids(), type: 'paragraph', lineation: 'verse' },
      { kind: 'token', id: ids(), form: 'ἀνα', joinNext: true },
      { kind: 'break', id: ids(), type: 'line' },
      { kind: 'token', id: ids(), form: 'στασις' },
      { kind: 'break', id: ids(), type: 'paragraph' },
      {
        kind: 'token',
        id: ids(),
        form: 'ἔπος',
        marks: [
          { kind: 'supplied', attrs: { resp: '01JCONJECTURE00000000000000' } },
          { kind: 'variant', attrs: { group: 'g', reading: 'x', place: 'margin' } },
        ],
      },
    );
    const xml = exportEditionTei({
      title: 't',
      language: 'grc',
      witnesses: [{ siglum: 'A', name: 'Codex A', description: 'Iliad' }],
      ...text,
    });
    expect(errors(xml)).toEqual([]);
  });

  it('with minor places of either kind, the grade as a subtype beside the type', () => {
    const text = editionSegments({
      label: '2',
      text: 'ἦ μέγα ἔργον',
      witnesses: [collationText('A', 'A', 'ἢ μέγα ἔργον'), collationText('B', 'B', 'ἦ μέγα ἔπος')],
    });
    for (const site of text.passages[0]!.sites) site.minor = true;
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      ...text,
    });
    expect(xml).toContain('<app type="interpretative" subtype="minor">');
    expect(xml).toContain('<app type="textual" subtype="minor">');
    expect(errors(xml)).toEqual([]);
  });

  it('with a variant across three segments, the starts of two of them inside its lemma, a conjecture and a reported reading', () => {
    const edition = ['s1: alpha beta gamma', 's2: delta', 's3: epsilon zeta eta'];
    const crossing = collatedLines(edition, {
      A: edition,
      B: ['s1: alpha beta kappa', 's2: lambda', 's3: mu zeta eta'],
    });
    const attachments = {
      0: [
        { kind: 'conjecture', id: 'c1', text: 'rho sigma tau', name: 'Bentley', source: '(Ath.)' },
        { kind: 'reported', id: 'r1', text: 'nu xi omicron', name: 'D' },
      ] satisfies Attachment[],
    };
    for (const mark of [(site: Site) => site, (site: Site) => ({ ...site, minor: true })]) {
      const xml = exportEditionTei({
        title: 't',
        witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
        ...passageText(crossing, { attachments, mark }),
      });
      expect(xml).toContain(
        '<lem wit="#wit-A">gamma <milestone unit="segment" n="s2"/>delta <milestone unit="segment" n="s3"/>epsilon</lem><rdg wit="#wit-B">kappa lambda mu</rdg><rdg type="conjecture" resp="#resp-Bentley" source="#src-1">rho sigma tau</rdg><rdg type="reported" wit="#wit-D">nu xi omicron</rdg>',
      );
      expect(errors(xml)).toEqual([]);
    }
  });

  it('with a line break inside a lemma, over a divided word and between two words', () => {
    const edition = fromText('the won der grows alpha beta gamma', { ids: sequentialIds('e') });
    (edition.items[1] as Token).joinNext = true;
    edition.items.splice(2, 0, { kind: 'break', id: 'b1', type: 'line' });
    edition.items.splice(6, 0, { kind: 'break', id: 'b2', type: 'line' });
    const baseUnits = units(edition, 0, edition.items.length);
    const c = collate({ id: 'E', siglum: 'ed.', units: baseUnits }, [
      collationText('B', 'B', 'the wander grows kappa lambda gamma'),
    ]);
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'B' }],
      runs: [{ label: '1', items: edition.items }],
      passages: [{ baseUnits, sites: c.sites }],
    });
    expect(xml).toContain('<lem>won<lb break="no"/>der</lem>');
    expect(xml).toContain('<lem>alpha<lb/>beta</lem>');
    expect(errors(xml)).toEqual([]);
  });

  it('with a word the segments divide, a witness without a whole segment around a variant inside it, and a segment the edition does not print', () => {
    const divided = collatedLines(['s1: alpha gam-', 's2: ma delta'], {
      A: ['s1: alpha gam-', 's2: ma delta'],
      B: ['s1: alpha kappa', 's2: delta'],
    });
    for (const words of [false, true]) {
      const xml = exportEditionTei({
        title: 't',
        witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
        words,
        ...passageText(divided),
      });
      expect(xml).toContain('<milestone unit="segment" n="s2" break="no"/>');
      if (words) expect(xml).toContain(' part="I">gam</w>');
      expect(errors(xml)).toEqual([]);
    }
    const without = collatedLines(['s1: alpha beta', 's2: gamma delta epsilon', 's3: zeta'], {
      A: ['s1: alpha beta', 's2: gamma delta epsilon', 's3: zeta'],
      B: ['s1: alpha beta', 's2: gamma kappa epsilon', 's3: zeta'],
      C: ['s1: alpha beta', 's3: zeta'],
    });
    const around = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }, { siglum: 'C' }],
      ...passageText(without),
    });
    expect(around).toContain('<lem wit="#wit-A #wit-B">gamma <app><lem wit="#wit-A">delta</lem>');
    expect(errors(around)).toEqual([]);
    const unprinted = collatedLines(['s1: alpha beta', 's3: zeta'], {
      A: ['s1: alpha beta', 's2: gamma delta', 's3: zeta'],
      B: ['s1: alpha beta', 's3: zeta'],
    });
    const added = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      ...passageText(unprinted),
    });
    expect(added).toContain(
      '<rdg wit="#wit-A"><milestone unit="segment" n="s2"/>gamma delta</rdg>',
    );
    expect(errors(added)).toEqual([]);
  });

  it('with a variant in pieces, each naming the next by xml:id, prev and next', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>t</title></titleStmt><publicationStmt><p>Exported from Varians.</p></publicationStmt><sourceDesc><listWit><witness xml:id="wit-A" n="A">A</witness><witness xml:id="wit-B" n="B">B</witness><witness xml:id="wit-C" n="C">C</witness></listWit></sourceDesc></fileDesc><encodingDesc><refsDecl><refState unit="segment"/></refsDecl><variantEncoding method="parallel-segmentation" location="internal"/></encodingDesc></teiHeader>
  <text><body><div type="edition"><ab>
    <milestone unit="segment" n="1"/>alpha <app><lem wit="#wit-A">beta <milestone unit="segment" n="2"/><app xml:id="app-1-2-1" next="#app-1-2-2"><lem wit="#wit-A #wit-B">gamma</lem><rdg wit="#wit-C"/></app></lem><rdg wit="#wit-B">kappa lambda</rdg></app> <app xml:id="app-1-2-2" prev="#app-1-2-1"><lem wit="#wit-A #wit-B">delta</lem><rdg wit="#wit-C"/></app>
  </ab></div></body></text>
</TEI>
`;
    expect(errors(xml)).toEqual([]);
  });

  it('with an adopted conjecture and the same letters read otherwise across the boundary of two segments', () => {
    const edition = ['s1: μῆνιν ἦ', 's2: μέγα ἔργον'];
    const crossing = collatedLines(edition, {
      A: edition,
      B: ['s1: μῆνιν ἢ', 's2: μέγᾱ ἔργον'],
    });
    const xml = exportEditionTei({
      title: 't',
      witnesses: [{ siglum: 'A' }, { siglum: 'B' }],
      ...passageText(crossing, {
        attachments: {
          0: [{ kind: 'conjecture', id: 'c1', text: 'ἦ μέγα', name: 'Bentley', adopted: true }],
        },
      }),
    });
    expect(xml).toContain(
      '<app type="interpretative"><lem wit="#wit-A" resp="#resp-Bentley">ἦ <milestone unit="segment" n="s2"/>μέγα</lem>',
    );
    expect(errors(xml)).toEqual([]);
  });

  it('with its bibliography: works of every kind as structured entries, and the citations of a conjecture and a report among the sources', () => {
    const works = [
      [
        'book',
        {
          author: 'West, Martin L.',
          editor: 'Allen, Thomas W. and others',
          title: 'Homeri Ilias',
          subtitle: 'Volumen prius',
          edition: '2',
          location: 'Stuttgart',
          publisher: 'Teubner',
          date: '1998',
          series: 'Bibliotheca Teubneriana',
          number: '12',
          volume: '1',
          isbn: '3-519-01431-9',
          doi: '10.1515/9783110951561',
          translator: 'Other, A. N.',
        },
      ],
      [
        'article',
        {
          author: 'Wilamowitz-Moellendorff, Ulrich von',
          editor: 'Someone, Else',
          title: 'Lesefrüchte',
          journaltitle: 'Hermes',
          volume: '62',
          number: '3',
          pages: '276--298',
          year: '1927',
          doi: '10.1000/example',
          url: 'https://example.org/hermes/62',
          issn: '0018-0777',
        },
      ],
      [
        'incollection',
        {
          author: 'Dover, K. J.',
          title: 'The Chorus',
          booktitle: 'Aristophanic Comedy',
          editor: 'Henderson, Jeffrey',
          pages: '10-20',
          publisher: 'Clarendon Press',
          location: 'Oxford',
          date: '1987-05',
          series: 'Studies',
          volume: '2',
        },
      ],
      ['thesis', { author: '{A Body}', title: 'T', institution: 'Oslo', date: 'forthcoming' }],
      ['online', { title: 'A page', url: 'https://example.org/a?b=c&d=e', date: '2026-11-11' }],
      ['misc', {}],
      ['book', { author: 'Homer' }],
      ['article', { title: 'Only a title' }],
      ['inbook', { editor: 'Ed, A.', pages: 'xii' }],
      ['my type', { title: 'A <b> & c', url: 'see the web' }],
    ] as const;
    const text = editionSegments({
      label: '1',
      text: 'the quick fox',
      witnesses: [collationText('A', 'A', 'the slow fox')],
      attachments: {
        0: [
          { kind: 'conjecture', id: 'c1', text: 'swift', name: 'Bentley', source: '(Ath.)' },
          { kind: 'reported', id: 'r1', text: 'quick', name: 'D' },
        ],
      },
    });
    const xml = exportEditionTei({
      title: 't',
      editors: ['An Editor'],
      witnesses: [{ siglum: 'A' }],
      origin: 'https://varians.example',
      ...text,
      bibliography: {
        works: works.map(([type, fields], k) => ({
          id: `01JBIB${k}`,
          label: `Work ${k}`,
          entry: { type, key: `k${k}`, fields: { ...fields } },
        })),
        citations: {
          c1: [
            { itemId: '01JBIB0', prenote: 'cf.', postnote: '45 & n. 3' },
            { itemId: '01JBIB1' },
            { itemId: 'not listed' },
          ],
          r1: [{ itemId: '01JBIB0', prenote: 'cf.', postnote: '45 & n. 3' }],
        },
      },
    });
    expect(xml).toContain(
      '<bibl xml:id="src-2">cf. <ref target="#bib-01JBIB0">Work 0</ref>, <citedRange>45 &amp; n. 3</citedRange></bibl>',
    );
    expect(xml).toContain('<bibl xml:id="src-3"><ref target="#bib-01JBIB1">Work 1</ref></bibl>');
    // The stated source first, then what is cited; the same citation by two records is one source.
    expect(xml).toContain(
      '<rdg type="conjecture" resp="#resp-Bentley" source="conj:c1 #src-1 #src-2 #src-3">swift</rdg><rdg type="reported" wit="#wit-D" source="#src-2">quick</rdg>',
    );
    expect(xml.match(/<biblStruct /gu)).toHaveLength(works.length);
    expect(errors(xml)).toEqual([]);
  });

  it('with Greek sigla, sigla that differ only by a superscript, and a sub-siglum for the variants of a carrier', () => {
    const sigla = ['Π', 'Σ', 'A¹', 'A²', 'A v.l.', 'a', '1'];
    const witnesses = sigla.map((siglum, i) =>
      collationText(`W${i}`, siglum, i % 2 ? 'the slow fox' : 'the quick fox'),
    );
    const xml = exportEditionTei({
      title: 't',
      witnesses: sigla.map((siglum) => ({ siglum })),
      ...editionSegments({ label: '1', text: 'the quick fox', witnesses }),
    });
    expect(xml).toContain('<witness xml:id="wit-Π" n="Π">');
    expect(xml).toContain('<witness xml:id="wit-A_" n="A¹">');
    expect(xml).toContain('<witness xml:id="wit-A_-2" n="A²">');
    expect(xml).toContain('<rdg wit="#wit-Σ #wit-A_-2 #wit-a">slow</rdg>');
    expect(errors(xml)).toEqual([]);
  });

  it('with no witnesses and no segments', () => {
    expect(
      errors(exportEditionTei({ title: 'Empty', witnesses: [], runs: [], passages: [] })),
    ).toEqual([]);
  });
});

describe.skipIf(!xmllint)('the record pointers the exporters write', slow, () => {
  it('in an edition: the prefixes, every word as <w> with its provenance, segments with ids and passage URNs, witnesses pointing at their records', () => {
    const input = editionInput();
    const [first, ...rest] = input.runs;
    const tokens = first!.items.filter((i) => i.kind === 'token');
    tokens[0]!.source = {
      kind: 'witness',
      transcriptionId: 'T1',
      tokenIds: ['01JTOKEN0000000000000000A1', '01JTOKEN0000000000000000A2'],
    };
    tokens[1]!.source = { kind: 'conjecture', conjectureId: '01JCONJECTURE000000000001' };
    tokens[2]!.source = { kind: 'editor' };
    const xml = exportEditionTei({
      ...input,
      words: true,
      origin: 'https://varians.example/',
      witnesses: input.witnesses.map((w, i) => ({
        ...w,
        id: `01JWITNESS00000000000000${String(i).padStart(2, '0')}`,
      })),
      runs: [
        { ...first!, id: '01JSEGMENT000000000000001', urn: 'urn:cts:greekLit:tlg0012.tlg001:1.1' },
        ...rest,
      ],
    });
    expect(xml).toContain(
      '<prefixDef ident="tok" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="https://varians.example/id/$1"/>',
    );
    expect(xml).toContain(
      '<milestone unit="segment" n="1.1" xml:id="seg-01JSEGMENT000000000000001" corresp="urn:cts:greekLit:tlg0012.tlg001:1.1"/>',
    );
    expect(xml).toContain(
      'corresp="tok:01JTOKEN0000000000000000A1 tok:01JTOKEN0000000000000000A2">the</w>',
    );
    expect(xml).toContain('source="conj:01JCONJECTURE000000000001">quick</w>');
    expect(xml).toMatch(/<w xml:id="w-[^"]+">brown<\/w>/);
    expect(xml).toContain('corresp="wit:01JWITNESS0000000000000000"');
    expect(errors(xml)).toEqual([]);
  });

  it('the licence with its address, the note on rights, and the persons responsible', () => {
    const xml = exportEditionTei({
      ...editionInput(),
      licence: 'CC BY-SA 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      rightsNote: 'The text of witness A by courtesy of the library.',
      authority: 'Varians at an example',
      contributors: [
        { name: 'Josiah Carberry', resp: 'edition', orcid: '0000-0002-1825-0097' },
        { name: 'A. N. Other', resp: 'notes', personId: '01JPERSON0000000000000000A' },
      ],
    });
    expect(xml).toContain(
      '<availability><licence target="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</licence><licence>The text of witness A by courtesy of the library.</licence></availability>',
    );
    expect(xml).toContain(
      '<respStmt><resp>edition</resp><persName ref="https://orcid.org/0000-0002-1825-0097">Josiah Carberry</persName></respStmt>',
    );
    expect(xml).toContain('<persName ref="person:01JPERSON0000000000000000A">');
    expect(errors(xml)).toEqual([]);
    const transcription = exportTranscriptionTei({
      ...exportInput(),
      licence: 'CC0 1.0',
      licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      contributors: [{ name: 'Josiah Carberry', resp: 'transcription' }],
    });
    expect(errors(transcription)).toEqual([]);
  });

  it('in a transcription: the prefixes', () => {
    const xml = exportTranscriptionTei({ ...exportInput(), origin: 'https://varians.example' });
    expect(xml).toContain(
      '<encodingDesc><refsDecl><refState unit="segment"/></refsDecl><listPrefixDef>',
    );
    expect(errors(xml)).toEqual([]);
  });
});

describe.skipIf(!xmllint)('what milestone B5 adds is valid', slow, () => {
  const header = (extra: string) => `<teiHeader>
    <fileDesc>
      <titleStmt>
        <title>Iliad 1: an edition</title>
        <editor>Someone</editor>
        <respStmt><resp>transcription and collation</resp><persName ref="https://orcid.org/0000-0002-1825-0097">Josiah Carberry</persName></respStmt>
        <respStmt><resp>review</resp><persName ref="person:01JPERSON0000000000000000A">A. N. Other</persName></respStmt>
      </titleStmt>
      <publicationStmt><authority>Varians</authority><availability><licence target="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</licence></availability></publicationStmt>
      <sourceDesc>${extra}</sourceDesc>
    </fileDesc>
    <encodingDesc>
      <refsDecl><refState unit="segment"/></refsDecl>
      <variantEncoding method="parallel-segmentation" location="internal"/>
      <listPrefixDef>
        <prefixDef ident="tok" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="https://varians.eu/id/$1"/>
        <prefixDef ident="seg" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="https://varians.eu/id/$1"/>
        <prefixDef ident="wit" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="https://varians.eu/id/$1"/>
        <prefixDef ident="conj" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="https://varians.eu/id/$1"/>
        <prefixDef ident="person" matchPattern="([0-9A-HJKMNP-TV-Z]{26})" replacementPattern="https://varians.eu/id/$1"/>
      </listPrefixDef>
    </encodingDesc>
    <profileDesc><langUsage><language ident="grc"/></langUsage></profileDesc>
  </teiHeader>`;

  it('in an edition: the prefixes, words pointing at witness tokens and conjectures, segments with passage URNs, the licence and the contributors', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  ${header('<listWit><witness xml:id="wit-A" n="A" corresp="wit:01JWITNESS000000000000000A">Venetus A</witness></listWit>')}
  <text xml:lang="grc">
    <body>
      <div type="edition">
        <ab><milestone unit="segment" n="1.1" xml:id="seg-01JSEGMENT000000000000001" corresp="urn:cts:greekLit:tlg0012.tlg001:1.1"/><w xml:id="w-01JWORD0000000000000000001" corresp="tok:01JTOKEN0000000000000000A1 tok:01JTOKEN0000000000000000A2">μῆνιν</w> <app><lem wit="#wit-A"><w xml:id="w-01JWORD0000000000000000002" source="conj:01JCONJECTURE000000000001">ἄειδε</w></lem><rdg type="conjecture" source="conj:01JCONJECTURE000000000002">ἔννεπε</rdg></app> <w xml:id="w-01JWORD0000000000000000003">θεὰ</w></ab>
      </div>
    </body>
  </text>
</TEI>
`;
    expect(errors(xml)).toEqual([]);
  });

  it('in a transcription: the prefixes, the licence and the contributors beside the witness', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  ${header('<msDesc><msIdentifier><settlement>Venice</settlement><repository>Biblioteca Nazionale Marciana</repository><idno>Gr. Z. 454</idno><altIdentifier type="siglum"><idno>A</idno></altIdentifier></msIdentifier><head>Venetus A</head></msDesc>')}
  <text xml:lang="grc"><body><ab><milestone unit="segment" n="1.1"/><w xml:id="w-01JTOKEN0000000000000000A1">ΜΗΝΙΝ</w></ab></body></text>
</TEI>
`;
    expect(errors(xml)).toEqual([]);
  });
});
