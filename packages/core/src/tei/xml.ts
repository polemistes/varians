/**
 * A small XML layer for the TEI module: an ordered element tree read with
 * fast-xml-parser, the few queries the importer needs, and the escaping the
 * exporter needs. Node has no DOM, and TEI needs mixed content in document
 * order, which the parser's ordered mode gives us.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface XmlElement {
  kind: 'element';
  /** Local name: namespace prefixes are removed, so `tei:div` is `div` and `xml:id` is the attribute `id`. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export interface XmlText {
  kind: 'text';
  text: string;
}

export type XmlNode = XmlElement | XmlText;

/** The document is not well formed, or has no element. */
export class XmlError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly col?: number,
  ) {
    super(message);
    this.name = 'XmlError';
  }
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  alwaysCreateTextNode: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/** Parse a document and return its root element. Throws an XmlError when the XML is not well formed. */
export function parseXml(xml: string): XmlElement {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    const { msg, line, col } = valid.err;
    throw new XmlError(`Not well-formed XML at line ${line}, column ${col}: ${msg}`, line, col);
  }
  const parsed: unknown = parser.parse(xml);
  const root = toNodes(parsed).find(isElement);
  if (!root) throw new XmlError('The document has no element.');
  return root;
}

/** Whether a node is an element. */
export function isElement(node: XmlNode | undefined): node is XmlElement {
  return node?.kind === 'element';
}

/** Whether a node is a text node. */
export function isText(node: XmlNode | undefined): node is XmlText {
  return node?.kind === 'text';
}

/** The ordered output of fast-xml-parser as our node tree. Comments and processing instructions are dropped. */
function toNodes(list: unknown): XmlNode[] {
  if (!Array.isArray(list)) return [];
  const out: XmlNode[] = [];
  for (const entry of list as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = Object.keys(record).find((key) => key !== ':@');
    if (name === undefined) continue;
    const value = record[name];
    if (name === '#text') {
      out.push({ kind: 'text', text: String(value) });
    } else if (name === '#cdata') {
      out.push({
        kind: 'text',
        text: toNodes(value)
          .filter(isText)
          .map((t) => t.text)
          .join(''),
      });
    } else if (name === '#comment' || name.startsWith('?') || name.startsWith('!')) {
      continue;
    } else {
      out.push({ kind: 'element', name, attrs: toAttrs(record[':@']), children: toNodes(value) });
    }
  }
  return out;
}

function toAttrs(value: unknown): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return attrs;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
    attrs[key] = String(v);
  }
  return attrs;
}

/** The element children of an element, in order. */
export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter(isElement);
}

/** The first child element with a name. */
export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find(
    (child): child is XmlElement => isElement(child) && child.name === name,
  );
}

/** Follow a path of child names from an element: the first child of each name in turn. */
export function descendant(element: XmlElement, path: string[]): XmlElement | undefined {
  let current: XmlElement | undefined = element;
  for (const name of path) {
    if (!current) return undefined;
    current = firstChild(current, name);
  }
  return current;
}

/** Every descendant element with one of the given names, in document order. */
export function findDescendants(element: XmlElement, ...names: string[]): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (node: XmlElement): void => {
    for (const child of node.children) {
      if (!isElement(child)) continue;
      if (names.includes(child.name)) out.push(child);
      visit(child);
    }
  };
  visit(element);
  return out;
}

/** The text of an element and its descendants with whitespace collapsed, leaving out the elements named in `skip`. */
export function textContent(element: XmlElement, skip: ReadonlySet<string> = new Set()): string {
  const parts: string[] = [];
  const visit = (node: XmlElement): void => {
    for (const child of node.children) {
      if (isText(child)) parts.push(child.text);
      else if (!skip.has(child.name)) visit(child);
    }
  };
  visit(element);
  return collapseWhitespace(parts.join(''));
}

/** Runs of whitespace as one space, trimmed. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** The text of an attribute, or undefined when absent or blank. */
export function attr(element: XmlElement, name: string): string | undefined {
  const value = element.attrs[name];
  if (value === undefined) return undefined;
  const trimmed = collapseWhitespace(value);
  return trimmed === '' ? undefined : trimmed;
}

/** Text escaped for element content. */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text escaped for a double-quoted attribute value; line breaks and tabs become character references. */
export function escapeAttr(text: string): string {
  return escapeText(text)
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

/** Whether a string can be an XML element or attribute name (letters, digits, underscore, dot, hyphen). */
export function isXmlName(name: string): boolean {
  return NAME.test(name);
}

/** The characters that may begin an XML name (XML 1.0, fifth edition), without the colon. */
const NAME_START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NOT_NAME_CHAR = new RegExp(
  `[^${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040]`,
  'gu',
);
const NAME_START_CHAR = new RegExp(`^[${NAME_START}]`, 'u');

/**
 * An xml:id from any id: characters outside the NCName set (which includes
 * Greek and other letters) become underscores, and a start that may not
 * begin a name gets one. Different ids can give the same name (A¹ and A²
 * both give A_); callers that need distinct names make them so.
 */
export function ncName(id: string, prefix = ''): string {
  const prefixed = `${prefix}${id.replace(NOT_NAME_CHAR, '_')}`;
  return NAME_START_CHAR.test(prefixed) ? prefixed : `_${prefixed}`;
}

export type AttrValue = string | number | boolean | null | undefined;

/**
 * Attributes of the XML namespace as the importer keeps them: the parser
 * drops prefixes, so `xml:lang` on an imported feature is stored as `lang`.
 * They are written back with their prefix; TEI has no attributes of these names.
 */
const XML_NAMESPACE_ATTRS = new Set(['lang', 'space', 'base']);

/** Attributes serialized for a start tag, with a leading space per attribute; null, undefined and invalid names are left out. */
export function attrsXml(
  attrs: Record<string, AttrValue> | undefined,
  exclude: readonly string[] = [],
): string {
  if (!attrs) return '';
  let out = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || exclude.includes(key) || !isXmlName(key)) continue;
    out += ` ${XML_NAMESPACE_ATTRS.has(key) ? `xml:${key}` : key}="${escapeAttr(String(value))}"`;
  }
  return out;
}

/** An element with text content, or an empty element when the text is undefined. */
export function elementXml(
  name: string,
  attrs: Record<string, AttrValue> | undefined,
  text?: string,
): string {
  const open = `<${name}${attrsXml(attrs)}`;
  return text === undefined ? `${open}/>` : `${open}>${escapeText(text)}</${name}>`;
}
