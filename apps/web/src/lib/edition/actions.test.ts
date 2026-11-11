import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '$lib/record/actions';
import { editionActions, NO_RIGHTS, type EditionRights } from './actions';

const owner: EditionRights = { signedIn: true, edit: true, publish: true, delete: true };
const collaborator: EditionRights = { signedIn: true, edit: true, publish: false, delete: false };
const reader: EditionRights = { signedIn: true, edit: false, publish: false, delete: false };
const visitor = NO_RIGHTS;

const draft = { slug: 'liber-1', published: false };
const published = { slug: 'liber-1', published: true };

/** The menu as a list of words: the item ids, a label as `[Label]`, a separator as `|`. */
function shape(menu: MenuEntry[]): string[] {
  return menu.map((entry) =>
    entry.kind === 'separator' ? '|' : entry.kind === 'label' ? `[${entry.label}]` : entry.id,
  );
}

const downloads = ['[Download]', 'tei', 'package'];

describe('the menu of an edition', () => {
  it('has every item in its fixed order for the owner of a published edition', () => {
    const { menu } = editionActions(published, owner, 'list');
    expect(shape(menu)).toEqual([
      'settings',
      '|',
      'publish',
      'unpublish',
      '|',
      'copy',
      '|',
      ...downloads,
      '|',
      'delete',
    ]);
    expect(menu.map((m) => ('label' in m ? m.label : null)).filter(Boolean)).toEqual([
      'Edition Settings',
      'Publish…',
      'Unpublish…',
      'Make a Copy…',
      'Download',
      'TEI XML',
      'Package',
      'Delete Edition…',
    ]);
  });

  it('offers no Unpublish for a draft', () => {
    expect(shape(editionActions(draft, owner, 'list').menu)).toEqual([
      'settings',
      '|',
      'publish',
      '|',
      'copy',
      '|',
      ...downloads,
      '|',
      'delete',
    ]);
  });

  it('gives a collaborator the settings, the copy and the downloads', () => {
    for (const edition of [draft, published])
      expect(shape(editionActions(edition, collaborator, 'list').menu)).toEqual([
        'settings',
        '|',
        'copy',
        '|',
        ...downloads,
      ]);
  });

  it('leaves out the item for the page one is on', () => {
    expect(shape(editionActions(published, owner, 'settings').menu)).not.toContain('settings');
    for (const place of ['list', 'reader', 'editor'] as const)
      expect(shape(editionActions(published, owner, place).menu)[0]).toBe('settings');
  });

  it('is the same on every page but for that item', () => {
    const list = shape(editionActions(published, owner, 'list').menu);
    expect(shape(editionActions(published, owner, 'reader').menu)).toEqual(list);
    expect(shape(editionActions(published, owner, 'editor').menu)).toEqual(list);
    expect(shape(editionActions(published, owner, 'settings').menu)).toEqual(list.slice(2));
  });

  it('gives a reader of a published edition the copy and the downloads on its own pages', () => {
    expect(shape(editionActions(published, reader, 'reader').menu)).toEqual([
      'copy',
      '|',
      ...downloads,
    ]);
  });

  it('gives a visitor only the downloads', () => {
    expect(shape(editionActions(published, visitor, 'reader').menu)).toEqual(downloads);
  });

  it('gives those who may not edit nothing in a list', () => {
    for (const rights of [reader, visitor])
      expect(editionActions(published, rights, 'list')).toEqual({ buttons: [], menu: [] });
  });

  it('puts Delete last, after a separator, and marks it', () => {
    const menu = editionActions(draft, owner, 'reader').menu;
    expect(menu.at(-2)).toEqual({ kind: 'separator' });
    expect(menu.at(-1)).toMatchObject({ kind: 'action', id: 'delete', danger: true });
  });

  it('offers no plain text with an apparatus among the downloads', () => {
    const { menu } = editionActions(published, owner, 'reader');
    expect(menu.some((m) => 'id' in m && m.id === 'text')).toBe(false);
    expect(menu.some((m) => 'href' in m && m.href.endsWith('.txt'))).toBe(false);
  });

  it('links the downloads to the addresses given, else to the edition as readers see it', () => {
    const plain = editionActions(published, visitor, 'reader').menu;
    expect(plain).toContainEqual(
      expect.objectContaining({ id: 'tei', href: '/editions/liber-1.tei.xml', file: true }),
    );
    expect(plain).toContainEqual(
      expect.objectContaining({ id: 'package', href: '/editions/liber-1/package.zip', file: true }),
    );
    const version = editionActions(published, visitor, 'reader', {
      downloads: {
        tei: '/editions/liber-1.tei.xml?v=2',
        package: '/editions/liber-1/package.zip',
      },
    }).menu;
    expect(version).toContainEqual(
      expect.objectContaining({ id: 'tei', href: '/editions/liber-1.tei.xml?v=2' }),
    );
  });
});

describe('the buttons of an edition', () => {
  const buttons = (...args: Parameters<typeof editionActions>) =>
    editionActions(...args).buttons.map((b) => [b.id, b.href]);

  it('are Read and Edit, in that order, in a list and on Edition Settings', () => {
    for (const place of ['list', 'settings'] as const)
      expect(buttons(draft, collaborator, place)).toEqual([
        ['read', '/editions/liber-1'],
        ['edit', '/editions/liber-1/edit'],
      ]);
  });

  it('leave out Read in the reader and Edit in the editor', () => {
    expect(buttons(draft, owner, 'reader')).toEqual([['edit', '/editions/liber-1/edit']]);
    expect(buttons(draft, owner, 'editor')).toEqual([['read', '/editions/liber-1']]);
  });

  it('read the draft from the editor of a published edition', () => {
    expect(buttons(published, owner, 'editor')).toEqual([['read', '/editions/liber-1?draft=1']]);
    expect(buttons(published, owner, 'list')[0]).toEqual(['read', '/editions/liber-1']);
  });

  it('are for those who may edit only', () => {
    for (const place of ['list', 'reader', 'editor', 'settings'] as const) {
      expect(buttons(published, reader, place)).toEqual([]);
      expect(buttons(published, visitor, place)).toEqual([]);
    }
  });

  it('carry the name of the edition in a list', () => {
    const [read, edit] = editionActions(draft, owner, 'list', { name: 'Liber 1' }).buttons;
    expect(read).toMatchObject({ label: 'Read', name: 'Read: Liber 1' });
    expect(edit).toMatchObject({ label: 'Edit', name: 'Edit: Liber 1' });
  });

  it('escape the slug in their addresses', () => {
    expect(buttons({ slug: 'a b', published: false }, owner, 'list')[0]).toEqual([
      'read',
      '/editions/a%20b',
    ]);
  });
});
