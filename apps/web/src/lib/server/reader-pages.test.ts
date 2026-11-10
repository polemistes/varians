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
  { number: 2, version: 5, at: at(2) },
  { number: 1, version: 3, at: at(1) },
];
const published = { visibility: 'published' as const, version: 7, publishedVersion: 5 };
const draft = { visibility: 'draft' as const, version: 4, publishedVersion: null };
const reader = { canView: true, canEdit: false };
const editor = { canView: true, canEdit: true };

describe('decideReaderView', () => {
  it('shows everyone the published version of a published edition', () => {
    expect(decideReaderView(published, reader, moments, {})).toEqual({
      atVersion: 5,
      mode: { kind: 'published', number: 2, at: at(2).toISOString() },
    });
  });

  it('shows the draft of a published edition to its editors only, when asked', () => {
    expect(decideReaderView(published, reader, moments, { draft: true })?.mode.kind).toBe(
      'published',
    );
    expect(decideReaderView(published, editor, moments, { draft: true })).toEqual({
      atVersion: null,
      mode: { kind: 'preview', version: 7, publishedNumber: 2 },
    });
  });

  it('shows a draft to those who may view it, and to nobody else', () => {
    expect(decideReaderView(draft, { canView: false, canEdit: false }, [], {})).toBeNull();
    expect(decideReaderView(draft, editor, [], {})).toEqual({
      atVersion: null,
      mode: { kind: 'draft', version: 4 },
    });
    expect(decideReaderView(draft, editor, [], { draft: true })?.mode.kind).toBe('draft');
  });

  it('shows a published version by its number, and says whether it is the current one', () => {
    expect(decideReaderView(published, reader, moments, { version: 1 })).toEqual({
      atVersion: 3,
      mode: { kind: 'version', number: 1, at: at(1).toISOString(), isCurrent: false },
    });
    expect(decideReaderView(published, reader, moments, { version: 2 })?.mode).toMatchObject({
      kind: 'version',
      isCurrent: true,
    });
    expect(decideReaderView(published, reader, moments, { version: 3 })).toBeNull();
  });

  it('keeps the versions of an edition taken back to a draft for those who may see it', () => {
    expect(
      decideReaderView(draft, { canView: false, canEdit: false }, moments, { version: 1 }),
    ).toBeNull();
    expect(decideReaderView(draft, editor, moments, { version: 2 })?.mode).toMatchObject({
      kind: 'version',
      number: 2,
      isCurrent: false,
    });
  });

  it('shows a published edition without a published moment as published, unnumbered', () => {
    expect(decideReaderView({ ...published, publishedVersion: 7 }, reader, [], {})).toEqual({
      atVersion: 7,
      mode: { kind: 'published', number: null, at: null },
    });
  });
});

describe('readerLinks', () => {
  it('keeps every link within the state shown', () => {
    expect(
      readerLinks('iliad-1', { kind: 'published', number: 2, at: null }, reader, true),
    ).toEqual({
      basePath: '/editions/iliad-1',
      query: '',
      exports: {
        text: '/editions/iliad-1.txt',
        tei: '/editions/iliad-1.tei.xml',
        package: '/editions/iliad-1/package.zip',
      },
      detail: '/editions/iliad-1/detail.json',
      links: { current: '/editions/iliad-1', preview: null, editor: null },
    });
    expect(
      readerLinks(
        'iliad-1',
        { kind: 'version', number: 1, at: '', isCurrent: false },
        editor,
        true,
      ),
    ).toMatchObject({
      basePath: '/editions/iliad-1/v/1',
      query: '',
      exports: { text: '/editions/iliad-1.txt?v=1', tei: '/editions/iliad-1.tei.xml?v=1' },
      detail: '/editions/iliad-1/detail.json?v=1',
      links: { preview: '/editions/iliad-1?draft=1', editor: '/editions/iliad-1/edit' },
    });
    expect(
      readerLinks('iliad-1', { kind: 'preview', version: 7, publishedNumber: 2 }, editor, true),
    ).toMatchObject({
      query: '?draft=1',
      exports: { text: '/editions/iliad-1.txt?draft=1' },
      detail: '/editions/iliad-1/detail.json?draft=1',
    });
    expect(
      readerLinks('iliad-1', { kind: 'draft', version: 4 }, editor, false).links.preview,
    ).toBeNull();
  });
});

describe('readerVersions', () => {
  it('links the current version to the edition and the others to their permalinks', () => {
    expect(readerVersions('iliad-1', moments, 2)).toEqual([
      { number: 2, at: at(2).toISOString(), href: '/editions/iliad-1', current: true },
      { number: 1, at: at(1).toISOString(), href: '/editions/iliad-1/v/1', current: false },
    ]);
    expect(readerVersions('iliad-1', moments, null).every((v) => v.href.includes('/v/'))).toBe(
      true,
    );
  });
});

describe('versionLine', () => {
  it('says which state the text is in', () => {
    expect(versionLine({ kind: 'published', number: 2, at: at(2).toISOString() })).toBe(
      'Version 2, published 2026-10-02',
    );
    expect(versionLine({ kind: 'published', number: null, at: null })).toBe('Published');
    expect(versionLine({ kind: 'draft', version: 4 })).toBe('Draft, version 4');
    expect(versionLine({ kind: 'preview', version: 7, publishedNumber: 2 })).toBe(
      'Preview of the draft, version 7',
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
