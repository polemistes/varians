/**
 * A transcript written as Leiden+ (see leidenplus.ts for the notation).
 *
 * Everything Leiden+ has a way of saying is written that way: the lines
 * with their numbers, the pages and columns as divisions, gaps, vacats,
 * unclear letters, the scribe's deletions and additions, abbreviations,
 * numbers, glyphs, hands, and a normalized form that differs from the
 * written one as a regularization. What it has no way of saying (the
 * segments of a work, boxes on an image, a variant noted in the margin) is
 * left out: Leiden+ is a way out of Varians for a text, not a copy of it.
 */

import type { Break, Id, Item, Mark, Obj, Stream, Token } from '../stream/items.ts';

export interface LeidenPlusWriteOptions {
  /** The language of the text, as Leiden+ names it at its head: grc, la, cop. Default grc. */
  language?: string;
  /** The labels of the witness's pages by id, for the divisions. */
  pageLabels?: Readonly<Record<Id, string>>;
}

const UNDERDOT = '̣';
const DIACRITICS: Record<string, string> = {
  asper: ' ῾',
  lenis: ' ᾿',
  diaeresis: '¨',
  acute: '´',
  grave: '`',
  circumflex: '^',
};
const SIGNS: Record<string, string> = {
  'horizontal-rule': '--------',
  'wavy-line': '~~~~~~~~',
  paragraphos: '----',
  'diple-obelismene': '>---',
  box: '###',
  coronis: '-$$-',
};

type Attrs = Mark['attrs'];

const doubt = (attrs: Attrs): boolean => attrs?.cert === 'low';

/** The extent of a gap or a space as Leiden+ writes it after a dot: `3`, `2-5`, `?`. */
function extentOf(attrs: Attrs): string {
  if (typeof attrs?.atLeast === 'number' && typeof attrs.atMost === 'number')
    return `${attrs.atLeast}-${attrs.atMost}`;
  if (typeof attrs?.quantity === 'number') return String(attrs.quantity);
  return '?';
}

function gap(attrs: Attrs): string {
  const n = extentOf(attrs);
  const about = attrs?.precision === 'low' && n !== '?' && !n.includes('-');
  const lines = attrs?.unit === 'line';
  const unsure = doubt(attrs) ? '(?)' : '';
  const desc = typeof attrs?.desc === 'string' ? attrs.desc : '';
  switch (attrs?.reason) {
    case 'illegible':
      if (desc === 'vestiges' || (lines && n === '?')) {
        if (!lines && n === '?') return `vestig${unsure} `;
        return `vestig.${about ? 'ca.' : ''}${n}${lines ? 'lin' : 'char'}${unsure}${unsure ? ' ' : ''}`;
      }
      return `${about ? 'ca.' : '.'}${n}${lines ? 'lin' : ''}${unsure}${unsure ? ' ' : ''}`;
    case 'ellipsis': {
      const amount = `${about ? 'ca.' : ''}${n}`;
      if (desc !== '' && desc !== 'non transcribed')
        return `(Lang: ${desc} ${amount} ${lines ? 'lines' : 'char'}${unsure})`;
      const what = attrs.unit === 'column' ? 'Column' : lines ? 'Lines' : 'Chars';
      return `(${what}: ${amount} non transcribed${unsure})`;
    }
    case 'omitted':
      return `<.${n}>`;
    default:
      if (lines) return `lost.${about ? 'ca.' : ''}${n}lin${unsure}${unsure ? ' ' : ''}`;
      return `[${about ? 'ca.' : '.'}${n}${unsure}]`;
  }
}

function vacat(attrs: Attrs): string {
  const n = extentOf(attrs);
  const about = attrs?.precision === 'low' && n !== '?' && !n.includes('-');
  const unsure = doubt(attrs) ? '(?) ' : '';
  return `vac.${about ? 'ca.' : ''}${n}${attrs?.unit === 'line' ? 'lin' : ''}${unsure}`;
}

function object(obj: Obj): string {
  const attrs = obj.attrs;
  const text = obj.text ?? '';
  switch (obj.type) {
    case 'gap':
      return gap(attrs);
    case 'lacuna':
      return gap({ reason: 'lost', unit: 'character', ...attrs });
    case 'space':
      return vacat(attrs);
    case 'figure':
      return `#${(text || 'figure').replace(/\s+/gu, '-')} `;
    case 'mark': {
      if (typeof attrs?.g === 'string') {
        const unclear = attrs.unclear === true ? '?' : '';
        if (attrs.g === 'filler' && typeof attrs.rend === 'string')
          return `*filler(${attrs.rend})${unclear}*`;
        return `*${attrs.g}${unclear}${text === '' ? '' : `,${text}`}*`;
      }
      const sign = typeof attrs?.rend === 'string' ? SIGNS[attrs.rend] : undefined;
      if (sign !== undefined) return sign;
      return text === '' ? '' : `/*${text}*/`;
    }
    default:
      return text === '' ? '' : `/*${text}*/`;
  }
}

/** What stands before and after the letters a mark covers; null for a mark Leiden+ does not write as brackets. */
function brackets(mark: Mark, letters: number): [string, string] | null {
  const attrs = mark.attrs;
  const unsure = doubt(attrs) ? '(?)' : '';
  switch (mark.kind) {
    case 'supplied':
      if (attrs?.evidence === 'parallel')
        return attrs.reason === 'lost' ? ['_[', `${unsure}]_`] : ['|_', `${unsure}_|`];
      return attrs?.reason === 'omitted' ? ['<', `${unsure}>`] : ['[', `${unsure}]`];
    case 'surplus':
      return ['{', `${unsure}}`];
    case 'del':
      return [
        attrs?.rend === 'slashes' ? '〚/' : attrs?.rend === 'cross-strokes' ? '〚X' : '〚',
        `${unsure}〛`,
      ];
    case 'add': {
      const place = attrs?.place;
      if (place === 'below') return ['//', `${unsure}\\\\`];
      if (place === 'interlinear') return ['||interlin:', `${unsure}||`];
      if (place === 'margin' && attrs?.rend === 'sling') return ['<|', `${unsure}|>`];
      if (place === 'margin' && attrs?.rend === 'underline') return ['<_', `${unsure}_>`];
      if (
        place === 'left' ||
        place === 'right' ||
        place === 'top' ||
        place === 'bottom' ||
        place === 'margin'
      )
        return [`||${place}:`, `${unsure}||`];
      return ['\\', `${unsure}/`];
    }
    case 'hi': {
      const rend = typeof attrs?.rend === 'string' ? attrs.rend : '';
      if (rend === 'superscript') return ['|^', '^|'];
      if (rend === 'subscript') return ['\\|', '|/'];
      if (rend === 'tall') return ['~||', '||~tall'];
      if (rend === 'supraline') return ['¯', '¯'];
      if (rend === 'supraline-underline') return ['¯_', '_¯'];
      // A diacritic of the scribe's stands on one letter: a space before it, the sign in parentheses after.
      const sign = DIACRITICS[rend];
      return sign !== undefined && letters === 1 ? [' ', `(${sign})`] : null;
    }
    case 'num': {
      const tick = attrs?.rend === 'tick' ? " '" : '';
      let value = typeof attrs?.value === 'string' ? attrs.value : String(attrs?.value ?? '');
      if (attrs?.type === 'fraction' && value === '') value = 'frac';
      if (typeof attrs?.atLeast === 'string' || typeof attrs?.atLeast === 'number')
        value = `${attrs.atLeast}-${attrs.atMost ?? '?'}`;
      return ['<#', `${tick}=${value}#>`];
    }
    case 'foreign':
      return ['~|', `|~${typeof attrs?.lang === 'string' ? attrs.lang : 'la'} `];
    case 'q':
      return ['"', '"'];
    case 'orig':
      return ['!', '!'];
    case 'abbr':
      // An abbreviation whose expansion cannot be written after its letters is left unresolved.
      return typeof attrs?.expan === 'string' ? null : ['(|', `${unsure}|)`];
    default:
      return null;
  }
}

/** A mark that stands at one place of a word: a gap, a vacat, a change of hand. */
function point(mark: Mark): string {
  if (mark.kind === 'gap') return gap(mark.attrs);
  if (mark.kind === 'space') return vacat(mark.attrs);
  if (mark.kind === 'handShift' && typeof mark.attrs?.new === 'string')
    return `$${mark.attrs.new}${doubt(mark.attrs) ? '(?)' : ''} `;
  return '';
}

interface Ranged {
  mark: Mark;
  from: number;
  to: number;
  order: number;
  open: string;
  close: string;
}

/** The letters of a word with its marks as Leiden+ writes them. Ranges that overlap without nesting are divided into pieces that nest. */
function marked(form: string, marks: readonly Mark[]): string {
  const chars = Array.from(form);
  const length = chars.length;
  const unclear = new Array<boolean>(length).fill(false);
  const points: Mark[] = [];
  const ranges: Ranged[] = [];
  let before = '';
  marks.forEach((mark, order) => {
    if (mark.from !== undefined && mark.from === mark.to) {
      points.push(mark);
      return;
    }
    const from = Math.max(0, mark.from ?? 0);
    const to = Math.min(length, mark.to ?? length);
    if (mark.kind === 'handShift') {
      before += point(mark);
      return;
    }
    if (mark.kind === 'unclear') {
      for (let i = from; i < to; i++) unclear[i] = true;
      return;
    }
    const pair = brackets(mark, to - from);
    if (pair && from < to) ranges.push({ mark, from, to, order, open: pair[0], close: pair[1] });
  });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order);
  const cuts = new Set<number>([0, length]);
  for (const range of ranges) cuts.add(range.from).add(range.to);
  for (const p of points) cuts.add(Math.min(length, Math.max(0, p.from ?? 0)));
  const bounds = [...cuts].sort((a, b) => a - b);
  let out = before;
  const open: Ranged[] = [];
  const letters = (a: number, b: number): string =>
    chars
      .slice(a, b)
      .map((ch, k) => (unclear[a + k] ? `${ch}${UNDERDOT}` : ch))
      .join('');
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k]!;
    const b = bounds[k + 1]!;
    const active = ranges.filter((r) => r.from <= a && r.to >= b);
    let common = 0;
    while (common < open.length && common < active.length && open[common] === active[common])
      common++;
    for (let j = open.length - 1; j >= common; j--) out += open[j]!.close;
    open.length = common;
    out += points
      .filter((p) => p.from === a)
      .map(point)
      .join('');
    for (let j = common; j < active.length; j++) {
      out += active[j]!.open;
      open.push(active[j]!);
    }
    out += letters(a, b);
  }
  for (let j = open.length - 1; j >= 0; j--) out += open[j]!.close;
  out += points
    .filter((p) => (p.from ?? 0) >= length)
    .map(point)
    .join('');
  return out;
}

/** Whether a word is one side of the scribe's own correction: what was added, or what was deleted. */
function sideOfCorrection(item: Item | undefined, side: 'add' | 'del'): item is Token {
  if (item?.kind !== 'token') return false;
  const whole = (kind: string): boolean =>
    (item.marks ?? []).some((m) => m.kind === kind && m.from === undefined && m.to === undefined);
  return whole('subst') && whole(side);
}

/** A word without the marks that say it is one side of a correction, which the notation around it says. */
function side(token: Token): string {
  const kept = (token.marks ?? []).filter(
    (m) => !(m.from === undefined && (m.kind === 'subst' || m.kind === 'add' || m.kind === 'del')),
  );
  return word(kept.length > 0 ? { ...token, marks: kept } : { ...token, marks: [] });
}

function word(token: Token): string {
  const marks = (token.marks ?? []).filter((m) => m.kind !== 'variant');
  const abbr = marks.find((m) => m.kind === 'abbr' && typeof m.attrs?.expan === 'string');
  const others = marks.filter((m) => m !== abbr);
  let written = marked(token.form, others);
  if (abbr) {
    const expan = String(abbr.attrs!.expan);
    const unsure = doubt(abbr.attrs) ? '?' : '';
    if (abbr.attrs!.symbol === true) written = `((${expan}${unsure}))`;
    else if (expan.startsWith(token.form) && expan.length > token.form.length)
      written = `(${written}(${expan.slice(token.form.length)}${unsure}))`;
    else written = `(|${written}|)`;
  }
  // A correction of the scribe's is the read form, as a regularization is.
  const corr = marks.find((m) => m.kind === 'corr' && typeof m.attrs?.corr === 'string');
  if (corr) return `<:${String(corr.attrs!.corr)}|corr|${written}:>`;
  if (token.norm !== undefined && token.norm !== token.form && token.norm !== '')
    return `<:${token.norm}|reg|${written}:>`;
  return written;
}

/** A label as a division's name: Leiden+ divides its names at dots and spaces. */
function divisionName(label: string): string {
  return label.trim().replace(/[.\s<>=#]+/gu, '_') || '_';
}

/** A stream as Leiden+. */
export function toLeidenPlus(stream: Stream, options: LeidenPlusWriteOptions = {}): string {
  const out: string[] = [`<S=.${options.language ?? 'grc'}`];
  const items = stream.items;
  /** Divisions open: a page, and a column within it. */
  let page = false;
  let column = false;
  let block = false;
  /** Whether the line being written has its number. */
  let numbered = false;
  let line = '';
  let lastNumber = 0;
  /** The join of a word that runs on, waiting for the number of the line it runs on to. */
  let runsOn = false;
  let glue = true;

  const flushLine = (): void => {
    if (line.trim() !== '') out.push(line.trimEnd());
    line = '';
  };
  const openBlock = (): void => {
    if (block) return;
    flushLine();
    out[out.length - 1] += '<=';
    block = true;
    numbered = false;
  };
  const closeBlock = (): void => {
    flushLine();
    if (block) out.push('=>');
    block = false;
  };
  const closeDivisions = (pageToo: boolean): void => {
    closeBlock();
    if (column) out[out.length - 1] += '=D>';
    column = false;
    if (pageToo && page) out[out.length - 1] += '=D>';
    if (pageToo) page = false;
  };
  const number = (brk?: Break): void => {
    const label = brk?.label;
    const given = label !== undefined && /^\d+[/,a-zA-Z0-9]*$/u.test(label) ? label : undefined;
    const n = given ?? String(lastNumber + 1);
    lastNumber = Number.parseInt(n, 10) || lastNumber + 1;
    const join = runsOn ? '.-' : '';
    line +=
      brk?.rend !== undefined ? `(${n}${join}, ${brk.rend}) ` : `${n}.${join === '' ? '' : '-'} `;
    numbered = true;
    runsOn = false;
    glue = true;
  };
  const write = (text: string): void => {
    if (text === '') return;
    openBlock();
    if (!numbered) number();
    line += (glue ? '' : ' ') + text;
    glue = false;
  };

  /** The word already written as the other side of a correction. */
  let skip = -1;
  items.forEach((item: Item, index) => {
    if (index === skip) return;
    if (item.kind === 'break') {
      const previous = items[index - 1];
      runsOn = previous?.kind === 'token' && previous.joinNext === true;
      switch (item.type) {
        case 'page': {
          closeDivisions(true);
          const label =
            (item.pageId !== undefined ? options.pageLabels?.[item.pageId] : undefined) ??
            item.label ??
            String(index);
          out.push(`<D=.${divisionName(label)}`);
          page = true;
          lastNumber = 0;
          break;
        }
        case 'column':
          closeDivisions(false);
          out.push(`<D=.${divisionName(item.label ?? 'col')}.column`);
          column = true;
          break;
        case 'paragraph':
          closeBlock();
          out.push('');
          break;
        default:
          openBlock();
          flushLine();
          number(item);
      }
      return;
    }
    if (item.kind === 'token') {
      // The scribe's correction of a word: what was added, then what it replaced.
      const next = items[index + 1];
      if (sideOfCorrection(item, 'add') && sideOfCorrection(next, 'del')) {
        write(`<:${side(item)}|subst|${side(next)}:>`);
        skip = index + 1;
        return;
      }
      write(word(item));
      if (item.joinNext) glue = true;
      return;
    }
    write(object(item));
  });
  closeDivisions(true);
  return `${out.filter((piece, k) => piece !== '' || k === 0).join('\n')}\n`;
}
