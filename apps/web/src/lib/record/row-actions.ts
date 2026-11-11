/**
 * What may be done with a smaller record, one that has no page of its own (a
 * conjecture, a reported reading, a bibliography entry): the menu at the end
 * of its row, wherever the row stands. Edit is the first item, deletion the
 * last after a separator (docs/design.md, section 4). An item is there only
 * for those who may do it; a row where none may be done has no menu.
 */
import { joinGroups, type MenuEntry, type RecordActions } from '$lib/record/actions';
import { recordActions } from '$lib/strings/record-actions';

/** What the viewer may do with the record. */
export interface RowMenuRights {
  edit: boolean;
  delete: boolean;
}

export const NO_ROW_RIGHTS: RowMenuRights = { edit: false, delete: false };

/** The ids of the menu's items, which the page does. */
export type RowActionId = 'edit' | 'delete';

/** The kinds that are drawn this way. */
export type RowKind = 'conjecture' | 'reading' | 'bibliography';

/** The menu of a row: Edit, then Delete; both are windows, so both end in an ellipsis. */
export function rowActions(kind: RowKind, rights: RowMenuRights): RecordActions {
  const t = recordActions[kind];
  const editing: MenuEntry[] = rights.edit ? [{ kind: 'action', id: 'edit', label: t.edit }] : [];
  const deleting: MenuEntry[] = rights.delete
    ? [{ kind: 'action', id: 'delete', label: t.delete, danger: true }]
    : [];
  return { buttons: [], menu: joinGroups([editing, deleting]) };
}
