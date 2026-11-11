import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '$lib/record/actions';
import { pageActions, type PageMenuState } from './actions';

const middle: PageMenuState = { index: 2, count: 3, hasImage: true, canView: true, busy: false };

/** The menu as a list of words: the item ids and a separator as `|`. */
const shape = (menu: MenuEntry[]): string[] =>
  menu.map((entry) => (entry.kind === 'separator' ? '|' : 'id' in entry ? entry.id : entry.label));

const disabled = (menu: MenuEntry[], id: string) =>
  menu.find((entry) => 'id' in entry && entry.id === id && entry.kind === 'action');

describe('the menu of a page card', () => {
  it('has its items in groups, with the removal last after a separator', () => {
    const { menu, buttons } = pageActions(middle);
    expect(buttons).toEqual([]);
    expect(shape(menu)).toEqual([
      'view',
      'rename',
      '|',
      'moveUp',
      'moveDown',
      'moveTo',
      '|',
      'image',
      'moveImage',
      'rights',
      'removeImage',
      'shiftImages',
      '|',
      'remove',
    ]);
    expect(menu.at(-2)).toEqual({ kind: 'separator' });
    expect(menu.at(-1)).toMatchObject({
      kind: 'action',
      id: 'remove',
      label: 'Remove Page…',
      danger: true,
    });
  });

  it('offers View only where the parent can show the image', () => {
    expect(shape(pageActions({ ...middle, canView: false }).menu)[0]).toBe('rename');
  });

  it('offers the image items of a page that has one only, and Add an Image for one without', () => {
    const without = pageActions({ ...middle, hasImage: false }).menu;
    expect(shape(without)).not.toContain('moveImage');
    expect(shape(without)).not.toContain('rights');
    expect(shape(without)).not.toContain('removeImage');
    expect(without).toContainEqual(
      expect.objectContaining({ id: 'image', label: 'Add an Image…' }),
    );
    expect(pageActions(middle).menu).toContainEqual(
      expect.objectContaining({ id: 'image', label: 'Replace Image…' }),
    );
  });

  it('shows what cannot be done now disabled, with its reason', () => {
    const first = pageActions({ ...middle, index: 1 }).menu;
    expect(disabled(first, 'moveUp')).toMatchObject({ disabled: 'It is the first page.' });
    expect(disabled(first, 'moveDown')).not.toHaveProperty('disabled');
    const last = pageActions({ ...middle, index: 3 }).menu;
    expect(disabled(last, 'moveDown')).toMatchObject({ disabled: 'It is the last page.' });
    const alone = pageActions({
      index: 1,
      count: 1,
      hasImage: true,
      canView: true,
      busy: false,
    }).menu;
    expect(disabled(alone, 'moveTo')).toMatchObject({ disabled: 'There is only one page.' });
    expect(disabled(alone, 'moveImage')).toMatchObject({ disabled: 'There is only one page.' });
  });

  it('disables every item but View with the reason while something happens to the page', () => {
    const menu = pageActions({ ...middle, busy: true }).menu;
    for (const entry of menu) {
      if (entry.kind !== 'action') continue;
      if (entry.id === 'view') expect(entry).not.toHaveProperty('disabled');
      else expect(entry).toHaveProperty('disabled', 'A change is under way.');
    }
  });
});
