import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import { isBreak, isToken, type Item, type Mark, type Token } from '../stream/items.ts';
import { isElement, parseXml, type XmlNode } from '../tei/xml.ts';
import { units } from '../stream/words.ts';
import { importLeidenPlus, isLeidenPlus, leidenPlusToEpiDoc } from './leidenplus.ts';
import { toLeidenPlus } from './leidenplus-write.ts';

/** XML as a comparable form: names, attributes in order of name, text with its spaces collapsed, empty text left out. */
function shape(node: XmlNode): unknown {
  if (!isElement(node)) return node.text.replace(/\s+/gu, ' ').trim();
  const attrs = Object.fromEntries(
    Object.entries(node.attrs).sort(([a], [b]) => a.localeCompare(b)),
  );
  const children = node.children.map(shape).filter((child) => child !== '');
  return { [node.name]: Object.keys(attrs).length ? [attrs, ...children] : children };
}

/** The EpiDoc of a piece of Leiden+ that stands inside a block. */
function epidoc(leiden: string): { xml: unknown; warnings: string[] } {
  const { xml, warnings } = leidenPlusToEpiDoc(`<S=.grc<=${leiden}=>`);
  const ab = parseXml(xml).children.find(isElement)!;
  return { xml: ab.children.map(shape).filter((child) => child !== ''), warnings };
}

function expected(xml: string): unknown {
  return parseXml(`<ab>${xml}</ab>`)
    .children.map(shape)
    .filter((child) => child !== '');
}

/**
 * The pairs of the Leiden+ documentation of papyri.info: this Leiden+, to
 * create this XML. Where the documentation's own example is cut short or
 * misprinted, the pair is left out.
 */
const PAIRS: [name: string, leiden: string, xml: string][] = [
  ['line break', '1. α', '<lb n="1"/>α'],
  ['word that wraps', '5.- α', '<lb n="5" break="no"/>α'],
  ['line 5 to 6', '5/6. α', '<lb n="5/6"/>α'],
  ['line perpendicular', '(2, perpendicular) α', '<lb n="2" rend="perpendicular"/>α'],
  ['line inverse with word-wrap', '(3.-, inverse) α', '<lb n="3" rend="inverse" break="no"/>α'],
  ['line in left margin', '3,ms. α', '<lb n="3,ms"/>α'],
  [
    'line in margin, perpendicular',
    '(8,ms, perpendicular) α',
    '<lb n="8,ms" rend="perpendicular"/>α',
  ],
  ['vacat, unknown', 'vac.?', '<space extent="unknown" unit="character"/>'],
  ['vacat, quantity', 'vac.3', '<space quantity="3" unit="character"/>'],
  ['vacat, range', 'vac.2-5', '<space atLeast="2" atMost="5" unit="character"/>'],
  ['vacat, about', 'vac.ca.3', '<space quantity="3" unit="character" precision="low"/>'],
  ['vacat, lines', 'vac.3lin', '<space quantity="3" unit="line"/>'],
  ['vacat, lines unknown', 'vac.?lin', '<space extent="unknown" unit="line"/>'],
  ['added above', '\\ὅλων/', '<add place="above">ὅλων</add>'],
  ['added below', '//<#δ=4#>\\\\', '<add place="below"><num value="4">δ</num></add>'],
  ['added at left', '||left:καὶ||', '<add place="left">καὶ</add>'],
  [
    'added between lines',
    '||interlin: ὧ( ῾)ν||',
    '<add place="interlinear"><hi rend="asper">ὧ</hi>ν</add>',
  ],
  ['sling in margin', '<|ν|>', '<add rend="sling" place="margin">ν</add>'],
  [
    'underline in margin',
    '<_οὕτως ἔχει_>',
    '<add rend="underline" place="margin">οὕτως ἔχει</add>',
  ],
  ['text in box', '###', '<milestone rend="box" unit="undefined"/>'],
  ['tall', '~||x||~tall', '<hi rend="tall">x</hi>'],
  ['superscript', '|^Ἡρωνείνῳ^|', '<hi rend="superscript">Ἡρωνείνῳ</hi>'],
  ['subscript', '\\|τα|/', '<hi rend="subscript">τα</hi>'],
  [
    'supraline',
    '¯νο.1¯',
    '<hi rend="supraline">νο<gap reason="illegible" quantity="1" unit="character"/></hi>',
  ],
  ['lines lost', 'lost.7lin', '<gap reason="lost" quantity="7" unit="line"/>'],
  [
    'lines lost, about',
    'lost.ca.7lin',
    '<gap reason="lost" quantity="7" unit="line" precision="low"/>',
  ],
  ['lines lost, range', 'lost.3-4lin', '<gap reason="lost" atLeast="3" atMost="4" unit="line"/>'],
  ['lines lost, unknown', 'lost.?lin', '<gap reason="lost" extent="unknown" unit="line"/>'],
  [
    'lines lost, doubted',
    'lost.?lin(?) ',
    '<gap reason="lost" extent="unknown" unit="line"><certainty match=".." locus="name"/></gap>',
  ],
  ['illegible', '.3', '<gap reason="illegible" quantity="3" unit="character"/>'],
  ['illegible, unknown', '.?', '<gap reason="illegible" extent="unknown" unit="character"/>'],
  [
    'illegible, about',
    'ca.23',
    '<gap reason="illegible" quantity="23" unit="character" precision="low"/>',
  ],
  [
    'illegible, range',
    '.9-10',
    '<gap reason="illegible" atLeast="9" atMost="10" unit="character"/>',
  ],
  ['illegible lines', '.5lin', '<gap reason="illegible" quantity="5" unit="line"/>'],
  [
    'illegible lines, about',
    'ca.20lin',
    '<gap reason="illegible" quantity="20" unit="line" precision="low"/>',
  ],
  [
    'vestiges, lines',
    'vestig.15lin',
    '<gap reason="illegible" quantity="15" unit="line"><desc>vestiges</desc></gap>',
  ],
  [
    'vestiges, range of lines',
    'vestig.2-3lin',
    '<gap reason="illegible" atLeast="2" atMost="3" unit="line"><desc>vestiges</desc></gap>',
  ],
  [
    'vestiges, about',
    'vestig.ca.3lin',
    '<gap reason="illegible" quantity="3" unit="line" precision="low"><desc>vestiges</desc></gap>',
  ],
  [
    'vestiges, unknown lines',
    'vestig.?lin',
    '<gap reason="illegible" extent="unknown" unit="line"/>',
  ],
  [
    'vestiges, unknown characters',
    'vestig ',
    '<gap reason="illegible" extent="unknown" unit="character"><desc>vestiges</desc></gap>',
  ],
  [
    'vestiges, characters',
    'vestig.14char',
    '<gap reason="illegible" quantity="14" unit="character"><desc>vestiges</desc></gap>',
  ],
  ['supplied omitted', '<ἀπεγραψάμην>', '<supplied reason="omitted">ἀπεγραψάμην</supplied>'],
  ['supplied omitted, doubted', '<οὐκ(?)>', '<supplied reason="omitted" cert="low">οὐκ</supplied>'],
  [
    'supplied omitted, inline',
    'ἀπ<ε>γραψάμην',
    'ἀπ<supplied reason="omitted">ε</supplied>γραψάμην',
  ],
  ['surplus', '{ὀνόματος}', '<surplus>ὀνόματος</surplus>'],
  ['surplus, inline', 'ὁμο{μο}λογῶ.', 'ὁμο<surplus>μο</surplus>λογῶ.'],
  ['deletion', '〚τοῖς κορασίοις〛', '<del rend="erasure">τοῖς κορασίοις</del>'],
  [
    'deletion with slashes',
    '〚/ τραπέζης Φρέμει. 〛',
    '<del rend="slashes"> τραπέζης Φρέμει. </del>',
  ],
  [
    'deletion with cross-strokes',
    '〚X $m4 lost.?lin 〛',
    '<del rend="cross-strokes"> <handShift new="m4"/> <gap reason="lost" extent="unknown" unit="line"/> </del>',
  ],
  ['expansion', '(στρατηγ(ός))', '<expan>στρατηγ<ex>ός</ex></expan>'],
  ['expansion, doubted', '(Καρ(ανίδι?))', '<expan>Καρ<ex cert="low">ανίδι</ex></expan>'],
  ['expansion of a symbol', '((ἔτους))', '<expan><ex>ἔτους</ex></expan>'],
  ['expansion of a symbol, doubted', '((ἔτους?))', '<expan><ex cert="low">ἔτους</ex></expan>'],
  ['abbreviation', '(|ομυο|)', '<abbr>ομυο</abbr>'],
  [
    'abbreviation with markup',
    '(|[.8]χυρι̣ο|)',
    '<abbr><gap reason="lost" quantity="8" unit="character"/>χυρ<unclear>ι</unclear>ο</abbr>',
  ],
  ['abbreviation, doubted', '(|λ(?)|)', '<abbr>λ<certainty locus="name" match=".."/></abbr>'],
  ['lost characters', '[.8]', '<gap reason="lost" quantity="8" unit="character"/>'],
  [
    'lost characters, about',
    '[ca.5]',
    '<gap reason="lost" quantity="5" unit="character" precision="low"/>',
  ],
  [
    'lost characters, range',
    '[.11-15]',
    '<gap reason="lost" atLeast="11" atMost="15" unit="character"/>',
  ],
  ['lost characters, unknown', '[.?]', '<gap reason="lost" extent="unknown" unit="character"/>'],
  ['supplied lost', '[ὁμο]λογῶ', '<supplied reason="lost">ὁμο</supplied>λογῶ'],
  [
    'supplied lost, doubted',
    'ἡμετέρ[α μήτηρ (?)] [.?]',
    'ἡμετέρ<supplied reason="lost" cert="low">α μήτηρ </supplied> <gap reason="lost" extent="unknown" unit="character"/>',
  ],
  [
    'supplied from a parallel',
    '|_Πόσεις_|',
    '<supplied evidence="parallel" reason="undefined">Πόσεις</supplied>',
  ],
  [
    'supplied from a parallel, lost',
    '_[abc]_',
    '<supplied evidence="parallel" reason="lost">abc</supplied>',
  ],
  ['hand', '$m4 ', '<handShift new="m4"/>'],
  ['hand, doubted', '$m3(?) ', '<handShift new="m3" cert="low"/>'],
  [
    'note',
    '/*BGU 1,108,r reprinted in WChr 227*/',
    '<note xml:lang="en">BGU 1,108,r reprinted in WChr 227</note>',
  ],
  [
    'quotation',
    '" ὁ γὰ̣ρ̣ ἐ̣λ̣εῶ̣ν̣ [πτωχόν] "',
    '<q> ὁ γ<unclear>ὰρ</unclear> <unclear>ἐλ</unclear>ε<unclear>ῶν</unclear> <supplied reason="lost">πτωχόν</supplied> </q>',
  ],
  [
    'regularization',
    '<:φρόντι[σ]ον|reg|φρόνδει[σ]ο̣ν:>',
    '<choice><reg>φρόντι<supplied reason="lost">σ</supplied>ον</reg><orig>φρόνδει<supplied reason="lost">σ</supplied><unclear>ο</unclear>ν</orig></choice>',
  ],
  [
    'regularization, several',
    '<:ἀνοίγεται (?)|ἀνοίεται (?)||reg||ἀ̣νύεται:>',
    '<choice><reg cert="low">ἀνοίγεται </reg><reg cert="low">ἀνοίεται </reg><orig><unclear>ἀ</unclear>νύεται</orig></choice>',
  ],
  [
    'regularization, for language',
    '<:ἄρακος=grc|reg|ⲁⲣⲁⲕ:>',
    '<choice><reg xml:lang="grc">ἄρακος</reg><orig>ⲁⲣⲁⲕ</orig></choice>',
  ],
  [
    'alternative reading',
    '<:Ὀχυρυγχίτου|alt|Ὀξυρυγχίτου νομοῦ:>',
    '<app type="alternative"><lem>Ὀχυρυγχίτου</lem><rdg>Ὀξυρυγχίτου νομοῦ</rdg></app>',
  ],
  [
    'alternative reading, doubted',
    '<:Ὀχυρυγχίτου(?)|alt|Ὀξυρυγχίτου νομοῦ(?):>',
    '<app type="alternative"><lem>Ὀχυρυγχίτου<certainty match=".." locus="value"/></lem><rdg>Ὀξυρυγχίτου νομοῦ<certainty match=".." locus="value"/></rdg></app>',
  ],
  [
    'scribal correction',
    '<:τοῦ|subst|της:>',
    '<subst><add place="inline">τοῦ</add><del rend="corrected">της</del></subst>',
  ],
  [
    'scribal correction, doubted',
    '<:τοῦ(?)|subst|της(?):>',
    '<subst><add place="inline">τοῦ<certainty match=".." locus="value"/></add><del rend="corrected">της<certainty match=".." locus="value"/></del></subst>',
  ],
  [
    'spelling correction',
    '<:τιμὴν|corr|τμμὴν:>',
    '<choice><corr>τιμὴν</corr><sic>τμμὴν</sic></choice>',
  ],
  [
    'Berichtigungsliste',
    '<:αἱ τοῦ=BL 9.17|ed|Θίτου:>',
    '<app type="editorial"><lem resp="BL 9.17">αἱ τοῦ</lem><rdg>Θίτου</rdg></app>',
  ],
  [
    'Berichtigungsliste, doubted',
    '<:αἱ τοῦ(?)=BL 9.17|ed|Θίτου:>',
    '<app type="editorial"><lem resp="BL 9.17">αἱ τοῦ<certainty match=".." locus="value"/></lem><rdg>Θίτου</rdg></app>',
  ],
  [
    'journal article',
    '<:Ἀντωνίνου=N. Gonis, ZPE 166 (2008) 268|ed|Αὐρηλίου:>',
    '<app type="editorial"><lem resp="N. Gonis, ZPE 166 (2008) 268">Ἀντωνίνου</lem><rdg>Αὐρηλίου</rdg></app>',
  ],
  [
    'editorial correction',
    '<:<#κγ=23#>=BGU 1 p.357|ed|<#κϛ=26#>:>',
    '<app type="editorial"><lem resp="BGU 1 p.357"><num value="23">κγ</num></lem><rdg><num value="26">κϛ</num></rdg></app>',
  ],
  [
    'correction of an omission',
    '<:τοῦ=PN W.G. Claytor (CPR VI plate 35)|ed|:>',
    '<app type="editorial"><lem resp="PN W.G. Claytor (CPR VI plate 35)">τοῦ</lem><rdg/></app>',
  ],
  ['number', '<#ιϛ=16#>', '<num value="16">ιϛ</num>'],
  ['fraction', '<#ιϛ=1/16#>', '<num value="1/16">ιϛ</num>'],
  ['number with a tick', "<#λβ '=1/32#>", '<num value="1/32" rend="tick">λβ</num>'],
  [
    'number, unclear',
    "<#σ̣ν̣ϛ̣ '=1/256#>",
    '<num value="1/256" rend="tick"><unclear>σνϛ</unclear></num>',
  ],
  [
    'number, illegible',
    '<#.2=#>',
    '<num><gap reason="illegible" quantity="2" unit="character"/></num>',
  ],
  ['number, lost', '<#[.2]=#>', '<num><gap reason="lost" quantity="2" unit="character"/></num>'],
  ['number, no symbol', '<#=4#>', '<num value="4"/>'],
  [
    'number with markup',
    '<#ι[ε(?)]=15#>',
    '<num value="15">ι<supplied reason="lost" cert="low">ε</supplied></num>',
  ],
  ['diaeresis', 'υ ἱ(¨)οῦ', 'υ<hi rend="diaeresis">ἱ</hi>οῦ'],
  ['asper', ' ὧ( ῾)', '<hi rend="asper">ὧ</hi>'],
  ['acute', ' ὃ(´)', '<hi rend="acute">ὃ</hi>'],
  ['circumflex', ' ὑ(^)', '<hi rend="circumflex">ὑ</hi>'],
  ['lenis', ' Ἀ( ᾿)', '<hi rend="lenis">Ἀ</hi>'],
  ['two diacritics', ' ἵ( ῾´)', '<hi rend="asper"><hi rend="acute">ἵ</hi></hi>'],
  [
    'diacritic over an illegible letter',
    ' .1(¨)',
    '<hi rend="diaeresis"><gap reason="illegible" quantity="1" unit="character"/></hi>',
  ],
  [
    'diacritic over a lost letter',
    ' [.1](´)',
    '<hi rend="acute"><gap reason="lost" quantity="1" unit="character"/></hi>',
  ],
  ['paragraphos', '----', '<milestone rend="paragraphos" unit="undefined"/>'],
  ['horizontal rule', '--------', '<milestone rend="horizontal-rule" unit="undefined"/>'],
  ['wavy line', '~~~~~~~~', '<milestone rend="wavy-line" unit="undefined"/>'],
  ['diple obelismene', '>---', '<milestone rend="diple-obelismene" unit="undefined"/>'],
  ['coronis', '-$$-', '<milestone rend="coronis" unit="undefined"/>'],
  ['glyph', '*slanting-stroke*', '<g type="slanting-stroke"/>'],
  ['glyph, unclear', '*check?*', '<unclear><g type="check"/></unclear>'],
  ['glyph with its character', '*chirho,☧*', '<g type="chirho">☧</g>'],
  ['filler stroke', '*filler(extension)*', '<g rend="extension" type="filler"/>'],
  [
    'filler stroke, unclear',
    '*filler(extension)?*',
    '<unclear><g rend="extension" type="filler"/></unclear>',
  ],
  ['figure', '#seal ', '<figure><figDesc>seal</figDesc></figure>'],
  ['another language', '~|comes|~la ', '<foreign xml:lang="la">comes</foreign>'],
  [
    'language left out',
    '(Lang: Demotic 1 lines)',
    '<gap reason="ellipsis" quantity="1" unit="line"><desc>Demotic</desc></gap>',
  ],
  [
    'language left out, unknown',
    '(Lang: Coptic ? lines)',
    '<gap reason="ellipsis" extent="unknown" unit="line"><desc>Coptic</desc></gap>',
  ],
  [
    'language left out, characters',
    '(Lang: Demotic 2 char)',
    '<gap reason="ellipsis" quantity="2" unit="character"><desc>Demotic</desc></gap>',
  ],
  [
    'not transcribed',
    '(Lines: 19 non transcribed)',
    '<gap reason="ellipsis" quantity="19" unit="line"><desc>non transcribed</desc></gap>',
  ],
  [
    'not transcribed, range',
    '(Lines: 1-3 non transcribed)',
    '<gap reason="ellipsis" atLeast="1" atMost="3" unit="line"><desc>non transcribed</desc></gap>',
  ],
  [
    'not transcribed, about',
    '(Lines: ca.7 non transcribed)',
    '<gap reason="ellipsis" quantity="7" unit="line" precision="low"><desc>non transcribed</desc></gap>',
  ],
  [
    'characters not transcribed',
    '(Chars: ? non transcribed)',
    '<gap reason="ellipsis" extent="unknown" unit="character"><desc>non transcribed</desc></gap>',
  ],
];

describe('Leiden+ as EpiDoc', () => {
  it.each(PAIRS)('%s', (_name, leiden, xml) => {
    const read = epidoc(leiden);
    expect(read.xml).toEqual(expected(xml));
    expect(read.warnings).toEqual([]);
  });

  it('reads divisions, nested, with their blocks and lines', () => {
    const { xml, warnings } = leidenPlusToEpiDoc(`<S=.grc
<D=.r
<D=.i.column<=
1. line of text
2. line of text
=>=D>
<D=.ii.column
<D=.a.fragment<=
1. line of text
=>=D>
=D>
=D>
<D=#_v.v<(v)><=
1.- line of text
=>=D>`);
    expect(warnings).toEqual([]);
    expect(shape(parseXml(xml))).toEqual(
      shape(
        parseXml(`<div xml:lang="grc" type="edition" xml:space="preserve">
<div n="r" type="textpart">
<div n="i" subtype="column" type="textpart"><ab><lb n="1"/>line of text <lb n="2"/>line of text</ab></div>
<div n="ii" subtype="column" type="textpart"><div n="a" subtype="fragment" type="textpart"><ab><lb n="1"/>line of text</ab></div></div>
</div>
<div n="v" type="textpart" xml:id="_v"><head>v</head><ab><lb n="1" break="no"/>line of text</ab></div>
</div>`),
      ),
    );
  });

  it('reads what does not close as text, and says so', () => {
    const read = epidoc('α [βγ δ');
    expect(read.xml).toEqual(['α [βγ δ']);
    expect(read.warnings).toEqual(['"[" is not closed with "]"; it was read as text.']);
  });

  it('knows Leiden+ from other text', () => {
    expect(isLeidenPlus('<S=.grc<=1. α=>')).toBe(true);
    expect(isLeidenPlus('  <= 1. α =>')).toBe(true);
    expect(isLeidenPlus('[μῆνιν] ἄειδε θεὰ')).toBe(false);
  });
});

describe('Leiden+ read into a transcript', () => {
  /** Items in brief: words with their read form, marks by kind, gaps with their length, breaks by label. */
  function brief(items: Item[]): string {
    return items
      .map((item) => {
        if (isBreak(item)) return `/${item.label ?? ''}`;
        if (!isToken(item)) {
          const a = item.attrs ?? {};
          if (item.type === 'gap')
            return `[${a.reason}:${a.quantity ?? a.extent}${a.unit === 'line' ? 'lin' : ''}]`;
          return `{${item.type}${typeof a.g === 'string' ? `:${a.g}` : ''}${typeof a.rend === 'string' ? `:${a.rend}` : ''}}`;
        }
        const marks = (item.marks ?? [])
          .map((m) =>
            m.kind === 'gap'
              ? `[${m.from}:${m.attrs?.quantity ?? m.attrs?.extent}]`
              : `${m.kind}${m.from === undefined ? '' : `(${m.from}-${m.to})`}`,
          )
          .join(',');
        return (
          item.form +
          (item.norm === undefined ? '' : `=${item.norm}${item.unchecked ? '?' : ''}`) +
          (marks ? `<${marks}>` : '') +
          (item.joinNext ? '-' : '')
        );
      })
      .join(' ');
  }

  it('keeps what the papyrus has and leaves out what its editor supplied', () => {
    const result = importLeidenPlus(
      `<S=.grc<=
1. [μῆνιν ἄει]δε θ̣εὰ <:Πηληϊάδεω|reg|Πηλειαδεω:> 〚Ἀχιλλ〛 \\Ἀχιλῆος/
2. <:οὐλομένην|corr|ουλομενεν:> ἣ <καὶ> μυρί {μυρί} Ἀχαι<ο>ῖς ἄλ{λ}γε ἔθη
3.- κε [.?] lost.2lin
=>`,
      { ids: sequentialIds() },
    );
    expect(result.warnings).toEqual([]);
    expect(brief(result.stream.items)).toBe(
      [
        '[lost:5] δε<[0:3]> θεὰ<unclear(0-1)> Πηλειαδεω=Πηληϊάδεω Ἀχιλλ<del> Ἀχιλῆος<add>',
        '/2 ουλομενεν=οὐλομένην? ἣ μυρί μυρί Ἀχαιῖς=Ἀχαιοῖς? ἄλλγε=ἄλγε? ἔθη-',
        '/3 κε [lost:unknown] [lost:2lin]',
      ].join(' '),
    );
    expect(result.segmentStarts.map((start) => start.parts.at(-1))).toEqual([
      { unit: 'lb', n: '1' },
      { unit: 'lb', n: '2' },
      { unit: 'lb', n: '3' },
    ]);
  });

  it('reads the signs of the papyrus', () => {
    const result = importLeidenPlus(
      '<S=.grc<=1. ((ἔτους)) <#ιϛ=16#> *stauros* (στρατηγ(ός)) $m2 ~|comes|~la vac.3 ---- .2 α=>',
      { ids: sequentialIds() },
    );
    expect(result.warnings).toEqual([]);
    expect(brief(result.stream.items)).toBe(
      'ἔτους<abbr> ιϛ<num> {mark:stauros} στρατηγ<abbr> comes<handShift,foreign> {space} {mark:paragraphos} [illegible:2] α',
    );
  });
});

describe('a transcript written as Leiden+', () => {
  const essence = (items: Item[]): unknown[] =>
    items.map((item) => {
      const { id: _id, ...rest } = item as Item & { id: string };
      return rest;
    });

  /** Everything here is something a papyrus has, so nothing is left out on the way in. */
  const TEXT = `<S=.grc<=
1. ((ἔτους)) <#ιϛ=16#> (στρατηγ(ός)) (Καρ(ανίδι?)) (|ομυο|) θ̣εὰ̣ [.3]δε ἄλ.2γε [ca.5] .? lost.2lin
2. <:Πηληϊάδεω|reg|Πηλειαδεω:> 〚Ἀχιλλ〛 \\Ἀχιλῆος/ <:τοῦ|subst|της:> //κάτω\\\\ ||left:καὶ|| 〚/οὐλ〛 οὐλο
3.- μένην *stauros* $m2 ~|comes|~la vac.3 ---- /*a note*/ "ἣ μυρί" |^α^| ¯β¯ υ ἱ(¨)οῦ vestig.2lin
(4, inverse) (Lines: 3 non transcribed) vac.?lin #seal *chirho,☧* <#λβ '=1/32#>
=>`;

  it('reads back as it was', () => {
    const first = importLeidenPlus(TEXT, { ids: sequentialIds() });
    expect(first.warnings).toEqual([]);
    const written = toLeidenPlus(first.stream);
    const second = importLeidenPlus(written, { ids: sequentialIds() });
    expect(second.warnings).toEqual([]);
    expect(essence(second.stream.items)).toEqual(essence(first.stream.items));
    // And what is written does not change on a second trip.
    expect(toLeidenPlus(second.stream)).toBe(written);
  });

  it('writes the lines with their numbers, a word that runs on, and a line set otherwise', () => {
    const written = toLeidenPlus(importLeidenPlus(TEXT, { ids: sequentialIds() }).stream);
    expect(written.split('\n')).toEqual([
      '<S=.grc<=',
      '1. ((ἔτους)) <#ιϛ=16#> (στρατηγ(ός)) (Καρ(ανίδι?)) (|ομυο|) θ̣εὰ̣ [.3]δε ἄλ.2γε [ca.5] .? lost.2lin',
      '2. <:Πηληϊάδεω|reg|Πηλειαδεω:> 〚Ἀχιλλ〛 \\Ἀχιλῆος/ <:τοῦ|subst|της:> //κάτω\\\\ ||left:καὶ|| 〚/οὐλ〛 οὐλο',
      '3.- μένην *stauros* $m2 ~|comes|~la  vac.3 ---- /*a note*/ "ἣ" "μυρί" |^α^| ¯β¯ υ ἱ(¨)οῦ vestig.2lin',
      "(4, inverse) (Lines: 3 non transcribed) vac.?lin #seal  *chirho,☧* <#λβ '=1/32#>",
      '=>',
      '',
    ]);
  });

  it('writes pages and columns as divisions, and a normalized form as a regularization', () => {
    const stream = {
      items: [
        { kind: 'token', id: 'a', form: 'ἄνδρα' },
        { kind: 'break', id: 'p1', type: 'page', pageId: 'P1' },
        { kind: 'token', id: 'b', form: 'μηνιν', norm: 'μῆνιν' },
        { kind: 'break', id: 'l1', type: 'line' },
        { kind: 'token', id: 'c', form: 'αειδε' },
        { kind: 'break', id: 'p2', type: 'page', pageId: 'P2' },
        { kind: 'break', id: 'c1', type: 'column', label: 'i' },
        { kind: 'token', id: 'd', form: 'θεα' },
      ],
    } as { items: Item[] };
    expect(toLeidenPlus(stream, { language: 'grc', pageLabels: { P1: '12r', P2: '12 v.' } })).toBe(
      [
        '<S=.grc<=',
        '1. ἄνδρα',
        '=>',
        '<D=.12r<=',
        '1. <:μῆνιν|reg|μηνιν:>',
        '2. αειδε',
        '=>=D>',
        '<D=.12_v_',
        '<D=.i.column<=',
        '1. θεα',
        '=>=D>=D>',
        '',
      ].join('\n'),
    );
  });

  it('keeps the space that closes a figure or a trace of letters at the end of a line', () => {
    const stream = {
      items: [
        { kind: 'token', id: 'a', form: 'αειδε' },
        { kind: 'object', id: 'f', type: 'figure', text: 'seal' },
        { kind: 'break', id: 'l1', type: 'line' },
        { kind: 'object', id: 'v', type: 'gap', attrs: { reason: 'illegible', desc: 'vestiges' } },
      ],
    } as { items: Item[] };
    const written = toLeidenPlus(stream);
    expect(written.split('\n')).toEqual(['<S=.grc<=', '1. αειδε #seal ', '2. vestig ', '=>', '']);
    const read = importLeidenPlus(written, { ids: sequentialIds() });
    expect(read.warnings).toEqual([]);
    expect(
      read.stream.items.map((item) => (item.kind === 'object' ? item.type : item.kind)),
    ).toEqual(['token', 'figure', 'break', 'gap']);
  });

  describe('marks over the same word', () => {
    const marks: Record<string, Mark> = {
      deleted: { kind: 'del', attrs: { rend: 'erasure' } },
      'deleted by slashes': { kind: 'del', attrs: { rend: 'slashes' } },
      'added above': { kind: 'add', attrs: { place: 'above' } },
      'added below': { kind: 'add', attrs: { place: 'below' } },
      'added in the margin': { kind: 'add', attrs: { place: 'margin', rend: 'sling' } },
      'added at the left': { kind: 'add', attrs: { place: 'left' } },
      superscript: { kind: 'hi', attrs: { rend: 'superscript' } },
      subscript: { kind: 'hi', attrs: { rend: 'subscript' } },
      tall: { kind: 'hi', attrs: { rend: 'tall' } },
      'under a line': { kind: 'hi', attrs: { rend: 'supraline' } },
      'under a line and underlined': { kind: 'hi', attrs: { rend: 'supraline-underline' } },
      number: { kind: 'num', attrs: { value: '5' } },
      foreign: { kind: 'foreign', attrs: { lang: 'la' } },
      quoted: { kind: 'q' },
      'in its original form': { kind: 'orig' },
      abbreviated: { kind: 'abbr' },
    };

    const trip = (form: string, list: Mark[]) => {
      const written = toLeidenPlus({ items: [{ kind: 'token', id: 'a', form, marks: list }] });
      const read = importLeidenPlus(written, { ids: sequentialIds() });
      return { written, read };
    };
    const canonical = (list: Mark[] | undefined) =>
      (list ?? [])
        .map((mark) =>
          JSON.stringify(mark, ['kind', 'attrs', 'from', 'to', 'place', 'rend', 'lang', 'value']),
        )
        .sort();

    it('are written so that each pair reads back, in whichever order they are given', () => {
      for (const [a, first] of Object.entries(marks))
        for (const [b, second] of Object.entries(marks)) {
          if (a === b) continue;
          const { written, read } = trip('αειδε', [first, second]);
          expect(read.warnings, `${a} and ${b}: ${written}`).toEqual([]);
          const token = read.stream.items[0] as Token;
          expect(canonical(token.marks), `${a} and ${b}: ${written}`).toEqual(
            canonical([first, second]),
          );
        }
    });

    it('are written so that marks that begin together but end apart read back', () => {
      const { written, read } = trip('αειδε', [
        { kind: 'foreign', attrs: { lang: 'la' } },
        { kind: 'add', attrs: { place: 'bottom' }, from: 0, to: 3 },
        { kind: 'hi', attrs: { rend: 'superscript' }, from: 0, to: 2 },
      ]);
      expect(read.warnings, written).toEqual([]);
      const token = read.stream.items[0] as Token;
      expect(canonical(token.marks), written).toEqual(
        canonical([
          { kind: 'foreign', attrs: { lang: 'la' } },
          { kind: 'add', attrs: { place: 'bottom' }, from: 0, to: 3 },
          { kind: 'hi', attrs: { rend: 'superscript' }, from: 0, to: 2 },
        ]),
      );
    });
  });

  it('gives the scribe’s correction as two words, read one before and one after it', () => {
    const { stream } = importLeidenPlus('<S=.grc<=1. ὑπὲρ <:τοῦ|subst|της:> πατρός=>', {
      ids: sequentialIds(),
    });
    const read = (state: 'corrected' | 'original') =>
      units(stream, 0, stream.items.length, state).map((unit) => unit.text);
    expect(read('corrected')).toEqual(['ὑπὲρ', 'τοῦ', 'πατρός']);
    expect(read('original')).toEqual(['ὑπὲρ', 'της', 'πατρός']);
  });
});
