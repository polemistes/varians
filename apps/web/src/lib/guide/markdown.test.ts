import { describe, expect, it } from 'vitest';
import { inline, render, slug } from './markdown';

describe('the guide renderer', () => {
  it('renders inline marks and keeps only links the site can serve', () => {
    expect(inline('**bold**, *italic*, `a < b` and [here](#pages) or [notes](../notes.md)')).toBe(
      '<strong>bold</strong>, <em>italic</em>, <code>a &lt; b</code> and <a href="#pages">here</a> or notes',
    );
    expect(inline('γρ. in **Variant…** 2 * 3')).toBe('γρ. in <strong>Variant…</strong> 2 * 3');
    // A page of the site is a link; another site's path without a scheme is not.
    expect(inline('[the format](/formats) and [x](//evil.example/y)')).toBe('<a href="/formats">the format</a> and x');
  });

  it('renders headings with ids, paragraphs, nested lists and tables', () => {
    const { html, headings } = render(
      ['# Using Varians', '', 'A paragraph', 'on two lines.', '', '## A work', '', '- one', '  - under one', '- two', '', '| Keys | Action |', '|---|---|', '| Alt+N | next |'].join('\n'),
    );
    expect(headings).toEqual([
      { level: 1, id: 'using-varians', text: 'Using Varians' },
      { level: 2, id: 'a-work', text: 'A work' },
    ]);
    expect(html).toContain('<h1 id="using-varians">Using Varians</h1>');
    expect(html).toContain('<p>A paragraph on two lines.</p>');
    expect(html).toContain('<ul><li>one<ul><li>under one</li></ul></li><li>two</li></ul>');
    expect(html).toContain('<table><thead><tr><th>Keys</th><th>Action</th></tr></thead><tbody><tr><td>Alt+N</td><td>next</td></tr></tbody></table>');
  });

  it('makes slugs from any letters', () => {
    expect(slug('Pages, columns and paragraphs')).toBe('pages-columns-and-paragraphs');
    expect(slug('Ἰλιάς 1')).toBe('ἰλιάς-1');
  });

  it('renders fenced code as it stands, and relative links under a base when one is given', () => {
    const { html } = render('```\n<work>/\n  work.json   the *work*\n```\n\nSee [the changelog](CHANGELOG.md) and <https://varians.eu/formats/2/>.', { linkBase: '/formats/2/' });
    expect(html).toContain('<pre><code>&lt;work&gt;/\n  work.json   the *work*</code></pre>');
    expect(html).toContain('<a href="/formats/2/CHANGELOG.md">the changelog</a>');
    expect(html).toContain('<a href="https://varians.eu/formats/2/">https://varians.eu/formats/2/</a>');
    expect(render('[up](../x.md)', { linkBase: '/f/' }).html).not.toContain('href');
  });
});

