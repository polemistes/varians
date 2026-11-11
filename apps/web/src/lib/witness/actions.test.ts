import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '$lib/record/actions';
import { NO_WITNESS_RIGHTS, witnessActions, type WitnessRights } from './actions';

const creator: WitnessRights = { maintain: true, merge: true, delete: true };
const maintainer: WitnessRights = { maintain: true, merge: true, delete: false };
const siteEditor: WitnessRights = { maintain: true, merge: false, delete: false };
const stranger = NO_WITNESS_RIGHTS;

const witness = { slug: 'codex-m' };

const shape = (menu: MenuEntry[]): string[] =>
  menu.map((entry) => (entry.kind === 'separator' ? '|' : 'id' in entry ? entry.id : entry.label));

describe('the menu of a witness', () => {
  it('has Merge and then Delete, in that order, for its creator', () => {
    const { menu } = witnessActions(witness, creator, 'page');
    expect(shape(menu)).toEqual(['merge', '|', 'delete']);
    expect(menu.map((m) => ('label' in m ? m.label : null)).filter(Boolean)).toEqual([
      'Merge into…',
      'Delete Witness…',
    ]);
  });

  it('gives a maintainer the merge and no deletion', () => {
    expect(shape(witnessActions(witness, maintainer, 'page').menu)).toEqual(['merge']);
  });

  it('gives a site editor, who may edit and not merge or delete, no menu', () => {
    expect(witnessActions(witness, siteEditor, 'page').menu).toEqual([]);
    expect(witnessActions(witness, siteEditor, 'page').buttons).toHaveLength(1);
  });

  it('gives a stranger nothing', () => {
    expect(witnessActions(witness, stranger, 'page')).toEqual({ buttons: [], menu: [] });
    expect(witnessActions(witness, stranger, 'list')).toEqual({ buttons: [], menu: [] });
  });

  it('is the same in a list as on the page', () => {
    for (const rights of [creator, maintainer, siteEditor])
      expect(witnessActions(witness, rights, 'list')).toEqual(
        witnessActions(witness, rights, 'page'),
      );
  });

  it('puts Delete last, after a separator, and marks it', () => {
    const menu = witnessActions(witness, creator, 'page').menu;
    expect(menu.at(-2)).toEqual({ kind: 'separator' });
    expect(menu.at(-1)).toMatchObject({ kind: 'action', id: 'delete', danger: true });
  });

  it('shows Delete disabled with the reason where it is known', () => {
    const reason = 'This witness cannot be deleted while the edition X depends on it.';
    expect(
      witnessActions(witness, creator, 'page', { deletion: reason }).menu.at(-1),
    ).toMatchObject({ id: 'delete', disabled: reason });
  });

  it('leads to the merge page', () => {
    expect(witnessActions({ slug: 'a b' }, creator, 'page').menu[0]).toMatchObject({
      kind: 'link',
      href: '/witnesses/a%20b/merge',
    });
  });
});

describe('the button of a witness', () => {
  it('is Edit for those who maintain it, on its page and in a list', () => {
    for (const place of ['page', 'list'] as const)
      expect(witnessActions(witness, maintainer, place).buttons).toEqual([
        { id: 'edit', label: 'Edit', href: '/witnesses/codex-m/edit' },
      ]);
  });

  it('carries the name in a list', () => {
    expect(
      witnessActions(witness, maintainer, 'list', { name: 'Codex M' }).buttons[0],
    ).toMatchObject({ name: 'Edit: Codex M' });
  });
});
