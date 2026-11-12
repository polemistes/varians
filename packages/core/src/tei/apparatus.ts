/**
 * TEI export of an edition: the critical text with its apparatus encoded
 * by the parallel-segmentation method. The text is one block in the order of
 * the edition, in which a segment begins with a `<milestone>` and a line
 * with an `<lb>`, so that no boundary of either walls a variant in. Every
 * variant is an `<app>` whose `<lem>` is the edition's words, with whatever
 * begins among them, and whose `<rdg>` elements are the witnesses' readings,
 * with the conjectures attached to it (docs/formats/tei-subset.md).
 */

import { EDITION_ITSELF, printedKind, unbracketed, type Attachment } from '../apparatus/render.ts';
import type { Reading, Site } from '../collate/collate.ts';
import type { BibEntry } from '../bib/biblatex.ts';
import { siteSegments } from '../collate/passage.ts';
import {
  isNotTranscribed,
  NOT_TRANSCRIBED_ATTRS,
  type Id,
  type Item,
  type Obj,
  type Token,
} from '../stream/items.ts';
import type { Unit } from '../stream/words.ts';
import { languagesOf } from '../stream/languages.ts';
import {
  encodingDesc,
  markupToken,
  paratextXml,
  publicationStmt,
  respStmts,
  sourcesBibl,
  type Contributor,
} from './export.ts';
import { biblStructXml, bibXmlId } from './bibliography.ts';
import { escapeAttr, escapeText, ncName } from './xml.ts';

export interface EditionWitness {
  siglum: string;
  /** The witness record's id, pointed at as `wit:<id>`. */
  id?: string;
  name?: string;
  description?: string;
}

/** A run of the edition's text: where a segment begins, and its items up to where the next one does. */
export interface EditionRunExport {
  /**
   * The label of the segment that begins here, written as the `n` of its
   * `<milestone>`. Absent for what stands before the first segment (a
   * paragraph break that opens the text).
   */
  label?: string;
  /** The segment's id: where the segment first begins, the milestone gets `xml:id="seg-<id>"`. */
  id?: string;
  /** The passage's CTS URN, written as the milestone's `corresp` where the segment first begins. */
  urn?: string;
  /** The edition's items of the run, in order (tokens, breaks, objects). */
  items: Item[];
}

/** A passage as it was collated: one segment, or several whose boundaries something may cross. */
export interface EditionPassageExport {
  /** The edition's collation units of the passage (as given to collate). */
  baseUnits: Unit[];
  /** The places of variation; one the editor judges minor (`minor`) is written as such. */
  sites: Site[];
  /** Conjectures and reported readings by site index. */
  attachments?: Record<number, Attachment[]>;
  /**
   * The passage's segments in order, where it has more than one: which of
   * them the edition prints, and the label of each it does not, which a
   * witness's reading there begins with.
   */
  segments?: readonly { segmentId: Id; printed: boolean; label?: string }[];
}

/** The bibliography of an edition: the works it cites, and what its conjectures and reported readings cite of them. */
export interface EditionBibliography {
  /** The works, in the order in which they are listed, each with the label it is cited by. */
  works: { id: string; label: string; entry: BibEntry }[];
  /** By the id of a conjecture or a reported reading: the works it cites, with what is said before and after each. */
  citations: Record<
    string,
    { itemId: string; prenote?: string | null; postnote?: string | null }[]
  >;
}

export interface EditionExport {
  title: string;
  editors?: string[];
  preface?: string;
  /** The base's siglum as collate used it, so that it is left out of `wit`. */
  baseSiglum?: string;
  /** What the edition rests on, as its editors state it. */
  sources?: string;
  /** The licence the edition is published under: its name, or a free statement. */
  licence?: string;
  licenceUrl?: string;
  /** A note on rights its editors add. */
  rightsNote?: string;
  /** Who is responsible for the edition, from its history. */
  contributors?: Contributor[];
  /** Who publishes it: the installation's name. */
  authority?: string;
  witnesses: EditionWitness[];
  /** The text in its order: the runs of the segments the edition prints. */
  runs: EditionRunExport[];
  /** The passages the text was collated in, with their variants. */
  passages: EditionPassageExport[];
  /** Write every word as `<w xml:id>`, with `corresp` to the witness tokens it was taken from or `source` to its conjecture. */
  words?: boolean;
  /** The installation's address, for the prefixes that resolve record ids. */
  origin?: string;
  /** The works the edition cites and the citations of its records: listed in the header, and pointed at by the readings. */
  bibliography?: EditionBibliography;
}

/**
 * How the file points at what its header lists: the witnesses (the base's
 * siglum is left out of `wit`), the scholars who proposed conjectures, the
 * sources stated for conjectures and reports, and the edition's own editors.
 */
interface WitnessRefs {
  baseSiglum: string;
  witId: (siglum: string) => string;
  /** Whether words are written as `<w>` with their provenance. */
  words: boolean;
  /** The language of `<text>`: a word in another one says its own. */
  textLang: string | undefined;
  /** ` resp="#…"` for who proposed a conjecture: the scholar's entry, or the edition's editors for one of its own; nothing where none is named. */
  resp: (name: string) => string;
  /** ` source="…"` for a record: the record itself where it has an address in the file, and the entry of the source stated for it. */
  source: (attachment: Attachment) => string;
}

/**
 * The scholars and the sources the apparatus names beside the witnesses,
 * each once, in the order in which they are first named. A source is what a
 * record states as its source, or a work of the bibliography as the record
 * cites it: with what is said before it and the place cited.
 */
interface Cited {
  /** The xml:id of each scholar, by name. */
  scholars: Map<string, string>;
  /** Each source by what it says: its xml:id and its `<bibl>`. */
  sources: Map<string, { id: string; xml: string }>;
  /** The pointers at the sources of a record, in order. */
  of: (attachment: Attachment) => string[];
}

function citedIn(
  attachments: readonly Attachment[],
  bibliography: EditionBibliography | undefined,
): Cited {
  const scholars = new Map<string, string>();
  const sources = new Map<string, { id: string; xml: string }>();
  const taken = new Set<string>();
  const labels = new Map((bibliography?.works ?? []).map((w) => [w.id, w.label] as const));
  const source = (key: string, content: () => string): string => {
    let known = sources.get(key);
    if (!known) {
      const id = `src-${sources.size + 1}`;
      known = { id, xml: `<bibl xml:id="${id}">${content()}</bibl>` };
      sources.set(key, known);
    }
    return `#${known.id}`;
  };
  const of = (attachment: Attachment): string[] => {
    const out: string[] = [];
    const stated = unbracketed(attachment.source);
    if (stated !== '') out.push(source(`stated ${stated}`, () => escapeText(stated)));
    for (const citation of bibliography?.citations[attachment.id] ?? []) {
      const label = labels.get(citation.itemId);
      // A work that is not among those listed cannot be pointed at.
      if (label === undefined) continue;
      const before = citation.prenote?.trim() ?? '';
      const place = citation.postnote?.trim() ?? '';
      out.push(
        source(`cited ${citation.itemId}\u0001${before}\u0001${place}`, () =>
          [
            before === '' ? '' : `${escapeText(before)} `,
            `<ref target="#${bibXmlId(citation.itemId)}">${escapeText(label)}</ref>`,
            place === '' ? '' : `, <citedRange>${escapeText(place)}</citedRange>`,
          ].join(''),
        ),
      );
    }
    return out;
  };
  for (const attachment of attachments) {
    const { name } = attachment;
    if (
      attachment.kind === 'conjecture' &&
      name !== EDITION_ITSELF &&
      name.trim() !== '' &&
      !scholars.has(name)
    ) {
      const base = ncName(name, 'resp-');
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      scholars.set(name, id);
      taken.add(id);
    }
    of(attachment);
  }
  return { scholars, sources, of };
}

/**
 * Distinct xml:ids for the witnesses, `wit-` and the siglum as a name; sigla
 * that give the same name (A¹ and A²) are told apart by a number.
 */
function witnessRefs(
  witnesses: readonly EditionWitness[],
  baseSiglum: string,
): Pick<WitnessRefs, 'baseSiglum' | 'witId'> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const { siglum } of witnesses) {
    if (ids.has(siglum)) continue;
    const name = ncName(siglum, 'wit-');
    let id = name;
    for (let n = 2; taken.has(id); n++) id = `${name}-${n}`;
    ids.set(siglum, id);
    taken.add(id);
  }
  return { baseSiglum, witId: (siglum) => ids.get(siglum) ?? ncName(siglum, 'wit-') };
}

/** A complete TEI document of the edition. */
export function exportEditionTei(input: EditionExport): string {
  const languages = languagesOf(input.runs.flatMap((run) => run.items));
  const lang = languages[0] ? ` xml:lang="${escapeAttr(languages[0])}"` : '';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<TEI xmlns="http://www.tei-c.org/ns/1.0">');
  out.push('  <teiHeader>');
  out.push('    <fileDesc>');
  // The editors have names of the file's own: a conjecture of the edition itself points at them.
  const editors = (input.editors ?? []).map((name, k) => ({ name, id: `editor-${k + 1}` }));
  out.push(
    `      <titleStmt><title>${escapeText(input.title)}</title>${editors.map((e) => `<editor xml:id="${e.id}">${escapeText(e.name)}</editor>`).join('')}${respStmts(input.contributors)}</titleStmt>`,
  );
  out.push(
    `      ${publicationStmt(input.licence, { licenceUrl: input.licenceUrl, rightsNote: input.rightsNote, authority: input.authority })}`,
  );
  out.push('      <sourceDesc>');
  const attachments = input.passages.flatMap((p) => Object.values(p.attachments ?? {}).flat());
  // A witness known only by a reading reported for it, outside the conspectus, is listed after it.
  const conspectus = new Set(input.witnesses.map((w) => w.siglum));
  const reportedOnly = [
    ...new Set(attachments.filter((a) => a.kind === 'reported').map((a) => a.name)),
  ].filter((siglum) => !conspectus.has(siglum));
  const witnesses: EditionWitness[] = [
    ...input.witnesses,
    ...reportedOnly.map((siglum) => ({ siglum })),
  ];
  const cited = citedIn(attachments, input.bibliography);
  const pointer = (id: string | undefined) => (id === undefined ? [] : [`#${id}`]);
  const refs: WitnessRefs = {
    ...witnessRefs(witnesses, input.baseSiglum ?? 'ed.'),
    words: input.words ?? false,
    textLang: languages[0],
    resp(name) {
      const to =
        name === EDITION_ITSELF
          ? editors.map((e) => `#${e.id}`)
          : pointer(cited.scholars.get(name));
      return to.length ? ` resp="${to.join(' ')}"` : '';
    },
    source(attachment) {
      const to = [
        // The record has an address where the file declares the prefix that resolves it.
        ...(attachment.kind === 'conjecture' && input.origin
          ? [`conj:${escapeAttr(attachment.id)}`]
          : []),
        ...cited.of(attachment),
      ];
      return to.length ? ` source="${to.join(' ')}"` : '';
    },
  };
  if (witnesses.length > 0) {
    out.push('        <listWit>');
    for (const w of witnesses) {
      const text = [w.name, w.description].filter((x) => x && x.trim() !== '').join('. ');
      const corresp = w.id ? ` corresp="wit:${escapeAttr(w.id)}"` : '';
      out.push(
        `          <witness xml:id="${refs.witId(w.siglum)}" n="${escapeAttr(w.siglum)}"${corresp}>${escapeText(text || w.siglum)}</witness>`,
      );
    }
    out.push('        </listWit>');
  }
  const bibl = sourcesBibl(input.sources);
  if (bibl) out.push(`        ${bibl}`);
  // Who proposed the conjectures and what is stated as the source of a conjecture or a report: the
  // readings point here by `resp` and `source`, which are pointers in TEI.
  if (cited.scholars.size + cited.sources.size > 0) {
    out.push('        <listBibl>');
    out.push('          <head>Scholars and sources named in the apparatus</head>');
    for (const [name, id] of cited.scholars)
      out.push(`          <bibl><author xml:id="${id}">${escapeText(name)}</author></bibl>`);
    for (const source of cited.sources.values()) out.push(`          ${source.xml}`);
    out.push('        </listBibl>');
  }
  // The works the edition cites, each a structured entry: a citation above points at its work here.
  const works = input.bibliography?.works ?? [];
  if (works.length > 0) {
    out.push('        <listBibl>');
    out.push('          <head>Works cited</head>');
    for (const work of works)
      out.push(`          ${biblStructXml(work.entry, { id: work.id, label: work.label })}`);
    out.push('        </listBibl>');
  }
  // A source description must say something: an edition with no witnesses yet and no sources.
  if (
    witnesses.length === 0 &&
    !bibl &&
    cited.scholars.size + cited.sources.size + works.length === 0
  )
    out.push('        <p>Edition.</p>');
  out.push('      </sourceDesc>');
  out.push('    </fileDesc>');
  out.push(`    ${encodingDesc(input.origin, { apparatus: true })}`);
  if (languages.length > 0)
    out.push(
      `    <profileDesc><langUsage>${languages.map((l) => `<language ident="${escapeAttr(l)}"/>`).join('')}</langUsage></profileDesc>`,
    );
  out.push('  </teiHeader>');
  out.push(`  <text${lang}>`);
  if (input.preface)
    out.push(`    <front><div type="preface"><p>${escapeText(input.preface)}</p></div></front>`);
  out.push('    <body>');
  out.push('      <div type="edition">');
  out.push(bodyXml(input, refs));
  out.push('      </div>');
  out.push('    </body>');
  out.push('  </text>');
  out.push('</TEI>');
  return out.join('\n') + '\n';
}

/**
 * A word of the edition with its marks; a variant noted in a witness's
 * carrier is not the edition's. With words on, it is a `<w>` naming where it
 * comes from: the witness tokens (`corresp="tok:…"`) or the conjecture
 * (`source="conj:…"`); an editor's own word names nothing. A token of a word
 * in several tokens says which part of the word it is (`part`: I the first,
 * M one in the middle, F the last).
 */
function tokenXml(token: Token, refs: WitnessRefs, part?: 'I' | 'M' | 'F'): string {
  const inner = markupToken(
    token.form,
    (token.marks ?? []).filter((m) => m.kind !== 'variant' && m.kind !== 'foreign'),
  );
  const lang =
    token.lang !== undefined && token.lang !== refs.textLang
      ? ` xml:lang="${escapeAttr(token.lang)}"`
      : '';
  const fragment = part ? ` part="${part}"` : '';
  // Without word elements, a word in another language than the text is still a <w>, to say so.
  if (!refs.words) return lang === '' ? inner : `<w${fragment}${lang}>${inner}</w>`;
  const source = token.source;
  let provenance = '';
  if (source?.kind === 'witness' && source.tokenIds.length)
    provenance = ` corresp="${source.tokenIds.map((id) => `tok:${escapeAttr(id)}`).join(' ')}"`;
  else if (source?.kind === 'conjecture')
    provenance = ` source="conj:${escapeAttr(source.conjectureId)}"`;
  return `<w xml:id="${ncName(token.id, 'w-')}"${fragment}${provenance}${lang}>${inner}</w>`;
}

function objectXml(item: Obj): string {
  const attrs = item.attrs ?? {};
  if (item.type === 'gap' && isNotTranscribed(attrs))
    return `<gap reason="${NOT_TRANSCRIBED_ATTRS.reason}"><desc>${escapeText(NOT_TRANSCRIBED_ATTRS.desc)}</desc></gap>`;
  if (item.type === 'gap' || item.type === 'lacuna') {
    const parts = ['reason="lost"'];
    if (typeof attrs.quantity === 'number')
      parts.push(
        `quantity="${attrs.quantity}" unit="${escapeAttr(String(attrs.unit ?? 'character'))}"`,
      );
    if (typeof attrs.extent === 'string') parts.push(`extent="${escapeAttr(attrs.extent)}"`);
    return `<gap ${parts.join(' ')}/>`;
  }
  if (item.type === 'paratext')
    return paratextXml(
      typeof attrs.type === 'string' ? { type: attrs.type } : undefined,
      item.text ?? '',
    );
  if (item.type === 'note') return `<note>${escapeText(item.text ?? '')}</note>`;
  if (item.type === 'space') return '<space/>';
  return item.text ? `<seg type="${escapeAttr(item.type)}">${escapeText(item.text)}</seg>` : '';
}

function witAttr(sigla: string[], refs: WitnessRefs): string {
  const ids = sigla.filter((s) => s !== refs.baseSiglum).map(refs.witId);
  return ids.length ? ` wit="${ids.map((id) => `#${id}`).join(' ')}"` : '';
}

/**
 * Items written as running text: a space between two words, none where a
 * break stands, none after the start of a segment, and none inside a word
 * that goes on (as where a line break or the start of a segment divides
 * it). A segment that begins between words of the text itself (`top`, not
 * inside a variant) begins a line of the file.
 */
function textWriter(refs: WitnessRefs, top: boolean) {
  const parts: string[] = [];
  /** The last word written joins the next: what stands between them divides one word. */
  let open = false;
  let last: 'break' | 'start' | 'other' | null = null;
  const push = (xml: string, kind: 'break' | 'start' | 'other', line = false) => {
    if (xml === '') return;
    if (line) parts.push('\n          ');
    else if (last !== null && !open && kind !== 'break' && last !== 'break' && last !== 'start')
      parts.push(' ');
    parts.push(xml);
    last = kind;
  };
  /** What stands inside a word does not end it: `break="no"`, as TEI says it of a break or a milestone. */
  const inWord = () => (open ? ' break="no"' : '');
  return {
    /** Something that is no item of the text: a variant. */
    push(xml: string) {
      push(xml, 'other');
      open = false;
    },
    item(item: Item) {
      if (item.kind === 'token') {
        const part = open ? (item.joinNext ? 'M' : 'F') : item.joinNext ? 'I' : undefined;
        push(tokenXml(item, refs, part), 'other');
        open = item.joinNext === true;
      } else if (item.kind === 'break') {
        // A paragraph is two line breaks, the second typed where the paragraph has a kind of its own.
        const first = `<lb${inWord()}/>`;
        push(
          item.type === 'paragraph'
            ? `${first}<lb${item.lineation ? ` type="${item.lineation}"` : ''}/>`
            : first,
          'break',
        );
      } else {
        // An object between two tokens ends the word, as the words are read.
        open = false;
        push(objectXml(item), 'other');
      }
    },
    /** The start of a segment: its label, and where the segment first begins its id and the passage's URN. */
    start(run: EditionRunExport, first: boolean) {
      const id = first && run.id ? ` xml:id="${ncName(run.id, 'seg-')}"` : '';
      const corresp = first && run.urn ? ` corresp="${escapeAttr(run.urn)}"` : '';
      push(
        `<milestone unit="segment" n="${escapeAttr(run.label ?? '')}"${id}${corresp}${inWord()}/>`,
        'start',
        top && !open,
      );
    },
    xml: () => parts.join(''),
  };
}

/** What the text is written from, in order: the start of a segment, or an item. */
type Entry = { start: EditionRunExport; first: boolean; item?: undefined } | { item: Item };

/** A variant with words of the edition, over a stretch of the entries: the whole of it, or one piece. */
interface Stretch {
  site: Site;
  passage: EditionPassageExport;
  first: number;
  last: number;
  /** The variants written inside its lemma, in order. */
  inside: Stretch[];
  /** Its name and its neighbours', where the variant is written in pieces. */
  link?: { id: string; prev?: string; next?: string };
  /** A piece after the first: a conjecture or a reported reading is named in it without its words. */
  later?: boolean;
}

/** A variant written at one place: one at a point, or one whose words do not stand together. */
interface Placed {
  site: Site;
  passage: EditionPassageExport;
  lemma: string;
}

/**
 * The text of the edition in one `<ab>`, in its own order.
 *
 * A variant with words of the edition is an `<app>` around them: its lemma is
 * the stretch of the text from its first word to its last, with the breaks,
 * the starts of segments and the objects between them. A variant at a point
 * stands where the words would. Variants do not overlap, with one exception,
 * and that one nests: where a witness is without one or more whole segments
 * (`wanting`), the variant that says so stands around the others over the
 * same words, which are found without that witness. Where its stretch and
 * another's cross (a variant across the boundary of a segment that a third
 * witness is without), it is written in pieces, each around what it can
 * hold, linked by `next` and `prev`: that a witness has nothing is true of
 * every piece.
 */
function bodyXml(input: EditionExport, refs: WitnessRefs): string {
  const seq: Entry[] = [];
  const begun = new Set<string>();
  for (const run of input.runs) {
    if (run.label !== undefined) {
      const first = run.id === undefined || !begun.has(run.id);
      if (run.id !== undefined) begun.add(run.id);
      seq.push({ start: run, first });
    }
    for (const item of run.items) seq.push({ item });
  }
  const at = new Map<Id, number>();
  seq.forEach((entry, i) => {
    if (entry.item) at.set(entry.item.id, i);
  });
  /** Where a unit of the edition stands: its tokens, or the gap it is. */
  const placesOf = (unit: Unit | undefined): number[] =>
    unit
      ? [...unit.tokenIds, ...(unit.gap ? [unit.gap.id] : [])]
          .map((id) => at.get(id))
          .filter((i): i is number => i !== undefined)
      : [];

  const top: Stretch[] = [];
  /** Variants at a point and variants gathered, by the entry they stand before (the number of entries: at the end). */
  const before = new Map<number, Placed[]>();
  const stand = (i: number, placed: Placed) => before.set(i, [...(before.get(i) ?? []), placed]);
  /** Words written in the lemma of a variant gathered, and so not where they stand. */
  const taken = new Set<number>();
  /** Entries some variant is around. */
  const covered = new Set<number>();

  /**
   * Puts a variant over the entries [x, y] among `list`, the variants of one
   * level, sorted. What lies wholly inside it goes into it; inside one that
   * holds it whole, it goes there. Where another's stretch reaches over one
   * of its ends, a variant that may be written in pieces goes on inside that
   * one and has a piece outside it; any other is refused, and nothing is changed.
   */
  const insert = (
    list: Stretch[],
    x: number,
    y: number,
    own: ReadonlySet<number>,
    make: (first: number, last: number) => Stretch,
    pieces: boolean,
  ): boolean => {
    let lo = x;
    let hi = y;
    for (const other of [...list]) {
      if (other.last < lo || other.first > hi) continue;
      if (other.first >= lo && other.last <= hi) continue;
      if (other.first <= lo && other.last >= hi)
        return insert(other.inside, lo, hi, own, make, pieces);
      if (!pieces) return false;
      if (other.first < lo) {
        insert(other.inside, lo, other.last, own, make, pieces);
        lo = other.last + 1;
      } else {
        insert(other.inside, other.first, hi, own, make, pieces);
        hi = other.first - 1;
      }
    }
    while (lo <= hi && !own.has(lo)) lo++;
    while (hi >= lo && !own.has(hi)) hi--;
    if (lo > hi) return true;
    const stretch = make(lo, hi);
    const within = (s: Stretch) => s.first >= lo && s.last <= hi;
    stretch.inside = list.filter(within);
    const rest = list.filter((s) => !within(s));
    list.length = 0;
    list.push(...rest, stretch);
    list.sort((a, b) => a.first - b.first);
    return true;
  };

  input.passages.forEach((passage, p) => {
    // The variants over words first, and then those that stand around them.
    const ordered = [...passage.sites].sort(
      (a, b) => Number(a.wanting === true) - Number(b.wanting === true),
    );
    for (const site of ordered) {
      if (site.baseTo <= site.baseFrom) {
        stand(pointOf(site, passage, seq, placesOf), { site, passage, lemma: '' });
        continue;
      }
      const own = new Set<number>();
      for (let i = site.baseFrom; i < site.baseTo; i++)
        for (const k of placesOf(passage.baseUnits[i])) own.add(k);
      // Words that are not in the text written have no place in it.
      if (own.size === 0) continue;
      const first = Math.min(...own);
      const last = Math.max(...own);
      let whole = true;
      for (let k = first; k <= last && whole; k++)
        if (seq[k]!.item?.kind === 'token' && !own.has(k)) whole = false;
      const made: Stretch[] = [];
      const make = (from: number, to: number): Stretch => {
        const stretch: Stretch = { site, passage, first: from, last: to, inside: [] };
        made.push(stretch);
        return stretch;
      };
      if (whole && insert(top, first, last, own, make, site.wanting === true)) {
        for (const k of own) covered.add(k);
        made.sort((a, b) => a.first - b.first);
        if (made.length > 1)
          made.forEach((piece, n) => {
            const name = (m: number) => `${p + 1}-${site.index + 1}-${m + 1}`;
            piece.link = {
              id: name(n),
              ...(n > 0 ? { prev: name(n - 1) } : {}),
              ...(n < made.length - 1 ? { next: name(n + 1) } : {}),
            };
            if (n > 0) piece.later = true;
          });
        continue;
      }
      // Its words do not stand together, or another variant's stretch crosses its own: the words that no
      // other variant has are gathered in its lemma, where the first of them stands.
      const mine = [...own].filter((k) => !covered.has(k)).sort((a, b) => a - b);
      if (mine.length === 0) continue;
      for (const k of mine) {
        covered.add(k);
        taken.add(k);
      }
      const lemma = mine
        .map((k) => seq[k]!.item)
        .filter((item): item is Token => item?.kind === 'token')
        .map((token) => tokenXml(token, refs))
        .join(' ');
      stand(mine[0]!, { site, passage, lemma });
    }
  });

  const placedXml = (i: number, out: ReturnType<typeof textWriter>) => {
    const here = before.get(i);
    if (!here) return;
    // Written once: the stretch that begins here is walked again from the same entry.
    before.delete(i);
    for (const placed of here) out.push(appXml(placed.site, placed.passage, placed.lemma, refs));
  };
  const walk = (first: number, last: number, inside: readonly Stretch[], level: number): string => {
    const out = textWriter(refs, level === 0);
    let next = 0;
    for (let i = first; i <= last; i++) {
      placedXml(i, out);
      while (inside[next] && inside[next]!.first < i) next++;
      const stretch = inside[next];
      if (stretch && stretch.first === i) {
        const lemma = walk(stretch.first, stretch.last, stretch.inside, level + 1);
        out.push(appXml(stretch.site, stretch.passage, lemma, refs, stretch));
        i = stretch.last;
        next++;
        continue;
      }
      if (taken.has(i)) continue;
      const entry = seq[i]!;
      if (entry.item) out.item(entry.item);
      else out.start(entry.start, entry.first);
    }
    if (level === 0) placedXml(seq.length, out);
    return out.xml();
  };
  const text = walk(0, seq.length - 1, top, 0);
  // The segments begin lines of the file; a text without one is written on the line of its block.
  return text.includes('\n') ? `        <ab>${text}\n        </ab>` : `        <ab>${text}</ab>`;
}

/**
 * The entry a variant at a point stands before (the number of entries: at
 * the end). Inside a segment it stands before the edition's word that
 * follows. Where the word before it and the word after it are of two
 * segments, the segments of the witnesses' words say where: in the first,
 * directly after its last word, before the break that ends the line; in the
 * second, before its first word; and in a segment the edition does not
 * print, between the two, after what ends the first and before the start of
 * the second.
 */
function pointOf(
  site: Site,
  passage: EditionPassageExport,
  seq: readonly Entry[],
  placesOf: (unit: Unit | undefined) => number[],
): number {
  const units = passage.baseUnits;
  let before: number | undefined;
  let unitBefore: Unit | undefined;
  for (let i = site.baseFrom - 1; i >= 0 && before === undefined; i--) {
    const places = placesOf(units[i]);
    if (places.length === 0) continue;
    before = Math.max(...places);
    unitBefore = units[i];
  }
  let after: number | undefined;
  let unitAfter: Unit | undefined;
  for (let i = site.baseFrom; i < units.length && after === undefined; i++) {
    const places = placesOf(units[i]);
    if (places.length === 0) continue;
    after = Math.min(...places);
    unitAfter = units[i];
  }
  const ids = siteSegments(site, units);
  const home = (passage.segments ?? []).find((s) => ids.includes(s.segmentId));
  if (home && !home.printed) {
    if (before !== undefined) {
      for (let k = before + 1; k < seq.length; k++) if (!seq[k]!.item) return k;
      return seq.length;
    }
    if (after !== undefined) {
      for (let k = after; k >= 0; k--) if (!seq[k]!.item) return k;
      return 0;
    }
    return seq.length;
  }
  const inFirst = home !== undefined && unitBefore?.segmentId === home.segmentId;
  const inSecond = home !== undefined && unitAfter?.segmentId === home.segmentId;
  if (before !== undefined && (after === undefined || (inFirst && !inSecond))) return before + 1;
  return after ?? seq.length;
}

/**
 * A witness's words in a reading. Where they lie in a segment the edition
 * does not print, the segment begins among them with its `<milestone>`: the
 * edition's text has no start of it, and the reading is where it is. Nothing
 * is said of where a witness begins a segment the edition prints; that is in
 * its transcript.
 */
function readingXml(reading: Reading, passage: EditionPassageExport): string {
  const plain = escapeText(reading.text);
  const labels = new Map(
    (passage.segments ?? [])
      .filter((s) => !s.printed && s.label !== undefined)
      .map((s) => [s.segmentId, s.label!] as const),
  );
  if (labels.size === 0) return plain;
  /** The words of a witness, each with the label of the segment it begins, where the edition does not print it. */
  const wordsOf = (id: Id) => {
    const words = (reading.units[id] ?? []).filter((u) => !u.gap);
    return words.map((unit, k) => ({
      text: unit.text,
      begins:
        unit.segmentId !== undefined && unit.segmentId !== words[k - 1]?.segmentId
          ? labels.get(unit.segmentId)
          : undefined,
    }));
  };
  const first = wordsOf(reading.textIds[0] ?? '');
  // The witnesses of a reading must begin the segment at the same word, and the words must be the reading's.
  const same = reading.textIds.every((id) => {
    const words = wordsOf(id);
    return words.length === first.length && words.every((w, k) => w.begins === first[k]!.begins);
  });
  if (
    !same ||
    !first.some((w) => w.begins !== undefined) ||
    first.map((w) => w.text).join(' ') !== reading.text
  )
    return plain;
  return first
    .map((w) =>
      w.begins === undefined
        ? escapeText(w.text)
        : `<milestone unit="segment" n="${escapeAttr(w.begins)}"/>${escapeText(w.text)}`,
    )
    .join(' ');
}

/** The name of a piece of a variant: a name of the file's own, which no word, segment or witness has. */
function pieceName(id: string): string {
  return ncName(id, 'app-');
}

function appXml(
  site: Site,
  passage: EditionPassageExport,
  lemmaXml: string,
  refs: WitnessRefs,
  piece?: Pick<Stretch, 'link' | 'later'>,
): string {
  const base = site.readings.find((r) => r.base);
  const attachments = passage.attachments?.[site.index] ?? [];
  const adopted = attachments.find((a) => a.adopted);
  const lemWit = base ? witAttr(base.sigla, refs) : '';
  const lemResp = adopted ? `${refs.resp(adopted.name)}${refs.source(adopted)}` : '';
  const out: string[] = [];
  out.push(
    lemmaXml === '' ? `<lem${lemWit}${lemResp}/>` : `<lem${lemWit}${lemResp}>${lemmaXml}</lem>`,
  );
  for (const reading of site.readings) {
    if (reading.base) continue;
    const wit = witAttr(reading.sigla, refs);
    // A witness that has lost the words is in no reading, and so in no <rdg>.
    if (reading.omission) out.push(`<rdg${wit}/>`);
    else out.push(`<rdg${wit}>${readingXml(reading, passage)}</rdg>`);
  }
  for (const attachment of attachments) {
    if (attachment.adopted) continue;
    const type = attachment.kind === 'conjecture' ? 'conjecture' : 'reported';
    // A reading reported for a witness is that witness's, as a reading collated is; a conjecture points at who proposed it.
    const resp =
      attachment.kind === 'reported'
        ? ` wit="#${refs.witId(attachment.name)}"`
        : refs.resp(attachment.name);
    const source = refs.source(attachment);
    // In a piece after the first the record is named without its words, so that it is not read as keeping the lemma there.
    if (attachment.text === '' || piece?.later) out.push(`<rdg type="${type}"${resp}${source}/>`);
    else out.push(`<rdg type="${type}"${resp}${source}>${escapeText(attachment.text)}</rdg>`);
  }
  // A minor place says its kind besides: a subtype stands only beside a type.
  const kind = printedKind(site, attachments);
  const typed = site.minor
    ? ` type="${kind}" subtype="minor"`
    : kind === 'interpretative'
      ? ' type="interpretative"'
      : '';
  // The pieces of one variant name themselves and each other, as TEI's global linking attributes do.
  const link = piece?.link;
  const linked = link
    ? ` xml:id="${pieceName(link.id)}"${typed}${link.prev ? ` prev="#${pieceName(link.prev)}"` : ''}${link.next ? ` next="#${pieceName(link.next)}"` : ''}`
    : typed;
  return `<app${linked}>${out.join('')}</app>`;
}
