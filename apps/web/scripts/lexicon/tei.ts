/**
 * The entries of the Perseus lexica (LSJ in TEI P5, the Middle Liddell in
 * TEI P4), each as a headword and an HTML body of p, b, i and span with
 * classes, exactly as the Anagnosis pipeline renders them (its lexicon.py),
 * so that the two read alike. Citation targets are left out: the reader
 * has no use for them, and they are a third of the size.
 */
import { lemmaKey, looseKey } from '@varians/core';
import { betaToUnicode } from './betacode.ts';
import { parseElement, type XmlElement, type XmlNode } from './xml.ts';

/** An entry as the database keeps it. */
export interface LexiconEntryRow {
  headword: string;
  homograph: number;
  lemmaKey: string;
  looseKey: string;
  html: string;
}

/**
 * The named entities of the TEI P4 file beyond XML's own: those it declares
 * in its doctype and uses in its text, as the Anagnosis loader substitutes
 * them. An entity not here stops the build, so that nothing is lost unseen.
 */
export const P4_ENTITIES: Record<string, string> = {
  verbar: '|',
  equals: '=',
  ast: '*',
  colon: ':',
  quest: '?',
  breve: '˘',
  macr: '¯',
  dagger: '†',
  Dagger: '‡',
  sect: '§',
  para: '¶',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lpar: '(',
  rpar: ')',
  plus: '+',
  minus: '−',
  semi: ';',
  excl: '!',
  comma: ',',
  period: '.',
  hyphen: '‐',
  lowbar: '_',
  num: '#',
  percnt: '%',
  commat: '@',
  lsqb: '[',
  rsqb: ']',
  lcub: '{',
  rcub: '}',
  sol: '/',
  bsol: '\\',
  nbsp: ' ',
  middot: '·',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  copy: '©',
  reg: '®',
  laquo: '«',
  raquo: '»',
  iexcl: '¡',
  iquest: '¿',
  pound: '£',
  euro: '€',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
  szlig: 'ß',
  Agrave: 'À',
  Aacute: 'Á',
  Acirc: 'Â',
  Auml: 'Ä',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Ecirc: 'Ê',
  Iacute: 'Í',
  Ntilde: 'Ñ',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Ouml: 'Ö',
  Uacute: 'Ú',
  Uuml: 'Ü',
  abreve: 'ă',
  ebreve: 'ĕ',
  ibreve: 'ĭ',
  obreve: 'ŏ',
  ubreve: 'ŭ',
  amacr: 'ā',
  emacr: 'ē',
  imacr: 'ī',
  omacr: 'ō',
  umacr: 'ū',
  ucaron: 'ǔ',
  rdot: 'ṛ',
  mnull: 'm̥',
  consi: 'j',
  // Perseus boilerplate of the header; empty, as the Anagnosis loader has them.
  responsibility: '',
  'fund.AnnCPB': '',
  'fund.NEH': '',
  'fund.FIPSE': '',
  'Perseus.publish': '',
  'Perseus.DE': '',
};

const GRAM_TAGS = new Set([
  'gramGrp',
  'pos',
  'gen',
  'itype',
  'tns',
  'mood',
  'per',
  'num',
  'pron',
  'case',
  'gram',
]);
const SKIP_TAGS = new Set(['pb', 'milestone', 'index']);
const LABELLED_TAGS = new Set([
  'usg',
  'etym',
  'note',
  'xr',
  'abbr',
  'lbl',
  'date',
  'placeName',
  'author',
  'title',
  'biblScope',
  'hi',
  'emph',
]);
const ITALIC_TAGS = new Set(['hi', 'emph', 'title']);
const PLAIN_TAGS = new Set([
  'entryFree',
  'entry',
  'form',
  'item',
  'list',
  'p',
  'div',
  'num',
  'date',
  'term',
]);

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/** A text node: converted from Beta Code where the element is Greek, then escaped. */
function text(s: string, greek: boolean): string {
  if (!s) return '';
  return escapeText(greek ? betaToUnicode(s) : s);
}

function render(el: XmlElement, inherited: boolean, out: string[]): void {
  const tag = el.name;
  const greek = inherited || el.attrs.lang === 'greek';
  if (SKIP_TAGS.has(tag)) return;
  if (tag === 'sense') {
    // The pipeline indents a sense by its level here, but its whitespace collapse below takes the indent away again.
    const n = el.attrs.n ?? '';
    out.push('<p class="sense">');
    if (n && n !== '0') out.push(`<b>${escapeAttribute(n)}.</b> `);
    children(el, greek, out);
    out.push('</p>');
    return;
  }
  let open = '';
  let close = '';
  if (tag === 'orth') [open, close] = ['<b class="orth">', '</b>'];
  else if (tag === 'tr') [open, close] = ['<i class="tr">', '</i>'];
  else if (tag === 'trans') [open, close] = ['', ''];
  else if (tag === 'foreign' || tag === 'quote' || tag === 'lemma' || tag === 'cit')
    [open, close] = [`<span class="${tag}">`, '</span>'];
  else if (tag === 'bibl' || tag === 'ref') [open, close] = [`<span class="${tag}">`, '</span>'];
  else if (GRAM_TAGS.has(tag)) [open, close] = ['<span class="gram">', '</span>'];
  else if (LABELLED_TAGS.has(tag)) {
    const element = ITALIC_TAGS.has(tag) ? 'i' : 'span';
    [open, close] = [`<${element} class="${tag}">`, `</${element}>`];
  } else if (PLAIN_TAGS.has(tag)) [open, close] = ['', ''];
  else [open, close] = [`<span class="${tag}">`, '</span>'];
  out.push(open);
  children(el, greek, out);
  out.push(close);
}

function children(el: XmlElement, greek: boolean, out: string[]): void {
  for (const child of el.children) {
    if (child.kind === 'text') out.push(text(child.text, greek));
    else if (child.kind === 'element') render(child, greek, out);
  }
}

/** The HTML of an entry: its head matter as one paragraph, then each sense as a paragraph. */
export function renderEntry(el: XmlElement): string {
  const out: string[] = [];
  children(el, false, out);
  let s = out.join('').replace(/\s+/gu, ' ');
  s = s.replaceAll(' </p>', '</p>').replaceAll('<p class="sense"> ', '<p class="sense">');
  if (!s.startsWith('<p')) {
    const i = s.indexOf('<p');
    const head = i < 0 ? s : s.slice(0, i);
    const rest = i < 0 ? '' : s.slice(i);
    s = `<p class="head">${head.trim()}</p>${rest}`;
  }
  return s.trim();
}

/** A key's headword and its homograph number: "a)1" is the first ἀ. */
export function splitKey(key: string): { base: string; homograph: number } {
  const m = /^(.*?)(\d+)$/su.exec(key);
  return m ? { base: m[1]!, homograph: parseInt(m[2]!, 10) } : { base: key, homograph: 0 };
}

/** The row of a parsed entry, or null for an entry without a key. */
export function entryRow(el: XmlElement): LexiconEntryRow | null {
  const key = el.attrs.key ?? '';
  if (!key) return null;
  const { base, homograph } = splitKey(key);
  const headword = betaToUnicode(base);
  return {
    headword,
    homograph,
    lemmaKey: lemmaKey(headword),
    looseKey: looseKey(headword),
    html: renderEntry(el),
  };
}

/**
 * The entries of a lexicon file, one element at a time, so that a file of
 * forty megabytes is never held as a tree. Entries commented out (the
 * Middle Liddell has three) are passed over with the comment.
 */
export function* entryElements(
  xml: string,
  tag: 'entryFree' | 'entry',
  named: Record<string, string> = P4_ENTITIES,
): Generator<XmlElement> {
  const pattern = new RegExp(`<!--[\\s\\S]*?-->|<${tag}\\b[\\s\\S]*?</${tag}>`, 'gu');
  for (const m of xml.matchAll(pattern)) {
    if (m[0].startsWith('<!--')) continue;
    yield parseElement(m[0], named);
  }
}

/** The rows of a lexicon file. */
export function* entriesOf(xml: string, tag: 'entryFree' | 'entry'): Generator<LexiconEntryRow> {
  for (const el of entryElements(xml, tag)) {
    const row = entryRow(el);
    if (row) yield row;
  }
}

/** One entry's XML parsed as the lexica are: with the P4 entities. For the tests and the fixtures. */
export function parseEntryFixture(xml: string): XmlElement {
  return parseElement(xml, P4_ENTITIES);
}

export type { XmlElement, XmlNode };
