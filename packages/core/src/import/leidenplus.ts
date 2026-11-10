/**
 * Leiden+ read into EpiDoc.
 *
 * Leiden+ is the notation in which papyri.info edits its texts. It is
 * defined as another way of writing EpiDoc: every construct of it stands
 * for one element (its documentation gives the pair for each). So it is read
 * here by writing that EpiDoc, which the TEI importer then reads like any
 * other, with the same rules for what a transcript keeps of an edition.
 *
 *   <S=.grc <D=.r <= 1. text 2.- text => =D>   language, divisions, block, lines
 *   [abc] [.3] [ca.5] [.?] lost.3lin            supplied where lost; lost letters and lines
 *   ạḅ .3 .? ca.3 vestig.2lin                   unclear letters; illegible ones; traces
 *   <abc> {abc} 〚abc〛 \abc/ //abc\\           omitted, surplus, deleted, added above, below
 *   (ab(c)) ((abc)) (|ab|)                      expansion, symbol, unresolved abbreviation
 *   <:a|reg|b:> <:a|corr|b:> <:a|subst|b:>      regularization, correction, the scribe's own correction
 *   <:a|alt|b:> <:a=BL 1.2|ed|b:>               alternative reading, reading corrected since the edition
 *   <#α=1#> *stauros* $m2 vac.3 ----            number, glyph, hand, vacat, paragraphos
 *
 * A note stands between a slash with a star and a star with a slash. A
 * construct that does not close is read as text and reported.
 */

import { importTei, type TeiImport, type TeiImportOptions } from '../tei/import.ts';
import { escapeAttr, escapeText } from '../tei/xml.ts';

export interface LeidenPlusXml {
  /** A `<div type="edition">` holding the text as EpiDoc. */
  xml: string;
  warnings: string[];
}

const UNDERDOT = '̣';
const MACRON = '̄';
const MARK = /\p{M}/u;
const SPACE = /\s/u;
/** The kinds of choice a `<: :>` holds, by the word between its bars. */
const OPTION_KINDS = ['reg', 'orth', 'corr', 'subst', 'alt', 'ed'] as const;
type OptionKind = (typeof OPTION_KINDS)[number];
const OPTION_BARS = OPTION_KINDS.flatMap((kind) => [`||${kind}||`, `|${kind}|`]);
const ADD_PLACES = ['interlin', 'bottom', 'left', 'right', 'top', 'margin'];
/** The diacritics a scribe wrote, as Leiden+ names them in parentheses after the letter. */
const DIACRITICS: [string, string][] = [
  [' ῾', 'asper'],
  [' ᾿', 'lenis'],
  ['¨', 'diaeresis'],
  ['´', 'acute'],
  ['`', 'grave'],
  ['^', 'circumflex'],
];
const MILESTONES: [string, string][] = [
  ['--------', 'horizontal-rule'],
  ['~~~~~~~~', 'wavy-line'],
  ['----', 'paragraphos'],
  ['>---', 'diple-obelismene'],
  ['###', 'box'],
  ['-$$-', 'coronis'],
];

type Attrs = Record<string, string | undefined>;

function el(name: string, attrs: Attrs, content?: string): string {
  let open = `<${name}`;
  for (const [key, value] of Object.entries(attrs))
    if (value !== undefined) open += ` ${key}="${escapeAttr(value)}"`;
  return content === undefined ? `${open}/>` : `${open}>${content}</${name}>`;
}

const CERTAINTY_OF_NAME = '<certainty match=".." locus="name"/>';
const CERTAINTY_OF_VALUE = '<certainty match=".." locus="value"/>';

/** A gap or a space from its extent as written: `?`, a number, or a range. */
function extent(
  name: 'gap' | 'space',
  reason: string | undefined,
  spec: string,
  unit: string,
  more: { about?: boolean; doubt?: boolean; desc?: string } = {},
): string {
  const attrs: Attrs = { reason };
  const range = /^(\d+)-(\d+)$/u.exec(spec);
  if (spec === '?') attrs.extent = 'unknown';
  else if (range) {
    attrs.atLeast = range[1];
    attrs.atMost = range[2];
  } else attrs.quantity = spec;
  attrs.unit = unit;
  if (more.about) attrs.precision = 'low';
  const inner =
    (more.desc === undefined ? '' : el('desc', {}, escapeText(more.desc))) +
    (more.doubt ? CERTAINTY_OF_NAME : '');
  return el(name, attrs, inner === '' ? undefined : inner);
}

class Reader {
  private i = 0;
  private expanDepth = 0;
  readonly warnings: string[] = [];

  constructor(private readonly s: string) {}

  // The document

  document(): string {
    const head = this.match(/\s*<S=\.([A-Za-z-]+)/y);
    const lang = head?.[1];
    let body = this.blocks();
    this.skipSpace();
    if (this.i < this.s.length) {
      // What follows the last block, or a text given without its blocks, is read as one more.
      const rest = this.items(() => false);
      if (rest.trim() !== '') body += el('ab', {}, rest);
    }
    return el('div', { 'xml:lang': lang, type: 'edition', 'xml:space': 'preserve' }, body);
  }

  private blocks(): string {
    let out = '';
    for (;;) {
      this.skipSpace();
      if (this.at('<D=')) {
        const div = this.division();
        if (div === null) break;
        out += div;
      } else if (this.at('<=')) {
        this.i += 2;
        const inner = this.items(() => this.at('=>'));
        if (this.at('=>')) this.i += 2;
        else this.warn('A block opened with <= is not closed with =>.');
        out += el('ab', {}, inner);
      } else break;
    }
    return out;
  }

  private division(): string | null {
    const start = this.i;
    const open = this.match(/<D=(?:#([^.\s<]+))?\.([^.\s<]+)(?:\.([^.\s<]+))?(?:\.([^\s<]+))?/y);
    if (!open) return null;
    const head = this.match(/<\(([^)]*)\)>/y);
    const inner = this.blocks();
    this.skipSpace();
    if (!this.at('=D>')) {
      this.warn('A division opened with <D= is not closed with =D>.');
      this.i = Math.max(this.i, start + 1);
    } else this.i += 3;
    return el(
      'div',
      { n: open[2], subtype: open[3], type: 'textpart', corresp: open[4], 'xml:id': open[1] },
      (head ? el('head', {}, escapeText(head[1] ?? '')) : '') + inner,
    );
  }

  // The text

  /** Items up to where `stop` holds, which is left unread. */
  private items(stop: () => boolean): string {
    let out = '';
    while (this.i < this.s.length && !stop()) out += this.item();
    return out;
  }

  /** The items of a construct up to its closer, and whether `(?)` stands before it. Null, with nothing read, when it does not close. */
  private body(closer: string): { xml: string; doubt: boolean } | null {
    const start = this.i;
    const doubtful = `(?)${closer}`;
    const xml = this.items(() => this.at(closer) || this.at(doubtful));
    if (this.at(doubtful)) {
      this.i += doubtful.length;
      return { xml, doubt: true };
    }
    if (this.at(closer)) {
      this.i += closer.length;
      return { xml, doubt: false };
    }
    this.i = start;
    return null;
  }

  /** A construct between an opener and a closer, or its first character as text when it does not close. */
  private enclosed(
    opener: string,
    closer: string,
    make: (xml: string, doubt: boolean) => string,
  ): string {
    const start = this.i;
    this.i += opener.length;
    const inner = this.body(closer);
    if (inner) return make(inner.xml, inner.doubt);
    this.i = start;
    this.warn(`"${opener}" is not closed with "${closer}"; it was read as text.`);
    return this.character();
  }

  private item(): string {
    const s = this.s;
    const c = s[this.i]!;
    if (SPACE.test(c)) return this.diacritic() ?? this.space();
    if (this.i === 0 || SPACE.test(s[this.i - 1]!) || s.startsWith('<=', this.i - 2)) {
      const line = this.line();
      if (line !== null) return line;
    }
    switch (c) {
      case '(':
        return this.parenthesis();
      case '[':
        return this.bracket();
      case '_':
        if (this.at('_['))
          return this.enclosed('_[', ']_', (xml, doubt) =>
            el('supplied', { evidence: 'parallel', reason: 'lost', cert: low(doubt) }, xml),
          );
        break;
      case '<':
        return this.angle();
      case '{':
        return this.enclosed('{', '}', (xml, doubt) =>
          el('surplus', {}, xml + (doubt ? CERTAINTY_OF_VALUE : '')),
        );
      case '〚':
      case '⟦':
        return this.deletion(c);
      case '\\':
        if (this.at('\\|'))
          return this.enclosed('\\|', '|/', (xml, doubt) =>
            el('hi', { rend: 'subscript' }, xml + (doubt ? CERTAINTY_OF_VALUE : '')),
          );
        return this.enclosed('\\', '/', (xml, doubt) =>
          el('add', { place: 'above' }, xml + (doubt ? CERTAINTY_OF_NAME : '')),
        );
      case '/':
        if (this.at('/*')) return this.note();
        if (this.at('//'))
          return this.enclosed('//', '\\\\', (xml, doubt) =>
            el('add', { place: 'below' }, xml + (doubt ? CERTAINTY_OF_NAME : '')),
          );
        break;
      case '|':
        return this.bar();
      case '~':
        if (this.at('~~~~~~~~')) return this.milestone();
        if (this.at('~||'))
          return this.enclosed('~||', '||~tall', (xml) => el('hi', { rend: 'tall' }, xml));
        if (this.at('~|')) return this.foreign();
        break;
      case '¯':
        if (this.at('¯_'))
          return this.enclosed('¯_', '_¯', (xml) => el('hi', { rend: 'supraline-underline' }, xml));
        return this.enclosed('¯', '¯', (xml) => el('hi', { rend: 'supraline' }, xml));
      case '-':
      case '>':
      case '#':
        if (MILESTONES.some(([sign]) => this.at(sign))) return this.milestone();
        if (c === '#') {
          const figure = this.match(/#([^\s#>=]+) /y);
          if (figure) return el('figure', {}, el('figDesc', {}, escapeText(figure[1]!)));
        }
        break;
      case '*':
        return this.glyph();
      case '$': {
        const hand = this.match(/\$(m\d+[^\s(]?)(\(\?\))? /y);
        if (hand) return el('handShift', { new: hand[1], cert: low(hand[2] !== undefined) });
        break;
      }
      case '"':
        return this.enclosed('"', '"', (xml) => el('q', {}, xml));
      case '!': {
        const orig = this.match(/!([^!\s]+)!/y);
        if (orig) return el('orig', {}, escapeText(orig[1]!));
        break;
      }
      case '.': {
        const gap = this.match(/\.(\?|\d+(?:-\d+)?)(lin)?(\(\?\) ?)?/y);
        if (gap)
          return extent('gap', 'illegible', gap[1]!, gap[2] ? 'line' : 'character', {
            doubt: gap[3] !== undefined,
          });
        break;
      }
      default:
        break;
    }
    return this.keyword() ?? this.letters();
  }

  /** Whitespace, as it stands: the importer divides words at it. */
  private space(): string {
    return this.s[this.i++]!;
  }

  /** A line number where a line begins: `1. `, `1.- ` when a word runs on, `(2, inverse)` for a line set otherwise. */
  private line(): string | null {
    const plain = this.match(/(\d+[/,a-zA-Z0-9]*)\.(-)? /y);
    if (plain) return el('lb', { n: plain[1], break: plain[2] ? 'no' : undefined });
    const set = this.match(/\((\d+[/,a-zA-Z0-9]*)(\.-)?, ([A-Za-z-]+)\) ?/y);
    if (set) return el('lb', { n: set[1], rend: set[3], break: set[2] ? 'no' : undefined });
    return null;
  }

  /** What is lost, left blank or left out, written as a word: `lost.3lin`, `vestig.2lin`, `vac.3`, `ca.5`. */
  private keyword(): string | null {
    const before = this.s[this.i - 1];
    if (before !== undefined && /[\p{L}\p{M}]/u.test(before)) return null;
    const lost = this.match(/lost\.(ca\.)?(\?|\d+(?:-\d+)?)lin(\(\?\) ?)?/y);
    if (lost)
      return extent('gap', 'lost', lost[2]!, 'line', {
        about: lost[1] !== undefined,
        doubt: lost[3] !== undefined,
      });
    const traces = this.match(/vestig\.(ca\.)?(\?|\d+(?:-\d+)?)(lin|char)(\(\?\) ?)?/y);
    if (traces) {
      const more: { about: boolean; doubt: boolean; desc?: string } = {
        about: traces[1] !== undefined,
        doubt: traces[4] !== undefined,
      };
      if (!(traces[2] === '?' && traces[3] === 'lin')) more.desc = 'vestiges';
      return extent(
        'gap',
        'illegible',
        traces[2]!,
        traces[3] === 'lin' ? 'line' : 'character',
        more,
      );
    }
    const trace = this.match(/vestig(\(\?\))? /y);
    if (trace)
      return extent('gap', 'illegible', '?', 'character', {
        desc: 'vestiges',
        doubt: trace[1] !== undefined,
      });
    const vacat = this.match(/vac\.(ca\.)?(\?|\d+(?:-\d+)?)(lin)?(\(\?\) ?)?/y);
    if (vacat)
      return extent('space', undefined, vacat[2]!, vacat[3] ? 'line' : 'character', {
        about: vacat[1] !== undefined,
        doubt: vacat[4] !== undefined,
      });
    const about = this.match(/ca\.(\d+)(lin)?(\(\?\) ?)?/y);
    if (about)
      return extent('gap', 'illegible', about[1]!, about[2] ? 'line' : 'character', {
        about: true,
        doubt: about[3] !== undefined,
      });
    return null;
  }

  /** Letters up to the next thing that is not one, with unclear letters (underdotted) and letters under a line (a macron) grouped. */
  private letters(): string {
    const cluster = this.cluster();
    if (!cluster.unclear && !cluster.supra) return escapeText(cluster.text);
    let run = cluster.text;
    for (;;) {
      const start = this.i;
      if (this.i >= this.s.length || this.special()) break;
      const next = this.cluster();
      if (next.unclear !== cluster.unclear || next.supra !== cluster.supra) {
        this.i = start;
        break;
      }
      run += next.text;
    }
    const unclear = cluster.unclear ? el('unclear', {}, escapeText(run)) : escapeText(run);
    return cluster.supra ? el('hi', { rend: 'supraline' }, unclear) : unclear;
  }

  /** Whether the character here begins something other than a letter. */
  private special(): boolean {
    return /[\s()[\]<>{}\\/|~*$"!.#_〚〛⟦⟧¯=:-]/u.test(this.s[this.i]!);
  }

  /** One character with the marks on it, without the underdot and the macron, which say something of it. */
  private cluster(): { text: string; unclear: boolean; supra: boolean } {
    const first = String.fromCodePoint(this.s.codePointAt(this.i)!);
    this.i += first.length;
    let text = first;
    let unclear = false;
    let supra = false;
    while (this.i < this.s.length && MARK.test(this.s[this.i]!)) {
      const mark = this.s[this.i++]!;
      if (mark === UNDERDOT) unclear = true;
      else if (mark === MACRON) supra = true;
      else text += mark;
    }
    return { text, unclear, supra };
  }

  /** One character as text, whatever it is. */
  private character(): string {
    return escapeText(this.cluster().text);
  }

  /** A diacritic the scribe wrote: a space, the letter, and the sign in parentheses, as in `υ ἱ(¨)οῦ`. */
  private diacritic(): string | null {
    if (this.s[this.i] !== ' ') return null;
    const start = this.i;
    this.i++;
    let inner: string;
    const lost = this.match(/\[\.(\d+)\]/y);
    const illegible = lost ? null : this.match(/\.(\d+)/y);
    if (lost) inner = extent('gap', 'lost', lost[1]!, 'character');
    else if (illegible) inner = extent('gap', 'illegible', illegible[1]!, 'character');
    else if (this.i < this.s.length && !this.special()) {
      const letter = this.cluster();
      inner = letter.unclear ? el('unclear', {}, escapeText(letter.text)) : escapeText(letter.text);
    } else {
      this.i = start;
      return null;
    }
    if (this.s[this.i] !== '(') {
      this.i = start;
      return null;
    }
    this.i++;
    const signs: string[] = [];
    for (;;) {
      const sign = DIACRITICS.find(([written]) => this.at(written));
      if (!sign) break;
      signs.push(sign[1]);
      this.i += sign[0].length;
    }
    if (signs.length === 0 || this.s[this.i] !== ')') {
      this.i = start;
      return null;
    }
    this.i++;
    if (this.at('(?)')) {
      this.i += 3;
      inner += CERTAINTY_OF_VALUE;
    }
    return signs.reduceRight((xml, rend) => el('hi', { rend }, xml), inner);
  }

  private parenthesis(): string {
    if (this.expanDepth > 0) return this.expansionPart();
    if (this.at('(?)')) {
      this.i += 3;
      this.warn('A "(?)" that belongs to nothing was left out.');
      return '';
    }
    const untranscribed = this.match(
      /\((Lines|Chars|Column): (ca\.)?(\?|\d+(?:-\d+)?) non transcribed(\(\?\))?\)/y,
    );
    if (untranscribed) {
      const unit = { Lines: 'line', Chars: 'character', Column: 'column' }[untranscribed[1]!]!;
      return extent('gap', 'ellipsis', untranscribed[3]!, unit, {
        about: untranscribed[2] !== undefined,
        doubt: untranscribed[4] !== undefined,
        desc: 'non transcribed',
      });
    }
    const language = this.match(/\(Lang: (\w+) (ca\.)?(\?|\d+) (lines|char)(\(\?\))?\)/y);
    if (language)
      return extent(
        'gap',
        'ellipsis',
        language[3]!,
        language[4] === 'lines' ? 'line' : 'character',
        {
          about: language[2] !== undefined,
          doubt: language[5] !== undefined,
          desc: language[1]!,
        },
      );
    if (this.at('(|'))
      return this.enclosed('(|', '|)', (xml, doubt) =>
        el('abbr', {}, xml + (doubt ? '<certainty locus="name" match=".."/>' : '')),
      );
    // An expansion: what is written, with what it stands for in inner parentheses.
    const start = this.i;
    this.i++;
    this.expanDepth++;
    const inner = this.items(() => this.at(')'));
    this.expanDepth--;
    if (!this.at(')')) {
      this.i = start;
      this.warn('"(" is not closed with ")"; it was read as text.');
      return this.character();
    }
    this.i++;
    return el('expan', {}, inner);
  }

  /** Inside an expansion: the letters supplied for the abbreviation, `(ός)`, or doubted, `(ός?)`. */
  private expansionPart(): string {
    const close = this.s.indexOf(')', this.i);
    if (close < 0) return this.character();
    let text = this.s.slice(this.i + 1, close);
    this.i = close + 1;
    const doubt = text.endsWith('?');
    if (doubt) text = text.slice(0, -1);
    return el('ex', { cert: low(doubt) }, escapeText(text));
  }

  private bracket(): string {
    const gap = this.match(/\[(?:\.|(ca\.))(\?|\d+(?:-\d+)?)(\(\?\))?\]/y);
    if (gap)
      return extent('gap', 'lost', gap[2]!, 'character', {
        about: gap[1] !== undefined,
        doubt: gap[3] !== undefined,
      });
    return this.enclosed('[', ']', (xml, doubt) =>
      el('supplied', { reason: 'lost', cert: low(doubt) }, xml),
    );
  }

  private angle(): string {
    if (this.at('<:')) return this.option();
    if (this.at('<#')) return this.number();
    if (this.at('<---->')) {
      this.i += 6;
      return el('supplied', { reason: 'omitted' }, paragraphos());
    }
    if (this.at('<----(?)>')) {
      this.i += 9;
      return el('supplied', { reason: 'omitted', cert: 'low' }, paragraphos());
    }
    if (this.at('<|'))
      return this.enclosed('<|', '|>', (xml, doubt) =>
        el('add', { rend: 'sling', place: 'margin' }, xml + (doubt ? CERTAINTY_OF_NAME : '')),
      );
    if (this.at('<_'))
      return this.enclosed('<_', '_>', (xml, doubt) =>
        el('add', { rend: 'underline', place: 'margin' }, xml + (doubt ? CERTAINTY_OF_NAME : '')),
      );
    const omitted = this.match(/<\.(\?|\d+)>/y);
    if (omitted) return extent('gap', 'omitted', omitted[1]!, 'character');
    return this.enclosed('<', '>', (xml, doubt) =>
      el('supplied', { reason: 'omitted', cert: low(doubt) }, xml),
    );
  }

  private deletion(opener: string): string {
    const closer = opener === '〚' ? '〛' : '⟧';
    const rend =
      this.s[this.i + 1] === 'X'
        ? 'cross-strokes'
        : this.s[this.i + 1] === '/'
          ? 'slashes'
          : 'erasure';
    return this.enclosed(
      rend === 'erasure' ? opener : opener + this.s[this.i + 1]!,
      closer,
      (xml, doubt) => el('del', { rend }, xml + (doubt ? CERTAINTY_OF_VALUE : '')),
    );
  }

  private bar(): string {
    if (this.at('|_'))
      return this.enclosed('|_', '_|', (xml, doubt) =>
        el('supplied', { evidence: 'parallel', reason: 'undefined', cert: low(doubt) }, xml),
      );
    if (this.at('|^'))
      return this.enclosed('|^', '^|', (xml) => el('hi', { rend: 'superscript' }, xml));
    const place = ADD_PLACES.find((name) => this.at(`||${name}:`));
    if (place)
      return this.enclosed(`||${place}:`, '||', (xml, doubt) =>
        el(
          'add',
          { place: place === 'interlin' ? 'interlinear' : place },
          xml + (doubt ? CERTAINTY_OF_NAME : ''),
        ),
      );
    return this.character();
  }

  private milestone(): string {
    const [sign, rend] = MILESTONES.find(([written]) => this.at(written))!;
    this.i += sign.length;
    return el('milestone', { rend, unit: 'undefined' });
  }

  private note(): string {
    const close = this.s.indexOf('*/', this.i + 2);
    if (close < 0) return this.character();
    const text = this.s.slice(this.i + 2, close);
    this.i = close + 2;
    return el('note', { 'xml:lang': 'en' }, escapeText(text));
  }

  private foreign(): string {
    const start = this.i;
    this.i += 2;
    const inner = this.items(() => this.at('|~'));
    const lang = this.at('|~') ? ((this.i += 2), this.match(/([A-Za-z-]+) ?/y)) : null;
    if (!lang) {
      this.i = start;
      this.warn('"~|" is not closed with "|~" and a language; it was read as text.');
      return this.character();
    }
    return el('foreign', { 'xml:lang': lang[1] }, inner);
  }

  private glyph(): string {
    const filler = this.match(/\*filler\(([^)*]+)\)(\?)?\*/y);
    if (filler) {
      const g = el('g', { rend: filler[1], type: 'filler' });
      return filler[2] ? el('unclear', {}, g) : g;
    }
    const sign = this.match(/\*([^*?,\s]+)(\?)?(?:,([^*]*))?\*/y);
    if (!sign) return this.character();
    const g = el('g', { type: sign[1] }, sign[3] === undefined ? undefined : escapeText(sign[3]));
    return sign[2] ? el('unclear', {}, g) : g;
  }

  /** A number with its value: `<#ιϛ=16#>`, with a tick `<#λβ '=1/32#>`, spelt out `<#=4#>`. */
  private number(): string {
    const start = this.i;
    this.i += 2;
    const inner = this.items(() => this.at('=') || this.at(" '=") || this.at('#>'));
    const tick = this.at(" '=");
    if (tick) this.i += 2;
    const value = this.at('=') ? ((this.i += 1), this.match(/([^#]*)#>/y)) : null;
    if (!value) {
      this.i = start;
      this.warn('"<#" is not closed with a value and "#>"; it was read as text.');
      return this.character();
    }
    let given = value[1]!.trim();
    const doubt = given.endsWith('(?)');
    if (doubt) given = given.slice(0, -3);
    const attrs: Attrs = {};
    const range = /^(\d+)-(\d+|\?)$/u.exec(given);
    if (given.startsWith('frac')) {
      attrs.type = 'fraction';
      if (given.length > 4) attrs.value = given.slice(4);
    } else if (range) {
      attrs.atLeast = range[1];
      if (range[2] !== '?') attrs.atMost = range[2];
    } else if (given !== '') attrs.value = given;
    if (tick) attrs.rend = 'tick';
    const content = inner + (doubt ? '<certainty match="../@value" locus="value"/>' : '');
    return el('num', attrs, content === '' ? undefined : content);
  }

  /**
   * A choice between `<:` and `:>`: its parts stand either side of the word
   * between bars that says what kind it is. A part may end in `(?)` and in
   * `=` with a citation or a language.
   */
  private option(): string {
    const start = this.i;
    this.i += 2;
    const parts: { xml: string; doubt: boolean; cite?: string }[] = [];
    let kind: OptionKind | null = null;
    /** How many parts stood before the kind was named. */
    let before = 0;
    const separator = (): boolean =>
      this.at(':>') ||
      OPTION_BARS.some((bars) => this.at(bars)) ||
      (this.s[this.i] === '|' && !this.barOpens());
    for (;;) {
      const xml = this.items(() => separator() || this.at('=') || this.at('(?)'));
      const part: { xml: string; doubt: boolean; cite?: string } = { xml, doubt: false };
      if (this.at('(?)')) {
        this.i += 3;
        part.doubt = true;
      }
      if (this.at('=')) {
        this.i++;
        const from = this.i;
        while (this.i < this.s.length && !separator()) this.i++;
        part.cite = this.s.slice(from, this.i).trim();
      }
      parts.push(part);
      if (this.at(':>')) {
        this.i += 2;
        break;
      }
      const bars = OPTION_BARS.find((b) => this.at(b));
      if (bars) {
        kind = bars.replaceAll('|', '') as OptionKind;
        before = parts.length;
        this.i += bars.length;
      } else if (this.s[this.i] === '|') this.i++;
      else {
        this.i = start;
        this.warn('"<:" is not closed with ":>"; it was read as text.');
        return this.character();
      }
    }
    if (kind === null) {
      this.warn(
        'A choice between "<:" and ":>" does not say what kind it is; its first part was read.',
      );
      return parts[0]?.xml ?? '';
    }
    return optionXml(kind, parts, before);
  }

  /** Whether the bar here opens a construct of its own, and so divides nothing. */
  private barOpens(): boolean {
    return this.at('|_') || this.at('|^') || ADD_PLACES.some((name) => this.at(`||${name}:`));
  }

  // Reading

  private at(text: string): boolean {
    return this.s.startsWith(text, this.i);
  }

  private match(pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = this.i;
    const found = pattern.exec(this.s);
    if (found) this.i = pattern.lastIndex;
    return found;
  }

  private skipSpace(): void {
    while (this.i < this.s.length && SPACE.test(this.s[this.i]!)) this.i++;
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

function low(doubt: boolean): string | undefined {
  return doubt ? 'low' : undefined;
}

function paragraphos(): string {
  return el('milestone', { rend: 'paragraphos', unit: 'undefined' });
}

function optionXml(
  kind: OptionKind,
  parts: { xml: string; doubt: boolean; cite?: string }[],
  before: number,
): string {
  const doubted = (part: { xml: string; doubt: boolean }): string =>
    part.xml + (part.doubt ? CERTAINTY_OF_VALUE : '');
  const first = parts[0] ?? { xml: '', doubt: false };
  const last = parts[parts.length - 1] ?? first;
  switch (kind) {
    case 'reg':
    case 'orth': {
      // Every part before the kind is a regularization; the one after it is what is written.
      const regs = parts.slice(0, Math.max(1, before));
      return el(
        'choice',
        {},
        regs
          .map((part) => el('reg', { 'xml:lang': part.cite, cert: low(part.doubt) }, part.xml))
          .join('') + el('orig', {}, doubted(last)),
      );
    }
    case 'corr':
      return el(
        'choice',
        {},
        el('corr', { cert: low(first.doubt) }, first.xml) + el('sic', {}, doubted(last)),
      );
    case 'subst':
      return el(
        'subst',
        {},
        el('add', { place: 'inline' }, doubted(first)) +
          el('del', { rend: 'corrected' }, doubted(last)),
      );
    default: {
      // The reading taken, then the others: alternatives, or what earlier editions read.
      const reading = (name: string, part: { xml: string; doubt: boolean; cite?: string }) =>
        el(name, { resp: kind === 'ed' ? part.cite : undefined }, doubted(part));
      return el(
        'app',
        { type: kind === 'alt' ? 'alternative' : 'editorial' },
        reading('lem', first) +
          parts
            .slice(1)
            .map((part) => reading('rdg', part))
            .join(''),
      );
    }
  }
}

/** Whether a text is Leiden+: it names its language as Leiden+ does, or holds a block of it. */
export function isLeidenPlus(text: string): boolean {
  return /^\s*<S=\./u.test(text) || /<=[\s\S]*=>/u.test(text);
}

/** Leiden+ as the EpiDoc it stands for. */
export function leidenPlusToEpiDoc(text: string): LeidenPlusXml {
  const reader = new Reader(text.replace(/\r\n?/gu, '\n').normalize('NFD'));
  const xml = reader.document().normalize('NFC');
  return { xml, warnings: reader.warnings };
}

/** Leiden+ read into a stream, by way of the EpiDoc it stands for. */
export function importLeidenPlus(text: string, options: TeiImportOptions = {}): TeiImport {
  const { xml, warnings } = leidenPlusToEpiDoc(text);
  const result = importTei(xml, options);
  return {
    ...result,
    warnings: [
      ...warnings,
      ...result.warnings.filter((warning) => !warning.startsWith('No <body>')),
    ],
  };
}
