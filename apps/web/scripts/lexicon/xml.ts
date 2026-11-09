/**
 * A small XML reader for the lexica: elements, attributes, text, comments
 * and entities, as the TEI of the Perseus dictionaries uses them. Every
 * text node is kept, whitespace included, and a comment stays a node, so
 * that the text on its two sides stays in two pieces, as a full parser
 * gives it. It reads one fragment at a time (an entry), not a whole file:
 * no namespaces, no DTD; declarations and doctypes are skipped.
 */

export class XmlError extends Error {}

export interface XmlElement {
  kind: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export interface XmlText {
  kind: 'text';
  text: string;
}
export interface XmlComment {
  kind: 'comment';
}
export type XmlNode = XmlElement | XmlText | XmlComment;

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The text with its entities decoded: the five of XML, numeric ones, and the named ones given. An unknown name is an error. */
export function decodeEntities(text: string, named: Record<string, string> = {}): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/gu, (all, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    const value = XML_ENTITIES[body] ?? named[body];
    if (value === undefined) throw new XmlError(`unknown entity ${all}`);
    return value;
  });
}

const ATTRIBUTE = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/** The attributes of a tag, from the text between its name and its closing bracket. */
export function attributesOf(
  body: string,
  named: Record<string, string> = {},
): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTRIBUTE.exec(body)) !== null)
    attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '', named);
  return attrs;
}

const TAG_NAME = /[^\s/>]+/y;
const TAG_END = /\s*(\/?)>/y;

/** The nodes of a fragment: its elements and the text, comments between them. */
export function parseNodes(xml: string, named: Record<string, string> = {}): XmlNode[] {
  const root: XmlNode[] = [];
  const stack: XmlElement[] = [];
  let children = root;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    if (xml[i] !== '<') {
      const end = xml.indexOf('<', i);
      const stop = end < 0 ? n : end;
      children.push({ kind: 'text', text: decodeEntities(xml.slice(i, stop), named) });
      i = stop;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) throw new XmlError('a comment is never closed');
      children.push({ kind: 'comment' });
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) throw new XmlError('a CDATA section is never closed');
      children.push({ kind: 'text', text: xml.slice(i + 9, end) });
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) throw new XmlError('a processing instruction is never closed');
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      i = skipDeclaration(xml, i);
      continue;
    }
    if (xml.startsWith('</', i)) {
      const end = xml.indexOf('>', i);
      if (end < 0) throw new XmlError('an end tag is never closed');
      const name = xml.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name)
        throw new XmlError(`</${name}> closes ${open ? `<${open.name}>` : 'nothing'}`);
      children = stack.length ? stack[stack.length - 1]!.children : root;
      i = end + 1;
      continue;
    }
    TAG_NAME.lastIndex = i + 1;
    const name = TAG_NAME.exec(xml);
    if (!name || name.index !== i + 1) throw new XmlError(`a tag without a name at ${i}`);
    const element: XmlElement = { kind: 'element', name: name[0], attrs: {}, children: [] };
    let at = TAG_NAME.lastIndex;
    ATTRIBUTE.lastIndex = at;
    let m: RegExpExecArray | null;
    while ((m = ATTRIBUTE.exec(xml)) !== null) {
      element.attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '', named);
      at = ATTRIBUTE.lastIndex;
    }
    TAG_END.lastIndex = at;
    const close = TAG_END.exec(xml);
    if (!close) throw new XmlError(`the tag <${element.name}> at ${i} is never closed`);
    children.push(element);
    if (close[1] !== '/') {
      stack.push(element);
      children = element.children;
    }
    i = TAG_END.lastIndex;
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1]!.name}> is never closed`);
  return root;
}

/** A doctype or other declaration, with its internal subset in brackets, skipped. */
function skipDeclaration(xml: string, from: number): number {
  let depth = 0;
  for (let i = from + 2; i < xml.length; i++) {
    const c = xml[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return i + 1;
  }
  throw new XmlError('a declaration is never closed');
}

/** The one element of a fragment, with whitespace and comments around it allowed. */
export function parseElement(xml: string, named: Record<string, string> = {}): XmlElement {
  const nodes = parseNodes(xml, named);
  const elements = nodes.filter((node): node is XmlElement => node.kind === 'element');
  if (elements.length !== 1) throw new XmlError(`one element expected, ${elements.length} found`);
  for (const node of nodes) {
    if (node.kind === 'text' && node.text.trim() !== '')
      throw new XmlError('text outside the element');
  }
  return elements[0]!;
}

/** The text of an element and its descendants, in order. */
export function textOf(node: XmlNode): string {
  if (node.kind === 'text') return node.text;
  if (node.kind === 'comment') return '';
  return node.children.map(textOf).join('');
}
