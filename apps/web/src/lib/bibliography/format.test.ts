import { describe, expect, it } from 'vitest';
import { formatCitation, formatNames, referencePieces, referenceText } from './format.ts';

describe('references', () => {
  it('formats names in the author-date way', () => {
    expect(formatNames([{ family: 'West', given: 'M. L.' }])).toBe('West, M. L.');
    expect(formatNames([{ family: 'Dover', given: 'K. J.' }, { family: 'Henderson', given: 'J.' }])).toBe('Dover, K. J. and J. Henderson');
    expect(formatNames([{ family: 'Page', given: 'D. L.' }, { family: 'others', given: '' }])).toBe('Page, D. L. et al.');
  });

  it('writes books, articles and chapters', () => {
    expect(
      referenceText({ type: 'book', key: 'west1998', fields: { author: 'West, Martin L.', title: 'Homeri Ilias', date: '1998', location: 'Stuttgart', publisher: 'Teubner' } }),
    ).toBe('West, Martin L. 1998. Homeri Ilias. Stuttgart: Teubner.');
    expect(
      referenceText({
        type: 'article',
        key: 'x',
        fields: { author: 'Bentley, Richard', title: 'Notes on Homer', journaltitle: 'Classical Quarterly', volume: '12', pages: '45--47', year: '1732' },
      }),
    ).toBe('Bentley, Richard. 1732. ‘Notes on Homer’. Classical Quarterly 12: 45–47.');
    expect(
      referenceText({
        type: 'incollection',
        key: 'y',
        fields: { author: 'Allen, T. W.', title: 'The text', editor: 'Monro, D. B.', booktitle: 'Homeri opera', pages: '1--10', date: '1902', location: 'Oxford' },
      }),
    ).toBe('Allen, T. W. 1902. ‘The text’. In Monro, D. B. (ed.), Homeri opera, 1–10. Oxford.');
    expect(referenceText({ type: 'book', key: 'z', fields: { editor: 'Allen, T. W. and Monro, D. B.', title: 'Homeri opera', date: '1920' } })).toBe(
      'Allen, T. W. and D. B. Monro (eds.). 1920. Homeri opera.',
    );
  });

  it('sets book titles in italics and turns LaTeX into letters', () => {
    const pieces = referencePieces({ type: 'book', key: 'w', fields: { author: 'Wilamowitz-Moellendorff, Ulrich von', title: 'Die Ilias und Homer', year: '1916' } });
    expect(pieces.find((p) => p.italic)?.text).toBe('Die Ilias und Homer');
    expect(referenceText({ type: 'book', key: 'g', fields: { author: 'G{\\"o}the, J.', title: 'T', year: '1800' } })).toContain('Göthe');
  });

  it('cites with notes before and after', () => {
    expect(formatCitation('West 1998', 'cf.', '45')).toBe('cf. West 1998, 45');
    expect(formatCitation('West 1998')).toBe('West 1998');
  });
});
