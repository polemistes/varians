/**
 * Bibliography entries as readers see them: an author-date reference in
 * pieces (so that titles can be set in italics) and as plain text, and a
 * citation as printed beside a conjecture or in a note.
 */
import { latexToUnicode, parseNames, type BibEntry, type Name } from '@varians/core';

export interface Piece {
  text: string;
  italic?: boolean;
}

const BOOKISH = new Set([
  'book',
  'mvbook',
  'collection',
  'mvcollection',
  'proceedings',
  'mvproceedings',
  'thesis',
  'report',
  'online',
  'manual',
  'misc',
  'reference',
  'mvreference',
  'unpublished',
]);
const PART_OF_BOOK = new Set([
  'incollection',
  'inproceedings',
  'inbook',
  'bookinbook',
  'inreference',
  'suppbook',
  'suppcollection',
]);

function field(entry: BibEntry, name: string): string {
  const value = entry.fields[name];
  return value === undefined ? '' : latexToUnicode(value).replace(/\s+/gu, ' ').trim();
}

function year(entry: BibEntry): string {
  for (const name of ['date', 'year']) {
    const match = /\d{4}(?:[/-]\d{2,4})?/u.exec(field(entry, name));
    if (match) return match[0].slice(0, 4);
  }
  return 'n.d.';
}

/** "West, M. L.", then "Given Family" for the others, joined with commas and a final "and". */
export function formatNames(names: Name[]): string {
  const parts = names.map((name, i) => {
    const family = latexToUnicode(name.family);
    const given = latexToUnicode(name.given);
    if (family.toLowerCase() === 'others') return 'et al.';
    if (!given) return family;
    return i === 0 ? `${family}, ${given}` : `${given} ${family}`;
  });
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.at(-1) === 'et al.') return `${parts.slice(0, -1).join(', ')} et al.`;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function namesOf(entry: BibEntry, name: string): Name[] {
  const value = entry.fields[name];
  return value === undefined || value.trim() === '' ? [] : parseNames(value);
}

function edited(names: Name[]): string {
  return `${formatNames(names)} (${names.length > 1 ? 'eds.' : 'ed.'})`;
}

function sentence(text: string): string {
  return /[.?!]$/u.test(text) ? text : `${text}.`;
}

/** The reference in pieces: names, year, title, where it appeared, publisher. */
export function referencePieces(entry: BibEntry): Piece[] {
  const authors = namesOf(entry, 'author');
  const editors = namesOf(entry, 'editor');
  const pieces: Piece[] = [];
  const responsible = authors.length
    ? formatNames(authors)
    : editors.length
      ? edited(editors)
      : field(entry, 'organization') || field(entry, 'institution');
  if (responsible) pieces.push({ text: `${sentence(responsible)} ` });
  pieces.push({ text: `${year(entry)}. ` });

  const title = field(entry, 'title');
  const location = [field(entry, 'location'), field(entry, 'publisher')].filter(Boolean).join(': ');
  if (entry.type === 'article' || entry.type === 'periodical') {
    if (title) pieces.push({ text: `‘${title}’. ` });
    const journal = field(entry, 'journaltitle');
    if (journal) pieces.push({ text: journal, italic: true });
    const volume = [field(entry, 'volume'), field(entry, 'number')].filter(Boolean).join('.');
    const pages = field(entry, 'pages').replace(/--/gu, '–');
    const tail = [volume ? ` ${volume}` : '', pages ? `: ${pages}` : ''].join('');
    pieces.push({ text: `${tail}.` });
  } else if (PART_OF_BOOK.has(entry.type)) {
    if (title) pieces.push({ text: `‘${title}’. ` });
    pieces.push({ text: 'In ' });
    const bookEditors = editors.length ? `${edited(editors)}, ` : '';
    if (bookEditors) pieces.push({ text: bookEditors });
    const booktitle = field(entry, 'booktitle');
    if (booktitle) pieces.push({ text: booktitle, italic: true });
    const pages = field(entry, 'pages').replace(/--/gu, '–');
    pieces.push({ text: `${pages ? `, ${pages}` : ''}.` });
    if (location) pieces.push({ text: ` ${sentence(location)}` });
  } else {
    if (title) pieces.push({ text: title, italic: BOOKISH.has(entry.type) || !entry.type });
    const edition = field(entry, 'edition');
    pieces.push({ text: '. ' });
    if (edition)
      pieces.push({
        text: /^\d+$/u.test(edition)
          ? `${ordinal(Number(edition))} edn. `
          : sentence(edition) + ' ',
      });
    if (authors.length && editors.length)
      pieces.push({ text: `${sentence(`Edited by ${formatNames(editors)}`)} ` });
    if (location) pieces.push({ text: sentence(location) });
  }
  const doi = field(entry, 'doi');
  const url = field(entry, 'url');
  if (doi)
    pieces.push({ text: ` https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//u, '')}` });
  else if (url) pieces.push({ text: ` ${url}` });
  return pieces
    .map((p) => ({ ...p, text: p.text.replace(/\.\./gu, '.') }))
    .filter((p) => p.text !== '');
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${n % 10 > 3 ? 'th' : suffix}`;
}

export function referenceText(entry: BibEntry): string {
  return referencePieces(entry)
    .map((p) => p.text)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** "cf. West 1998, 45": the label with what comes before and after it. */
export function formatCitation(
  label: string,
  prenote?: string | null,
  postnote?: string | null,
): string {
  const before = prenote?.trim();
  const after = postnote?.trim();
  return `${before ? `${before} ` : ''}${label}${after ? `, ${after}` : ''}`;
}
