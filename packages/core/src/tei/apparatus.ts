/**
 * TEI export of an edition: the critical text with its apparatus encoded
 * by the parallel-segmentation method. Every site becomes an `<app>` whose
 * `<lem>` is the edition's words and whose `<rdg>` elements are the
 * witnesses' readings, with the conjectures attached to the site.
 */

import { printedKind, type Attachment } from '../apparatus/render.ts';
import type { Site } from '../collate/collate.ts';
import type { Item, Token } from '../stream/items.ts';
import type { Unit } from '../stream/words.ts';
import { markupToken, publicationStmt, sourcesBibl } from './export.ts';
import { escapeAttr, escapeText, ncName } from './xml.ts';

export interface EditionWitness {
  siglum: string;
  name?: string;
  description?: string;
}

export interface EditionSegmentExport {
  label: string;
  /** The edition's items of the segment, in order (tokens, breaks, objects). */
  items: Item[];
  /** The edition's collation units for the segment (as given to collate). */
  baseUnits: Unit[];
  sites: Site[];
  /** Conjectures and reported readings by site index. */
  attachments?: Record<number, Attachment[]>;
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
  /** The licence the edition is published under. */
  licence?: string;
  witnesses: EditionWitness[];
  segments: EditionSegmentExport[];
}

const witId = (siglum: string): string => ncName(siglum, 'wit-');

/** A complete TEI document of the edition. */
export function exportEditionTei(input: EditionExport): string {
  const lang = input.language ? ` xml:lang="${escapeAttr(input.language)}"` : '';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<TEI xmlns="http://www.tei-c.org/ns/1.0">');
  out.push('  <teiHeader>');
  out.push('    <fileDesc>');
  out.push(`      <titleStmt><title>${escapeText(input.title)}</title>${(input.editors ?? []).map((name) => `<editor>${escapeText(name)}</editor>`).join('')}</titleStmt>`);
  out.push(`      ${publicationStmt(input.licence)}`);
  out.push('      <sourceDesc>');
  out.push('        <listWit>');
  for (const w of input.witnesses) {
    const text = [w.name, w.description].filter((x) => x && x.trim() !== '').join('. ');
    out.push(`          <witness xml:id="${witId(w.siglum)}" n="${escapeAttr(w.siglum)}">${escapeText(text || w.siglum)}</witness>`);
  }
  out.push('        </listWit>');
  const bibl = sourcesBibl(input.sources);
  if (bibl) out.push(`        ${bibl}`);
  out.push('      </sourceDesc>');
  out.push('    </fileDesc>');
  if (input.language) out.push(`    <profileDesc><langUsage><language ident="${escapeAttr(input.language)}"/></langUsage></profileDesc>`);
  out.push('  </teiHeader>');
  out.push(`  <text${lang}>`);
  if (input.preface) out.push(`    <front><div type="preface"><p>${escapeText(input.preface)}</p></div></front>`);
  out.push('    <body>');
  out.push('      <div type="edition">');
  for (const segment of input.segments) out.push(segmentXml(segment, input.baseSiglum ?? 'ed.'));
  out.push('      </div>');
  out.push('    </body>');
  out.push('  </text>');
  out.push('</TEI>');
  return out.join('\n') + '\n';
}

function tokenXml(token: Token): string {
  return markupToken(token.form, token.marks ?? []);
}

function itemXml(item: Item): string {
  switch (item.kind) {
    case 'token':
      return tokenXml(item);
    case 'break':
      return item.type === 'paragraph' ? '<lb/><lb/>' : '<lb/>';
    case 'object': {
      const attrs = item.attrs ?? {};
      if (item.type === 'gap' || item.type === 'lacuna') {
        const parts = ['reason="lost"'];
        if (typeof attrs.quantity === 'number') parts.push(`quantity="${attrs.quantity}" unit="${escapeAttr(String(attrs.unit ?? 'character'))}"`);
        if (typeof attrs.extent === 'string') parts.push(`extent="${escapeAttr(attrs.extent)}"`);
        return `<gap ${parts.join(' ')}/>`;
      }
      if (item.type === 'paratext') {
        const type = typeof attrs.type === 'string' ? attrs.type : 'paratext';
        const element = type === 'speaker' ? 'speaker' : type === 'head' ? 'head' : type === 'stage' ? 'stage' : 'label';
        return `<${element}>${escapeText(item.text ?? '')}</${element}>`;
      }
      if (item.type === 'note') return `<note>${escapeText(item.text ?? '')}</note>`;
      if (item.type === 'space') return '<space/>';
      return item.text ? `<seg type="${escapeAttr(item.type)}">${escapeText(item.text)}</seg>` : '';
    }
  }
}

function witAttr(sigla: string[], baseSiglum: string): string {
  const ids = sigla.filter((s) => s !== baseSiglum).map(witId);
  return ids.length ? ` wit="${ids.map((id) => `#${id}`).join(' ')}"` : '';
}

function segmentXml(segment: EditionSegmentExport, baseSiglum: string): string {
  // Which tokens each site covers, and where insertion sites stand.
  const siteOfToken = new Map<string, Site>();
  const insertionBefore = new Map<string, Site[]>();
  const insertionsAtEnd: Site[] = [];
  for (const site of segment.sites) {
    if (site.baseTo > site.baseFrom) {
      for (let i = site.baseFrom; i < site.baseTo; i++) for (const id of segment.baseUnits[i]?.tokenIds ?? []) siteOfToken.set(id, site);
    } else {
      const next = segment.baseUnits[site.baseFrom]?.tokenIds[0];
      if (next) insertionBefore.set(next, [...(insertionBefore.get(next) ?? []), site]);
      else insertionsAtEnd.push(site);
    }
  }
  const emitted = new Set<Site>();
  const parts: string[] = [];
  const push = (xml: string) => {
    if (xml === '') return;
    const previous = parts[parts.length - 1];
    if (previous !== undefined && !previous.startsWith('<lb') && !xml.startsWith('<lb')) parts.push(' ');
    parts.push(xml);
  };
  for (const item of segment.items) {
    if (item.kind === 'token') {
      for (const site of insertionBefore.get(item.id) ?? []) {
        if (!emitted.has(site)) {
          emitted.add(site);
          push(appXml(site, [], segment, baseSiglum));
        }
      }
      const site = siteOfToken.get(item.id);
      if (site) {
        if (emitted.has(site)) continue;
        emitted.add(site);
        const covered = segment.items.filter((i): i is Token => i.kind === 'token' && siteOfToken.get(i.id) === site);
        push(appXml(site, covered, segment, baseSiglum));
        continue;
      }
      push(tokenXml(item));
      continue;
    }
    push(itemXml(item));
  }
  for (const site of insertionsAtEnd) {
    if (!emitted.has(site)) {
      emitted.add(site);
      push(appXml(site, [], segment, baseSiglum));
    }
  }
  return `        <ab n="${escapeAttr(segment.label)}">${parts.join('')}</ab>`;
}

function appXml(site: Site, lemmaTokens: Token[], segment: EditionSegmentExport, baseSiglum: string): string {
  const base = site.readings.find((r) => r.base);
  const attachments = segment.attachments?.[site.index] ?? [];
  const adopted = attachments.find((a) => a.adopted);
  const lemmaText = lemmaTokens.map(tokenXml).join(' ');
  const lemWit = base ? witAttr(base.sigla, baseSiglum) : '';
  const lemResp = adopted ? ` resp="${escapeAttr(adopted.name)}"` : '';
  const out: string[] = [];
  out.push(lemmaText === '' ? `<lem${lemWit}${lemResp}/>` : `<lem${lemWit}${lemResp}>${lemmaText}</lem>`);
  for (const reading of site.readings) {
    if (reading.base) continue;
    const wit = witAttr(reading.sigla, baseSiglum);
    if (reading.lacunose && reading.text === '') out.push(`<rdg${wit}><gap reason="lost"/></rdg>`);
    else if (reading.omission) out.push(`<rdg${wit}/>`);
    else out.push(`<rdg${wit}>${escapeText(reading.text)}${reading.lacunose ? '<gap reason="lost"/>' : ''}</rdg>`);
  }
  for (const attachment of attachments) {
    if (attachment.adopted) continue;
    const type = attachment.kind === 'conjecture' ? 'conjecture' : 'reported';
    const resp = ` resp="${escapeAttr(attachment.name)}"`;
    const source = attachment.source ? ` source="${escapeAttr(attachment.source)}"` : '';
    if (attachment.text === '') out.push(`<rdg type="${type}"${resp}${source}/>`);
    else out.push(`<rdg type="${type}"${resp}${source}>${escapeText(attachment.text)}</rdg>`);
  }
  return printedKind(site, attachments) === 'interpretative' ? `<app type="interpretative">${out.join('')}</app>` : `<app>${out.join('')}</app>`;
}
