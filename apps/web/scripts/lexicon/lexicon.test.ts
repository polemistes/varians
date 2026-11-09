import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase, greekForms, lexiconEntries, lexicons } from '@varians/db';
import { asc } from 'drizzle-orm';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { betaToUnicode } from './betacode.ts';
import { loadLexicon, type LexiconData } from './build.ts';
import { LEXICON_FORMAT, LexiconFileError, exportLexicon, readLexiconFile } from './export.ts';
import { morpheusAnalyses } from './morpheus.ts';
import { packForms } from './pack-forms.ts';
import {
  P4_ENTITIES,
  entriesOf,
  entryElements,
  entryRow,
  parseEntryFixture,
  renderEntry,
  splitKey,
} from './tei.ts';
import { isWord, treebankAnalyses } from './treebank.ts';
import { XmlError, attributesOf, decodeEntities, parseElement, parseNodes, textOf } from './xml.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

describe('Beta Code', () => {
  it('converts as the beta-code package does, on the keys and Greek of both lexica', () => {
    const pairs = fixture('betacode-pairs.json') as Record<string, string>;
    const wrong: string[] = [];
    for (const [beta, greek] of Object.entries(pairs)) {
      if (betaToUnicode(beta) !== greek.normalize('NFC'))
        wrong.push(`${beta} → ${betaToUnicode(beta)}, not ${greek}`);
    }
    expect(wrong).toEqual([]);
    expect(Object.keys(pairs).length).toBeGreaterThan(3000);
  });

  it('writes a final sigma, capitals, breathings, accents, iota subscript and diaeresis', () => {
    expect(betaToUnicode('lo/gos')).toBe('λόγος');
    expect(betaToUnicode('*(/ellhn')).toBe('Ἕλλην');
    expect(betaToUnicode('a)/nqrwpos, ou')).toBe('ἄνθρωπος, ου');
    expect(betaToUnicode('tw=| a)ndri/')).toBe('τῷ ἀνδρί');
    expect(betaToUnicode('a)i+/dhs')).toBe('ἀΐδης'.normalize('NFC'));
    expect(betaToUnicode('*a')).toBe('Α');
    expect(betaToUnicode('a)1')).toBe('ἀ1');
  });
});

describe('the XML reader', () => {
  it('reads elements, attributes, text, comments and entities', () => {
    const el = parseElement(
      '<a x="1" y=\'two &amp; three\'>before<!-- c -->after<b/>tail &lt;&#x3b1;&#945;&gt;</a>',
    );
    expect(el.name).toBe('a');
    expect(el.attrs).toEqual({ x: '1', y: 'two & three' });
    expect(el.children.map((c) => c.kind)).toEqual(['text', 'comment', 'text', 'element', 'text']);
    expect(textOf(el)).toBe('beforeaftertail <αα>');
  });

  it('keeps whitespace text and skips declarations', () => {
    const nodes = parseNodes(
      '<?xml version="1.0"?>\n<!DOCTYPE x [ <!ENTITY e "f"> ]>\n<r> <s>a</s> </r>\n',
    );
    const r = nodes.find((n) => n.kind === 'element');
    expect(r && textOf(r)).toBe(' a ');
  });

  it('decodes the named entities given and refuses the others', () => {
    expect(decodeEntities('a &mdash; b &lpar;c&rpar;', P4_ENTITIES)).toBe('a — b (c)');
    expect(() => decodeEntities('&nosuch;', P4_ENTITIES)).toThrow(XmlError);
    expect(() => parseElement('<a>&bogus;</a>')).toThrow(/unknown entity/u);
  });

  it('refuses tags that do not match or never close', () => {
    expect(() => parseElement('<a><b></a>')).toThrow(XmlError);
    expect(() => parseElement('<a>')).toThrow(XmlError);
    expect(() => parseElement('<a/><b/>')).toThrow(/one element/u);
  });

  it('reads the attributes of a tag body', () => {
    expect(attributesOf(' id="1" form="ὦ" lemma=\'ὦ\' postag="i--------" /')).toEqual({
      id: '1',
      form: 'ὦ',
      lemma: 'ὦ',
      postag: 'i--------',
    });
  });
});

describe('the entries of the lexica', () => {
  interface Sample {
    lexicon: string;
    raw: string;
    key: string;
    headword: string;
    homograph: number;
    html: string;
  }
  const samples = fixture('entries.json') as Sample[];

  it('render as the Anagnosis pipeline renders them, in both lexica', () => {
    expect(samples.length).toBeGreaterThan(30);
    for (const sample of samples) {
      const el = parseEntryFixture(sample.raw);
      const row = entryRow(el);
      expect(row, sample.key).not.toBeNull();
      // The pipeline renders citation targets and strips them when it packs the entries; the rows never have them.
      expect(row!.html, sample.key).toBe(sample.html.replace(/ data-ref="[^"]*"/gu, ''));
      expect(row!.headword, sample.key).toBe(sample.headword);
      expect(row!.homograph, sample.key).toBe(sample.homograph);
    }
  });

  it('key the entry by the lemma as written and by its letters', () => {
    const row = entryRow(
      parseEntryFixture(
        '<entry key="*(/ellhn2"><form><orth lang="greek">*(/ellhn</orth></form><sense n="0"><tr>a Greek</tr></sense></entry>',
      ),
    )!;
    expect(row.headword).toBe('Ἕλλην');
    expect(row.homograph).toBe(2);
    expect(row.lemmaKey).toBe('ἕλλην');
    expect(row.looseKey).toBe('ελλην');
    expect(row.html).toBe(
      '<p class="head"><b class="orth">Ἕλλην</b></p><p class="sense"><i class="tr">a Greek</i></p>',
    );
  });

  it('number a sense, leave an unnumbered one alone, and keep no indentation', () => {
    const html = renderEntry(
      parseEntryFixture(
        '<entryFree key="a"><orth lang="greek">a</orth><sense level="1" n="A">one</sense><sense level="3" n="0"> two</sense><sense level="2">three</sense></entryFree>',
      ),
    );
    expect(html).toBe(
      '<p class="head"><b class="orth">α</b></p><p class="sense"><b>A.</b> one</p><p class="sense">two</p><p class="sense">three</p>',
    );
  });

  it('split a key into its headword and homograph number', () => {
    expect(splitKey('a)1')).toEqual({ base: 'a)', homograph: 1 });
    expect(splitKey('mh/n2')).toEqual({ base: 'mh/n', homograph: 2 });
    expect(splitKey('*a')).toEqual({ base: '*a', homograph: 0 });
  });

  it('are taken one by one from a file, passing over those commented out', () => {
    const file =
      '<TEI.2><body>\n<entry key="a"><sense>1</sense></entry>\n<!--\n<entry key="b"><sense>2</sense></entry>\n-->\n<entry key="c"><sense>3 <!-- note --> 4</sense></entry>\n</body></TEI.2>';
    expect([...entryElements(file, 'entry')].map((el) => el.attrs.key)).toEqual(['a', 'c']);
    expect([...entriesOf(file, 'entry')].map((row) => row.html)).toEqual([
      '<p class="sense">1</p>',
      '<p class="sense">3 4</p>',
    ]);
    expect(
      [
        ...entryElements('<entryFree key="x">1</entryFree><entry key="y">2</entry>', 'entryFree'),
      ].map((el) => el.attrs.key),
    ).toEqual(['x']);
  });
});

describe('the treebank analyses', () => {
  it('take the words with their lemma and tag, not artificial nodes or insertions', () => {
    const xml = `<sentence id="1">
      <word id="1" form="ὦ" lemma="ὦ" postag="i--------" head="5" relation="AuxZ"/>
      <word id="2" form="κοινὸν" lemma="κοινός1" postag="a-s---nv-" head="5" relation="ATR"/>
      <word id="3" form="[0]" lemma="" postag="" artificial="elliptic"/>
      <word id="4" form="δ̓" lemma="δέ" postag="c--------"/>
      <word id="5" form="ἔστι" lemma="εἰμί" postag="v3spia---" insertion_id="2"/>
      <word id="6" form="," lemma="," postag="u--------"/>
      <word id="7" form="{ΧΟ.}" lemma="{ΧΟ.}" postag="x--------"/>
    </sentence>`;
    expect([...treebankAnalyses(xml)]).toEqual([
      { form: 'ὦ', lemma: 'ὦ', postag: 'i--------' },
      { form: 'κοινὸν', lemma: 'κοινός', postag: 'a-s---nv-' },
      { form: 'δʼ', lemma: 'δέ', postag: 'c--------' },
    ]);
    expect(isWord('{ΧΟ.}')).toBe(false);
    expect(isWord('ἄειδε')).toBe(true);
  });
});

describe('the Morpheus analyses', () => {
  it('keep the analyses of the main dialects where there are any, and take the length marks off', () => {
    const lines = [
      'ʼΗ\tἐάω\tv2spma---\tdoric\t',
      'ʼΗ\tἐάω\tv3siia---\tdoric\t',
      'νεᾱνίᾱς\tνεανίας\tn-s---mn-\t\tνεᾱνίᾱς',
      'ἄν\tἄν\tg--------\tattic epic ionic\t',
      'ἄν\tἀνά\tr--------\tdoric aeolic\t',
      '',
    ];
    expect([...morpheusAnalyses(lines)]).toEqual([
      { form: 'ʼΗ', lemma: 'ἐάω', postag: 'v2spma---' },
      { form: 'ʼΗ', lemma: 'ἐάω', postag: 'v3siia---' },
      { form: 'νεανίας', lemma: 'νεανίας', postag: 'n-s---mn-' },
      { form: 'ἄν', lemma: 'ἄν', postag: 'g--------' },
    ]);
  });
});

describe('the packed forms', () => {
  it('key the forms by their letters, treebank first, each lemma and tag once', () => {
    const treebank = [
      { form: 'ἦ', lemma: 'εἰμί', postag: 'v3siia---' },
      { form: 'ᾖ', lemma: 'εἰμί', postag: 'v3spsa---' },
    ];
    const morpheus = [
      { form: 'ἤ', lemma: 'ἤ', postag: 'c--------' },
      { form: 'ἦ', lemma: 'εἰμί', postag: 'v3siia---' },
      { form: 'ἥ', lemma: 'ὁ', postag: 'l-s---fn-' },
      { form: 'ἡ', lemma: 'ὁ', postag: 'l-s---fn-' },
      { form: 'λόγος', lemma: 'λόγος', postag: 'n-s---mn-' },
    ];
    const { rows, counts } = packForms(treebank, morpheus);
    expect(counts).toEqual({ treebank: 2, morpheus: 5 });
    expect([...rows.keys()].sort()).toEqual(['η', 'λογος']);
    expect(rows.get('η')).toBe(
      [
        'ἦ\tεἰμί\tv3siia---\ttreebank',
        'ᾖ\tεἰμί\tv3spsa---\ttreebank',
        'ἤ\tἤ\tc--------\tmorpheus',
        'ἥ\tὁ\tl-s---fn-\tmorpheus',
      ].join('\n'),
    );
    expect(rows.get('λογος')).toBe('λόγος\tλόγος\tn-s---mn-\tmorpheus');
  });
});

describe('the lexicon in the database and as a file', () => {
  const url = process.env.DATABASE_URL_TEST ?? 'postgres://varians@127.0.0.1:54329/varians_test';
  const { db, pool } = createDatabase(url);
  let dir: string;
  afterAll(async () => {
    await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  class Rollback extends Error {}

  const small: LexiconData = {
    dictionaries: [
      { id: 'lsj', title: 'LSJ', source: 'Perseus', licence: 'CC BY-SA 4.0' },
      { id: 'ml', title: 'Middle Liddell', source: 'Perseus', licence: 'CC BY-SA 3.0 US' },
    ],
    entries: [
      {
        lexiconId: 'lsj',
        headword: 'μῆνις',
        homograph: 0,
        lemmaKey: 'μῆνις',
        looseKey: 'μηνις',
        html: '<p class="head"><b class="orth">μῆνις</b></p>',
      },
      {
        lexiconId: 'lsj',
        headword: 'ἀ',
        homograph: 1,
        lemmaKey: 'ἀ',
        looseKey: 'α',
        html: '<p class="head">a "quoted"\ttab</p>',
      },
      {
        lexiconId: 'ml',
        headword: 'μῆνις',
        homograph: 0,
        lemmaKey: 'μῆνις',
        looseKey: 'μηνις',
        html: '<p class="head">wrath</p>',
      },
    ],
    forms: [
      ['μηνιν', 'μῆνιν\tμῆνις\tn-s---fa-\ttreebank'],
      ['η', 'ἦ\tεἰμί\tv3siia---\ttreebank\nἤ\tἤ\tc--------\tmorpheus'],
    ],
  };

  it('is replaced in one transaction, exported, and read back the same', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'varians-lexicon-test-'));
    const file = path.join(dir, 'lexicon.jsonl.gz');
    await expect(
      db.transaction(async (tx) => {
        expect(await loadLexicon(tx, small)).toEqual({ entries: 3, forms: 2 });
        const dictionaries = await tx.select().from(lexicons).orderBy(asc(lexicons.position));
        expect(dictionaries.map((d) => [d.id, d.position])).toEqual([
          ['lsj', 0],
          ['ml', 1],
        ]);
        const entries = await tx.select().from(lexiconEntries).orderBy(asc(lexiconEntries.id));
        expect(entries.map((e) => [e.id, e.lexiconId, e.headword, e.homograph])).toEqual([
          [1, 'lsj', 'μῆνις', 0],
          [2, 'lsj', 'ἀ', 1],
          [3, 'ml', 'μῆνις', 0],
        ]);
        expect((await tx.select().from(greekForms)).length).toBe(2);
        const header = await exportLexicon(tx, file);
        expect(header.format).toBe(LEXICON_FORMAT);
        expect(header.counts).toEqual({ entries: 3, forms: 2 });
        expect(header.dictionaries).toEqual(small.dictionaries);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.part`)).toBe(false);
    const read = await readLexiconFile(file);
    expect(read.header.counts).toEqual({ entries: 3, forms: 2 });
    expect(read.data.dictionaries).toEqual(small.dictionaries);
    expect([...read.data.entries]).toEqual([...small.entries]);
    // The export orders the word keys as the database collates them.
    expect([...read.data.forms].sort()).toEqual([...small.forms].sort());
  });

  async function gzipped(name: string, lines: string[]): Promise<string> {
    const file = path.join(dir, name);
    await pipeline(
      Readable.from(lines.map((l) => `${l}\n`)),
      createGzip(),
      createWriteStream(file),
    );
    return file;
  }

  it('refuses a file that is not a lexicon, of another version, or cut short', async () => {
    await expect(
      readLexiconFile(await gzipped('other.jsonl.gz', ['{"format":"something-else"}'])),
    ).rejects.toThrow(/not a lexicon/u);
    await expect(
      readLexiconFile(
        await gzipped('v2.jsonl.gz', [
          JSON.stringify({
            format: LEXICON_FORMAT,
            version: 2,
            made: 'x',
            dictionaries: [],
            counts: { entries: 0, forms: 0 },
          }),
        ]),
      ),
    ).rejects.toThrow(/version 2/u);
    const header = JSON.stringify({
      format: LEXICON_FORMAT,
      version: 1,
      made: '2026-11-09T00:00:00Z',
      dictionaries: [{ id: 'lsj', title: 'LSJ', source: 's', licence: 'l' }],
      counts: { entries: 2, forms: 0 },
    });
    await expect(
      readLexiconFile(
        await gzipped('short.jsonl.gz', [
          header,
          JSON.stringify(['e', 'lsj', 'ἀ', 0, 'ἀ', 'α', '<p></p>']),
        ]),
      ),
    ).rejects.toThrow(/incomplete/u);
    await expect(
      readLexiconFile(
        await gzipped('alien.jsonl.gz', [
          header,
          JSON.stringify(['e', 'ml', 'ἀ', 0, 'ἀ', 'α', '<p></p>']),
          JSON.stringify(['e', 'ml', 'ἀ', 0, 'ἀ', 'α', '<p></p>']),
        ]),
      ),
    ).rejects.toThrow(/does not name/u);
    const plain = path.join(dir, 'plain.txt');
    await pipeline(Readable.from(['not gzip']), createWriteStream(plain));
    await expect(readLexiconFile(plain)).rejects.toBeInstanceOf(LexiconFileError);
  });
});
