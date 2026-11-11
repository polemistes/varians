import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '$lib/record/actions';
import { NO_WORK_RIGHTS, workActions, type WorkRights } from './actions';

const maintainer: WorkRights = { maintain: true, merge: true, delete: false, administrator: false };
const creator: WorkRights = { maintain: true, merge: true, delete: true, administrator: false };
const siteEditor: WorkRights = {
  maintain: true,
  merge: false,
  delete: false,
  administrator: false,
};
const administrator: WorkRights = {
  maintain: true,
  merge: true,
  delete: true,
  administrator: true,
};
const stranger: WorkRights = NO_WORK_RIGHTS;

const work = { slug: 'iliad' };

/** The menu as a list of words: the item ids, a label as `[Label]`, a separator as `|`. */
function shape(menu: MenuEntry[]): string[] {
  return menu.map((entry) =>
    entry.kind === 'separator' ? '|' : entry.kind === 'label' ? `[${entry.label}]` : entry.id,
  );
}

describe('the menu of a work', () => {
  it('has every item in its fixed order for an administrator', () => {
    const { menu } = workActions(work, administrator, 'page');
    expect(shape(menu)).toEqual([
      'remotes',
      '|',
      '[Download]',
      'package',
      'archive',
      '|',
      'merge',
      '|',
      'delete',
    ]);
    expect(menu.map((m) => ('label' in m ? m.label : null)).filter(Boolean)).toEqual([
      'Other Installations',
      'Download',
      'Package',
      'Archive with History',
      'Merge into…',
      'Delete Work…',
    ]);
  });

  it('gives the creator everything but the server’s archive', () => {
    expect(shape(workActions(work, creator, 'page').menu)).toEqual([
      'remotes',
      '|',
      '[Download]',
      'package',
      '|',
      'merge',
      '|',
      'delete',
    ]);
  });

  it('gives a maintainer who may not delete no deletion', () => {
    expect(shape(workActions(work, maintainer, 'page').menu)).toEqual([
      'remotes',
      '|',
      '[Download]',
      'package',
      '|',
      'merge',
    ]);
  });

  it('gives a site editor the settings and the package but no merge or deletion', () => {
    expect(shape(workActions(work, siteEditor, 'page').menu)).toEqual([
      'remotes',
      '|',
      '[Download]',
      'package',
    ]);
  });

  it('gives a visitor or a stranger the package only, on the work’s own page', () => {
    expect(shape(workActions(work, stranger, 'page').menu)).toEqual(['[Download]', 'package']);
  });

  it('is the same in a list as on the page, for those who may change the work', () => {
    for (const rights of [administrator, creator, maintainer, siteEditor])
      expect(shape(workActions(work, rights, 'list').menu)).toEqual(
        shape(workActions(work, rights, 'page').menu),
      );
  });

  it('gives those who may not change the work nothing in a list', () => {
    expect(workActions(work, stranger, 'list')).toEqual({ buttons: [], menu: [] });
  });

  it('puts Delete last, after a separator, and marks it', () => {
    const menu = workActions(work, creator, 'page').menu;
    expect(menu.at(-2)).toEqual({ kind: 'separator' });
    expect(menu.at(-1)).toMatchObject({ kind: 'action', id: 'delete', danger: true });
  });

  it('shows Delete disabled with the reason where it is known', () => {
    const reason = 'This work cannot be deleted while the edition X depends on it.';
    const menu = workActions(work, creator, 'page', { deletion: reason }).menu;
    expect(menu.at(-1)).toMatchObject({ id: 'delete', disabled: reason });
    expect(workActions(work, creator, 'page').menu.at(-1)).not.toHaveProperty('disabled');
    // A reason shows only to those who may delete at all.
    expect(shape(workActions(work, maintainer, 'page', { deletion: reason }).menu)).not.toContain(
      'delete',
    );
  });

  it('leads to the pages and files of the work', () => {
    const menu = workActions({ slug: 'a b' }, administrator, 'page').menu;
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'remotes', href: '/works/a%20b/remotes' }),
    );
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'package', href: '/works/a%20b/package.zip', file: true }),
    );
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'archive', href: '/works/a%20b/archive.zip', file: true }),
    );
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'merge', href: '/works/a%20b/merge' }),
    );
  });
});

describe('the buttons of a work', () => {
  it('are Edit for those who maintain it, on its page and in a list', () => {
    for (const place of ['page', 'list'] as const)
      expect(workActions(work, maintainer, place).buttons).toEqual([
        { id: 'edit', label: 'Edit', href: '/works/iliad/edit' },
      ]);
  });

  it('include the work’s name in a list, for the accessible name', () => {
    const [button] = workActions(work, maintainer, 'list', { name: 'Iliad' }).buttons;
    expect(button).toMatchObject({ id: 'edit', name: 'Edit: Iliad' });
  });

  it('are none for those who may not edit', () => {
    expect(workActions(work, stranger, 'page').buttons).toEqual([]);
  });
});
