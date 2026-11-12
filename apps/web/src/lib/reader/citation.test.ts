import { describe, expect, it } from 'vitest';
import { versionCitation } from './citation';

describe('the citation of a version', () => {
  it('names the editors, the title, the version, its date, its address and the licence', () => {
    expect(
      versionCitation({
        editors: ['A. Editor', 'B. Editor'],
        title: 'Liber primus',
        number: 2,
        at: '2026-11-12T10:00:00.000Z',
        address: 'https://example.org/editions/liber/v/2',
        licence: 'CC BY-SA 4.0',
      }),
    ).toBe(
      'A. Editor and B. Editor, Liber primus, Version 2 (2026-11-12), https://example.org/editions/liber/v/2. CC BY-SA 4.0.',
    );
  });

  it('leaves out the editors and the licence where there are none', () => {
    expect(
      versionCitation({
        editors: [],
        title: 'M · Book 1',
        number: 1,
        at: '2026-11-12',
        address: 'https://example.org/transcriptions/T/v/1',
        licence: null,
      }),
    ).toBe('M · Book 1, Version 1 (2026-11-12), https://example.org/transcriptions/T/v/1.');
  });
});
