/**
 * TEI export of an edition: the critical text with its apparatus encoded
 * by the parallel-segmentation method. Every site becomes an `<app>` whose
 * `<lem>` is the edition's words and whose `<rdg>` elements are the
 * witnesses' readings, with the conjectures attached to the site. A variant
 * whose words lie in several segments is written in parts, one `<app>` in the
 * `<ab>` of each, each given as it stands in its own segment and linked to
 * the others by `next` and `prev` (see `variantParts`, which makes them).
 */

import { printedKind, type Attachment } from '../apparatus/render.ts';
import type { Site } from '../collate/collate.ts';
import { isNotTranscribed, NOT_TRANSCRIBED_ATTRS, type Item, type Token } from '../stream/items.ts';
import type { Unit } from '../stream/words.ts';
import {
  encodingDesc,
  markupToken,
  paratextXml,
  publicationStmt,
  respStmts,
  sourcesBibl,
  type Contributor,
} from './export.ts';
import type { VariantLink } from './parts.ts';
import { escapeAttr, escapeText, ncName } from './xml.ts';

export interface EditionWitness {
  siglum: string;
  /** The witness record's id, pointed at as `wit:<id>`. */
  id?: string;
  name?: string;
  description?: string;
}

export interface EditionSegmentExport {
  label: string;
  /** The segment's id: the `<ab>` gets `xml:id="seg-<id>"`. */
  id?: string;
  /** The passage's CTS URN, written as the `<ab>`'s `corresp`. */
  urn?: string;
  /** The edition's items of the segment, in order (tokens, breaks, objects). */
  items: Item[];
  /** The edition's collation units for the segment (as given to collate). */
  baseUnits: Unit[];
  /** The places of variation; one the editor judges minor (`minor`) is written as such. */
  sites: Site[];
  /** Conjectures and reported readings by site index. */
  attachments?: Record<number, Attachment[]>;
  /**
   * By site index, the sites that are one part of a variant written across
   * segments (`variantParts`): the part is written with its `xml:id`, `prev`
   * and `next`, and the kind of the whole variant, and with the later tokens of
   * a word of the edition that begins in the segment before in its lemma. A
   * site not here stands alone.
   */
  links?: Record<number, VariantLink>;
}

export interface EditionExport {
  title: string;
  editors?: string[];
  language?: string;
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
  segments: EditionSegmentExport[];
  /** Write every word as `<w xml:id>`, with `corresp` to the witness tokens it was taken from or `source` to its conjecture. */
  words?: boolean;
  /** The installation's address, for the prefixes that resolve record ids. */
  origin?: string;
}

/** How the witnesses are referred to: the base's siglum, left out of `wit`, and each siglum's xml:id. */
interface WitnessRefs {
  baseSiglum: string;
  witId: (siglum: string) => string;
  /** Whether words are written as `<w>` with their provenance. */
  words: boolean;
}

/**
 * Distinct xml:ids for the witnesses, `wit-` and the siglum as a name; sigla
 * that give the same name (A¹ and A²) are told apart by a number.
 */
function witnessRefs(witnesses: readonly EditionWitness[], baseSiglum: string): WitnessRefs {
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
  return { baseSiglum, witId: (siglum) => ids.get(siglum) ?? ncName(siglum, 'wit-'), words: false };
}

/** A complete TEI document of the edition. */
export function exportEditionTei(input: EditionExport): string {
  const lang = input.language ? ` xml:lang="${escapeAttr(input.language)}"` : '';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<TEI xmlns="http://www.tei-c.org/ns/1.0">');
  out.push('  <teiHeader>');
  out.push('    <fileDesc>');
  out.push(
    `      <titleStmt><title>${escapeText(input.title)}</title>${(input.editors ?? []).map((name) => `<editor>${escapeText(name)}</editor>`).join('')}${respStmts(input.contributors)}</titleStmt>`,
  );
  out.push(
    `      ${publicationStmt(input.licence, { licenceUrl: input.licenceUrl, rightsNote: input.rightsNote, authority: input.authority })}`,
  );
  out.push('      <sourceDesc>');
  const refs = {
    ...witnessRefs(input.witnesses, input.baseSiglum ?? 'ed.'),
    words: input.words ?? false,
  };
  if (input.witnesses.length > 0) {
    out.push('        <listWit>');
    for (const w of input.witnesses) {
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
  // A source description must say something: an edition with no witnesses yet and no sources.
  if (input.witnesses.length === 0 && !bibl) out.push('        <p>Edition.</p>');
  out.push('      </sourceDesc>');
  out.push('    </fileDesc>');
  const encoding = encodingDesc(input.origin);
  if (encoding) out.push(`    ${encoding}`);
  if (input.language)
    out.push(
      `    <profileDesc><langUsage><language ident="${escapeAttr(input.language)}"/></langUsage></profileDesc>`,
    );
  out.push('  </teiHeader>');
  out.push(`  <text${lang}>`);
  if (input.preface)
    out.push(`    <front><div type="preface"><p>${escapeText(input.preface)}</p></div></front>`);
  out.push('    <body>');
  out.push('      <div type="edition">');
  for (const segment of input.segments) out.push(segmentXml(segment, refs));
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
 * (`source="conj:…"`); an editor's own word names nothing.
 */
function tokenXml(token: Token, refs?: WitnessRefs): string {
  const inner = markupToken(
    token.form,
    (token.marks ?? []).filter((m) => m.kind !== 'variant'),
  );
  if (!refs?.words) return inner;
  const source = token.source;
  let provenance = '';
  if (source?.kind === 'witness' && source.tokenIds.length)
    provenance = ` corresp="${source.tokenIds.map((id) => `tok:${escapeAttr(id)}`).join(' ')}"`;
  else if (source?.kind === 'conjecture')
    provenance = ` source="conj:${escapeAttr(source.conjectureId)}"`;
  return `<w xml:id="${ncName(token.id, 'w-')}"${provenance}>${inner}</w>`;
}

function itemXml(item: Item, refs?: WitnessRefs): string {
  switch (item.kind) {
    case 'token':
      return tokenXml(item, refs);
    case 'break':
      // A paragraph is two line breaks, the second typed where the paragraph has a kind of its own.
      return item.type === 'paragraph'
        ? `<lb/><lb${item.lineation ? ` type="${item.lineation}"` : ''}/>`
        : '<lb/>';
    case 'object': {
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
  }
}

function witAttr(sigla: string[], refs: WitnessRefs): string {
  const ids = sigla.filter((s) => s !== refs.baseSiglum).map(refs.witId);
  return ids.length ? ` wit="${ids.map((id) => `#${id}`).join(' ')}"` : '';
}

/**
 * Items written as the text of an `<ab>` is: a space between two words, none
 * where a break stands or where a word is joined to the next (as where a line
 * break divides it).
 */
function textWriter(refs: WitnessRefs) {
  const parts: string[] = [];
  let joinNext = false;
  const push = (xml: string) => {
    if (xml === '') return;
    const previous = parts[parts.length - 1];
    if (
      previous !== undefined &&
      !joinNext &&
      !previous.startsWith('<lb') &&
      !xml.startsWith('<lb')
    )
      parts.push(' ');
    parts.push(xml);
    joinNext = false;
  };
  return {
    push,
    /** An item of the text: a word that joins the next stays against it. */
    item(item: Item) {
      if (item.kind === 'token') {
        push(tokenXml(item, refs));
        joinNext = item.joinNext === true;
      } else push(itemXml(item, refs));
    },
    xml: () => parts.join(''),
  };
}

function segmentXml(segment: EditionSegmentExport, refs: WitnessRefs): string {
  // Which tokens each site covers, and where insertion sites stand.
  const siteOfToken = new Map<string, Site>();
  const insertionBefore = new Map<string, Site[]>();
  const insertionsAtEnd: Site[] = [];
  for (const site of segment.sites) {
    // The later tokens of a word of the edition that begins in the segment before are this place's too.
    const tail = segment.links?.[site.index]?.tail ?? [];
    if (site.baseTo > site.baseFrom || tail.length > 0) {
      if (site.baseTo > site.baseFrom)
        for (let i = site.baseFrom; i < site.baseTo; i++)
          for (const id of segment.baseUnits[i]?.tokenIds ?? []) siteOfToken.set(id, site);
      for (const id of tail) siteOfToken.set(id, site);
    } else {
      const next = segment.baseUnits[site.baseFrom]?.tokenIds[0];
      if (next) insertionBefore.set(next, [...(insertionBefore.get(next) ?? []), site]);
      else insertionsAtEnd.push(site);
    }
  }
  // Where the tokens of each site stand among the items.
  const span = new Map<Site, { first: number; last: number }>();
  segment.items.forEach((item, k) => {
    const site = item.kind === 'token' ? siteOfToken.get(item.id) : undefined;
    if (!site) return;
    const known = span.get(site);
    if (known) known.last = k;
    else span.set(site, { first: k, last: k });
  });
  const emitted = new Set<Site>();
  const out = textWriter(refs);
  for (let k = 0; k < segment.items.length; k++) {
    const item = segment.items[k]!;
    if (item.kind !== 'token') {
      out.item(item);
      continue;
    }
    for (const site of insertionBefore.get(item.id) ?? []) {
      if (!emitted.has(site)) {
        emitted.add(site);
        out.push(appXml(site, '', segment, refs));
      }
    }
    const site = siteOfToken.get(item.id);
    if (!site) {
      out.item(item);
      continue;
    }
    if (emitted.has(site)) continue;
    emitted.add(site);
    const { first, last } = span.get(site)!;
    const within = segment.items.slice(first, last + 1);
    // The lemma is the stretch of the text from its first word to its last, breaks and objects between them
    // included, as the text outside a variant is written. Another place's word among them, or a place that
    // is to stand inside the stretch, would be lost in it: the lemma is then the words alone.
    const whole =
      within.every((i) => i.kind !== 'token' || siteOfToken.get(i.id) === site) &&
      within.slice(1).every((i) => i.kind !== 'token' || !insertionBefore.has(i.id));
    if (whole) {
      const lemma = textWriter(refs);
      for (const i of within) lemma.item(i);
      out.push(appXml(site, lemma.xml(), segment, refs));
      k = last;
    } else {
      const lemma = within
        .filter((i): i is Token => i.kind === 'token' && siteOfToken.get(i.id) === site)
        .map((t) => tokenXml(t, refs))
        .join(' ');
      out.push(appXml(site, lemma, segment, refs));
    }
  }
  for (const site of insertionsAtEnd) {
    if (!emitted.has(site)) {
      emitted.add(site);
      out.push(appXml(site, '', segment, refs));
    }
  }
  const id = segment.id ? ` xml:id="${ncName(segment.id, 'seg-')}"` : '';
  const corresp = segment.urn ? ` corresp="${escapeAttr(segment.urn)}"` : '';
  return `        <ab n="${escapeAttr(segment.label)}"${id}${corresp}>${out.xml()}</ab>`;
}

/** The name of a part of a variant: a name of the file's own, which no word, segment or witness has. */
function partName(id: string): string {
  return ncName(id, 'app-');
}

function appXml(
  site: Site,
  lemmaXml: string,
  segment: EditionSegmentExport,
  refs: WitnessRefs,
): string {
  const base = site.readings.find((r) => r.base);
  const attachments = segment.attachments?.[site.index] ?? [];
  const link = segment.links?.[site.index];
  const adopted = attachments.find((a) => a.adopted);
  const lemWit = base ? witAttr(base.sigla, refs) : '';
  const lemResp = adopted ? ` resp="${escapeAttr(adopted.name)}"` : '';
  const out: string[] = [];
  out.push(
    lemmaXml === '' ? `<lem${lemWit}${lemResp}/>` : `<lem${lemWit}${lemResp}>${lemmaXml}</lem>`,
  );
  for (const reading of site.readings) {
    if (reading.base) continue;
    const wit = witAttr(reading.sigla, refs);
    // A witness that has lost the words is in no reading, and so in no <rdg>.
    if (reading.omission) out.push(`<rdg${wit}/>`);
    else out.push(`<rdg${wit}>${escapeText(reading.text)}</rdg>`);
  }
  for (const attachment of attachments) {
    if (attachment.adopted) continue;
    const type = attachment.kind === 'conjecture' ? 'conjecture' : 'reported';
    const resp = ` resp="${escapeAttr(attachment.name)}"`;
    const source = attachment.source ? ` source="${escapeAttr(attachment.source)}"` : '';
    if (attachment.text === '') out.push(`<rdg type="${type}"${resp}${source}/>`);
    else out.push(`<rdg type="${type}"${resp}${source}>${escapeText(attachment.text)}</rdg>`);
  }
  // A minor place says its kind besides: a subtype stands only beside a type.
  const kind = link?.kind ?? printedKind(site, attachments);
  const typed = site.minor
    ? ` type="${kind}" subtype="minor"`
    : kind === 'interpretative'
      ? ' type="interpretative"'
      : '';
  // The parts of one variant name themselves and each other, as TEI's global linking attributes do.
  const linked = link
    ? ` xml:id="${partName(link.id)}"${typed}${link.prev ? ` prev="#${partName(link.prev)}"` : ''}${link.next ? ` next="#${partName(link.next)}"` : ''}`
    : typed;
  return `<app${linked}>${out.join('')}</app>`;
}
