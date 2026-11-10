/**
 * The bibliography is biblatex: entries are read from and
 * written to `.bib` text, and the apparatus cites them by an author-year
 * label derived here. The reader is hand-written for the standard shape:
 * braced, quoted and bare values, `#` concatenation, `@string` macros,
 * `@comment` and `@preamble` blocks, BibTeX's legacy types and fields
 * mapped onto their biblatex names. LaTeX inside values is kept as written.
 */

export interface BibEntry {
  /** The entry type in lower case: article, book, thesis, ... */
  type: string;
  key: string;
  /** Field name in lower case to value, outer braces removed, inner braces kept. */
  fields: Record<string, string>;
}

export interface BiblatexParse {
  entries: BibEntry[];
  warnings: string[];
}

export interface Name {
  family: string;
  given: string;
}

/** BibTeX types that biblatex spells differently, with the `type` field the alias implies. */
const TYPE_ALIASES: Record<string, [string, string | null]> = {
  phdthesis: ['thesis', 'phdthesis'],
  mastersthesis: ['thesis', 'mathesis'],
  techreport: ['report', 'techreport'],
  conference: ['inproceedings', null],
  electronic: ['online', null],
  www: ['online', null],
};

/** BibTeX fields that biblatex spells differently. */
const FIELD_ALIASES: Record<string, string> = {
  journal: 'journaltitle',
  address: 'location',
  school: 'institution',
  annote: 'annotation',
  key: 'sortkey',
  pdf: 'file',
  primaryclass: 'eprintclass',
  archiveprefix: 'eprinttype',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The order fields are written in; anything else follows alphabetically. */
const FIELD_ORDER = [
  'author',
  'editor',
  'title',
  'journaltitle',
  'booktitle',
  'date',
  'volume',
  'number',
  'pages',
  'publisher',
  'location',
  'doi',
  'url',
];

/** Read `.bib` text. Entries that cannot be read are skipped and reported; nothing is fatal. */
export function parseBiblatex(text: string): BiblatexParse {
  const entries: BibEntry[] = [];
  const warnings: string[] = [];
  const macros = new Map<string, string>(MONTHS.map((month, i) => [month, String(i + 1)]));
  const cursor = { text, pos: 0 };
  while (true) {
    const at = text.indexOf('@', cursor.pos);
    if (at < 0) break;
    cursor.pos = at + 1;
    const name = readWhile(cursor, (c) => /[A-Za-z]/u.test(c)).toLowerCase();
    skipSpace(cursor);
    const open = text[cursor.pos];
    if (name === '' || (open !== '{' && open !== '(')) continue;
    const close = open === '{' ? '}' : ')';
    cursor.pos++;
    if (name === 'comment' || name === 'preamble') {
      if (!skipBlock(cursor, close)) {
        warnings.push(`An unclosed @${name} block at the end of the file was ignored.`);
        break;
      }
      continue;
    }
    if (name === 'string') {
      const fields = readFields(cursor, close, macros, warnings, '@string');
      if (fields === null) {
        warnings.push('An unclosed @string block at the end of the file was ignored.');
        break;
      }
      for (const [macro, value] of fields) macros.set(macro.toLowerCase(), value);
      continue;
    }
    skipSpace(cursor);
    const key = readWhile(cursor, (c) => c !== ',' && c !== close && !/\s/u.test(c));
    skipSpace(cursor);
    if (text[cursor.pos] === ',') cursor.pos++;
    const fields = readFields(
      cursor,
      close,
      macros,
      warnings,
      key === '' ? `@${name}` : `"${key}"`,
    );
    if (fields === null) {
      warnings.push(
        `An unclosed @${name} entry${key === '' ? '' : ` "${key}"`} at the end of the file was ignored.`,
      );
      break;
    }
    if (key === '') {
      warnings.push(`An @${name} entry without a key was skipped.`);
      continue;
    }
    if (/[{}()"#\\]/u.test(key)) {
      warnings.push(`An @${name} entry with the unusable key "${key}" was skipped.`);
      continue;
    }
    const [type, typeField] = TYPE_ALIASES[name] ?? [name, null];
    const record: Record<string, string> = {};
    for (const [rawName, value] of fields) {
      const lower = rawName.toLowerCase();
      const fieldName = FIELD_ALIASES[lower] ?? lower;
      if (value.trim() === '') continue;
      if (record[fieldName] !== undefined)
        warnings.push(`"${key}": the field ${fieldName} is given twice; the last value is kept.`);
      record[fieldName] = value.trim();
    }
    if (typeField !== null && record.type === undefined) record.type = typeField;
    dateFromYearAndMonth(record);
    entries.push({ type, key, fields: record });
  }
  return { entries, warnings };
}

interface Cursor {
  text: string;
  pos: number;
}

/** Skip a braced or parenthesised block whose opener has been consumed. False when it never closes. */
function skipBlock(cursor: Cursor, close: string): boolean {
  let depth = 1;
  while (cursor.pos < cursor.text.length) {
    const ch = cursor.text[cursor.pos]!;
    cursor.pos++;
    if (ch === '\\') {
      cursor.pos++;
    } else if (ch === '{' || (close === ')' && ch === '(')) {
      depth++;
    } else if (ch === '}' || (close === ')' && ch === ')')) {
      depth--;
      if (depth === 0) return true;
    }
  }
  return false;
}

/** The `name = value` pairs up to the closing bracket, which is consumed. Null when the text ends first. */
function readFields(
  cursor: Cursor,
  close: string,
  macros: Map<string, string>,
  warnings: string[],
  where: string,
): [string, string][] | null {
  const fields: [string, string][] = [];
  while (true) {
    skipSpace(cursor);
    if (cursor.pos >= cursor.text.length) return null;
    if (cursor.text[cursor.pos] === close) {
      cursor.pos++;
      return fields;
    }
    if (cursor.text[cursor.pos] === ',') {
      cursor.pos++;
      continue;
    }
    const name = readWhile(cursor, (c) => !/[\s=,{}()"#]/u.test(c));
    skipSpace(cursor);
    if (name === '' || cursor.text[cursor.pos] !== '=') {
      warnings.push(
        `${where}: unreadable text before "${cursor.text.slice(cursor.pos, cursor.pos + 20).trim()}" was skipped.`,
      );
      if (!skipToComma(cursor, close)) return null;
      continue;
    }
    cursor.pos++;
    const value = readValue(cursor, close, macros, warnings, where);
    fields.push([name, value]);
    skipSpace(cursor);
    const ch = cursor.text[cursor.pos];
    if (ch === undefined) return null;
    if (ch !== ',' && ch !== close) {
      warnings.push(`${where}: unexpected text after the field ${name} was skipped.`);
      if (!skipToComma(cursor, close)) return null;
    }
  }
}

/** Advance to the next comma at depth zero, leaving the cursor on it or on the closer. False when the text ends. */
function skipToComma(cursor: Cursor, close: string): boolean {
  let depth = 0;
  while (cursor.pos < cursor.text.length) {
    const ch = cursor.text[cursor.pos]!;
    if (ch === '{') depth++;
    else if (ch === '}' && depth > 0) depth--;
    else if (depth === 0 && (ch === ',' || ch === close)) return true;
    cursor.pos++;
  }
  return false;
}

/** A value: braced, quoted or bare, or several of those joined with `#`. Whitespace inside is collapsed. */
function readValue(
  cursor: Cursor,
  close: string,
  macros: Map<string, string>,
  warnings: string[],
  where: string,
): string {
  const parts: string[] = [];
  while (true) {
    skipSpace(cursor);
    const ch = cursor.text[cursor.pos];
    if (ch === undefined) break;
    if (ch === '{') {
      cursor.pos++;
      parts.push(readBraced(cursor));
    } else if (ch === '"') {
      cursor.pos++;
      parts.push(readQuoted(cursor));
    } else {
      const bare = readWhile(cursor, (c) => !/[\s,#]/u.test(c) && c !== close && c !== '}');
      if (bare === '') break;
      if (/^\d+$/u.test(bare)) {
        parts.push(bare);
      } else {
        const macro = macros.get(bare.toLowerCase());
        if (macro === undefined)
          warnings.push(
            `${where}: the macro ${bare} is not defined; its name is used as the value.`,
          );
        parts.push(macro ?? bare);
      }
    }
    skipSpace(cursor);
    if (cursor.text[cursor.pos] === '#') {
      cursor.pos++;
      continue;
    }
    break;
  }
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

/** The content of a braced value whose opening brace has been consumed; the closing brace is consumed too. */
function readBraced(cursor: Cursor): string {
  const start = cursor.pos;
  let depth = 1;
  while (cursor.pos < cursor.text.length) {
    const ch = cursor.text[cursor.pos]!;
    if (ch === '\\') {
      cursor.pos += 2;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const content = cursor.text.slice(start, cursor.pos);
        cursor.pos++;
        return content;
      }
    }
    cursor.pos++;
  }
  return cursor.text.slice(start);
}

function readQuoted(cursor: Cursor): string {
  const start = cursor.pos;
  let depth = 0;
  while (cursor.pos < cursor.text.length) {
    const ch = cursor.text[cursor.pos]!;
    if (ch === '\\') {
      cursor.pos += 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '"' && depth === 0) {
      const content = cursor.text.slice(start, cursor.pos);
      cursor.pos++;
      return content;
    }
    cursor.pos++;
  }
  return cursor.text.slice(start);
}

function readWhile(cursor: Cursor, accept: (c: string) => boolean): string {
  const start = cursor.pos;
  while (cursor.pos < cursor.text.length && accept(cursor.text[cursor.pos]!)) cursor.pos++;
  return cursor.text.slice(start, cursor.pos);
}

function skipSpace(cursor: Cursor): void {
  while (cursor.pos < cursor.text.length && /\s/u.test(cursor.text[cursor.pos]!)) cursor.pos++;
}

/** BibTeX's `year` and `month` become biblatex's `date` when the entry has none and the year is a plain year. */
function dateFromYearAndMonth(fields: Record<string, string>): void {
  if (fields.date !== undefined) return;
  const year = fields.year;
  if (year === undefined || !/^\d{4}$/u.test(year.trim())) return;
  const month = monthNumber(fields.month);
  fields.date = month === null ? year.trim() : `${year.trim()}-${String(month).padStart(2, '0')}`;
  delete fields.year;
  if (month !== null) delete fields.month;
}

function monthNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.replace(/[{}]/gu, '').trim().toLowerCase();
  if (/^\d{1,2}$/u.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= 12 ? n : null;
  }
  const index = MONTHS.findIndex((month) => text.startsWith(month));
  return index >= 0 ? index + 1 : null;
}

/** Write entries as `.bib` text, fields in a stable order, values braced. */
export function serializeBiblatex(entries: BibEntry[]): string {
  return entries.map(serializeEntry).join('\n\n') + (entries.length > 0 ? '\n' : '');
}

function serializeEntry(entry: BibEntry): string {
  const names = Object.keys(entry.fields).sort(compareFieldNames);
  const lines = names.map((name) => `  ${name} = {${entry.fields[name] ?? ''}},`);
  return `@${entry.type}{${entry.key},\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}}`;
}

function compareFieldNames(a: string, b: string): number {
  const ia = FIELD_ORDER.indexOf(a);
  const ib = FIELD_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The author-year label an apparatus cites by: "Wilamowitz 1927", "Dover
 * and Henderson 1987", "Page et al. 1962". Names come from the first name
 * list the entry has (author, editor, translator), then a corporate body
 * (organization, institution, publisher), then the title's first words;
 * the year is the first year in `date`, else `year`.
 */
export function citationLabel(entry: BibEntry): string {
  const fields = entry.fields;
  let names = '';
  for (const field of ['author', 'editor', 'translator']) {
    const value = fields[field];
    if (value !== undefined && value.trim() !== '') {
      names = familyNames(parseNames(value));
      if (names !== '') break;
    }
  }
  if (names === '') {
    for (const field of ['organization', 'institution', 'publisher']) {
      const value = fields[field];
      if (value !== undefined && value.trim() !== '') {
        names = latexToUnicode(splitOutsideBraces(value, /^and$/iu)[0] ?? '');
        if (names !== '') break;
      }
    }
  }
  const year = citationYear(fields);
  if (names === '') {
    const title = titleWords(fields);
    return [title, year].filter((part) => part !== '').join(' ') || entry.key;
  }
  return [names, year].filter((part) => part !== '').join(' ');
}

/** The year an entry is cited by: the first four digits of `date`, else of `year`; empty when there is none. */
export function citationYear(fields: Record<string, string>): string {
  for (const field of ['date', 'year']) {
    const value = fields[field];
    const match = value === undefined ? null : /\d{4}/u.exec(value);
    if (match) return match[0];
  }
  return '';
}

function titleWords(fields: Record<string, string>): string {
  const short = fields.shorttitle;
  if (short !== undefined && short.trim() !== '') return latexToUnicode(short);
  const title = fields.title;
  if (title === undefined || title.trim() === '') return '';
  const head = latexToUnicode(title)
    .split(/[:.;?!]/u)[0]!
    .trim();
  const words = head.split(/\s+/u).filter((w) => w !== '');
  return (words.length <= 4 ? words : words.slice(0, 3)).join(' ');
}

/** "Wilamowitz", "Dover and Henderson", "Page et al."; "and others" counts as et al. */
function familyNames(names: Name[]): string {
  const families = names.map((name) => latexToUnicode(name.family)).filter((f) => f !== '');
  const others = families.findIndex((f) => f.toLowerCase() === 'others');
  if (others >= 0) {
    const first = families[0];
    return first === undefined || others === 0 ? '' : `${first} et al.`;
  }
  const [first, second] = families;
  if (first === undefined) return '';
  if (second === undefined) return first;
  if (families.length === 2) return `${first} and ${second}`;
  return `${first} et al.`;
}

/**
 * A biblatex name list into family and given names: "Last, First and Last,
 * First", or "First Last", with "and" between names and braces protecting
 * what must not be split. A "von" part stays with the family name.
 */
export function parseNames(value: string): Name[] {
  const names: Name[] = [];
  for (const raw of splitOutsideBraces(value, /^and$/iu)) {
    const item = raw.trim();
    if (item === '') continue;
    const parts = splitOutsideBraces(item, ',').map((part) => part.trim());
    if (parts.length >= 2) {
      const given = unbrace(parts[parts.length - 1]!);
      const family = unbrace(parts.slice(0, -1).join(' '));
      names.push({ family, given });
      continue;
    }
    if (item.startsWith('{') && item.endsWith('}') && braceDepthAt(item, item.length - 1) === 1) {
      names.push({ family: unbrace(item), given: '' });
      continue;
    }
    const words = wordsOutsideBraces(item);
    if (words.length <= 1) {
      names.push({ family: unbrace(item), given: '' });
      continue;
    }
    let vonStart = words.findIndex(
      (word, i) => i < words.length - 1 && /^\p{Ll}/u.test(unbrace(word)),
    );
    if (vonStart < 0) vonStart = words.length - 1;
    names.push({
      family: unbrace(words.slice(vonStart).join(' ')),
      given: unbrace(words.slice(0, vonStart).join(' ')),
    });
  }
  return names;
}

/** Names back to biblatex's unambiguous "Last, First" list; a corporate name is braced. */
export function serializeNames(names: Name[]): string {
  return names
    .filter((name) => name.family.trim() !== '')
    .map((name) => {
      const family = name.family.trim();
      const given = name.given.trim();
      if (given === '') return family.includes(' ') ? `{${family}}` : family;
      return `${family}, ${given}`;
    })
    .join(' and ');
}

/** Give repeated labels the suffixes a, b, c in order of appearance: Henderson 1987a, Henderson 1987b. */
export function disambiguateLabels(labels: string[]): string[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if ((counts.get(label) ?? 0) < 2) return label;
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    return label + letterSuffix(n);
  });
}

function letterSuffix(n: number): string {
  let out = '';
  let value = n;
  do {
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
}

const ACCENTS: Record<string, string> = {
  '`': '̀',
  "'": '́',
  '^': '̂',
  '~': '̃',
  '=': '̄',
  u: '̆',
  '.': '̇',
  '"': '̈',
  r: '̊',
  H: '̋',
  v: '̌',
  c: '̧',
  k: '̨',
  d: '̣',
  b: '̱',
};

const LETTERS: Record<string, string> = {
  ss: 'ß',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
  dh: 'ð',
  DH: 'Ð',
  th: 'þ',
  TH: 'Þ',
};

/** LaTeX accents and special letters as Unicode, braces removed: `M{\"u}ller` becomes `Müller`. For display only. */
export function latexToUnicode(text: string): string {
  const accented = text
    .replace(
      /\\([`'^~=."Hrvcdkbu])\{?(\\?[ij]|\p{L})\}?/gu,
      (_, accent: string, letter: string) => {
        const base = letter === '\\i' ? 'i' : letter === '\\j' ? 'j' : letter;
        return (base + (ACCENTS[accent] ?? '')).normalize('NFC');
      },
    )
    .replace(
      /\\(ss|ae|AE|oe|OE|aa|AA|dh|DH|th|TH|[oOlLij])(?![A-Za-z])\s?/gu,
      (_, name: string) => LETTERS[name] ?? name,
    )
    .replace(/\\&/gu, '&')
    .replace(/~/gu, ' ')
    .replace(/\\emph|\\textit|\\textbf/gu, '');
  return accented.replace(/[{}]/gu, '').replace(/\s+/gu, ' ').trim();
}

function unbrace(text: string): string {
  return text.replace(/[{}]/gu, '').trim();
}

/** Split at a separator standing at brace depth zero: a string, or a pattern a whole whitespace-delimited word must match. */
function splitOutsideBraces(text: string, separator: string | RegExp): string[] {
  if (typeof separator === 'string') {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      if (depth === 0 && ch === separator) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current);
    return parts;
  }
  const parts: string[] = [];
  let current: string[] = [];
  for (const word of wordsOutsideBraces(text)) {
    if (separator.test(word)) {
      parts.push(current.join(' '));
      current = [];
    } else {
      current.push(word);
    }
  }
  parts.push(current.join(' '));
  return parts;
}

/** Whitespace-delimited words, a braced group counting as one word. */
function wordsOutsideBraces(text: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/u.test(ch)) {
      if (current !== '') words.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current !== '') words.push(current);
  return words;
}

function braceDepthAt(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
  }
  return depth;
}
