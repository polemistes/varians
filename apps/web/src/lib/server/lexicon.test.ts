import { describe, expect, it } from 'vitest';
import { safeEntryHtml } from './lexicon';

describe('safeEntryHtml', () => {
  it('lets through the markup the dictionaries use', () => {
    expect(safeEntryHtml('<p><b>μῆνις</b>, <i>ιος</i>, <span class="sense">wrath</span></p>')).toBe(
      '<p><b>μῆνις</b>, <i>ιος</i>, <span class="sense">wrath</span></p>',
    );
  });

  it('escapes everything else', () => {
    expect(
      safeEntryHtml(
        '<script>alert(1)</script><span class="x" onclick="y">z</span><img src=x onerror=1>',
      ),
    ).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;&lt;span class=&quot;x&quot; onclick=&quot;y&quot;&gt;z</span>&lt;img src=x onerror=1&gt;',
    );
    // An entity quote cannot close the class: it stays text.
    expect(safeEntryHtml('<span class="a&quot;><b>">')).toBe('<span class="a"><b>&quot;&gt;');
  });
});
