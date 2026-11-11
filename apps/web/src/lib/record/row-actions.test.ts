import { describe, expect, it } from 'vitest';
import { NO_ROW_RIGHTS, rowActions, type RowKind } from './row-actions';

const kinds: RowKind[] = ['conjecture', 'reading', 'bibliography'];

describe('the menu of a row', () => {
  it('has Edit first and Delete last after a separator, for every kind', () => {
    for (const kind of kinds) {
      const { menu, buttons } = rowActions(kind, { edit: true, delete: true });
      expect(buttons).toEqual([]);
      expect(menu).toEqual([
        { kind: 'action', id: 'edit', label: 'Edit…' },
        { kind: 'separator' },
        { kind: 'action', id: 'delete', label: 'Delete…', danger: true },
      ]);
    }
  });

  it('gives one who may edit and not delete Edit alone', () => {
    for (const kind of kinds)
      expect(rowActions(kind, { edit: true, delete: false }).menu).toEqual([
        { kind: 'action', id: 'edit', label: 'Edit…' },
      ]);
  });

  it('gives one who may delete and not edit Delete alone, with no separator before it', () => {
    for (const kind of kinds)
      expect(rowActions(kind, { edit: false, delete: true }).menu).toEqual([
        { kind: 'action', id: 'delete', label: 'Delete…', danger: true },
      ]);
  });

  it('gives those who may do neither no menu', () => {
    for (const kind of kinds)
      expect(rowActions(kind, NO_ROW_RIGHTS)).toEqual({ buttons: [], menu: [] });
  });

  it('is one menu for the three kinds: the same items in the same order', () => {
    const [first, ...others] = kinds.map((kind) => rowActions(kind, { edit: true, delete: true }));
    for (const other of others) expect(other).toEqual(first);
  });
});
