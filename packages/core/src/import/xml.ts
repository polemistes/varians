/**
 * A small element tree over fast-xml-parser for the layout importers
 * (PAGE, ALTO). Document order is kept, namespace prefixes are dropped,
 * attribute values stay strings, comments and processing instructions
 * are left out.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The element's own text: its direct text nodes run together, trimmed. */
  text: string;
}

export interface ParsedXml {
  /** The top-level elements, normally one. */
  elements: XmlElement[];
  /** A well-formedness problem, when there is one. Parsing is attempted regardless. */
  error: string | null;
}

/** Parse an XML document into elements. Never throws: a broken document gives an error and whatever could be read. */
export function parseXml(xml: string): ParsedXml {
  const validation = XMLValidator.validate(xml);
  const error = validation === true ? null : `${validation.err.msg} (line ${validation.err.line})`;
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
  });
  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch (e) {
    return { elements: [], error: error ?? (e instanceof Error ? e.message : String(e)) };
  }
  return { elements: toElements(raw), error };
}

function toElements(nodes: unknown): XmlElement[] {
  if (!Array.isArray(nodes)) return [];
  const out: XmlElement[] = [];
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue;
    const record = node as Record<string, unknown>;
    const name = Object.keys(record).find((key) => key !== ':@');
    if (name === undefined || name === '#text') continue;
    const attrs: Record<string, string> = {};
    const rawAttrs = record[':@'];
    if (typeof rawAttrs === 'object' && rawAttrs !== null) {
      for (const [key, value] of Object.entries(rawAttrs)) attrs[key] = String(value);
    }
    const content = record[name];
    out.push({ name, attrs, children: toElements(content), text: textOf(content) });
  }
  return out;
}

function textOf(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  let text = '';
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue;
    const value = (node as Record<string, unknown>)['#text'];
    if (value !== undefined) text += String(value);
  }
  return text.trim();
}

/** The direct children with a name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** The first direct child with a name. */
export function firstChild(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((child) => child.name === name);
}

/** Every element with a name below this one, in document order. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.name === name) out.push(child);
      walk(child);
    }
  };
  walk(element);
  return out;
}

/** An attribute as a finite number, or null. */
export function numberAttr(element: XmlElement, name: string): number | null {
  const raw = element.attrs[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
