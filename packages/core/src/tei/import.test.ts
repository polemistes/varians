import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isBreak, isToken, type Item, type Mark } from '../stream/items.ts';
import { detectStructure, importTei } from './import.ts';

const TEI = 'xmlns="http://www.tei-c.org/ns/1.0"';

function read(xml: string, supplements: 'drop' | 'keep' = 'drop') {
  return importTei(xml, { ids: sequentialIds(), supplements });
}

/** Items as short comparable records: forms with their marks and joins, break types, object types. */
function sketch(items: Item[]): unknown[] {
  return items.map((item) => {
    if (isToken(item)) {
      const out: Record<string, unknown> = { form: item.form };
      if (item.norm !== undefined) out.norm = item.norm;
      if (item.joinNext) out.join = true;
      if (item.marks) out.marks = item.marks;
      return out;
    }
    if (isBreak(item))
      return item.label === undefined
        ? { break: item.type }
        : { break: item.type, label: item.label };
    const out: Record<string, unknown> = { object: item.type };
    if (item.attrs) out.attrs = item.attrs;
    if (item.text !== undefined) out.text = item.text;
    return out;
  });
}

/** The warnings of an import, without the one every bare fragment gets. */
function notices(result: { warnings: string[] }): string[] {
  return result.warnings.filter((warning) => !warning.startsWith('No <body>'));
}

function forms(items: Item[]): string[] {
  return items.map((item) =>
    isToken(item) ? item.form : isBreak(item) ? `|${item.type}` : `[${item.type}]`,
  );
}

const ILIAD = `<TEI ${TEI}>
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Iliad</title><author>Homer</author></titleStmt>
      <publicationStmt><p>Perseus</p></publicationStmt>
      <sourceDesc><p>Monro and Allen</p></sourceDesc>
    </fileDesc>
    <profileDesc><langUsage><language ident="grc">Greek</language></langUsage></profileDesc>
  </teiHeader>
  <text>
    <body>
      <div type="edition" n="urn:cts:greekLit:tlg0012.tlg001.perseus-grc2" xml:lang="grc">
        <div type="textpart" subtype="book" n="1">
          <l n="1">μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος</l>
          <l n="2">οὐλομένην, ἣ μυρί᾽ <lb/>Ἀχαιοῖς ἄλγε᾽ ἔθηκε,</l>
        </div>
        <div type="textpart" subtype="book" n="2">
          <l n="1">ἄλλοι μέν ῤα θεοί τε</l>
        </div>
      </div>
    </body>
  </text>
</TEI>`;

const PLATO = `<TEI ${TEI}><text><body>
  <div type="edition" n="urn:cts:greekLit:tlg0059.tlg002.perseus-grc1">
    <milestone unit="page" n="17"/><milestone unit="section" n="a"/>
    <p><said who="#Socrates">ὅτι μὲν ὑμεῖς, ὦ ἄνδρες Ἀθηναῖοι, πεπόνθατε</said> <milestone unit="section" n="b"/>ὑπὸ τῶν ἐμῶν κατηγόρων, οὐκ οἶδα·</p>
    <milestone unit="page" n="18"/><milestone unit="section" n="a"/>
    <p>ἐγὼ δ᾽ οὖν καὶ αὐτὸς</p>
  </div>
</body></text></TEI>`;

const INSCRIPTION = `<TEI ${TEI}><text><body>
  <div type="edition" xml:lang="grc">
    <ab>
      <lb n="1"/>ὁ δῆμος <supplied reason="lost">τὸν</supplied> δεῖνα ἄ<lb n="2" break="no"/>ρχοντα
      <gap reason="lost" quantity="3" unit="character"/> ἀρε<unclear>τ</unclear>ῆς
      <lb n="3"/><expan>Ἀπολ<ex>λωνίου</ex></expan> ἀν<supplied reason="lost">δ</supplied>ρα κα<gap reason="illegible" quantity="2" unit="character"/>ς
    </ab>
  </div>
</body></text></TEI>`;

const MANUSCRIPT = `<TEI ${TEI}>
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Venetus A</title></titleStmt>
      <publicationStmt><p/></publicationStmt>
      <sourceDesc>
        <msDesc>
          <msIdentifier><settlement>Venice</settlement><repository>Biblioteca Marciana</repository><idno>Gr. Z. 454</idno></msIdentifier>
          <msContents><summary>Iliad with scholia</summary><msItem><title>Ilias</title></msItem></msContents>
          <physDesc>
            <objectDesc><supportDesc><support><material>parchment</material></support><extent>327 leaves</extent></supportDesc></objectDesc>
            <handDesc><handNote>one main hand</handNote></handDesc>
          </physDesc>
          <history><origin><origDate notBefore="0900" notAfter="0999">10th century</origDate></origin></history>
        </msDesc>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <facsimile><surface xml:id="f12r"><graphic url="https://images.example/12r.jpg"/></surface></facsimile>
  <text><body>
    <pb n="12r" facs="#f12r"/>
    <cb n="a"/>
    <ab>
      <lb/>ΜΗΝΙΝ ΑΕΙΔΕ <choice><abbr>ΘΑ</abbr><expan>ΘΕΑ</expan></choice>
      <lb/><del rend="strikethrough">ΠΗΛΗΙ</del> <add place="above">ΠΗΛΗΙΑΔΕΩ</add> ΑΧΙΛΗΟΣ
      <lb/><choice><orig>ΟΥΛΟΜΕΝΗΝ</orig><reg>οὐλομένην</reg></choice> <hi rend="rubric">Η</hi> <handShift new="#h2"/>ΜΥΡΙ
    </ab>
    <cb n="b"/>
    <ab><lb/>ΑΧΑΙΟΙΣ <note place="margin">σχόλιον</note> ΑΛΓΕ</ab>
  </body></text>
</TEI>`;

describe('importTei: a Perseus-style Iliad', () => {
  const result = read(ILIAD);

  it('reads the header', () => {
    expect(result.header).toEqual({ title: 'Iliad', author: 'Homer', language: 'grc' });
    expect(result.witness).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('makes whitespace-separated tokens with punctuation attached, and line breaks between lines but not at the start', () => {
    expect(forms(result.stream.items)).toEqual([
      'μῆνιν',
      'ἄειδε',
      'θεὰ',
      'Πηληϊάδεω',
      'Ἀχιλῆος',
      '|line',
      'οὐλομένην,',
      'ἣ',
      'μυρί᾽',
      '|line',
      'Ἀχαιοῖς',
      'ἄλγε᾽',
      'ἔθηκε,',
      '|line',
      'ἄλλοι',
      'μέν',
      'ῤα',
      'θεοί',
      'τε',
    ]);
  });

  it('reports a segment start per numbered line with the book from the div, leaving the edition div out', () => {
    expect(result.segmentStarts).toEqual([
      {
        itemIndex: 0,
        parts: [
          { unit: 'book', n: '1' },
          { unit: 'line', n: '1' },
        ],
      },
      {
        itemIndex: 6,
        parts: [
          { unit: 'book', n: '1' },
          { unit: 'line', n: '2' },
        ],
      },
      {
        itemIndex: 14,
        parts: [
          { unit: 'book', n: '2' },
          { unit: 'line', n: '1' },
        ],
      },
    ]);
    expect(result.pages).toEqual([]);
  });

  it('uses the ids given', () => {
    expect(result.stream.items.map((i) => i.id).slice(0, 3)).toEqual(['t1', 't2', 't3']);
  });
});

describe('importTei: Plato with Stephanus milestones', () => {
  const result = read(PLATO);

  it('accumulates page and section milestones and resets the section at a new page', () => {
    const items = result.stream.items;
    const at = (form: string) => items.findIndex((i) => isToken(i) && i.form === form);
    expect(result.segmentStarts).toEqual([
      {
        itemIndex: 0,
        parts: [
          { unit: 'page', n: '17' },
          { unit: 'section', n: 'a' },
        ],
      },
      {
        itemIndex: at('ὑπὸ'),
        parts: [
          { unit: 'page', n: '17' },
          { unit: 'section', n: 'b' },
        ],
      },
      {
        itemIndex: at('ἐγὼ'),
        parts: [
          { unit: 'page', n: '18' },
          { unit: 'section', n: 'a' },
        ],
      },
    ]);
  });

  it('makes a paragraph break between paragraphs and keeps said transparent without warnings', () => {
    expect(result.stream.items.filter(isBreak).map((b) => b.type)).toEqual(['paragraph']);
    expect(result.warnings).toEqual([]);
    expect(forms(result.stream.items).slice(0, 3)).toEqual(['ὅτι', 'μὲν', 'ὑμεῖς,']);
  });
});

describe('importTei: an EpiDoc inscription', () => {
  const result = read(INSCRIPTION);

  it('reads supplied, unclear, gaps, expansions and a word divided at a line end', () => {
    expect(sketch(result.stream.items)).toEqual([
      { form: 'ὁ' },
      { form: 'δῆμος' },
      // What its editor supplied where the stone is lost is not the stone's: the gap is.
      { object: 'gap', attrs: { reason: 'lost', unit: 'character', quantity: 3 } },
      { form: 'δεῖνα' },
      { form: 'ἄ', join: true },
      { break: 'line', label: '2' },
      { form: 'ρχοντα' },
      { object: 'gap', attrs: { reason: 'lost', quantity: 3, unit: 'character' } },
      { form: 'ἀρετῆς', marks: [{ kind: 'unclear', from: 3, to: 4 }] },
      { break: 'line', label: '3' },
      { form: 'Ἀπολ', marks: [{ kind: 'abbr', attrs: { expan: 'Ἀπολλωνίου' } }] },
      {
        form: 'ἀνρα',
        marks: [
          {
            kind: 'gap',
            attrs: { reason: 'lost', unit: 'character', quantity: 1 },
            from: 2,
            to: 2,
          },
        ],
      },
      {
        form: 'κας',
        marks: [
          {
            kind: 'gap',
            attrs: { reason: 'illegible', quantity: 2, unit: 'character' },
            from: 2,
            to: 2,
          },
        ],
      },
    ]);
  });

  it('offers the numbered line breaks as segment starts and finds the language on the div', () => {
    expect(result.segmentStarts).toEqual([
      { itemIndex: 0, parts: [{ unit: 'lb', n: '1' }] },
      { itemIndex: 6, parts: [{ unit: 'lb', n: '2' }] },
      { itemIndex: 10, parts: [{ unit: 'lb', n: '3' }] },
    ]);
    expect(result.header.language).toBe('grc');
    expect(result.warnings).toEqual([]);
  });
});

describe('importTei: a manuscript transcription', () => {
  const result = read(MANUSCRIPT);

  it('reads pages, columns, abbreviations, deletions, additions, regularizations, hand shifts and notes', () => {
    expect(sketch(result.stream.items)).toEqual([
      { break: 'page', label: '12r' },
      { break: 'column', label: 'a' },
      { form: 'ΜΗΝΙΝ' },
      { form: 'ΑΕΙΔΕ' },
      { form: 'ΘΑ', marks: [{ kind: 'abbr', attrs: { expan: 'ΘΕΑ' } }] },
      { break: 'line' },
      { form: 'ΠΗΛΗΙ', marks: [{ kind: 'del', attrs: { rend: 'strikethrough' } }] },
      { form: 'ΠΗΛΗΙΑΔΕΩ', marks: [{ kind: 'add', attrs: { place: 'above' } }] },
      { form: 'ΑΧΙΛΗΟΣ' },
      { break: 'line' },
      { form: 'ΟΥΛΟΜΕΝΗΝ', norm: 'οὐλομένην' },
      { form: 'Η', marks: [{ kind: 'hi', attrs: { rend: 'rubric' } }] },
      { form: 'ΜΥΡΙ', marks: [{ kind: 'handShift', attrs: { new: '#h2' } }] },
      { break: 'column', label: 'b' },
      { form: 'ΑΧΑΙΟΙΣ' },
      { object: 'note', attrs: { place: 'margin' }, text: 'σχόλιον' },
      { form: 'ΑΛΓΕ' },
    ]);
  });

  it('lists the pages with their facsimile images', () => {
    expect(result.pages).toEqual([
      { label: '12r', facs: '#f12r', imageUrl: 'https://images.example/12r.jpg', itemIndex: 0 },
    ]);
  });

  it('reads the manuscript description', () => {
    expect(result.header.title).toBe('Venetus A');
    expect(result.witness).toEqual({
      settlement: 'Venice',
      repository: 'Biblioteca Marciana',
      idno: 'Gr. Z. 454',
      title: 'Ilias',
      description: 'Iliad with scholia',
      date: '10th century',
      material: 'parchment',
      extent: '327 leaves',
      hands: 'one main hand',
    });
  });
});

describe('importTei: tokens and marks', () => {
  it('marks every word an element spans, and only the letters it covers inside a word', () => {
    const result = read(`<ab>ab<unclear>cd ef</unclear>gh <del>x y</del></ab>`);
    expect(sketch(result.stream.items)).toEqual([
      { form: 'abcd', marks: [{ kind: 'unclear', from: 2, to: 4 }] },
      { form: 'efgh', marks: [{ kind: 'unclear', from: 0, to: 2 }] },
      { form: 'x', marks: [{ kind: 'del' }] },
      { form: 'y', marks: [{ kind: 'del' }] },
    ]);
  });

  it('merges adjacent pieces of one mark', () => {
    const result = read(
      `<ab><unclear>ab<supplied>c</supplied></unclear><supplied>de</supplied></ab>`,
      'keep',
    );
    const marks = (result.stream.items[0] as { marks: Mark[] }).marks;
    expect(marks).toEqual([
      { kind: 'unclear', from: 0, to: 3 },
      { kind: 'supplied', from: 2, to: 5 },
    ]);
  });

  it('reads one token per w, joins a word divided inside a w or between adjacent ws, and attaches punctuation after a w', () => {
    const result = read(`<ab><w>ἄνδ<lb break="no"/>ρα</w> <w>μοι</w>, <w>ἔν</w><w>νεπε</w></ab>`);
    expect(sketch(result.stream.items)).toEqual([
      { form: 'ἄνδ', join: true },
      { break: 'line' },
      { form: 'ρα' },
      { form: 'μοι,' },
      { form: 'ἔν', join: true },
      { form: 'νεπε' },
    ]);
  });

  it('reads a correction and a regularization as the read form, and a space between words', () => {
    const result = read(
      `<ab><choice><sic>θεος</sic><corr>θεὸς</corr></choice> πρ<choice><orig>ο</orig><reg>ω</reg></choice>τος <space quantity="2" unit="character"/> x</ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'θεος', norm: 'θεὸς' },
      { form: 'προτος', norm: 'πρωτος' },
      { object: 'space', attrs: { quantity: 2, unit: 'character' } },
      { form: 'x' },
    ]);
  });

  it('divides a regularization of several words among them', () => {
    const result = read(`<ab><choice><orig>a b</orig><reg>c d</reg></choice></ab>`);
    expect(sketch(result.stream.items)).toEqual([
      { form: 'a', norm: 'c' },
      { form: 'b', norm: 'd' },
    ]);
  });
});

describe('importTei: what its editor added to a carrier', () => {
  const lost = (quantity: number) => ({ reason: 'lost', unit: 'character', quantity });
  const gapAt = (at: number, quantity: number) => ({
    kind: 'gap',
    attrs: lost(quantity),
    from: at,
    to: at,
  });

  it('leaves the gap where words were supplied, one gap for a run of them, and a point in a word the gap breaks', () => {
    const result = read(
      `<ab><supplied reason="lost">μῆνιν ἄει</supplied>δε θεὰ <supplied reason="lost">Πηληϊάδεω Ἀχιλῆος</supplied> οὐλο<supplied reason="lost">μένην</supplied></ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { object: 'gap', attrs: lost(5) },
      { form: 'δε', marks: [gapAt(0, 3)] },
      { form: 'θεὰ' },
      { object: 'gap', attrs: lost(16) },
      { form: 'οὐλο', marks: [gapAt(4, 5)] },
    ]);
    expect(notices(result)).toEqual([]);
  });

  it('keeps a supplement that runs over a line end as a gap on either line', () => {
    const result = read(
      `<ab><lb n="1"/>ἄλγε᾽ <supplied reason="lost">ἔθηκε <lb n="2"/>πολλὰς</supplied> δ᾽</ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'ἄλγε᾽' },
      { object: 'gap', attrs: lost(5) },
      { break: 'line', label: '2' },
      { object: 'gap', attrs: lost(6) },
      { form: 'δ᾽' },
    ]);
  });

  it('counts a gap inside a supplement with it, and makes the whole unknown when the gap is', () => {
    const known = read(
      `<ab><supplied reason="lost">ἀπο<gap reason="lost" quantity="2" unit="character"/></supplied>ψαμένην</ab>`,
    );
    expect(sketch(known.stream.items)).toEqual([{ form: 'ψαμένην', marks: [gapAt(0, 5)] }]);
    const unknown = read(
      `<ab>α <supplied reason="lost">βγ <gap reason="lost" extent="unknown" unit="character"/></supplied> δ</ab>`,
    );
    expect(sketch(unknown.stream.items)).toEqual([
      { form: 'α' },
      { object: 'gap', attrs: { reason: 'lost', unit: 'character', extent: 'unknown' } },
      { form: 'δ' },
    ]);
  });

  it('reads a gap that touches letters as a point of their word, and one that touches none as an object', () => {
    const gap = `<gap reason="lost" quantity="3" unit="character"/>`;
    const result = read(`<ab>${gap}δε θε${gap} ${gap} ἄλ${gap}γε</ab>`);
    expect(sketch(result.stream.items)).toEqual([
      { form: 'δε', marks: [gapAt(0, 3)] },
      { form: 'θε', marks: [gapAt(2, 3)] },
      { object: 'gap', attrs: lost(3) },
      { form: 'ἄλγε', marks: [gapAt(2, 3)] },
    ]);
  });

  it('takes letters the editor adds or brackets inside a word as its read form, to be confirmed', () => {
    const result = read(
      `<ab>ἀπ<supplied reason="omitted">ε</supplied>γραψάμην ὁμο<surplus>μο</surplus>λογῶ</ab>`,
    );
    expect(result.stream.items).toMatchObject([
      { form: 'ἀπγραψάμην', norm: 'ἀπεγραψάμην', unchecked: true },
      { form: 'ὁμομολογῶ', norm: 'ὁμολογῶ', unchecked: true },
    ]);
    expect(result.stream.items.every((item) => !('marks' in item))).toBe(true);
  });

  it('leaves out a whole word the editor adds, and keeps a whole word the editor brackets, unmarked', () => {
    const result = read(
      `<ab>τοῦ <supplied reason="omitted">καὶ</supplied> τοῦ <surplus>ὀνόματος</surplus> τοῦ</ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'τοῦ' },
      { form: 'τοῦ' },
      { form: 'ὀνόματος' },
      { form: 'τοῦ' },
    ]);
  });

  it('reads a correction as the read form, to be confirmed, and a regularization without what was supplied in it', () => {
    const result = read(
      `<ab><choice><corr>τιμὴν</corr><sic>τμμὴν</sic></choice> <choice><reg>φρόντι<supplied reason="lost">σ</supplied>ον</reg><orig>φρόνδει<supplied reason="lost">σ</supplied><unclear>ο</unclear>ν</orig></choice></ab>`,
    );
    expect(result.stream.items).toMatchObject([
      { form: 'τμμὴν', norm: 'τιμὴν', unchecked: true },
      {
        form: 'φρόνδειον',
        norm: 'φρόντιον',
        marks: [{ kind: 'unclear', from: 7, to: 8 }, gapAt(7, 1)],
      },
    ]);
    expect((result.stream.items[1] as { unchecked?: boolean }).unchecked).toBeUndefined();
  });

  it('takes the reading its editor chose where others are given, without a warning', () => {
    const result = read(
      `<ab><app type="editorial"><lem resp="BL 9.17">αἱ τοῦ</lem><rdg>Θίτου</rdg></app> <app type="alternative"><lem>Ὀχυρυγχίτου</lem><rdg>Ὀξυρυγχίτου νομοῦ</rdg></app></ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'αἱ' },
      { form: 'τοῦ' },
      { form: 'Ὀχυρυγχίτου' },
    ]);
    expect(notices(result)).toEqual([]);
  });

  it('keeps all of it for a printed edition used as a witness, whose text it is', () => {
    const result = read(
      `<ab><supplied reason="lost">μῆνιν</supplied> ὁμο<surplus>μο</surplus>λογῶ <choice><corr>τιμὴν</corr><sic>τμμὴν</sic></choice></ab>`,
      'keep',
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'μῆνιν', marks: [{ kind: 'supplied', attrs: { reason: 'lost' } }] },
      { form: 'ὁμομολογῶ', marks: [{ kind: 'surplus', from: 3, to: 5 }] },
      { form: 'τμμὴν', marks: [{ kind: 'corr', attrs: { corr: 'τιμὴν' } }] },
    ]);
  });
});

describe('importTei: the signs of a papyrus', () => {
  it('reads numbers, another language, a quotation and a doubt as marks', () => {
    const result = read(
      `<ab><num value="16">ιϛ</num> <num value="4"/> <foreign xml:lang="la">comes</foreign> <q>ὁ γὰρ</q> <add place="above">ὅλων<certainty match=".." locus="name"/></add></ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'ιϛ', marks: [{ kind: 'num', attrs: { value: '16' } }] },
      { form: 'comes', marks: [{ kind: 'foreign', attrs: { lang: 'la' } }] },
      { form: 'ὁ', marks: [{ kind: 'q' }] },
      { form: 'γὰρ', marks: [{ kind: 'q' }] },
      { form: 'ὅλων', marks: [{ kind: 'add', attrs: { place: 'above', cert: 'low' } }] },
    ]);
    expect(notices(result)).toEqual([]);
  });

  it('reads signs that are not letters as mark objects, and what is said of a gap', () => {
    const result = read(
      `<ab>α <g type="stauros"/> <unclear><g type="check"/></unclear> <g type="chirho">☧</g> <milestone rend="paragraphos" unit="undefined"/> β <gap reason="illegible" quantity="15" unit="line"><desc>vestiges</desc></gap> <gap reason="lost" extent="unknown" unit="line"><certainty match=".." locus="name"/></gap></ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'α' },
      { object: 'mark', attrs: { g: 'stauros' } },
      { object: 'mark', attrs: { g: 'check', unclear: true } },
      { object: 'mark', attrs: { g: 'chirho' }, text: '☧' },
      { object: 'mark', attrs: { rend: 'paragraphos', unit: 'undefined' } },
      { form: 'β' },
      {
        object: 'gap',
        attrs: { reason: 'illegible', quantity: 15, unit: 'line', desc: 'vestiges' },
      },
      { object: 'gap', attrs: { reason: 'lost', extent: 'unknown', unit: 'line', cert: 'low' } },
    ]);
  });

  it('takes the expansion as the form of a word a symbol stands for', () => {
    const result = read(
      `<ab><expan><ex>ἔτους</ex></expan> <expan>Καρ<ex cert="low">ανίδι</ex></expan></ab>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { form: 'ἔτους', marks: [{ kind: 'abbr', attrs: { expan: 'ἔτους', symbol: true } }] },
      { form: 'Καρ', marks: [{ kind: 'abbr', attrs: { expan: 'Καρανίδι', cert: 'low' } }] },
    ]);
  });
});

describe('importTei: structure', () => {
  it('does not stack breaks at the starts of line groups and divs, and makes one paragraph break between paragraphs', () => {
    const result = read(`<div><lg><l>a</l><l>b</l></lg><lg><l>c</l></lg><p>d</p><p>e</p></div>`);
    expect(forms(result.stream.items)).toEqual([
      'a',
      '|line',
      'b',
      '|line',
      'c',
      '|paragraph',
      'd',
      '|paragraph',
      'e',
    ]);
  });

  it('makes paratext objects of heads and speakers and reports unknown elements once', () => {
    const result = read(
      `<div><head>Title</head><sp><speaker>A.</speaker><l n="1">x <foo>y</foo> <bar>z</bar></l></sp></div>`,
    );
    expect(sketch(result.stream.items)).toEqual([
      { object: 'paratext', attrs: { type: 'head' }, text: 'Title' },
      { break: 'line' },
      { object: 'paratext', attrs: { type: 'speaker' }, text: 'A.' },
      { break: 'line' },
      { form: 'x' },
      { form: 'y' },
      { form: 'z' },
    ]);
    expect(result.warnings).toEqual([
      'No <body> element was found; the whole document was read as text.',
      'Unknown elements were kept as text: bar, foo.',
    ]);
  });

  it('keeps only the lemma of an apparatus entry and says so once', () => {
    const result = read(
      `<ab>a <app><lem>b</lem><rdg wit="#A">c</rdg></app> <app><lem>d</lem><rdg>e</rdg></app></ab>`,
    );
    expect(forms(result.stream.items)).toEqual(['a', 'b', 'd']);
    expect(result.warnings).toEqual([
      'No <body> element was found; the whole document was read as text.',
      'Apparatus entries (app) were reduced to their lemma; readings were not imported.',
    ]);
  });

  it('breaks the line before a speaker or head met inside a line, but not before a stage direction', () => {
    const result = read(
      `<body><sp><speaker>A.</speaker><l n="1">x <stage>aside</stage> y</l></sp><sp><speaker>B.</speaker><l n="2">z</l></sp></body>`,
    );
    expect(forms(result.stream.items)).toEqual([
      '[paratext]',
      '|line',
      'x',
      '[paratext]',
      'y',
      '|line',
      '[paratext]',
      '|line',
      'z',
    ]);
  });

  it('attaches punctuation before a w to it, and keeps entities and namespace prefixes out of the way', () => {
    const result = read(
      `<tei:TEI xmlns:tei="http://www.tei-c.org/ns/1.0"><tei:text xml:lang="la"><tei:body><tei:ab><tei:pc>«</tei:pc><tei:w>a</tei:w> &amp; <![CDATA[b<c]]> &#x3b1;</tei:ab></tei:body></tei:text></tei:TEI>`,
    );
    expect(forms(result.stream.items)).toEqual(['«a', '&', 'b<c', 'α']);
    expect(result.header.language).toBe('la');
    expect(notices(result)).toEqual([]);
  });

  it('reads every text of a group', () => {
    const result = read(
      `<TEI ${TEI}><text><group><text><body><p>a</p></body></text><text><body><p>b</p></body></text></group></text></TEI>`,
    );
    expect(forms(result.stream.items)).toEqual(['a', '|paragraph', 'b']);
  });

  it('reads figures with their descriptions and a page break without a number', () => {
    const result = read(`<ab>a <pb/> <figure><figDesc>a drawing</figDesc></figure> b</ab>`);
    expect(sketch(result.stream.items)).toEqual([
      { form: 'a' },
      { break: 'page', label: '1' },
      { object: 'figure', text: 'a drawing' },
      { form: 'b' },
    ]);
    expect(result.pages).toEqual([{ label: '1', itemIndex: 1 }]);
  });

  it('rejects XML that is not well formed', () => {
    expect(() => read('<ab><w>a</ab>')).toThrow(/line 1/u);
  });
});

describe('detectStructure', () => {
  it('counts the numbered units of an epic text', () => {
    expect(detectStructure(ILIAD)).toEqual({
      units: [
        { unit: 'book', count: 2, example: '1' },
        { unit: 'line', count: 3, example: '1' },
      ],
      hasLineElements: true,
      hasWordElements: false,
      pageBreaks: 0,
    });
  });

  it('counts milestones by unit', () => {
    expect(detectStructure(PLATO).units).toEqual([
      { unit: 'page', count: 2, example: '17' },
      { unit: 'section', count: 3, example: 'a' },
    ]);
  });

  it('counts numbered line breaks, words and page breaks', () => {
    const structure = detectStructure(
      `<ab><pb n="1"/><lb n="1"/><w>a</w><lb n="2"/><w>b</w><pb n="2"/><lb n="3"/>c</ab>`,
    );
    expect(structure).toEqual({
      units: [{ unit: 'lb', count: 3, example: '1' }],
      hasLineElements: false,
      hasWordElements: true,
      pageBreaks: 2,
    });
  });
});

describe('importTei: hands and stages of corrections', () => {
  it('reads hand pointers as hand ids and seq as a number', () => {
    const result = read(`<ab>a <del hand="#hand-h2" seq="2">b</del> <add hand="#m3">c</add></ab>`);
    const marks = result.stream.items
      .filter((i) => i.kind === 'token')
      .map((t) => (t as { marks?: unknown }).marks);
    expect(marks[1]).toEqual([{ kind: 'del', attrs: { hand: 'h2', seq: 2 } }]);
    expect(marks[2]).toEqual([{ kind: 'add', attrs: { hand: 'm3' } }]);
  });
});
