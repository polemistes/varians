/**
 * A work of the bibliography as TEI lists it: a `<biblStruct>`, TEI's
 * structured entry, made from the biblatex entry. What is published by
 * itself (a book, a thesis, a journal) is a `<monogr>`; what is published in
 * something else (an article, a chapter) is an `<analytic>` before the
 * `<monogr>` it is in. Only what the entry says is written, in the order
 * TEI asks for, so that every entry is valid whatever it has and lacks.
 */

import { latexToUnicode, parseNames, type BibEntry, type Name } from '../bib/biblatex.ts';
import { escapeAttr, escapeText, ncName } from './xml.ts';

/** Entry types of what stands in a book: its title is the part's, and the book's is `booktitle`. */
const PART_OF_BOOK = new Set([
  'incollection',
  'inproceedings',
  'inbook',
  'bookinbook',
  'inreference',
  'suppbook',
  'suppcollection',
]);
/** Entry types of what stands in a journal. */
const IN_PERIODICAL = new Set(['article', 'periodical', 'suppperiodical', 'review']);
/** Entry types that TEI's title level `u` is for: not published, or a thesis. */
const UNPUBLISHED = new Set(['thesis', 'unpublished']);

/** The name by which the file points at a work of the bibliography. */
export function bibXmlId(id: string): string {
  return ncName(id, 'bib-');
}

function person(tag: 'author' | 'editor', name: Name, attrs: string): string {
  const family = latexToUnicode(name.family).trim();
  const given = latexToUnicode(name.given).trim();
  // A name without a given name is written as it stands: an ancient author, or a body.
  return given === ''
    ? `<${tag}${attrs}>${escapeText(family)}</${tag}>`
    : `<${tag}${attrs}><forename>${escapeText(given)}</forename> <surname>${escapeText(family)}</surname></${tag}>`;
}

/** A work as a `<biblStruct>`, named `bib-<id>` and, where a label is given, numbered by it (`n`). */
export function biblStructXml(entry: BibEntry, options: { id: string; label?: string }): string {
  const field = (name: string): string => {
    const value = entry.fields[name];
    return value === undefined ? '' : latexToUnicode(value).replace(/\s+/gu, ' ').trim();
  };
  const element = (name: string, text: string, attrs = ''): string =>
    text === '' ? '' : `<${name}${attrs}>${escapeText(text)}</${name}>`;
  const people = (name: string, tag: 'author' | 'editor', attrs = ''): string[] => {
    const value = entry.fields[name];
    if (value === undefined || value.trim() === '') return [];
    return (
      parseNames(value)
        // "and others" says that the list is not whole, and names nobody.
        .filter((n) => n.family.trim() !== '' && n.family.trim().toLowerCase() !== 'others')
        .map((n) => person(tag, n, attrs))
    );
  };
  const title = (name: string, sub: string, level: string): string =>
    element('title', [field(name), field(sub)].filter(Boolean).join(': '), ` level="${level}"`);
  const scope = (unit: string, text: string): string => {
    const range = /^(\d+)\s*[-–]+\s*(\d+)$/u.exec(text);
    const attrs = ` unit="${unit}"${range ? ` from="${range[1]}" to="${range[2]}"` : ''}`;
    return element('biblScope', text.replace(/\s*-{1,3}\s*/gu, '–'), attrs);
  };
  const idno = (type: string, text: string): string => element('idno', text, ` type="${type}"`);

  const inJournal = IN_PERIODICAL.has(entry.type);
  const inBook = PART_OF_BOOK.has(entry.type);
  const authors = people('author', 'author');
  const editors = people('editor', 'editor');
  const translators = people('translator', 'editor', ' role="translator"');
  const doi = idno('DOI', field('doi').replace(/^https?:\/\/(dx\.)?doi\.org\//u, ''));
  const written = field('date') || field('year');
  const date = element(
    'date',
    written,
    /^\d{4}(-\d{2}(-\d{2})?)?$/u.test(written) ? ` when="${written}"` : '',
  );

  const out: string[] = [];
  if (inJournal || inBook) {
    // The part: who wrote it and what it is called. In a journal its editors are none of the journal's.
    const own = [...authors, ...(inJournal ? editors : []), ...translators];
    const parts = [...own, title('title', 'subtitle', 'a'), doi].filter(Boolean);
    if (parts.length) out.push(`<analytic>${parts.join('')}</analytic>`);
  }

  const names = inJournal ? [] : inBook ? editors : [...authors, ...editors, ...translators];
  const named = inJournal
    ? title('journaltitle', 'journalsubtitle', 'j') || title('journal', '', 'j')
    : inBook
      ? title('booktitle', 'booksubtitle', 'm')
      : title('title', 'subtitle', UNPUBLISHED.has(entry.type) ? 'u' : 'm');
  const numbers = [
    idno('ISBN', field('isbn')),
    idno('ISSN', field('issn')),
    inJournal || inBook ? '' : doi,
  ].filter(Boolean);
  const imprint = (
    inJournal
      ? [
          scope('volume', field('volume')),
          scope('issue', field('number')),
          scope('page', field('pages')),
          date,
        ]
      : [
          element('pubPlace', field('location')),
          element('publisher', field('publisher') || field('institution') || field('organization')),
          date,
        ]
  ).filter(Boolean);
  const after = inJournal
    ? []
    : [scope('volume', field('volume')), inBook ? scope('page', field('pages')) : ''].filter(
        Boolean,
      );
  out.push(
    [
      '<monogr>',
      ...names,
      // TEI asks for a title after names; an entry that has names and no title has an empty one.
      named || (names.length ? '<title level="m"/>' : ''),
      ...numbers,
      element('edition', field('edition')),
      // And for an imprint, which says at least one thing: where nothing is known, a date that is empty.
      `<imprint>${imprint.length ? imprint.join('') : '<date/>'}</imprint>`,
      ...after,
      '</monogr>',
    ].join(''),
  );
  if (!inJournal && field('series') !== '')
    out.push(
      `<series>${element('title', field('series'), ' level="s"')}${scope('volume', field('number'))}</series>`,
    );
  // An address, where it is one: a pointer holds no spaces.
  const url = field('url');
  if (/^[a-z][a-z0-9+.-]*:\S+$/iu.test(url)) out.push(`<ptr target="${escapeAttr(url)}"/>`);

  const type = /^[a-z]+$/u.test(entry.type) ? ` type="${entry.type}"` : '';
  const label = options.label ? ` n="${escapeAttr(options.label)}"` : '';
  return `<biblStruct xml:id="${bibXmlId(options.id)}"${type}${label}>${out.join('')}</biblStruct>`;
}
