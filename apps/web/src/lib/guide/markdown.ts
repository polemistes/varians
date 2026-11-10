/**
 * The guide's Markdown as HTML: the small subset docs/guide.md uses.
 * Headings (with ids, for a table of contents), paragraphs, bulleted lists
 * one level deep, tables, fenced code blocks, and inline bold, italic
 * (with asterisks or underscores, since Prettier writes underscores), code
 * and links. Links into the repository, which the site does not serve,
 * become plain text, unless a base is given that serves them (the format
 * specification at /formats).
 */

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RenderOptions {
  /** Where relative links point: they become links under this address rather than plain text. */
  linkBase?: string;
}

/** Bold, italic, code and links within one run of text. */
export function inline(text: string, options: RenderOptions = {}): string {
  return inlineWith(text, options);
}

function inlineWith(text: string, options: RenderOptions): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${escape(part.slice(1, -1))}</code>`;
      let s = escape(part);
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
        if (/^(https?:\/\/|#|\/(?!\/))/.test(href)) return `<a href="${href}">${label}</a>`;
        if (options.linkBase && /^[\w./-]+(#[\w-]*)?$/.test(href) && !href.includes('..'))
          return `<a href="${options.linkBase}${href}">${label}</a>`;
        return label;
      });
      s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
      return s;
    })
    .join('');
}

/** The text of a heading without its marks, for the table of contents. */
function plain(text: string): string {
  return text.replace(/\*\*|`|\*/g, '').replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1$2');
}

export function render(markdown: string, options: RenderOptions = {}): Rendered {
  const inline = (text: string) => inlineWith(text, options);
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  let paragraph: string[] = [];
  let list: { depth: number; items: string[] }[] = [];
  let table: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const html: string[] = ['<ul>'];
    list.forEach((item, k) => {
      const next = list[k + 1];
      if (item.depth === 0) {
        html.push(`<li>${inline(item.items[0]!)}`);
        if (next && next.depth > 0) html.push('<ul>');
        else html.push('</li>');
      } else {
        html.push(`<li>${inline(item.items[0]!)}</li>`);
        if (!next || next.depth === 0) html.push('</ul></li>');
      }
    });
    html.push('</ul>');
    out.push(html.join(''));
    list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.map((row) =>
      row
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
    const [head, , ...body] = rows;
    const cells = (row: string[], tag: string) =>
      row.map((cell) => `<${tag}>${inline(cell)}</${tag}>`).join('');
    out.push(
      `<table><thead><tr>${cells(head ?? [], 'th')}</tr></thead><tbody>${body.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody></table>`,
    );
    table = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  let fence: string[] | null = null;
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (fence === null) {
        flushAll();
        fence = [];
      } else {
        out.push(`<pre><code>${escape(fence.join('\n'))}</code></pre>`);
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      const id = slug(plain(text));
      headings.push({ level, id, text: plain(text) });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^\|/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line.trim());
      continue;
    }
    const item = /^( *)- (.+)$/.exec(line);
    if (item) {
      flushParagraph();
      flushTable();
      list.push({ depth: item[1]!.length >= 2 ? 1 : 0, items: [item[2]!] });
      continue;
    }
    if (line.trim() === '') {
      flushAll();
      continue;
    }
    // A continuation of the last list item, indented under it.
    if (list.length && /^\s{2,}\S/.test(line)) {
      list[list.length - 1]!.items[0] += ' ' + line.trim();
      continue;
    }
    flushList();
    flushTable();
    paragraph.push(line.trim());
  }
  flushAll();
  return { html: out.join('\n'), headings };
}
