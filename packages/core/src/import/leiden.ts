/**
 * Leiden conventions in plain text (epigraphy, papyrology) read into a
 * stream with marks and objects, and written back from a stream for the
 * apparatus's "as written" display.
 *
 *   [abc]   supplied (lost)             [---] [...] [ca. 5] [5]  gaps
 *   {abc}   surplus                     (abc)   abbreviation expanded
 *   ⟦abc⟧   deleted by the scribe       \abc/   added above the line
 *   <abc>   editor's correction         ạḅ _ab_ unclear letters
 *   |       line end (|| is read as a line end, with a warning)
 *   -       at a line end: the word continues on the next line
 *   vac.    a blank left by the scribe   ...    standalone dots: illegible
 *
 * A text in this notation is a transcript of its carrier, and is read as
 * every transcript is (docs/design.md, section 3.7): what its editor
 * supplied or struck out is not kept as the carrier's. Letters supplied in
 * [ ] become the gap they fill, letters added in < > or bracketed in { }
 * inside a word make its read form, a whole word added is left out and a
 * whole word bracketed stays.
 */

import { newId } from '../ids.ts';
import {
  isBreak,
  isNotTranscribed,
  isObj,
  type Break,
  type Item,
  type Mark,
  type Obj,
  type Stream,
  type Token,
} from '../stream/items.ts';
import { NOT_TRANSCRIBED_TEXT } from '../stream/text.ts';

export interface LeidenOptions {
  ids?: () => string;
  /** `transcript`, the default, reads the text as the transcript of its carrier; `verbatim` keeps every bracket as its mark. */
  as?: 'transcript' | 'verbatim';
}

export interface LeidenImport {
  stream: Stream;
  warnings: string[];
}

type RangeKind = 'supplied' | 'surplus' | 'del' | 'add' | 'corr' | 'unclear';

const KIND_ORDER: RangeKind[] = ['supplied', 'surplus', 'del', 'add', 'corr', 'unclear'];

interface Bracket {
  close: string;
  kind: RangeKind | 'paren';
}

const OPENERS = new Map<string, Bracket>([
  ['[', { close: ']', kind: 'supplied' }],
  ['{', { close: '}', kind: 'surplus' }],
  ['⟦', { close: '⟧', kind: 'del' }],
  ['<', { close: '>', kind: 'corr' }],
  ['\\', { close: '/', kind: 'add' }],
  ['(', { close: ')', kind: 'paren' }],
]);

const CLOSERS = new Map<string, string>(
  [...OPENERS].map(([open, bracket]) => [bracket.close, open]),
);

const COMBINING = /^\p{M}$/u;
const DOT_BELOW = '̣';

/** A letter inside the units of one token, with the marks that cover it. */
interface Unit {
  text: string;
  kinds: RangeKind[];
}

interface Building {
  units: Unit[];
  /** The word with its abbreviations expanded, as far as it has been read. */
  expansion: string;
  abbr: boolean;
  joinNext: boolean;
}

interface Context {
  ids: () => string;
  chars: string[];
  items: Item[];
  warnings: string[];
  depth: Record<RangeKind, number>;
  building: Building | null;
  /** Every bracket is kept as its mark. */
  keep: boolean;
  /** The gap last made from supplied words, which the next supplied word joins. */
  lastLostGap: Obj | null;
}

/** Read Leiden notation into a stream. Unbalanced brackets are kept as text and reported. */
export function fromLeiden(text: string, options: LeidenOptions = {}): LeidenImport {
  const chars = Array.from(prepare(text));
  const matching = matchBrackets(chars);
  const ctx: Context = {
    ids: options.ids ?? newId,
    chars,
    items: [],
    warnings: [],
    depth: { supplied: 0, surplus: 0, del: 0, add: 0, corr: 0, unclear: 0 },
    building: null,
    keep: options.as === 'verbatim',
    lastLostGap: null,
  };
  for (const i of [...matching.unmatched].sort((a, b) => a - b)) {
    ctx.warnings.push(`Unbalanced "${chars[i]}" on line ${lineOf(chars, i)}, kept as text.`);
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (matching.unmatched.has(i)) {
      literal(ctx, ch);
      continue;
    }
    const opener = OPENERS.get(ch);
    const close = matching.pairs.get(i);
    if (opener && close !== undefined) {
      const content = chars.slice(i + 1, close).join('');
      if (opener.kind === 'paren') {
        parenthesis(ctx, content, i);
        i = close;
        continue;
      }
      if (opener.kind === 'supplied') {
        const gap = gapAttrs(content);
        if (gap) {
          flushToken(ctx);
          ctx.items.push({ kind: 'object', id: ctx.ids(), type: 'gap', attrs: gap });
          i = close;
          continue;
        }
      }
      ctx.depth[opener.kind]++;
      continue;
    }
    const openChar = CLOSERS.get(ch);
    if (openChar !== undefined && matching.closers.has(i)) {
      const kind = OPENERS.get(openChar)!.kind;
      if (kind !== 'paren') ctx.depth[kind] = Math.max(0, ctx.depth[kind] - 1);
      continue;
    }
    if (ch === '_') {
      if (matching.closers.has(i)) ctx.depth.unclear = Math.max(0, ctx.depth.unclear - 1);
      else ctx.depth.unclear++;
      continue;
    }
    if (ch === '|') {
      if (chars[i + 1] === '|') {
        ctx.warnings.push(`"||" on line ${lineOf(chars, i)} read as a line break.`);
        i++;
      }
      endLine(ctx);
      continue;
    }
    if (ch === '\n') {
      endLine(ctx);
      continue;
    }
    if (/\s/u.test(ch)) {
      flushToken(ctx);
      continue;
    }
    if (ch === DOT_BELOW) {
      dotBelow(ctx);
      continue;
    }
    if (COMBINING.test(ch)) {
      appendCombining(ctx, ch);
      continue;
    }
    if (ch === '.' || ch === '+') {
      const run = dotRun(chars, i);
      if (run.count >= 2) {
        flushToken(ctx);
        ctx.items.push({
          kind: 'object',
          id: ctx.ids(),
          type: 'gap',
          attrs: { reason: 'illegible', unit: 'character', quantity: run.count },
        });
        i = run.end - 1;
        continue;
      }
    }
    literal(ctx, ch);
  }
  flushToken(ctx);
  for (let i = ctx.items.length - 1; i >= 0; i--) {
    const item = ctx.items[i]!;
    if (item.kind === 'token') {
      delete item.joinNext;
      break;
    }
  }
  return { stream: { items: ctx.items }, warnings: ctx.warnings };
}

function prepare(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/…/gu, '...')
    .replace(/\[\[/gu, '⟦')
    .replace(/\]\]/gu, '⟧')
    .replace(/〚/gu, '⟦')
    .replace(/〛/gu, '⟧');
}

interface Matching {
  /** Opening index to closing index. */
  pairs: Map<number, number>;
  /** Closing index to opening index. */
  closers: Map<number, number>;
  unmatched: Set<number>;
}

function matchBrackets(chars: string[]): Matching {
  const stacks = new Map<string, number[]>();
  const pairs = new Map<number, number>();
  const closers = new Map<number, number>();
  const unmatched = new Set<number>();
  let underscore: number | null = null;
  chars.forEach((ch, i) => {
    if (OPENERS.has(ch)) {
      const stack = stacks.get(ch) ?? [];
      stack.push(i);
      stacks.set(ch, stack);
      return;
    }
    const opener = CLOSERS.get(ch);
    if (opener !== undefined) {
      const open = stacks.get(opener)?.pop();
      if (open === undefined) {
        unmatched.add(i);
      } else {
        pairs.set(open, i);
        closers.set(i, open);
      }
      return;
    }
    if (ch === '_') {
      if (underscore === null) {
        underscore = i;
      } else {
        pairs.set(underscore, i);
        closers.set(i, underscore);
        underscore = null;
      }
    }
  });
  for (const stack of stacks.values()) for (const i of stack) unmatched.add(i);
  if (underscore !== null) unmatched.add(underscore);
  return { pairs, closers, unmatched };
}

const GAP_UNKNOWN = /^[\s\-–—]*$/u;
const GAP_DOTS = /^[\s.+]*[.+][\s.+]*$/u;
const GAP_CIRCA = /^\s*(?:ca?\.?|circa)\s*(\d+)\s*$/iu;
const GAP_NUMBER = /^\s*(\d+)\s*$/u;

/** The attributes of the gap a bracket's content stands for, or null when the content is supplied text. */
function gapAttrs(content: string): Obj['attrs'] | null {
  if (GAP_UNKNOWN.test(content)) return { reason: 'lost', unit: 'character', extent: 'unknown' };
  if (GAP_DOTS.test(content)) {
    return { reason: 'lost', unit: 'character', quantity: (content.match(/[.+]/gu) ?? []).length };
  }
  const circa = GAP_CIRCA.exec(content);
  if (circa)
    return { reason: 'lost', unit: 'character', quantity: Number(circa[1]), precision: 'low' };
  const number = GAP_NUMBER.exec(content);
  if (number) return { reason: 'lost', unit: 'character', quantity: Number(number[1]) };
  return null;
}

const VACAT = /^vac(?:at|\.)?\s*(\d+)?$/iu;

function parenthesis(ctx: Context, content: string, at: number): void {
  const trimmed = content.trim();
  if (trimmed === '?') {
    ctx.warnings.push(
      `"(?)" on line ${lineOf(ctx.chars, at)} dropped: uncertainty of a reading is not recorded.`,
    );
    return;
  }
  const vacat = VACAT.exec(trimmed);
  if (vacat) {
    flushToken(ctx);
    pushSpace(ctx, vacat[1] ? Number(vacat[1]) : null);
    return;
  }
  const building = ensureBuilding(ctx);
  building.abbr = true;
  building.expansion += content.replace(/[[\]{}⟦⟧<>\\/_]/gu, '');
}

function pushSpace(ctx: Context, quantity: number | null): void {
  const space: Obj = { kind: 'object', id: ctx.ids(), type: 'space' };
  if (quantity !== null) space.attrs = { unit: 'character', quantity };
  ctx.items.push(space);
}

function ensureBuilding(ctx: Context): Building {
  if (!ctx.building) ctx.building = { units: [], expansion: '', abbr: false, joinNext: false };
  return ctx.building;
}

function activeKinds(ctx: Context): RangeKind[] {
  return KIND_ORDER.filter((kind) => ctx.depth[kind] > 0);
}

function literal(ctx: Context, ch: string): void {
  const building = ensureBuilding(ctx);
  let base = ch;
  let unclear = false;
  if (ch.charCodeAt(0) > 0x7f) {
    const decomposed = ch.normalize('NFD');
    if (decomposed.includes(DOT_BELOW)) {
      base = decomposed.replace(/̣/gu, '').normalize('NFC');
      unclear = true;
    }
  }
  const kinds = activeKinds(ctx);
  if (unclear && !kinds.includes('unclear')) kinds.push('unclear');
  building.units.push({ text: base, kinds });
  building.expansion += base;
}

function appendCombining(ctx: Context, ch: string): void {
  const last = ctx.building?.units[ctx.building.units.length - 1];
  if (last && ctx.building) {
    last.text += ch;
    ctx.building.expansion += ch;
  } else {
    literal(ctx, ch);
  }
}

function dotBelow(ctx: Context): void {
  const last = ctx.building?.units[ctx.building.units.length - 1];
  if (last && !last.kinds.includes('unclear')) last.kinds.push('unclear');
}

function dotRun(chars: string[], from: number): { count: number; end: number } {
  let j = from;
  let count = 0;
  while (j < chars.length) {
    const ch = chars[j];
    if (ch === '.' || ch === '+') {
      count++;
      j++;
    } else if (ch === ' ' && count > 0 && (chars[j + 1] === '.' || chars[j + 1] === '+')) {
      j++;
    } else {
      break;
    }
  }
  return { count, end: j };
}

function endLine(ctx: Context): void {
  const building = ctx.building;
  if (building) {
    const last = building.units[building.units.length - 1];
    if (last && last.text === '-') {
      building.units.pop();
      building.expansion = building.expansion.slice(0, -1);
      if (building.units.length > 0 || building.abbr) building.joinNext = true;
    }
  }
  flushToken(ctx);
  const item: Break = { kind: 'break', id: ctx.ids(), type: 'line' };
  ctx.items.push(item);
}

const BARE_VACAT = /^vac(?:at|\.)$/iu;

const lettersOf = (unit: Unit): number => Array.from(unit.text.normalize('NFC')).length;

/**
 * A word of a carrier without what its editor supplied: the letters that
 * are there, the gaps where supplied letters stood, and the read form the
 * editor's additions and brackets give. Null when no letter of it is there;
 * the gap its supplied letters leave is then put between the words.
 */
function carried(
  ctx: Context,
  units: Unit[],
): { units: Unit[]; gaps: Mark[]; norm?: string } | null {
  const kept: Unit[] = [];
  const gaps: Mark[] = [];
  let place = 0;
  let run = 0;
  let lost = 0;
  let judged = false;
  let read = '';
  const closeRun = (): void => {
    if (run === 0) return;
    gaps.push({
      kind: 'gap',
      from: place,
      to: place,
      attrs: { reason: 'lost', unit: 'character', quantity: run },
    });
    run = 0;
  };
  for (const unit of units) {
    if (unit.kinds.includes('supplied')) {
      run += lettersOf(unit);
      lost += lettersOf(unit);
      continue;
    }
    closeRun();
    if (unit.kinds.includes('corr')) {
      read += unit.text;
      judged = true;
      continue;
    }
    if (unit.kinds.includes('surplus')) judged = true;
    else read += unit.text;
    kept.push({ text: unit.text, kinds: unit.kinds.filter((kind) => kind !== 'surplus') });
    place += lettersOf(unit);
  }
  closeRun();
  if (kept.length === 0) {
    if (lost === 0) return null;
    const last = ctx.lastLostGap;
    if (last && ctx.items[ctx.items.length - 1] === last) {
      last.attrs = { ...last.attrs, quantity: Number(last.attrs?.quantity ?? 0) + lost };
    } else {
      const gap: Obj = {
        kind: 'object',
        id: ctx.ids(),
        type: 'gap',
        attrs: { reason: 'lost', unit: 'character', quantity: lost },
      };
      ctx.items.push(gap);
      ctx.lastLostGap = gap;
    }
    return null;
  }
  const form = kept.map((unit) => unit.text).join('');
  const norm = read.normalize('NFC');
  return judged && norm !== '' && norm !== form.normalize('NFC')
    ? { units: kept, gaps, norm }
    : { units: kept, gaps };
}

function flushToken(ctx: Context): void {
  const building = ctx.building;
  ctx.building = null;
  if (!building || (building.units.length === 0 && !building.abbr)) return;
  let gaps: Mark[] = [];
  let norm: string | undefined;
  if (!ctx.keep && building.units.length > 0) {
    const word = carried(ctx, building.units);
    if (!word) return;
    building.units = word.units;
    gaps = word.gaps;
    norm = word.norm;
  }
  const unmarked = building.units.every((unit) => unit.kinds.length === 0);
  let form = building.units.map((unit) => unit.text.normalize('NFC')).join('');
  if (!building.abbr && unmarked && BARE_VACAT.test(form)) {
    pushSpace(ctx, null);
    return;
  }
  const previous = ctx.items[ctx.items.length - 1];
  if (
    !building.abbr &&
    unmarked &&
    /^\d+$/u.test(form) &&
    isObj(previous) &&
    previous.type === 'space' &&
    !previous.attrs
  ) {
    previous.attrs = { unit: 'character', quantity: Number(form) };
    return;
  }
  if (form === '') {
    ctx.warnings.push(
      `"(${building.expansion})" has no abbreviated letters before it; the expansion is used as the form.`,
    );
    form = building.expansion;
  }
  const token: Token = { kind: 'token', id: ctx.ids(), form };
  if (building.joinNext) token.joinNext = true;
  const marks = [...marksOf(building.units), ...gaps].sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  if (building.abbr) marks.push({ kind: 'abbr', attrs: { expan: building.expansion } });
  if (marks.length > 0) token.marks = marks;
  if (norm !== undefined) {
    token.norm = norm;
    token.unchecked = true;
  }
  ctx.items.push(token);
}

/** Marks from the units of a token: one per maximal run of letters a kind covers, whole-token when it covers all. */
function marksOf(units: Unit[]): Mark[] {
  const offsets: number[] = [0];
  for (const unit of units) {
    offsets.push(offsets[offsets.length - 1]! + Array.from(unit.text.normalize('NFC')).length);
  }
  const total = offsets[units.length]!;
  const marks: Mark[] = [];
  for (const kind of KIND_ORDER) {
    let start = -1;
    for (let i = 0; i <= units.length; i++) {
      const covered = i < units.length && units[i]!.kinds.includes(kind);
      if (covered && start < 0) start = i;
      if (!covered && start >= 0) {
        const mark: Mark = { kind };
        const attrs = markAttrs(kind);
        if (attrs) mark.attrs = attrs;
        const from = offsets[start]!;
        const to = offsets[i]!;
        if (!(from === 0 && to === total)) {
          mark.from = from;
          mark.to = to;
        }
        marks.push(mark);
        start = -1;
      }
    }
  }
  return marks.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}

function markAttrs(kind: RangeKind): Mark['attrs'] | null {
  if (kind === 'supplied') return { reason: 'lost' };
  if (kind === 'add') return { place: 'above' };
  return null;
}

function lineOf(chars: string[], index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < chars.length; i++) if (chars[i] === '\n') line++;
  return line;
}

// Writing

const BRACKETS: Record<string, [string, string]> = {
  supplied: ['[', ']'],
  omitted: ['<', '>'],
  surplus: ['{', '}'],
  del: ['⟦', '⟧'],
  add: ['\\', '/'],
  corr: ['<', '>'],
};

/** A stream in Leiden notation, best effort: brackets for the marks, underdots for unclear letters, `|` for line ends. */
export function toLeiden(stream: Stream): string {
  let out = '';
  let glue = false;
  for (const item of stream.items) {
    if (isBreak(item)) {
      const symbol = item.type === 'page' || item.type === 'column' ? '||' : '|';
      out += glue ? `-${symbol}` : `${out === '' ? '' : ' '}${symbol}`;
      continue;
    }
    if (isObj(item)) {
      const text = objectLeiden(item);
      if (text === null) continue;
      out += (out === '' ? '' : ' ') + text;
      glue = false;
      continue;
    }
    out += (glue || out === '' ? '' : ' ') + tokenLeiden(item);
    glue = item.joinNext === true;
  }
  return out;
}

function objectLeiden(obj: Obj): string | null {
  const attrs = obj.attrs ?? {};
  if (obj.type === 'gap') {
    // Leiden has no sign for it: the words say that the transcript stops short here.
    if (isNotTranscribed(attrs)) return NOT_TRANSCRIBED_TEXT;
    const quantity = typeof attrs.quantity === 'number' ? attrs.quantity : null;
    if (attrs.reason === 'illegible')
      return quantity === null ? '---' : '.'.repeat(Math.min(quantity, 12));
    if (quantity === null || attrs.extent === 'unknown') return '[---]';
    if (attrs.precision === 'low') return `[ca. ${quantity}]`;
    return quantity <= 12 ? `[${'.'.repeat(quantity)}]` : `[${quantity}]`;
  }
  if (obj.type === 'space') {
    return typeof attrs.quantity === 'number' ? `vac. ${attrs.quantity}` : 'vac.';
  }
  return null;
}

function tokenLeiden(token: Token): string {
  const cps = Array.from(token.form);
  const n = cps.length;
  const opens: string[][] = Array.from({ length: n + 1 }, () => []);
  const closes: string[][] = Array.from({ length: n + 1 }, () => []);
  const unclear: boolean[] = Array.from({ length: n }, () => false);
  let expansionAt: number | null = null;
  let expansion = '';
  const marks = [...(token.marks ?? [])].sort((a, b) => rank(a.kind) - rank(b.kind));
  for (const mark of marks) {
    const from = Math.max(0, Math.min(n, mark.from ?? 0));
    const to = Math.max(from, Math.min(n, mark.to ?? n));
    if (mark.kind === 'unclear') {
      for (let k = from; k < to; k++) unclear[k] = true;
      continue;
    }
    if (mark.kind === 'abbr') {
      const expan = typeof mark.attrs?.expan === 'string' ? mark.attrs.expan : '';
      if (expan === '' || expan === token.form) continue;
      const placed = placeExpansion(cps, Array.from(expan));
      expansionAt = placed.at;
      expansion = placed.text;
      continue;
    }
    const key =
      mark.kind === 'supplied' && mark.attrs?.reason === 'omitted' ? 'omitted' : mark.kind;
    const pair = BRACKETS[key];
    if (!pair) continue;
    opens[from]!.push(pair[0]);
    closes[to]!.unshift(pair[1]);
  }
  for (let k = 1; k < n; k++) if (COMBINING.test(cps[k]!)) unclear[k] = unclear[k - 1]!;
  let out = '';
  for (let k = 0; k <= n; k++) {
    if (expansionAt === k) out += `(${expansion})`;
    out += closes[k]!.join('') + opens[k]!.join('');
    if (k < n) {
      out += cps[k];
      const next = cps[k + 1];
      if (unclear[k] && !(next !== undefined && COMBINING.test(next))) out += DOT_BELOW;
    }
  }
  return out;
}

function rank(kind: string): number {
  const index = KIND_ORDER.indexOf(kind as RangeKind);
  return index < 0 ? KIND_ORDER.length : index;
}

/** Where the parenthesised part of an expansion goes: after the letters it shares with the written form. */
function placeExpansion(form: string[], expan: string[]): { at: number; text: string } {
  let prefix = 0;
  while (prefix < form.length && prefix < expan.length && form[prefix] === expan[prefix]) prefix++;
  if (prefix === form.length) return { at: form.length, text: expan.slice(prefix).join('') };
  const rest = form.slice(prefix);
  const tail = expan.slice(expan.length - rest.length);
  if (rest.length <= expan.length - prefix && rest.every((ch, i) => ch === tail[i])) {
    return { at: prefix, text: expan.slice(prefix, expan.length - rest.length).join('') };
  }
  return { at: form.length, text: expan.join('') };
}
