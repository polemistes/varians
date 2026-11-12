import { describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import {
  decideReaderView,
  parseVersionNumber,
  readerLinks,
  readerRequestFromUrl,
  readerVersions,
  versionLine,
  type PublishedMoment,
} from './reader-pages.ts';

const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const moments: PublishedMoment[] = [
  { number: 2, version: 5, at: at(2), note: 'Second.', withdrawn: null },
  { number: 1, version: 3, at: at(1), note: null, withdrawn: null },
];
const edition = { version: 7 };
const reader = { canView: true, canEdit: false };
const editor = { canView: true, canEdit: true };

describe('decideReaderView', () => {
  it('shows everyone the latest version of an edition that has one', () => {
    expect(decideReaderView(edition, reader, moments, {})).toEqual({
      versionNumber: 2,
      mode: { kind: 'published', number: 2, at: at(2).toISOString(), note: 'Second.' },
    });
  });

  it('shows the draft of an edition with a version to its editors only, when asked', () => {
    const asked = decideReaderView(edition, reader, moments, { draft: true });
    expect(asked && 'mode' in asked ? asked.mode.kind : null).toBe('published');
    expect(decideReaderView(edition, editor, moments, { draft: true })).toEqual({
      versionNumber: null,
      mode: { kind: 'preview', version: 7, publishedNumber: 2 },
    });
  });

  it('shows the draft of an edition with no version to those who may edit it, and to nobody else', () => {
    expect(decideReaderView(edition, { canView: false, canEdit: false }, [], {})).toBeNull();
    expect(decideReaderView(edition, editor, [], {})).toEqual({
      versionNumber: null,
      mode: { kind: 'draft', version: 7 },
    });
    const asked = decideReaderView(edition, editor, [], { draft: true });
    expect(asked && 'mode' in asked ? asked.mode.kind : null).toBe('draft');
  });

  it('shows a version by its number, and says whether it is the latest', () => {
    expect(decideReaderView(edition, reader, moments, { version: 1 })).toEqual({
      versionNumber: 1,
      mode: {
        kind: 'version',
        number: 1,
        at: at(1).toISOString(),
        note: null,
        isCurrent: false,
        withdrawn: null,
        latest: 2,
      },
    });
    expect(decideReaderView(edition, reader, moments, { version: 2 })).toMatchObject({
      mode: { kind: 'version', isCurrent: true },
    });
    expect(decideReaderView(edition, reader, moments, { version: 3 })).toBeNull();
  });

  it('shows a withdrawn version at its address, with its withdrawal and the latest that stands, which the edition shows', () => {
    const withdrawn = { at: at(4), personId: null, personName: null, note: 'Wrong text.' };
    const versions: PublishedMoment[] = [{ ...moments[0]!, withdrawn }, moments[1]!];
    expect(decideReaderView(edition, reader, versions, { version: 2 })).toEqual({
      versionNumber: 2,
      mode: {
        kind: 'version',
        number: 2,
        at: at(2).toISOString(),
        note: 'Second.',
        isCurrent: false,
        withdrawn: { at: at(4).toISOString(), note: 'Wrong text.' },
        latest: 1,
      },
    });
    expect(decideReaderView(edition, reader, versions, {})).toMatchObject({
      versionNumber: 1,
      mode: { kind: 'published', number: 1 },
    });
    // Every version withdrawn: the edition is no longer public, but each version is still read at its address.
    const none = versions.map((v) => ({ ...v, withdrawn }));
    expect(decideReaderView(edition, { canView: false, canEdit: false }, none, {})).toBeNull();
    expect(
      decideReaderView(edition, { canView: false, canEdit: false }, none, { version: 1 }),
    ).toMatchObject({
      versionNumber: 1,
      mode: { kind: 'version', withdrawn: { note: 'Wrong text.' }, latest: null },
    });
  });
});

describe('readerLinks', () => {
  it('keeps every link within the state shown', () => {
    expect(
      readerLinks('iliad-1', { kind: 'published', number: 2, at: '', note: null }, reader, true),
    ).toEqual({
      basePath: '/editions/iliad-1',
      query: '',
      exports: {
        tei: '/editions/iliad-1.tei.xml',
        package: '/editions/iliad-1/package.zip',
      },
      detail: '/editions/iliad-1/detail.json',
      sites: '/editions/iliad-1/sites.json',
      links: { current: '/editions/iliad-1', preview: null },
    });
    expect(
      readerLinks(
        'iliad-1',
        {
          kind: 'version',
          number: 1,
          at: '',
          note: null,
          isCurrent: false,
          withdrawn: null,
          latest: 2,
        },
        editor,
        true,
      ),
    ).toMatchObject({
      basePath: '/editions/iliad-1/v/1',
      query: '',
      exports: { tei: '/editions/iliad-1.tei.xml?v=1' },
      detail: '/editions/iliad-1/detail.json?v=1',
      sites: '/editions/iliad-1/sites.json?v=1',
      links: { preview: '/editions/iliad-1?draft=1' },
    });
    expect(
      readerLinks('iliad-1', { kind: 'preview', version: 7, publishedNumber: 2 }, editor, true),
    ).toMatchObject({
      query: '?draft=1',
      exports: { tei: '/editions/iliad-1.tei.xml?draft=1' },
      detail: '/editions/iliad-1/detail.json?draft=1',
      sites: '/editions/iliad-1/sites.json?draft=1',
    });
    expect(
      readerLinks('iliad-1', { kind: 'draft', version: 4 }, editor, false).links.preview,
    ).toBeNull();
  });
});

describe('readerVersions', () => {
  it('links the latest version to the edition and the others to their permalinks, withdrawn ones marked', () => {
    const withdrawn = { at: at(4), personId: null, personName: null, note: 'Wrong.' };
    const listed = readerVersions('iliad-1', [{ ...moments[0]!, withdrawn }, moments[1]!], 1);
    expect(listed.map(({ changes: _changes, ...v }) => v)).toEqual([
      {
        number: 2,
        at: at(2).toISOString(),
        note: 'Second.',
        withdrawn: { at: at(4).toISOString(), note: 'Wrong.' },
        href: '/editions/iliad-1/v/2',
        current: false,
      },
      {
        number: 1,
        at: at(1).toISOString(),
        note: null,
        withdrawn: null,
        href: '/editions/iliad-1',
        current: true,
      },
    ]);
    expect(readerVersions('iliad-1', moments, null).every((v) => v.href.includes('/v/'))).toBe(
      true,
    );
  });
});

describe('versionLine', () => {
  it('says which state the text is in', () => {
    expect(versionLine({ kind: 'published', number: 2, at: at(2).toISOString(), note: null })).toBe(
      'Version 2, published 2026-10-02',
    );
    // A withdrawn version says so, in the plain text too.
    const version = {
      kind: 'version' as const,
      number: 1,
      at: at(1).toISOString(),
      note: null,
      isCurrent: false,
      latest: 2,
    };
    expect(versionLine({ ...version, withdrawn: null })).toBe('Version 1, published 2026-10-01');
    expect(versionLine({ ...version, withdrawn: { at: at(4).toISOString(), note: null } })).toBe(
      'Version 1, published 2026-10-01, withdrawn 2026-10-04',
    );
    // The draft has no number: a version is what is published.
    expect(versionLine({ kind: 'draft', version: 4 })).toBe('Draft');
    expect(versionLine({ kind: 'preview', version: 7, publishedNumber: 2 })).toBe(
      'Preview of the draft',
    );
  });
});

describe('version numbers in URLs', () => {
  it('takes positive whole numbers and refuses anything else with a 404', () => {
    expect(parseVersionNumber('2')).toBe(2);
    for (const bad of ['0', '-1', '1.5', 'x', '', '01']) {
      try {
        parseVersionNumber(bad);
        expect.unreachable(bad);
      } catch (error) {
        expect(isHttpError(error, 404)).toBe(true);
      }
    }
  });

  it('reads the downloads request from the query', () => {
    expect(readerRequestFromUrl(new URL('http://x/editions/a.txt'))).toEqual({ draft: false });
    expect(readerRequestFromUrl(new URL('http://x/editions/a.txt?draft=1'))).toEqual({
      draft: true,
    });
    expect(readerRequestFromUrl(new URL('http://x/editions/a.txt?v=3'))).toEqual({
      draft: false,
      version: 3,
    });
  });
});
